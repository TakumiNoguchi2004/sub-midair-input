"""統合のための検索インターフェース。

各サブシステム (emoji / japanese / english) はこの ``Searcher`` を実装し、
統合アプリ (``midair_app``) は実装詳細を知らずに ``mode`` で振り分けて呼び出す。
これにより「分割開発 → 最終的に 1 システムへ統合」を疎結合のまま実現する。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


@dataclass
class SearchResult:
    """サブシステム横断の検索結果 1 件。"""

    id: str  # サブシステム内の識別子 (emoji なら hexcode)
    score: float  # 類似度 (大きいほど近い)
    label: str  # 表示用ラベル (emoji なら annotation)
    payload: dict = field(default_factory=dict)  # 追加情報 (emoji 文字, image_path, ...)


@runtime_checkable
class Searcher(Protocol):
    """各サブシステムの検索エントリ。統合側はこの契約だけに依存する。"""

    mode: str  # "emoji" / "japanese" / "english"

    def search_text(self, query: str, top_k: int = 5) -> list[SearchResult]: ...
