"""Server-owned runtime binding shared by every agentic pipeline."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from deeptutor.core.context import UnifiedContext
from deeptutor.services.cli_apps.models import TOOL_PREFIX as CLI_APP_TOOL_PREFIX

logger = logging.getLogger(__name__)

GENERATION_TOOL_SERVICES: dict[str, str] = {
    "imagegen": "imagegen",
    "videogen": "videogen",
    # [local patch 2026-09-02, migrated 2026-09-05] tts_speak 是后加工具：旧前端
    # 页面缓存的 enabled_optional_tools 不含它，payload.tools 会漏传——
    # drop_unconfigured_generation_tools 里强制并入（TTS 已配置时）。
    "tts_speak": "tts",
}


def drop_unconfigured_generation_tools(tools: list[str]) -> list[str]:
    """Hide generation tools that cannot succeed with current settings."""

    present = [name for name in tools if name in GENERATION_TOOL_SERVICES]
    # Stale-frontend defense: a cached tool whitelist can omit tts_speak entirely;
    # force it into the probe (dropped again below when TTS is unconfigured).
    if "tts_speak" not in present:
        present.append("tts_speak")
    if not present:
        return tools
    try:
        from deeptutor.services.config.model_catalog import get_model_catalog_service

        service = get_model_catalog_service()
        catalog = service.load()
        configured = {
            name
            for name in present
            if (service.get_active_model(catalog, GENERATION_TOOL_SERVICES[name]) or {}).get(
                "model"
            )
        }
    except Exception:
        logger.debug("generation-tool config probe failed; dropping them", exc_info=True)
        configured = set()
    result = [name for name in tools if name not in GENERATION_TOOL_SERVICES or name in configured]
    if "tts_speak" in configured and "tts_speak" not in result:
        result.append("tts_speak")
    return result


def bind_workspace_tool_runtime(
    tool_name: str,
    args: dict[str, Any],
    context: UnifiedContext,
    *,
    fallback_task_dir: Path | None = None,
    sandbox_user_id: str = "",
) -> dict[str, Any]:
    """Inject workspace paths and sandbox mounts from trusted turn context."""

    kwargs = dict(args)
    workspace = context.runtime.workspace
    task_dir = Path(workspace.output_dir) if workspace is not None else fallback_task_dir

    if tool_name.startswith("workspace_") and workspace is not None:
        kwargs["_workspace_id"] = workspace.workspace_id
        kwargs["_language"] = context.language or "en"

    if tool_name in {"exec"} or tool_name.startswith(CLI_APP_TOOL_PREFIX):
        from deeptutor.services.sandbox import Mount
        from deeptutor.services.workspace.execution import prepare_workspace_execution_env

        if sandbox_user_id:
            kwargs["_sandbox_user_id"] = sandbox_user_id
        if task_dir is None:
            return kwargs

        work_name = "exec" if tool_name == "exec" else "cli"
        workdir = task_dir / work_name
        workdir.mkdir(parents=True, exist_ok=True)
        state_dir = task_dir / ".deeptutor" / "execution"
        kwargs["_sandbox_workdir"] = str(workdir)
        kwargs["_sandbox_internal_root"] = str(state_dir)
        if tool_name == "exec":
            kwargs["_sandbox_code_workdir"] = str(workdir)
            kwargs["_sandbox_source_dir"] = str(state_dir / "exec_calls")
        kwargs["_sandbox_env"] = prepare_workspace_execution_env(
            task_dir,
            workspace_root=workspace.root if workspace is not None else None,
        )
        mounts = [
            Mount(host_path=str(workdir), sandbox_path=str(workdir), read_only=False),
            Mount(host_path=str(state_dir), sandbox_path=str(state_dir), read_only=False),
        ]
        if workspace is not None:
            mounts.insert(
                0,
                Mount(
                    host_path=workspace.root,
                    sandbox_path=workspace.root,
                    read_only=True,
                ),
            )
            kwargs["_workspace_id"] = workspace.workspace_id
            kwargs["_workspace_root"] = workspace.root
        kwargs["_sandbox_mounts"] = tuple(mounts)
        return kwargs

    if tool_name in GENERATION_TOOL_SERVICES and task_dir is not None:
        media_dir = task_dir / "media"
        media_dir.mkdir(parents=True, exist_ok=True)
        kwargs["_workspace_dir"] = str(media_dir)
        if workspace is not None:
            kwargs["_workspace_id"] = workspace.workspace_id
    return kwargs


def fallback_task_dir_from_metadata(
    context: UnifiedContext,
    *,
    feature: str,
) -> Path | None:
    """Resolve the legacy direct-call turn directory when no runtime exists."""

    turn_id = str((context.metadata or {}).get("turn_id") or "").strip()
    if not turn_id:
        return None
    from deeptutor.services.path_service import get_path_service

    return get_path_service().get_task_workspace(feature, turn_id)


__all__ = [
    "GENERATION_TOOL_SERVICES",
    "bind_workspace_tool_runtime",
    "drop_unconfigured_generation_tools",
    "fallback_task_dir_from_metadata",
]
