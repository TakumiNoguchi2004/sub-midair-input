"""OpenMoji メタデータのロードと画像読み込み。

OpenMoji の画像はファイル名が hexcode (例: ``1F600.png``) なので、
``openmoji.json`` の各エントリと画像をファイル名で突き合わせる。
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image


@dataclass
class EmojiRecord:
    """1 絵文字ぶんのメタデータ。FAISS の row 順とこの並びを一致させる。"""

    hexcode: str
    emoji: str
    annotation: str
    group: str
    subgroups: str
    tags: str
    image_path: str

    def as_dict(self) -> dict:
        return asdict(self)


def load_emoji_records(metadata_path: str | Path, images_dir: str | Path) -> list[EmojiRecord]:
    """``openmoji.json`` を読み、実在する画像だけを ``EmojiRecord`` のリストにして返す。"""
    metadata_path = Path(metadata_path)
    images_dir = Path(images_dir)

    with open(metadata_path, encoding="utf-8") as f:
        raw = json.load(f)

    records: list[EmojiRecord] = []
    for item in raw:
        hexcode = item["hexcode"]
        image_path = images_dir / f"{hexcode}.png"
        if not image_path.exists():
            continue
        records.append(
            EmojiRecord(
                hexcode=hexcode,
                emoji=item.get("emoji", ""),
                annotation=item.get("annotation", ""),
                group=item.get("group", ""),
                subgroups=item.get("subgroups", ""),
                tags=item.get("tags", ""),
                image_path=str(image_path),
            )
        )
    return records


def load_rgb_on_white(path: str | Path) -> Image.Image:
    """透過 PNG を白背景に合成して RGB で返す。

    OpenMoji は透過背景なので、そのまま RGB 化すると背景が黒に潰れる絵文字が出る。
    CLIP の学習分布 (自然画像) に寄せる意味でも白背景に合成しておく。
    """
    img = Image.open(path).convert("RGBA")
    background = Image.new("RGBA", img.size, (255, 255, 255, 255))
    background.alpha_composite(img)
    return background.convert("RGB")
