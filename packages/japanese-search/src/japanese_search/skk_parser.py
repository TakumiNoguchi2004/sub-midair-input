"""SKK-JISYO パーサー。読み → 候補リスト の辞書を構築する。"""
from __future__ import annotations

import re
from pathlib import Path


def _strip_annotation(cand: str) -> str:
    """候補の #注釈 を除去して表記だけ返す。"""
    return cand.split(";")[0].split("#")[0].strip()


def load(path: Path) -> tuple[dict[str, list[str]], int]:
    """SKK-JISYO ファイルを読み込み (読み → 候補リスト) を返す。

    Returns:
        dict: 読み → 候補リスト
        int: 最長読みの文字数 (greedy segmentation 用)
    """
    dic: dict[str, list[str]] = {}
    max_len = 0

    with open(path, encoding="euc-jp", errors="ignore") as f:
        for line in f:
            line = line.rstrip("\n")
            # コメント行・空行スキップ
            if not line or line.startswith(";"):
                continue
            # 送り仮名エントリ (読み に > を含む) はスキップ
            if ">" in line.split(" ")[0]:
                continue

            # フォーマット: `reading /cand1/cand2/.../`
            m = re.match(r"^(\S+)\s+/(.+)/$", line)
            if not m:
                continue

            reading = m.group(1)
            # ひらがなの読みのみ対象 (カタカナ・ASCII 読みは除外)
            if not all("ぁ" <= c <= "ゖ" or c in "ぁ-ん" for c in reading):
                continue

            candidates = [_strip_annotation(c) for c in m.group(2).split("/") if c]
            candidates = [c for c in candidates if c]
            if not candidates:
                continue

            dic[reading] = candidates
            if len(reading) > max_len:
                max_len = len(reading)

    return dic, max_len
