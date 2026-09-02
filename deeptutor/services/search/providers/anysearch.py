"""AnySearch search provider (https://anysearch.com).

Unified real-time search API: general web search with structured results.
REST endpoint: POST {base_url}/v1/search with Bearer auth; responses are
``{"code": 0, "data": {"results": [{"title", "url", "snippet", "content"}]}}``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import requests

from ..base import BaseSearchProvider
from ..types import Citation, SearchResult, WebSearchResponse
from . import register_provider


@register_provider("anysearch")
class AnySearchProvider(BaseSearchProvider):
    """AnySearch unified real-time search (https://api.anysearch.com)."""

    description = "AnySearch unified real-time search API"
    API_KEY_ENV_VARS = ("ANYSEARCH_API_KEY",)

    def search(
        self,
        query: str,
        base_url: str = "",
        max_results: int = 5,
        timeout: int = 20,
        **kwargs: Any,
    ) -> WebSearchResponse:
        endpoint = (base_url or "https://api.anysearch.com").strip().rstrip("/")
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        request_kwargs: dict[str, Any] = {
            "json": {"query": query, "max_results": max(1, min(int(max_results), 10))},
            "headers": headers,
            "timeout": timeout,
        }
        if self.proxy:
            request_kwargs["proxies"] = {"http": self.proxy, "https": self.proxy}
        resp = requests.post(f"{endpoint}/v1/search", **request_kwargs)
        if resp.status_code != 200:
            raise Exception(f"AnySearch API error: {resp.status_code} - {resp.text}")
        payload = resp.json()
        if payload.get("code") not in (0, "0"):
            raise Exception(f"AnySearch API error: {payload.get('message', 'unknown')}")
        rows = (payload.get("data") or {}).get("results") or []
        citations: list[Citation] = []
        search_results: list[SearchResult] = []
        for idx, row in enumerate(rows[: max(1, min(int(max_results), 10))], 1):
            title = str(row.get("title", ""))
            url = str(row.get("url", ""))
            snippet = str(row.get("snippet", "") or row.get("content", ""))
            content = str(row.get("content", ""))
            search_results.append(
                SearchResult(
                    title=title,
                    url=url,
                    snippet=snippet,
                    source="AnySearch",
                    content=content,
                )
            )
            citations.append(
                Citation(
                    id=idx,
                    reference=f"[{idx}]",
                    url=url,
                    title=title,
                    snippet=snippet,
                    source="AnySearch",
                    content=content,
                )
            )
        return WebSearchResponse(
            query=query,
            answer="",
            provider="anysearch",
            timestamp=datetime.now().isoformat(),
            model="anysearch",
            citations=citations,
            search_results=search_results,
            metadata={"finish_reason": "stop"},
        )
