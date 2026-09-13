"""Built-in speech extension for Immersive Reading.

Prefers the server's configured TTS gateway (the same engine chat uses) and
returns a ``browser_speech`` result carrying ``audio_url``. The frontend plays
that URL when present and only falls back to ``speechSynthesis`` — which is
what made read-aloud sound like a mechanical system voice.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import uuid

from deeptutor.reading.extensions import (
    ReadingAction,
    ReadingContext,
    ReadingExtensionManifest,
    ReadingExtensionResult,
)

logger = logging.getLogger(__name__)


class ReadAloudExtension:
    """Serve verified unit text as spoken audio (server TTS, else browser)."""

    manifest = ReadingExtensionManifest(
        id="read_aloud",
        version="1.1.0",
        name="Read aloud",
        actions=[ReadingAction(id="read", label="Read aloud")],
        result_types=["browser_speech"],
    )

    def run_action(self, action: str, context: ReadingContext) -> ReadingExtensionResult:
        if action != "read":
            raise ValueError(f"Unsupported read-aloud action: {action}")
        text = (context.visible_text or "").strip()
        if not text:
            raise ValueError("Nothing to read on this page.")

        # Cap what one click can speak — a full textbook page can be huge and
        # every engine has a practical limit.
        spoken = text if len(text) <= 8_000 else text[:8_000]
        audio_url = ""
        try:
            audio_url = self._synthesize_url(spoken)
        except Exception:
            logger.warning(
                "read_aloud server TTS failed; falling back to browser speech",
                exc_info=True,
            )

        payload: dict[str, object] = {"text": spoken, "locale": context.locale}
        if audio_url:
            payload["audio_url"] = audio_url
        return ReadingExtensionResult(type="browser_speech", payload=payload)

    def _synthesize_url(self, text: str) -> str:
        """Run the configured voice engine and write a publicly servable file."""
        from deeptutor.services.voice import synthesize_speech
        from deeptutor.tools.media_gen_tool import _run_dir, _write_media

        result = synthesize_speech(text)
        if inspect.isawaitable(result):
            try:
                asyncio.get_running_loop()
            except RuntimeError:
                audio, content_type = asyncio.run(result)
            else:
                # Nested event loop on this worker — leave it to the browser.
                close = getattr(result, "close", None)
                if callable(close):
                    close()
                return ""
        else:  # pragma: no cover - defensive against a sync adapter
            audio, content_type = result  # type: ignore[misc]

        if not audio:
            return ""
        ext = "mp3" if "mpeg" in (content_type or "") else "wav"
        run_dir, workspace_id = _run_dir(None, "tts")
        artifacts = _write_media(
            run_dir,
            [(audio, content_type)],
            stem=f"read_aloud_{uuid.uuid4().hex[:8]}",
            default_ext=ext,
            workspace_id=workspace_id,
        )
        if not artifacts:
            return ""
        return artifacts[0].url or ""


__all__ = ["ReadAloudExtension"]
