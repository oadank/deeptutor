"""anydoc engine config (read-side adapter over the v2 settings slice)."""

from __future__ import annotations

from dataclasses import dataclass

from deeptutor.services.config.runtime_settings import (
    DOCUMENT_PARSING_ENGINE_ANYDOC,
    load_document_parsing_settings,
)


@dataclass(frozen=True)
class AnydocConfig:
    # "reject" (default) keeps scanning/OCR-only files local — the parse fails
    # with NeedsOcr and the KB upload can fall back to another engine. "hosted"
    # would ship the whole document to Firecrawl's cloud; not a default here.
    ocr: str = "reject"


def resolve_anydoc_config() -> AnydocConfig:
    slice_ = (
        load_document_parsing_settings()
        .get("engines", {})
        .get(DOCUMENT_PARSING_ENGINE_ANYDOC, {})
    )
    ocr = str(slice_.get("ocr") or "reject").strip().lower()
    if ocr not in ("reject", "hosted"):
        ocr = "reject"
    return AnydocConfig(ocr=ocr)


__all__ = ["AnydocConfig", "resolve_anydoc_config"]
