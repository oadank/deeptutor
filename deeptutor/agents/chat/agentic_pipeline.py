"""Chat's binding of the agent loop.

Chat is the loop the base host describes, so this is only a name: the
exploring-loop protocol, the tool surface and the prompt pack in
:mod:`deeptutor.agents.chat.prompts` are all the defaults declared on
:class:`~deeptutor.agents.loop.pipeline.AgenticLoopPipeline`.

The deep modes that run chat's own protocol (solve, ask_questions, reading,
watching, course study, visualize) construct this class directly, overriding
only budgets and stream namespace. A mode whose protocol differs from chat's
subclasses the host instead — see
:class:`deeptutor.capabilities.mastery.pipeline.MasteryLoopPipeline`.

Module-level symbols are re-exported here because they are patched by name in
tests and read by :mod:`deeptutor.agents.chat.capability`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - import cycle guard
    from deeptutor.core.context import UnifiedContext

from deeptutor.agents.loop.pipeline import (
    KB_SEED_CHARS_PER_KB,
    KB_SEED_MAX_KBS,
    LOOP_EXCLUDED_TOOLS,
    LOOP_OPTIONAL_TOOLS,
    AgenticLoopPipeline,
    _DispatchOutcome,
    _read_int,
)

#: Chat's optional-tool whitelist. Every loop shares it: a mode never silently
#: removes a tool the user turned on for themselves.
CHAT_OPTIONAL_TOOLS = LOOP_OPTIONAL_TOOLS
CHAT_EXCLUDED_TOOLS = LOOP_EXCLUDED_TOOLS


class AgenticChatPipeline(AgenticLoopPipeline):
    """Run a chat turn as one exploring agent loop."""


    async def _drain_user_injections(self, context: "UnifiedContext") -> list[str]:
        """[local patch 2026-09-03, migrated to v1.6.5 architecture] Return user
        messages injected into this still-running turn.

        When a mid-turn ``start_turn`` loses the session lease, the request
        preparer persists the text as a user message carrying
        ``metadata.injected`` plus the owning ``turn_id``. Draining happens
        once per agent-loop round; a per-(session, turn) message-id watermark
        keeps it idempotent regardless of pipeline instance lifetime.
        """
        metadata = context.metadata or {}
        turn_id = str(metadata.get("turn_id", "") or "").strip()
        session_id = str(getattr(context, "session_id", "") or "").strip()
        if not turn_id or not session_id:
            return []
        key = (session_id, turn_id)
        watermarks = getattr(self, "_injection_watermarks", None)
        if watermarks is None:
            watermarks = self._injection_watermarks = {}
        watermark = int(watermarks.get(key, 0))
        from deeptutor.services.session import get_session_store

        messages = await get_session_store().get_messages(session_id)
        contents: list[str] = []
        for message in messages:
            try:
                message_id = int(message.get("id") or 0)
            except (TypeError, ValueError):
                continue
            if message_id <= watermark:
                continue
            message_meta = message.get("metadata") or {}
            if (
                message.get("role") == "user"
                and message_meta.get("injected")
                and str(message_meta.get("turn_id") or "") == turn_id
            ):
                content = str(message.get("content") or "").strip()
                if content:
                    contents.append(content)
            watermark = message_id
        watermarks[key] = watermark
        return contents


__all__ = [
    "CHAT_EXCLUDED_TOOLS",
    "CHAT_OPTIONAL_TOOLS",
    "KB_SEED_CHARS_PER_KB",
    "KB_SEED_MAX_KBS",
    "AgenticChatPipeline",
    "_DispatchOutcome",
    "_read_int",
]
