"""anydoc version and input-format compatibility helpers."""

from __future__ import annotations

from functools import lru_cache
import importlib.metadata

from .._versions import package_version, version_at_least

MIN_ANYDOC_VERSION = "0.2.0"

# Formats the anydoc 0.2.x Rust core converts locally. PDF covers text-layer
# PDFs via the bundled pdf-inspector (scanned PDFs raise NeedsOcr — the OCR
# route belongs to the mineru/docling engines). The set mirrors the project's
# documented support matrix at the pinned floor; `format_from_path` still has
# the final word at parse time.
ANYDOC_0_2_0_FORMATS = frozenset(
    {
        ".csv",
        ".doc",
        ".docm",
        ".docx",
        ".epub",
        ".htm",
        ".html",
        ".odp",
        ".ods",
        ".odt",
        ".pdf",
        ".pps",
        ".ppsm",
        ".ppsx",
        ".ppt",
        ".pptm",
        ".pptx",
        ".pot",
        ".rtf",
        ".xls",
        ".xlsb",
        ".xlsm",
        ".xlsx",
    }
)


@lru_cache(maxsize=1)
def anydoc_supported_formats() -> frozenset[str]:
    """Anydoc converts by content signature, so the static matrix is the whole story."""
    return ANYDOC_0_2_0_FORMATS


def installed_anydoc_version() -> str:
    return package_version("firecrawl-anydoc")


def anydoc_version_is_current(version: str | None = None) -> bool:
    current = installed_anydoc_version() if version is None else version
    return version_at_least(current, MIN_ANYDOC_VERSION)


__all__ = [
    "ANYDOC_0_2_0_FORMATS",
    "MIN_ANYDOC_VERSION",
    "anydoc_supported_formats",
    "anydoc_version_is_current",
    "installed_anydoc_version",
]
