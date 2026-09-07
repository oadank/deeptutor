"""anydoc engine adapter implementing the ``Parser`` protocol."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Callable, Optional

from ...base import ReadinessReport
from ...signature import ParserSignature
from ...types import ParserError
from .._versions import package_version
from .config import AnydocConfig, resolve_anydoc_config
from .formats import (
    MIN_ANYDOC_VERSION,
    anydoc_supported_formats,
    anydoc_version_is_current,
    installed_anydoc_version,
)


class AnydocParser:
    """Any-format → Markdown via firecrawl/anydoc (pure Rust, no models, no network).

    Chosen for the Office/e-book branch: legacy ``.doc/.ppt/.xls`` binaries,
    ODF, RTF and EPUB in one pass, with tables and OMML formulas preserved.
    Scanned PDFs raise ``NeedsOcr`` locally (ocr="reject", the default) so the
    KB upload keeps its mineru/docling OCR route; ``ocr="hosted"`` would ship
    the document to Firecrawl's cloud and is opt-in only.
    """

    name = "anydoc"
    needs_local_models = False

    @classmethod
    def is_available(cls) -> bool:
        return importlib.util.find_spec("anydoc") is not None

    def resolve_config(self) -> AnydocConfig:
        return resolve_anydoc_config()

    def supported_formats(self) -> frozenset[str]:
        return anydoc_supported_formats()

    def signature(self, config: AnydocConfig) -> ParserSignature:
        return ParserSignature.build(
            "anydoc",
            package_version("firecrawl-anydoc"),
            {"ocr": config.ocr},
        )

    def is_ready(self, config: AnydocConfig) -> ReadinessReport:
        if not self.is_available():
            return ReadinessReport(
                ready=False,
                reason="not_configured",
                message=(
                    "anydoc isn't installed (pip install firecrawl-anydoc, or "
                    "deeptutor[parse-anydoc])."
                ),
            )
        version = installed_anydoc_version()
        if not anydoc_version_is_current(version):
            return ReadinessReport(
                ready=False,
                reason="update_required",
                message=(
                    f"Installed firecrawl-anydoc {version or 'unknown'} is too old. "
                    f"DeepTutor needs anydoc >= {MIN_ANYDOC_VERSION}. Update it under "
                    "Settings → Document Parsing."
                ),
            )
        return ReadinessReport(ready=True)

    def parse(
        self,
        source_path: Path,
        workdir: Path,
        *,
        config: AnydocConfig,
        on_output: Optional[Callable[[str], None]] = None,
    ) -> None:
        import anydoc

        if on_output:
            on_output(f"Converting {Path(source_path).name} via anydoc…")
        try:
            text = anydoc.to_markdown(str(source_path), ocr=config.ocr)
        except Exception as exc:  # noqa: BLE001 - surface as a parser error
            raise ParserError(f"anydoc failed to convert {Path(source_path).name}: {exc}")
        stem = Path(source_path).stem
        (workdir / f"{stem}.md").write_text(str(text or ""), encoding="utf-8")


__all__ = ["AnydocParser"]
