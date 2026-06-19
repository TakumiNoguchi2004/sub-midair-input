"""画像 / テキストを共通空間に写像する encoder ラッパー。

差し替え可能にするため、検索側は ``encode_image`` / ``encode_text`` / ``dim`` だけに依存する。
返り値は **L2 正規化済み float32** の ``np.ndarray`` で統一する
(FAISS ``IndexFlatIP`` に入れれば内積 = cosine 類似度になる)。
"""

from __future__ import annotations

import numpy as np
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

DEFAULT_MODEL = "openai/clip-vit-base-patch32"


class ClipEncoder:
    """OpenAI CLIP (transformers 実装) の薄いラッパー。"""

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        device: str | None = None,
        batch_size: int = 64,
    ) -> None:
        self.model_name = model_name
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.batch_size = batch_size
        self.model = CLIPModel.from_pretrained(model_name).to(self.device).eval()
        self.processor = CLIPProcessor.from_pretrained(model_name)

    @property
    def dim(self) -> int:
        return int(self.model.config.projection_dim)

    @torch.no_grad()
    def encode_image(self, images: list[Image.Image]) -> np.ndarray:
        """PIL 画像のリスト → (N, dim) の正規化済みベクトル。"""
        chunks = []
        for start in range(0, len(images), self.batch_size):
            batch = images[start : start + self.batch_size]
            inputs = self.processor(images=batch, return_tensors="pt").to(self.device)
            feats = self.model.get_image_features(**inputs)
            chunks.append(self._normalize(self._as_tensor(feats)))
        return self._stack(chunks)

    @torch.no_grad()
    def encode_text(self, texts: list[str]) -> np.ndarray:
        """テキストのリスト → (N, dim) の正規化済みベクトル。"""
        chunks = []
        for start in range(0, len(texts), self.batch_size):
            batch = texts[start : start + self.batch_size]
            inputs = self.processor(
                text=batch, return_tensors="pt", padding=True, truncation=True
            ).to(self.device)
            feats = self.model.get_text_features(**inputs)
            chunks.append(self._normalize(self._as_tensor(feats)))
        return self._stack(chunks)

    @staticmethod
    def _as_tensor(out) -> torch.Tensor:
        # transformers>=5 は ModelOutput (pooler_output に射影済み埋め込み) を返す。
        # 4.x は射影済みテンソルを直接返すので、その場合はそのまま使う。
        if hasattr(out, "pooler_output"):
            return out.pooler_output
        return out

    def _normalize(self, feats: torch.Tensor) -> np.ndarray:
        feats = feats / feats.norm(p=2, dim=-1, keepdim=True)
        return feats.cpu().numpy().astype("float32")

    def _stack(self, chunks: list[np.ndarray]) -> np.ndarray:
        if not chunks:
            return np.zeros((0, self.dim), dtype="float32")
        return np.concatenate(chunks, axis=0)
