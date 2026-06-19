"""データ準備工程: OpenMoji 画像 → CLIP 埋め込み → FAISS index 構築。

成果物 (デフォルトは ``data/emoji_search/`` 配下):
  - ``index.faiss``     : 画像埋め込みの FAISS index (row 順 = metadata 順)
  - ``metadata.jsonl``  : row_id ↔ hexcode / annotation / image_path ...
  - ``index_meta.json`` : model_id / dim / normalize など (再構築判断用)

GPU があれば自動で使う。RTX 6000 Ada クラスなら数千枚でも数十秒。
リポジトリのどこから実行してもよいよう、デフォルトパスは repo root 基準で解決する。
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from tqdm import tqdm

from emoji_search.data import load_emoji_records, load_rgb_on_white
from emoji_search.encoder import DEFAULT_MODEL, ClipEncoder
from midair_shared.index import build_flat_ip, save_index

# .../packages/emoji-search/scripts/build_index.py -> repo root は parents[3]
REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPO_ROOT / "data" / "emoji_search"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build FAISS index from OpenMoji images.")
    parser.add_argument("--metadata", default=str(DATA_DIR / "openmoji.json"))
    parser.add_argument("--images-dir", default=str(DATA_DIR / "openmoji"))
    parser.add_argument("--model", default=DEFAULT_MODEL, help="CLIP モデル名")
    parser.add_argument("--index-path", default=str(DATA_DIR / "index.faiss"))
    parser.add_argument("--metadata-out", default=str(DATA_DIR / "metadata.jsonl"))
    parser.add_argument("--batch-size", type=int, default=64)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    records = load_emoji_records(args.metadata, args.images_dir)
    print(f"[1/4] loaded {len(records)} emoji records")
    if not records:
        raise SystemExit("画像が 1 枚も見つからない。--images-dir / --metadata を確認。")

    encoder = ClipEncoder(args.model, batch_size=args.batch_size)
    print(f"[2/4] model={encoder.model_name} dim={encoder.dim} device={encoder.device}")

    images = [load_rgb_on_white(r.image_path) for r in tqdm(records, desc="      load images")]

    t0 = time.perf_counter()
    vectors = encoder.encode_image(images)
    print(f"[3/4] encoded {vectors.shape[0]} images -> {vectors.shape[1]}d "
          f"in {time.perf_counter() - t0:.1f}s")

    index = build_flat_ip(vectors)
    index_path = Path(args.index_path)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    save_index(index, index_path)

    with open(args.metadata_out, "w", encoding="utf-8") as f:
        for row_id, record in enumerate(records):
            row = {"row_id": row_id, **record.as_dict()}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    meta = {
        "model_id": encoder.model_name,
        "dim": encoder.dim,
        "normalize": True,
        "metric": "ip",
        "preprocess": "rgba_on_white",
        "count": len(records),
    }
    meta_path = index_path.with_name("index_meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"[4/4] saved {index_path}, {args.metadata_out}, {meta_path}")


if __name__ == "__main__":
    main()
