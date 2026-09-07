"""OpenClaw backend — one persistent agent turn over ACP.

Speaks the Agent Client Protocol (``openclaw acp``) — the same long-lived
surface the agents-to-feishu bridge runs in production — instead of the
one-shot ``openclaw agent --json`` gateway path. The gateway daemon proved
fragile on this deployment (its supervisor task is disabled and its port is
taken by tailscaled), while ACP needs no daemon at all. Consults reuse the
agent's session across calls: the ACP session id rides in
``ConsultResult.session_id``, so a follow-up consult continues the same
conversation.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

from deeptutor.services.subagent.acp_client import AcpError, get_shared
from deeptutor.services.subagent.base import OnEvent, SubagentBackend
from deeptutor.services.subagent.config import BackendConfig
from deeptutor.services.subagent.process import not_found_detail, probe_version
from deeptutor.services.subagent.types import (
    EVENT_ERROR,
    EVENT_LOG,
    EVENT_REASONING,
    EVENT_TEXT,
    EVENT_TOOL,
    ConsultResult,
    DetectResult,
    SubagentEvent,
)

logger = logging.getLogger(__name__)

_STATE_DIR = Path(os.environ.get("DEEPTUTOR_OPENCLAW_STATE_DIR") or Path.home() / ".openclaw")
_EXEC = Path(os.environ.get("DEEPTUTOR_OPENCLAW_EXEC") or Path.home() / "AppData/Roaming/npm/openclaw.exe")


def _spawn_spec() -> tuple[str, list[str], str] | None:
    if _EXEC.is_file():
        return str(_EXEC), ["acp"], str(_STATE_DIR)
    return None


class OpenClawBackend(SubagentBackend):
    kind = "openclaw"
    display_name = "OpenClaw"
    cli_command = "openclaw"

    def __init__(self) -> None:
        self._consult_lock = asyncio.Lock()

    async def detect(self) -> DetectResult:
        ok, text = await probe_version([self.cli_command, "--version"])
        detail = "" if ok else not_found_detail(text, "openclaw CLI not found on PATH")
        if not ok and _spawn_spec() is not None:
            return DetectResult(
                kind=self.kind,
                display_name=self.display_name,
                available=True,
                version="",
                detail="ACP entry available (CLI not on PATH)",
            )
        return DetectResult(
            kind=self.kind,
            display_name=self.display_name,
            available=ok,
            version=text if ok else "",
            detail=detail,
        )

    async def consult(
        self,
        question: str,
        *,
        on_event: OnEvent,
        cwd: str | None = None,
        session_id: str | None = None,
        config: BackendConfig | None = None,
        images: list[str] | None = None,  # noqa: ARG002 — ACP text prompt only for now
        partner_id: str | None = None,  # noqa: ARG002 — partner-only; ignored here
    ) -> ConsultResult:
        config = config or BackendConfig()
        spec = _spawn_spec()
        if spec is None:
            result = ConsultResult(session_id=session_id)
            result.success = False
            result.error = "openclaw executable not found (DEEPTUTOR_OPENCLAW_EXEC / npm openclaw.exe)"
            await on_event(SubagentEvent(kind=EVENT_ERROR, text=result.error, raw={}))
            return result

        command, args, state_dir = spec
        result = ConsultResult(session_id=session_id)

        async def emit(kind: str, text: str, raw: dict[str, Any], meta: dict[str, Any] | None = None) -> None:
            result.event_count += 1
            await on_event(SubagentEvent(kind=kind, text=text, raw=raw, meta=meta or {}))

        prompt = question
        if config.system_prompt.strip() and not session_id:
            prompt = f"{config.system_prompt.strip()}\n\n{question}"

        text_chunks: list[str] = []

        async def on_update(update: dict[str, Any]) -> None:
            kind = str(update.get("sessionUpdate") or "")
            content = update.get("content") if isinstance(update.get("content"), dict) else {}
            if kind == "agent_message_chunk" and str(content.get("type") or "") == "text":
                delta = str(content.get("text") or "")
                if delta:
                    # The ACP agents emit the streaming delta AND then the full
                    # message as a second chunk — keep cumulative, never duplicate.
                    current = "".join(text_chunks)
                    if delta == current:
                        return
                    if current and delta.startswith(current):
                        text_chunks.clear()
                        text_chunks.append(delta)
                    else:
                        text_chunks.append(delta)
                    await emit(
                        EVENT_TEXT,
                        "".join(text_chunks).strip(),
                        update,
                        {"merge_id": "openclaw:text"},
                    )
            elif kind == "agent_thought_chunk" and str(content.get("type") or "") == "text":
                await emit(EVENT_REASONING, str(content.get("text") or ""), update, {"merge_id": "openclaw:rsn"})
            elif kind in ("tool_call", "tool_call_update"):
                title = str(update.get("title") or "tool")
                raw_input = update.get("rawInput")
                detail = raw_input if isinstance(raw_input, str) else str(raw_input or "")
                await emit(EVENT_TOOL, f"{title}({detail[:160]})", update)

        try:
            async with self._consult_lock:
                proc = await get_shared(
                    self.kind, command=command, args=args, cwd=state_dir,
                    env={"OPENCLAW_STATE_DIR": state_dir},
                )
                sid = session_id or ""
                for attempt in (0, 1):
                    try:
                        if not sid:
                            sid = await proc.session_new(cwd or state_dir)
                        await proc.prompt(sid, prompt, on_update=on_update)
                        break
                    except AcpError:
                        if attempt or sid != session_id or not session_id:
                            raise
                        # a respawned ACP process invalidated the old session — start fresh
                        sid = ""
                        result.session_id = ""
        except AcpError as exc:
            result.success = False
            result.error = str(exc)
            await emit(EVENT_ERROR, str(exc), {})
            return result
        except Exception as exc:  # pragma: no cover - defensive process boundary
            logger.warning("openclaw consult failed: %s", exc, exc_info=True)
            result.success = False
            result.error = str(exc)
            await emit(EVENT_ERROR, str(exc), {})
            return result

        result.session_id = sid
        final_text = "".join(text_chunks).strip()
        if not final_text:
            result.success = False
            result.error = "openclaw ACP returned no answer text"
            await emit(EVENT_ERROR, result.error, {})
            return result
        result.final_text = final_text
        return result


__all__ = ["OpenClawBackend"]
