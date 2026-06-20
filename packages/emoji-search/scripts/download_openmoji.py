"""OpenMoji データ取得スクリプト (データ準備工程の入口)。

GitHub Releases から 72x72 PNG (zip) と ``openmoji.json`` を取得し、
``data/emoji_search/`` に配置する。リポジトリ全体 (~1.6GB) は重いので clone しない。

2 種類の画像セットを取得できる (``--variant``):
  - ``color`` -> ``openmoji/``        : カラー版。**表示用** (検索結果に出す絵文字)
  - ``black`` -> ``openmoji_black/``  : 黒線画版。**index 構築用** (手書き=白地+黒線にドメインを合わせる)
表示は常にカラー、ベクトルは線画から、という運用
(詳細は docs/emoji_search/experiment-domain-matched-index.md)。

冪等: 既に存在すればスキップする (``--force`` で再取得)。
依存は標準ライブラリのみ (urllib / zipfile)。

実行例:
    uv run python packages/emoji-search/scripts/download_openmoji.py                 # color のみ
    uv run python packages/emoji-search/scripts/download_openmoji.py --variant both  # color + black
"""

from __future__ import annotations

import argparse
import os
import shutil
import urllib.request
import zipfile
from pathlib import Path

OPENMOJI_VERSION = "17.0.0"

# variant -> (展開先サブディレクトリ, Releases の zip ファイル名)
VARIANTS = {
    "color": ("openmoji", "openmoji-72x72-color.zip"),
    "black": ("openmoji_black", "openmoji-72x72-black.zip"),
}
RELEASE_BASE = f"https://github.com/hfg-gmuend/openmoji/releases/download/{OPENMOJI_VERSION}"
METADATA_URL = (
    f"https://raw.githubusercontent.com/hfg-gmuend/openmoji/"
    f"{OPENMOJI_VERSION}/data/openmoji.json"
)

# データルートは MIDAIR_DATA_DIR 優先、無ければ repo root/data。
# .../packages/emoji-search/scripts/download_openmoji.py -> repo root は parents[3]
REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = Path(os.environ.get("MIDAIR_DATA_DIR") or (REPO_ROOT / "data")) / "emoji_search"


def _download(url: str, dest: Path) -> None:
    print(f"      downloading {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "midair-input/0.1"})
    with urllib.request.urlopen(request) as response, open(dest, "wb") as out:
        shutil.copyfileobj(response, out)


def fetch_images(variant: str, *, force: bool) -> None:
    """指定 variant の画像セットを取得・展開する (冪等)。"""
    subdir, zip_name = VARIANTS[variant]
    images_dir = DATA_DIR / subdir
    zip_path = DATA_DIR / zip_name

    existing = list(images_dir.glob("*.png")) if images_dir.exists() else []
    if existing and not force:
        print(f"  images[{variant}]: skip ({len(existing)} png already in {images_dir})")
        return
    print(f"  images[{variant}]")
    _download(f"{RELEASE_BASE}/{zip_name}", zip_path)
    images_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(images_dir)
    count = len(list(images_dir.glob("*.png")))
    print(f"      extracted {count} png -> {images_dir}")


def fetch_metadata(*, force: bool) -> None:
    metadata_path = DATA_DIR / "openmoji.json"
    if metadata_path.exists() and not force:
        print(f"  metadata: skip (already at {metadata_path})")
        return
    print("  metadata")
    _download(METADATA_URL, metadata_path)
    print(f"      saved {metadata_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download OpenMoji images + metadata.")
    parser.add_argument(
        "--variant",
        choices=["color", "black", "both"],
        default="color",
        help="取得する画像セット: color=表示用 / black=index構築用(線画) / both=両方",
    )
    parser.add_argument("--force", action="store_true", help="既存ファイルがあっても再取得する")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    variants = ["color", "black"] if args.variant == "both" else [args.variant]
    for variant in variants:
        fetch_images(variant, force=args.force)
    fetch_metadata(force=args.force)

    print("done. 次: uv run python packages/emoji-search/scripts/build_index.py")


if __name__ == "__main__":
    main()
