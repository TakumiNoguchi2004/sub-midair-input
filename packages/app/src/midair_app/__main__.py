"""統合 CLI: ``midair --mode {emoji,japanese,english} --query ... --top-k N``。

mode に応じてサブシステムの ``Searcher`` を遅延ロードし、共通の ``SearchResult``
形式で結果を表示する。
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .registry import MODES, build_searcher

# データルートは MIDAIR_DATA_DIR 優先、無ければ repo root/data (repo 内ならどの cwd からでも動く)。
# .../packages/app/src/midair_app/__main__.py -> parents[4] = repo root
DEFAULT_DATA_DIR = Path(os.environ.get("MIDAIR_DATA_DIR") or (Path(__file__).resolve().parents[4] / "data"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="midair", description="Mid-Air input 統合検索")
    parser.add_argument("--mode", choices=MODES, default="emoji", help="入力モダリティ")
    parser.add_argument("--query", required=True, help="検索テキスト")
    parser.add_argument("--top-k", type=int, default=5, help="返す件数")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR,
                        help="データルート (既定: <repo>/data)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        searcher = build_searcher(args.mode, args.data_dir)
        results = searcher.search_text(args.query, args.top_k)
    except NotImplementedError as e:
        print(f"[{args.mode}] {e}", file=sys.stderr)
        raise SystemExit(2)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(2)
    for r in results:
        emoji = r.payload.get("emoji", "")
        print(f"{r.score:.3f}  {emoji}  {r.id}  {r.label}")


if __name__ == "__main__":
    main()
