"""EmojiSearcher: FAISS index + metadata + CLIP encoder を束ねた検索実装。

``midair_shared.search.Searcher`` 契約を満たし、統合アプリから mode="emoji" で
呼び出される。テキスト検索に加え、手書き入力用の画像検索も提供する。
"""

from __future__ import annotations

import json
from pathlib import Path

from midair_shared.index import load_index, search as faiss_search
from midair_shared.search import SearchResult

from .encoder import DEFAULT_MODEL, ClipEncoder


class EmojiSearcher:
    mode = "emoji"

    def __init__(
        self,
        index_path: str | Path,
        metadata_path: str | Path,
        model_name: str = DEFAULT_MODEL,
    ) -> None:
        self.index = load_index(index_path)
        with open(metadata_path, encoding="utf-8") as f:
            self.metadata = [json.loads(line) for line in f]
        self.encoder = ClipEncoder(model_name)

    def search_text(self, query: str, top_k: int = 5) -> list[SearchResult]:
        vectors = self.encoder.encode_text([query])
        return self._search(vectors, top_k)

    def search_image(self, image, top_k: int = 5) -> list[SearchResult]:
        """手書き入力 (PIL 画像) → 近い絵文字。emoji 固有の追加 API。"""
        vectors = self.encoder.encode_image([image])
        return self._search(vectors, top_k)

    def _search(self, vectors, top_k: int) -> list[SearchResult]:
        scores, ids = faiss_search(self.index, vectors, top_k)
        results = []
        for score, row_id in zip(scores[0], ids[0]):
            if row_id < 0:
                continue
            meta = self.metadata[int(row_id)]
            results.append(
                SearchResult(
                    id=meta["hexcode"],
                    score=float(score),
                    label=meta["annotation"],
                    payload={"emoji": meta["emoji"], "image_path": meta["image_path"]},
                )
            )
        return results
