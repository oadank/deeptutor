"""Shared subagent credential lookups.

配置中心原则（与 deeptutor-claude.mjs 一致）：凭证唯一来源是
``~/.dsh/.credentials.yaml``（由配置中心写入），环境变量里已有的值优先——
服务 env / 用户级 env 是它的透传通道，不在这里偷偷找别的文件。
"""

from __future__ import annotations

import os
from pathlib import Path
import re


def litellm_key() -> str:
    """LiteLLM 门禁 key：先取 ``LITELLM_API_KEY`` env，再读配置中心凭证文件。"""
    from_env = (os.environ.get("LITELLM_API_KEY") or "").strip()
    if from_env:
        return from_env
    return _from_credentials("LITELLM_API_KEY")


def deepseek_key() -> str:
    """DeepSeek 官方 key：先取 ``DEEPSEEK_API_KEY`` env，再读配置中心凭证文件。"""
    from_env = (os.environ.get("DEEPSEEK_API_KEY") or "").strip()
    if from_env:
        return from_env
    return _from_credentials("DEEPSEEK_API_KEY")


def ark_key() -> str:
    """火山方舟 key：先取 ``ARK_API_KEY`` env，再读配置中心凭证文件。"""
    from_env = (os.environ.get("ARK_API_KEY") or "").strip()
    if from_env:
        return from_env
    return _from_credentials("ARK_API_KEY")


def _from_credentials(name: str) -> str:
    base = os.environ.get("USERPROFILE") or os.environ.get("HOME") or ""
    if not base:
        return ""
    try:
        text = (Path(base) / ".dsh" / ".credentials.yaml").read_text(encoding="utf-8")
    except OSError:
        return ""
    match = re.search(rf"^\s*{name}\s*:\s*(\S+)", text, re.M)
    return match[1].strip() if match else ""


__all__ = ["ark_key", "deepseek_key", "litellm_key"]
