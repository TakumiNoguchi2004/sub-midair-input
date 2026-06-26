# syntax=docker/dockerfile:1
#
# Intel Mac (linux/amd64, GPU 無し) でローカル実行するためのイメージ。
# torch は CPU 版を uv.lock で固定済み。CLIP モデルはイメージに焼き込み、実行時はネット不要。
# data/ (画像 + index) は実行時にボリュームマウントする。

FROM --platform=linux/amd64 python:3.12-slim

# uv (依存解決・インストール)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    HF_HOME=/opt/hf \
    MIDAIR_DATA_DIR=/app/data \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# 1) 依存メタデータ + ワークスペース各パッケージ
COPY pyproject.toml uv.lock README.md ./
COPY packages/ ./packages/

# 2) CPU 版依存をインストール (lock 固定 / 開発依存なし)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# 3) CLIP モデル (ViT-B/32) をイメージに焼き込む -> 実行時のダウンロード不要
RUN python -c "from transformers import CLIPModel, CLIPProcessor; m='openai/clip-vit-base-patch32'; CLIPModel.from_pretrained(m); CLIPProcessor.from_pretrained(m)"

# 3b) MediaPipe (Hand Landmarker) の JS/wasm/モデルを static/vendor に焼き込む
#     -> ブラウザの Mid-Air 入力 (手検出) も実行時ネット不要 (完全オフライン)
RUN python packages/web/scripts/fetch_mediapipe.py

# 3c) Drive から index を取得する gdown を venv に入れておく (compose の fetch サービスが使う)
RUN uv pip install --python /app/.venv/bin/python gdown

# モデルを焼き込んだので実行時はオフライン固定 (ネット無し環境でも確実に動く)
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

EXPOSE 8000

# 既定は Web アプリ起動 (0.0.0.0 でコンテナ外公開)
CMD ["uvicorn", "midair_web.app:app", "--host", "0.0.0.0", "--port", "8000"]
