"""EmojiSearcher: FAISS index + metadata + CLIP encoder を束ねた検索実装。

``midair_shared.search.Searcher`` 契約を満たし、統合アプリから mode="emoji" で
呼び出される。テキスト検索に加え、手書き入力用の画像検索も提供する。

**原則2 (index↔query 同ドメイン保証)**: 画像検索では、index 構築時に使った前処理
(``index_meta.json`` の ``preprocess``) と同じ正規化を query にも適用する。
対応表に無い preprocess の index を読み込んだら、黙ってドメインをズラさず即エラーにする
(無言の精度劣化を防ぐ)。現行の ``rgba_on_white`` / ``openmoji_black`` では query 側は
「白背景合成のみ」= 手書き入力に対して実質恒等なので、挙動は変わらない。
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from midair_shared.index import load_index, search as faiss_search
from midair_shared.search import SearchResult

from .encoder import DEFAULT_MODEL, ClipEncoder


def _on_white(img: Image.Image) -> Image.Image:
    """PIL 画像を白背景に合成して RGB 化する。既に白地ならほぼ恒等。"""
    background = Image.new("RGBA", img.size, (255, 255, 255, 255))
    background.alpha_composite(img.convert("RGBA"))
    return background.convert("RGB")


# index_meta.json の preprocess ラベル -> query(手書き)側に適用する前処理。
# index と query を同じドメインに揃えるための対応表。
#   rgba_on_white / openmoji_black: query は「白地+黒線」のままでよい -> 白合成のみ(恒等的)。
# grayscale / binarize / edge を index に使う場合は、ここに対応する query 前処理を必ず追加する。
QUERY_PREPROCESS = {
    "rgba_on_white": _on_white,
    "openmoji_black": _on_white,
}


class EmojiSearcher:
    mode = "emoji"

    def __init__(
        self,
        index_path: str | Path,
        metadata_path: str | Path,
        model_name: str = DEFAULT_MODEL,
    ) -> None:
        index_path = Path(index_path)
        self.index = load_index(index_path)
        with open(metadata_path, encoding="utf-8") as f:
            self.metadata = [json.loads(line) for line in f]
        self.encoder = ClipEncoder(model_name)
        self.preprocess = self._resolve_query_preprocess(index_path)

    @staticmethod
    def _resolve_query_preprocess(index_path: Path):
        """index_meta.json の preprocess に対応する query 前処理を返す。

        - 対応表に無いラベル -> 即 ValueError (index と query のドメイン不一致を未然に防ぐ)。
        - index_meta.json が無い -> 従来挙動 (rgba_on_white) にフォールバック。
        """
        meta_path = index_path.with_name("index_meta.json")
        label = "rgba_on_white"
        if meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            label = meta.get("preprocess", label)
        if label not in QUERY_PREPROCESS:
            raise ValueError(
                f"index の preprocess='{label}' に対応する query 前処理が未実装です。"
                f"searcher.QUERY_PREPROCESS に追加してください "
                f"(対応済み: {sorted(QUERY_PREPROCESS)})。"
            )
        return QUERY_PREPROCESS[label]

    def search_text(self, query: str, top_k: int = 5) -> list[SearchResult]:
        vectors = self.encoder.encode_text([query])
        return self._search(vectors, top_k)

    def search_image(self, image: Image.Image, top_k: int = 5) -> list[SearchResult]:
        """手書き入力 (PIL 画像) → 近い絵文字。index と同じ前処理を query にも適用する。"""
        vectors = self.encoder.encode_image([self.preprocess(image)])
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
