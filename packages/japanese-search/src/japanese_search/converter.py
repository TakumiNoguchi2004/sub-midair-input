"""かな漢字変換: 辞書ベースの最長一致セグメンテーション。

統計的な言語モデルは使わず、``dictionary.DICTIONARY`` に対する貪欲な最長一致で
読み(ひらがな)を単語単位に区切り、各セグメントへ変換候補を割り当てる。

- 各位置で、辞書に存在する最も長い読みを優先して 1 セグメントとする。
- マッチしない場合は 1 文字をそのまま(候補なし = 元のひらがな)セグメントにする。
- 各セグメントの候補リストの末尾には、必ず元のひらがな表記を含める
  (変換が誤っていてもひらがなに戻せるようにするため)。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .dictionary import DICTIONARY, MAX_READING_LEN


@dataclass
class Segment:
    """変換対象の 1 区切り。"""

    reading: str  # 元のひらがな表記
    candidates: list[str] = field(default_factory=list)  # 変換候補 (先頭が既定選択)


def _candidates_for(reading: str) -> list[str]:
    """辞書の候補 + 元のひらがな (重複除去、順序維持)。"""
    found = DICTIONARY.get(reading, [])
    out = list(found)
    if reading not in out:
        out.append(reading)
    return out


def segment(text: str) -> list[Segment]:
    """ひらがな文字列を貪欲な最長一致でセグメントに分割し、候補を割り当てる。"""
    segments: list[Segment] = []
    i = 0
    n = len(text)
    while i < n:
        matched = None
        max_len = min(MAX_READING_LEN, n - i)
        for length in range(max_len, 0, -1):
            piece = text[i : i + length]
            if piece in DICTIONARY:
                matched = piece
                break
        if matched is None:
            # 辞書にない: 1 文字だけをそのまま (変換候補なし) のセグメントにする
            piece = text[i : i + 1]
            segments.append(Segment(reading=piece, candidates=[piece]))
            i += 1
        else:
            segments.append(Segment(reading=matched, candidates=_candidates_for(matched)))
            i += len(matched)
    return segments


def convert(text: str) -> list[dict]:
    """フロントエンド向けの JSON シリアライズ可能な形で変換結果を返す。"""
    return [{"reading": s.reading, "candidates": s.candidates} for s in segment(text)]
