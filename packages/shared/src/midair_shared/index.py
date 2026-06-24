"""FAISS index の構築・保存・読み込み・検索。

絵文字数は数千オーダーなので ``IndexFlatIP`` (全探索・内積) で十分。
ベクトルは encoder 側で L2 正規化済みなので、内積 = cosine 類似度になる。
"""

from __future__ import annotations

from pathlib import Path

import faiss
import numpy as np


def build_flat_ip(vectors: np.ndarray) -> faiss.IndexFlatIP:
    """(N, dim) の正規化済みベクトルから内積 index を作る。"""
    vectors = np.ascontiguousarray(vectors, dtype="float32")
    index = faiss.IndexFlatIP(vectors.shape[1])
    index.add(vectors)
    return index


def save_index(index: faiss.Index, path: str | Path) -> None:
    faiss.write_index(index, str(path))


def load_index(path: str | Path) -> faiss.Index:
    return faiss.read_index(str(path))


def search(index: faiss.Index, query_vectors: np.ndarray, top_k: int):
    """(M, dim) のクエリ → (scores, ids) を返す。ids は row_id。"""
    query_vectors = np.ascontiguousarray(query_vectors, dtype="float32")
    scores, ids = index.search(query_vectors, top_k)
    return scores, ids
