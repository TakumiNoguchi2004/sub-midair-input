"""サブシステム共通の encoder 契約。

絵文字 / 日本語 / 英語 の各サブシステムは、それぞれの埋め込みモデルを
これらの Protocol に従って実装する。検索側 (FAISS) は実装詳細に依存しない。

返り値は **L2 正規化済み float32** の ``(N, dim)`` ``np.ndarray`` で統一する
(FAISS ``IndexFlatIP`` に入れれば内積 = cosine 類似度になる)。
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np


@runtime_checkable
class TextEncoder(Protocol):
    """テキスト → ベクトル。3 サブシステム共通の最小契約。"""

    @property
    def dim(self) -> int: ...

    def encode_text(self, texts: list[str]) -> np.ndarray: ...


@runtime_checkable
class MultimodalEncoder(TextEncoder, Protocol):
    """テキストに加えて画像も同じ空間に埋め込める encoder (例: CLIP)。

    絵文字サブシステムの手書き入力はこちらを要求する。
    """

    def encode_image(self, images: list) -> np.ndarray: ...
