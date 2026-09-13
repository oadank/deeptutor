"""Authenticated transport for schema-driven Immersive Reading extensions."""

from __future__ import annotations

import asyncio
import inspect
import logging
import re
import time
import unicodedata
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError

from deeptutor.multi_user.learning_access import (
    allowed_reading_extensions,
    assert_learning_material,
)
from deeptutor.reading import ReadingStore
from deeptutor.reading.extensions import (
    ReadingContext,
    ReadingExtensionResult,
    get_reading_extension_registry,
)

logger = logging.getLogger(__name__)
router = APIRouter()
# LLM-backed actions (translation / quiz) routinely need more than 30s on a
# reasoning model; browser_speech is instant. One ceiling for all of them kept
# opening the circuit breaker on ordinary cold starts.
ACTION_TIMEOUT_S = 120
_LLM_EXTENSIONS = frozenset({"translation", "quiz", "study_guidance", "vocabulary"})
_TIMED_OUT_COOLDOWN_S = 90.0


class ActionPayload(BaseModel):
    locator: int = Field(ge=1)
    selection: str = Field(default="", max_length=10_000)
    locale: str = Field(default="en", max_length=32)


def _normal(value: str) -> str:
    """Whitespace-only normalisation for display-facing text."""
    return re.sub(r"\s+", " ", value).strip()


_WS_MAP = dict.fromkeys(map(ord, "\t\n\r\f\v            ​‌‍ 　"), " ")
_WS_MAP.update({ord(c): None for c in "­﻿"})
_PUNCT_WS = str.maketrans({c: " " for c in "‘’“”‟′″·・•・‧"})


def _match_key(value: str) -> str:
    """Aggressive normalisation for verifying a browser selection against
    stored unit text. PDF extractors and DOM selections disagree on soft
    hyphens, NBSP, zero-width marks and curly quotes — none of which the
    learner can see."""
    text = unicodedata.normalize("NFKC", value or "")
    text = text.translate(_WS_MAP).translate(_PUNCT_WS)
    return re.sub(r"\s+", " ", text).strip().casefold()


def _verified_selection(candidate: str, unit_text: str) -> str:
    """Return the candidate when it is (a tolerant form of) text from the unit.

    Exact substring match after whitespace normalisation is the happy path.
    When the DOM quote and the stored page disagree on invisible characters
    only, the aggressive key match still accepts it. A short distinctive
    prefix is tried last so a multi-line selection that lost its trailing
    punctuation still verifies.
    """
    value = _normal(candidate)
    if not value:
        return ""
    if value in _normal(unit_text):
        return value
    key = _match_key(value)
    unit_key = _match_key(unit_text)
    if key and key in unit_key:
        return value
    # Prefix of the first sentence / first 48 visible chars — enough for a
    # PDF that hyphenates across lines differently than the browser.
    for size in (48, 24):
        prefix = key[:size].strip()
        if len(prefix) >= 12 and prefix in unit_key:
            return value
    return ""


@router.get("/extensions")
async def list_extensions() -> list[dict[str, Any]]:
    allowed = allowed_reading_extensions()
    return [
        extension.manifest.model_dump()
        for extension in get_reading_extension_registry().all()
        if allowed is None or extension.manifest.id in allowed
    ]


@router.post("/materials/{material_id}/extensions/{extension_id}/actions/{action}")
async def run_extension_action(
    material_id: str,
    extension_id: str,
    action: str,
    payload: ActionPayload,
) -> dict[str, Any]:
    try:
        assert_learning_material(material_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    allowed = allowed_reading_extensions()
    if allowed is not None and extension_id not in allowed:
        raise HTTPException(status_code=403, detail="This reading extension is not allowed.")

    registry = get_reading_extension_registry()
    extension = registry.get(extension_id)
    if extension is None:
        raise HTTPException(status_code=404, detail="Reading extension not found.")
    declared_action = next((row for row in extension.manifest.actions if row.id == action), None)
    if declared_action is None:
        raise HTTPException(status_code=404, detail="Reading extension action not found.")
    store = ReadingStore()
    try:
        unit_text = store.unit_text(material_id, payload.locator)
        position = store.position(material_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    selection = _verified_selection(payload.selection, unit_text)
    if "selection" in declared_action.requires and not selection:
        raise HTTPException(status_code=400, detail="Select text from the visible unit first.")
    try:
        context = ReadingContext(
            material_id=material_id,
            locator=payload.locator,
            source_anchor=(position.source_anchor if position.locator == payload.locator else ""),
            locale=payload.locale,
            selection=selection,
            visible_text=unit_text,
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail="This reading unit is too large for the extension protocol.",
        ) from exc
    if not registry.begin_action(extension_id):
        raise HTTPException(
            status_code=503,
            detail={
                "message": "This reading action is temporarily unavailable.",
                "recoverable": True,
            },
        )
    # LLM-backed actions get the full budget; browser_speech is instant.
    timeout_s = (
        ACTION_TIMEOUT_S if extension_id in _LLM_EXTENSIONS else min(30, ACTION_TIMEOUT_S)
    )
    try:
        async with asyncio.timeout(timeout_s):
            loop = asyncio.get_running_loop()
            value = await loop.run_in_executor(
                registry.executor_for(extension_id),
                extension.run_action,
                action,
                context,
            )
            if inspect.isawaitable(value):
                value = await value
        result = (
            value
            if isinstance(value, ReadingExtensionResult)
            else ReadingExtensionResult.model_validate(value)
        )
        if result.type not in extension.manifest.result_types:
            raise ValueError(f"Extension returned undeclared result type {result.type!r}.")
        return result.model_dump()
    except TimeoutError as exc:
        registry.mark_timed_out(extension_id, cooldown_s=timeout_s)
        logger.warning(
            "Reading extension %s action %s timed out after %.0fs",
            extension_id,
            action,
            timeout_s,
            exc_info=True,
        )
        raise HTTPException(
            status_code=503,
            detail={
                "message": "This reading action is temporarily unavailable.",
                "recoverable": True,
            },
        ) from exc
    except ValueError as exc:
        # Model-shape / grounding failures are user-actionable — do not dress
        # them as a temporary outage.
        logger.warning(
            "Reading extension %s action %s rejected: %s",
            extension_id,
            action,
            exc,
            exc_info=True,
        )
        raise HTTPException(
            status_code=422,
            detail={
                "message": str(exc)
                or "The model returned an unusable result for this passage. Try selecting different text or scrolling to another page.",
                "recoverable": True,
            },
        ) from exc
    except Exception as exc:
        # Previously every failure (LLM JSON shape, missing key, provider
        # error) was swallowed into the same 503 with no log line — undiagnosable.
        logger.warning(
            "Reading extension %s action %s failed: %s",
            extension_id,
            action,
            exc,
            exc_info=True,
        )
        raise HTTPException(
            status_code=503,
            detail={
                "message": "This reading action is temporarily unavailable.",
                "recoverable": True,
            },
        ) from exc
    finally:
        registry.finish_action(extension_id)


__all__ = ["router"]
