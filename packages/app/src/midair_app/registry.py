"""mode -> Searcher の遅延生成。

重い依存 (torch など) は選択されたモードのときだけ import する。
これにより japanese/english モードで emoji の依存をロードせずに済む。
"""

from __future__ import annotations

from pathlib import Path

from midair_shared.search import Searcher

MODES = ("emoji", "japanese", "english")


def build_searcher(mode: str, data_dir: Path) -> Searcher:
    if mode == "emoji":
        from emoji_search.searcher import EmojiSearcher

        d = data_dir / "emoji_search"
        index_path = d / "index.npy"
        if not index_path.exists():
            raise FileNotFoundError(
                f"index が見つかりません: {index_path}\n"
                "先にデータ準備を実行してください:\n"
                "  uv run python packages/emoji-search/scripts/download_openmoji.py\n"
                "  uv run python packages/emoji-search/scripts/build_index.py"
            )
        return EmojiSearcher(index_path, d / "metadata.jsonl")

    if mode == "japanese":
        from japanese_search.searcher import JapaneseSearcher

        return JapaneseSearcher()

    if mode == "english":
        from english_search.searcher import EnglishSearcher

        return EnglishSearcher()

    raise ValueError(f"unknown mode: {mode!r} (choices: {MODES})")
