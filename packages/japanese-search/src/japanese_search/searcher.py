"""JapaneseSearcher: 日本語入力サブシステムの検索エントリ (未実装スケルトン)。

``midair_shared.search.Searcher`` 契約を満たす形で実装していく。
"""

from __future__ import annotations

from midair_shared.search import SearchResult


class JapaneseSearcher:
    mode = "japanese"

    def search_text(self, query: str, top_k: int = 5) -> list[SearchResult]:
        raise NotImplementedError("日本語入力サブシステムは未実装です")
