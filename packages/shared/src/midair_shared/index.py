"""ベクトルインデックスの構築・保存・読み込み・検索 (numpy 実装)。

絵文字数は数千オーダーなので全探索内積で十分。
ベクトルは encoder 側で L2 正規化済みなので、内積 = cosine 類似度になる。
"""

from __future__ import annotations

from pathlib import Path

import numpy as np


def build_index(vectors: np.ndarray) -> np.ndarray:
    """(N, dim) の正規化済みベクトルを float32 連続配列として返す。"""
    return np.ascontiguousarray(vectors, dtype="float32")


def save_index(vectors: np.ndarray, path: str | Path) -> None:
    np.save(str(path), vectors)


def load_index(path: str | Path) -> np.ndarray:
    return np.load(str(path))


def search(vectors: np.ndarray, query_vectors: np.ndarray, top_k: int):
    """(M, dim) のクエリ → (scores, ids) を返す。ids は row_id。

    全探索内積検索 (IndexFlatIP 相当)。
    """
    query_vectors = np.ascontiguousarray(query_vectors, dtype="float32")
    scores = (vectors @ query_vectors.T).T  # (M, N)
    top_ids = np.argsort(-scores, axis=1)[:, :top_k]
    top_scores = np.take_along_axis(scores, top_ids, axis=1)
    return top_scores, top_ids
