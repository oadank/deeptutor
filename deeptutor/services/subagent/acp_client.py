"""Minimal Agent Client Protocol (ACP) stdio client — shared by backends whose
CLIs speak it (OpenClaw, DeepSeek Harness's ``acp-demo``).

Wire-compatible with the agents-to-feishu bridge that runs these same CLIs in
production: one long-lived stdio process speaks JSON-RPC — ``initialize`` →
``session/new`` → ``session/prompt`` — while ``session/update`` notifications
stream the agent's answer, thinking and tool activity, and
``session/request_permission`` requests are auto-approved (our backends run
with bypass/danger-full-access semantics).

Why ACP instead of the one-shot CLI surfaces: on this deployment the gateway
daemon is fragile (openclaw's supervisor task disabled, its port taken by
tailscaled) and dsh's headless profile exits 0 silently, while the ACP surface
has run 24/7 across the whole bot fleet. The client deliberately follows the
bridge's proven call shapes, including the strict bits: dsh requires
``session/new`` with ``mcpServers: []``, and a gateway-backed agent may answer
the prompt with no ACP response at all — hence the first-output deadline.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import suppress
import json
import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

# stream-json/banner lines can exceed asyncio's 64KB default reader limit — the
# same trap that bit process.py (see _STREAM_LINE_LIMIT there).
_STREAM_LINE_LIMIT = 8 * 1024 * 1024

INITIALIZE_TIMEOUT_S = 60.0
SESSION_NEW_TIMEOUT_S = 30.0
FIRST_OUTPUT_TIMEOUT_S = 75.0
PROMPT_IDLE_TIMEOUT_S = 300.0


class AcpError(RuntimeError):
    """An ACP conversation-level failure (spawn, handshake, prompt, timeout)."""


UpdateHandler = Callable[[dict[str, Any]], Awaitable[None]]


class AcpProcess:
    """One ACP agent process: JSON-RPC over line-delimited stdio."""

    def __init__(
        self,
        command: str,
        args: list[str],
        *,
        cwd: str,
        env: dict[str, str] | None = None,
        name: str = "acp",
    ) -> None:
        self._command = command
        self._args = args
        self._cwd = cwd
        self._name = name
        self._env = env
        self._proc: asyncio.subprocess.Process | None = None
        self._pump_task: asyncio.Task[None] | None = None
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._update_handler: UpdateHandler | None = None
        self._next_id = 100
        self._lock = asyncio.Lock()

    @property
    def alive(self) -> bool:
        return self._proc is not None and self._proc.returncode is None

    @property
    def lock(self) -> asyncio.Lock:
        """Serializes prompts: one active turn per ACP process."""
        return self._lock

    async def start(self) -> None:
        import shutil

        resolved = shutil.which(self._command) or self._command
        self._proc = await asyncio.create_subprocess_exec(
            resolved,
            *self._args,
            cwd=self._cwd,
            env=self._env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=_STREAM_LINE_LIMIT,
        )
        self._pump_task = asyncio.create_task(self._pump())

    async def close(self) -> None:
        if self._proc is not None and self._proc.returncode is None:
            with suppress(ProcessLookupError):
                self._proc.terminate()
        self._fail_pending("ACP process closed")

    async def initialize(self) -> None:
        await self._request(
            "initialize", {"protocolVersion": 1, "capabilities": {}}, INITIALIZE_TIMEOUT_S
        )

    async def session_new(self, cwd: str) -> str:
        result = await self._request("session/new", {"cwd": cwd, "mcpServers": []}, SESSION_NEW_TIMEOUT_S)
        session_id = str((result or {}).get("sessionId") or "")
        if not session_id:
            raise AcpError(f"{self._name} ACP session/new: missing sessionId")
        return session_id

    async def prompt(
        self,
        session_id: str,
        text: str,
        *,
        on_update: UpdateHandler,
    ) -> dict[str, Any]:
        """Run one turn; streams ``session/update`` payloads to *on_update*.

        Raises :class:`AcpError` when the agent stays silent past the
        first-output deadline or idle past the prompt deadline — gateway-backed
        agents fail without answering, and waiting forever is how a consult
        turns into a hang.
        """
        last_output = time.monotonic()
        got_first = False

        async def handler(update: dict[str, Any]) -> None:
            nonlocal last_output, got_first
            last_output = time.monotonic()
            got_first = True
            await on_update(update)

        self._update_handler = handler
        request_task = asyncio.create_task(
            self._request(
                "session/prompt",
                {"sessionId": session_id, "prompt": [{"type": "text", "text": text}]},
                PROMPT_IDLE_TIMEOUT_S * 2,
            )
        )
        try:
            while not request_task.done():
                await asyncio.sleep(0.5)
                idle = time.monotonic() - last_output
                if not got_first and idle > FIRST_OUTPUT_TIMEOUT_S:
                    request_task.cancel()
                    raise AcpError(
                        f"{self._name} ACP: no output for {FIRST_OUTPUT_TIMEOUT_S:.0f}s "
                        "(agent likely failed to start; check its stderr/logs)"
                    )
                if got_first and idle > PROMPT_IDLE_TIMEOUT_S:
                    request_task.cancel()
                    await self._cancel_session(session_id)
                    raise AcpError(
                        f"{self._name} ACP: idle for {PROMPT_IDLE_TIMEOUT_S:.0f}s mid-turn"
                    )
            return await request_task
        finally:
            self._update_handler = None

    # ── internals ────────────────────────────────────────────────────────

    async def _cancel_session(self, session_id: str) -> None:
        """Best-effort ``session/cancel`` so an abandoned turn cannot block the
        next prompt on the same session (agents reject "turn already open")."""
        if self._proc is None or self._proc.stdin is None:
            return
        try:
            self._proc.stdin.write(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "method": "session/cancel",
                        "params": {"sessionId": session_id},
                    }
                ).encode("utf-8")
                + b"\n"
            )
            await self._proc.stdin.drain()
        except (ConnectionError, RuntimeError):
            logger.warning("%s ACP cancel failed", self._name)

    async def _request(self, method: str, params: dict[str, Any], timeout: float) -> dict[str, Any]:
        if not self.alive:
            raise AcpError(f"{self._name} ACP process is not running")
        assert self._proc is not None and self._proc.stdin is not None
        request_id = self._next_id
        self._next_id += 1
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        line = json.dumps(
            {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params},
            ensure_ascii=False,
        )
        try:
            self._proc.stdin.write(line.encode("utf-8") + b"\n")
            await self._proc.stdin.drain()
        except (ConnectionError, RuntimeError) as exc:
            self._pending.pop(request_id, None)
            raise AcpError(f"{self._name} ACP stdin write failed: {exc}") from exc
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            raise AcpError(f"{self._name} ACP {method} timed out after {timeout:.0f}s") from None
        finally:
            self._pending.pop(request_id, None)

    async def _pump(self) -> None:
        assert self._proc is not None and self._proc.stdout is not None
        stderr_task = asyncio.create_task(_drain_stderr(self._proc, self._name))
        try:
            while True:
                raw = await self._proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except ValueError:
                    logger.debug("%s ACP non-JSON stdout: %s", self._name, line[:200])
                    continue
                await self._dispatch(msg)
        except asyncio.CancelledError:
            pass
        except Exception:  # pragma: no cover - defensive: pump must not die loudly
            logger.warning("%s ACP pump crashed", self._name, exc_info=True)
        finally:
            stderr_task.cancel()
            self._fail_pending(f"{self._name} ACP process exited")

    async def _dispatch(self, msg: dict[str, Any]) -> None:
        request_id = msg.get("id")
        if request_id is not None and ("result" in msg or "error" in msg):
            future = self._pending.get(int(request_id))
            if future is not None and not future.done():
                if msg.get("error"):
                    future.set_exception(AcpError(f"{self._name} ACP error: {msg['error']}"))
                else:
                    future.set_result(msg.get("result") or {})
            return
        method = str(msg.get("method") or "")
        if method == "session/update" and self._update_handler is not None:
            params = msg.get("params") or {}
            update = params.get("update")
            if isinstance(update, dict):
                await self._update_handler(update)
            return
        if method == "session/request_permission":
            await self._approve_permission(msg)
            return
        if request_id is not None and method:
            # An agent→client request we don't implement (fs/*, terminal/*, …).
            # Answer with a JSON-RPC error so the agent's tool call fails cleanly
            # instead of hanging on a reply that never comes.
            await self._reply_error(request_id, f"client does not support {method}")
            return
        logger.debug("%s ACP notification %s ignored", self._name, method)

    async def _reply_error(self, request_id: Any, message: str) -> None:
        if self._proc is None or self._proc.stdin is None:
            return
        try:
            self._proc.stdin.write(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {"code": -32601, "message": message},
                    }
                ).encode("utf-8")
                + b"\n"
            )
            await self._proc.stdin.drain()
        except (ConnectionError, RuntimeError):
            logger.warning("%s ACP error reply failed", self._name)

    async def _approve_permission(self, msg: dict[str, Any]) -> None:
        """Danger-full-access agents should not ask; auto-allow defensively."""
        if self._proc is None or self._proc.stdin is None or msg.get("id") is None:
            return
        options = (msg.get("params") or {}).get("options") or []
        allow = next(
            (
                str(o.get("optionId"))
                for o in options
                if isinstance(o, dict) and "allow" in str(o.get("optionId", "")).lower()
            ),
            str(options[0].get("optionId")) if options and isinstance(options[0], dict) else "allow-once",
        )
        try:
            self._proc.stdin.write(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": msg["id"],
                        "result": {"outcome": {"outcome": "selected", "optionId": allow}},
                    }
                ).encode("utf-8")
                + b"\n"
            )
            await self._proc.stdin.drain()
        except (ConnectionError, RuntimeError):
            logger.warning("%s ACP permission reply failed", self._name)

    def _fail_pending(self, reason: str) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(AcpError(reason))
        self._pending.clear()


def _windows_env_backfill(env: dict[str, str]) -> dict[str, str]:
    """NSSM-sourced envs are complete here, but backfill defensively like the
    agents-to-feishu bridge does — some agents hard-require these keys."""
    env.setdefault("SystemRoot", os.environ.get("SystemRoot", r"C:\Windows"))
    env.setdefault("ComSpec", os.environ.get("ComSpec", r"C:\Windows\system32\cmd.exe"))
    return env


_SHARED: dict[str, AcpProcess] = {}


async def get_shared(
    key: str,
    *,
    command: str,
    args: list[str],
    cwd: str,
    env: dict[str, str] | None = None,
) -> AcpProcess:
    """One long-lived ACP process per backend kind; respawned if it died."""
    proc = _SHARED.get(key)
    if proc is not None and proc.alive:
        return proc
    if proc is not None:
        await proc.close()
    # Full parent env + overrides — a stripped env breaks the agents' own
    # state dirs (openclaw's SQLite cache under %LOCALAPPDATA% needs it).
    merged = {**os.environ, **(env or {})}
    proc = AcpProcess(command, args, cwd=cwd, env=_windows_env_backfill(merged), name=key)
    await proc.start()
    await proc.initialize()
    _SHARED[key] = proc
    logger.info("%s ACP process ready", key)
    return proc


async def _drain_stderr(proc: asyncio.subprocess.Process, name: str) -> None:
    stream = proc.stderr
    if stream is None:
        return
    while True:
        raw = await stream.readline()
        if not raw:
            return
        text = raw.decode("utf-8", "replace").strip()
        if text:
            logger.debug("%s ACP stderr: %s", name, text[:300])


from contextlib import suppress  # noqa: E402  (used by close(); kept near use)
