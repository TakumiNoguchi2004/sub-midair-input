"""データ準備工程: OpenMoji 画像 → CLIP 埋め込み → numpy index 構築。

成果物 (デフォルトは ``data/emoji_search/`` 配下):
  - ``index.npy``       : 画像埋め込みベクトル (row 順 = metadata 順, float32)
  - ``metadata.jsonl``  : row_id ↔ hexcode / annotation / image_path ...
  - ``index_meta.json`` : model_id / dim / normalize など (再構築判断用)

GPU があれば自動で使う。RTX 6000 Ada クラスなら数千枚でも数十秒。
リポジトリのどこから実行してもよいよう、デフォルトパスは repo root 基準で解決する。
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

from tqdm import tqdm

from emoji_search.data import load_emoji_records, load_rgb_on_white
from emoji_search.encoder import DEFAULT_MODEL, ClipEncoder
from midair_shared.index import build_index, save_index

# データルートは MIDAIR_DATA_DIR 優先、無ければ repo root/data。
# .../packages/emoji-search/scripts/build_index.py -> repo root は parents[3]
REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = Path(os.environ.get("MIDAIR_DATA_DIR") or (REPO_ROOT / "data")) / "emoji_search"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build numpy index from OpenMoji images.")
    parser.add_argument("--metadata", default=str(DATA_DIR / "openmoji.json"))
    parser.add_argument(
        "--source-variant",
        choices=["color", "black"],
        default="color",
        help="ベクトル構築に使う画像セット: color=openmoji/ / black=openmoji_black/(線画)。"
        "表示は常にカラー (metadata は openmoji/ を指す)。",
    )
    parser.add_argument(
        "--images-dir",
        default=None,
        help="ベクトル構築に使う画像ディレクトリ。未指定なら --source-variant から決定。",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL, help="CLIP モデル名")
    parser.add_argument("--index-path", default=str(DATA_DIR / "index.npy"))
    parser.add_argument("--metadata-out", default=str(DATA_DIR / "metadata.jsonl"))
    parser.add_argument("--batch-size", type=int, default=64)
    return parser.parse_args()


# source-variant -> (画像サブディレクトリ, index_meta に記録する preprocess ラベル)
SOURCE_VARIANTS = {
    "color": ("openmoji", "rgba_on_white"),
    "black": ("openmoji_black", "openmoji_black"),
}


def main() -> None:
    args = parse_args()

    subdir, preprocess_label = SOURCE_VARIANTS[args.source_variant]
    images_dir = args.images_dir or str(DATA_DIR / subdir)

    records = load_emoji_records(args.metadata, images_dir)
    print(f"[1/4] loaded {len(records)} emoji records "
          f"(source={args.source_variant}, dir={images_dir})")
    if not records:
        raise SystemExit("画像が 1 枚も見つからない。--images-dir / --metadata を確認。")

    encoder = ClipEncoder(args.model, batch_size=args.batch_size)
    print(f"[2/4] model={encoder.model_name} dim={encoder.dim} device={encoder.device}")

    images = [load_rgb_on_white(r.image_path) for r in tqdm(records, desc="      load images")]

    t0 = time.perf_counter()
    vectors = encoder.encode_image(images)
    print(f"[3/4] encoded {vectors.shape[0]} images -> {vectors.shape[1]}d "
          f"in {time.perf_counter() - t0:.1f}s")

    index_path = Path(args.index_path)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    save_index(build_index(vectors), index_path)

    with open(args.metadata_out, "w", encoding="utf-8") as f:
        for row_id, record in enumerate(records):
            row = {"row_id": row_id, **record.as_dict()}
            row["image_path"] = f"openmoji/{record.hexcode}.png"
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    meta = {
        "model_id": encoder.model_name,
        "dim": encoder.dim,
        "normalize": True,
        "metric": "ip",
        "preprocess": preprocess_label,
        "count": len(records),
    }
    meta_path = index_path.with_name("index_meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"[4/4] saved {index_path}, {args.metadata_out}, {meta_path}")


if __name__ == "__main__":
    main()
