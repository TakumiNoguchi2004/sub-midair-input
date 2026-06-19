"""OpenMoji データ取得スクリプト (データ準備工程の入口)。

GitHub Releases から 72x72 カラー PNG (zip) と ``openmoji.json`` を取得し、
``data/emoji_search/`` に配置する。リポジトリ全体 (~1.6GB) は重いので clone しない。

冪等: 既に存在すればスキップする (``--force`` で再取得)。
依存は標準ライブラリのみ (urllib / zipfile)。

実行例:
    uv run python packages/emoji-search/scripts/download_openmoji.py
"""

from __future__ import annotations

import argparse
import shutil
import urllib.request
import zipfile
from pathlib import Path

OPENMOJI_VERSION = "17.0.0"
PNG_ZIP_URL = (
    f"https://github.com/hfg-gmuend/openmoji/releases/download/"
    f"{OPENMOJI_VERSION}/openmoji-72x72-color.zip"
)
METADATA_URL = (
    f"https://raw.githubusercontent.com/hfg-gmuend/openmoji/"
    f"{OPENMOJI_VERSION}/data/openmoji.json"
)

# .../packages/emoji-search/scripts/download_openmoji.py -> repo root は parents[3]
REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPO_ROOT / "data" / "emoji_search"


def _download(url: str, dest: Path) -> None:
    print(f"      downloading {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "midair-input/0.1"})
    with urllib.request.urlopen(request) as response, open(dest, "wb") as out:
        shutil.copyfileobj(response, out)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download OpenMoji images + metadata.")
    parser.add_argument("--force", action="store_true", help="既存ファイルがあっても再取得する")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    images_dir = DATA_DIR / "openmoji"
    zip_path = DATA_DIR / "openmoji-72x72-color.zip"
    metadata_path = DATA_DIR / "openmoji.json"

    # 1) 画像 (72x72 color PNG)
    existing_png = list(images_dir.glob("*.png")) if images_dir.exists() else []
    if existing_png and not args.force:
        print(f"[1/2] images: skip ({len(existing_png)} png already in {images_dir})")
    else:
        print("[1/2] images")
        _download(PNG_ZIP_URL, zip_path)
        images_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(images_dir)
        count = len(list(images_dir.glob("*.png")))
        print(f"      extracted {count} png -> {images_dir}")

    # 2) メタデータ
    if metadata_path.exists() and not args.force:
        print(f"[2/2] metadata: skip (already at {metadata_path})")
    else:
        print("[2/2] metadata")
        _download(METADATA_URL, metadata_path)
        print(f"      saved {metadata_path}")

    print("done. 次: uv run python packages/emoji-search/scripts/build_index.py")


if __name__ == "__main__":
    main()
