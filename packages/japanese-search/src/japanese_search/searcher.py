from __future__ import annotations

from midair_shared.search import Searcher
from .converter import convert, segment


class JapaneseSearcher(Searcher):
    mode = "japanese"

    def search_text(self, text: str, top_k: int = 10) -> list:
        segs = segment(text)
        return [{"reading": s.reading, "result": s.current} for s in segs]

    def convert(self, text: str) -> list[dict]:
        return convert(text)
