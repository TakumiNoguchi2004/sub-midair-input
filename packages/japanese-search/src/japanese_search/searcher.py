"""JapaneseSearcher: ``midair_shared.search.Searcher`` 契約を満たすかな漢字変換実装。

統合アプリ (``midair_app``) からは ``search_text`` 経由で「最有力の変換結果」を
1 件返す。Web フロントエンドは、セグメント単位で候補を選び直せるよう、
より詳細な ``convert`` を直接使う。
"""

from __future__ import annotations

from midair_shared.search import SearchResult

from .converter import convert as convert_text


class JapaneseSearcher:
    mode = "japanese"

    def search_text(self, query: str, top_k: int = 5) -> list[SearchResult]:
        segments = convert_text(query)
        best = "".join(s["candidates"][0] for s in segments)
        return [
            SearchResult(
                id=best,
                score=1.0,
                label=best,
                payload={"segments": segments},
            )
        ]

    def convert(self, text: str) -> list[dict]:
        """セグメント単位の変換結果 (``[{reading, candidates}, ...]``) を返す。"""
        return convert_text(text)
