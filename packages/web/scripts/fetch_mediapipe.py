"""MediaPipe Tasks Vision (Hand Landmarker) を static/vendor へ取得する。

ブラウザ側 Mid-Air 入力 (手検出) を **完全オフライン** で動かすため、
@mediapipe/tasks-vision の JS / wasm とモデルを自前配信用に同梱する。
CLIP モデルと同様「ビルド時に取得 → 実行時はネット不要」とするため、
Dockerfile からも呼ぶ。冪等 (既存ファイルがあればスキップ、--force で再取得)。
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

VERSION = "0.10.35"
CDN = f"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@{VERSION}"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)

# (相対パス, URL) の一覧。相対パスは vendor/mediapipe/ からの位置。
FILES: list[tuple[str, str]] = [
    ("vision_bundle.mjs", f"{CDN}/vision_bundle.mjs"),
    ("hand_landmarker.task", MODEL_URL),
    *[
        (f"wasm/{name}", f"{CDN}/wasm/{name}")
        for name in (
            "vision_wasm_internal.js",
            "vision_wasm_internal.wasm",
            "vision_wasm_module_internal.js",
            "vision_wasm_module_internal.wasm",
            "vision_wasm_nosimd_internal.js",
            "vision_wasm_nosimd_internal.wasm",
        )
    ],
]

VENDOR_DIR = Path(__file__).resolve().parent.parent / "src" / "midair_web" / "static" / "vendor" / "mediapipe"
TIMEOUT_SECONDS = 60


def fetch(rel: str, url: str, *, force: bool) -> None:
    dest = VENDOR_DIR / rel
    if dest.is_file() and dest.stat().st_size > 0 and not force:
        print(f"  skip (exists): {rel}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  download: {rel}")
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310 - 既知の固定 URL
            tmp.write_bytes(resp.read())
        tmp.replace(dest)
    finally:
        if tmp.exists():
            tmp.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="既存ファイルも再取得する")
    args = parser.parse_args()

    print(f"MediaPipe tasks-vision {VERSION} -> {VENDOR_DIR}")
    for rel, url in FILES:
        fetch(rel, url, force=args.force)
    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
