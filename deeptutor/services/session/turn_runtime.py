"""Compatibility facade for the decomposed v2 turn services."""

from __future__ import annotations

import asyncio
import contextlib
import logging

from . import _turn_runtime_shared as _shared
from .turns import (
    LearningTurnAdapter,
    SessionTitleService,
    TurnContextAssembler,
    TurnExecutor,
    TurnLifecycle,
    TurnRequestPreparer,
)

logger = logging.getLogger(__name__)


# Preserve direct imports of normalization helpers during the v2 transition.
# PEP 562 forwards private helpers without copying the 1,200-line value layer
# back into this compatibility module.
def __getattr__(name: str):
    try:
        return getattr(_shared, name)
    except AttributeError:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from None


class TurnRuntimeManager(
    TurnRequestPreparer,
    TurnContextAssembler,
    LearningTurnAdapter,
    TurnExecutor,
    TurnLifecycle,
    SessionTitleService,
):
    """Backward-compatible composition of the focused v2 turn services."""


import threading

_runtime_lock = threading.Lock()
_runtime_instances: dict[str, TurnRuntimeManager] = {}


def get_turn_runtime_manager() -> TurnRuntimeManager:
    from deeptutor.services.session import get_session_store
    from deeptutor.services.session.scope import store_scope

    store = get_session_store()
    key = store_scope(store).cache_key
    with _runtime_lock:
        if key not in _runtime_instances:
            manager = TurnRuntimeManager(store=store)
            _runtime_instances[key] = manager
            # [local patch 2026-09-03] 启动孤儿清扫：进程重启后，DB 里还挂在
            # queued/running/waiting_input 的 turn 全部是孤儿（执行体在内存，
            # 已随上一个进程消失）——不清理的话会话会被"运行中"状态永久卡死，
            # 前端永远显示停止按钮。标记为 cancelled，用户重发即可。
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None
            if loop is not None:
                loop.create_task(_sweep_orphaned_turns(manager))
        return _runtime_instances[key]


async def _sweep_orphaned_turns(manager: TurnRuntimeManager) -> None:
    try:
        nonterminal = await manager.store.list_nonterminal_turns()
        swept = 0
        for turn in nonterminal:
            with contextlib.suppress(Exception):
                await manager.store.transition_turn(
                    str(turn.get("id") or ""),
                    "cancelled",
                    expected_status=str(turn.get("status") or ""),
                )
                swept += 1
        if swept:
            logger.warning(
                "Startup orphan sweep: cancelled %d stale turn(s) left over "
                "from a previous process: %s",
                swept,
                ", ".join(str(t.get("id")) for t in nonterminal),
            )
    except Exception:
        logger.debug("startup orphan sweep failed", exc_info=True)


__all__ = ["TurnRuntimeManager", "get_turn_runtime_manager"]
