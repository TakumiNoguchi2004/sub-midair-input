"""かな漢字変換: SKK-JISYO を使った greedy 最長一致セグメンテーション。"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from .skk_parser import load as _load_skk

_REPO_ROOT = Path(__file__).resolve().parents[4]
_DATA_ROOT = Path(os.environ.get("MIDAIR_DATA_DIR") or (_REPO_ROOT / "data"))
_SKK_PATH = _DATA_ROOT / "japanese_search" / "SKK-JISYO.L"


@lru_cache(maxsize=1)
def _get_dict() -> tuple[dict[str, list[str]], int]:
    return _load_skk(_SKK_PATH)


@dataclass
class Segment:
    reading: str
    candidates: list[str] = field(default_factory=list)
    sel: int = 0  # 現在選択中の候補インデックス

    @property
    def current(self) -> str:
        if not self.candidates:
            return self.reading
        return self.candidates[self.sel]

    def next(self) -> None:
        if self.candidates:
            self.sel = (self.sel + 1) % len(self.candidates)

    def prev(self) -> None:
        if self.candidates:
            self.sel = (self.sel - 1) % len(self.candidates)


def segment(text: str) -> list[Segment]:
    """ひらがな文字列を greedy 最長一致でセグメント分割し候補を付ける。"""
    dic, max_len = _get_dict()
    segments: list[Segment] = []
    i = 0
    n = len(text)
    while i < n:
        best: str | None = None
        for length in range(min(max_len, n - i), 0, -1):
            piece = text[i : i + length]
            if piece in dic:
                best = piece
                break
        if best is None:
            piece = text[i : i + 1]
            segments.append(Segment(reading=piece, candidates=[piece]))
            i += 1
        else:
            cands = list(dic[best])
            if best not in cands:
                cands.append(best)
            segments.append(Segment(reading=best, candidates=cands))
            i += len(best)
    return segments


def convert(text: str) -> list[dict]:
    """フロントエンド向け JSON シリアライズ可能な変換結果を返す。"""
    return [
        {"reading": s.reading, "candidates": s.candidates, "sel": s.sel}
        for s in segment(text)
    ]
