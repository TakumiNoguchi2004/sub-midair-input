"""FastAPI アプリ: テキスト / 手書き画像で絵文字を検索し、画像で結果を返す。

検索は **非同期ジョブ** で処理する:
  POST /api/search/{text,image}  -> job_id を即返す (status=pending)
  GET  /api/jobs/{job_id}        -> status と結果 (done になったら results)
重い CLIP 推論は ``asyncio.to_thread`` でワーカースレッドに逃がし、
イベントループ (= 他リクエスト) を塞がない。
"""

from __future__ import annotations

import asyncio
import base64
import io
import mimetypes
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

from emoji_search.searcher import EmojiSearcher
from japanese_search.converter import convert as jp_convert

# データルートは MIDAIR_DATA_DIR 優先 (Docker 等)、無ければ repo root/data。
# .../packages/web/src/midair_web/app.py -> parents[4] = repo root
REPO_ROOT = Path(__file__).resolve().parents[4]
_DATA_ROOT = Path(os.environ.get("MIDAIR_DATA_DIR") or (REPO_ROOT / "data"))
DATA_DIR = _DATA_ROOT / "emoji_search"
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Mid-Air Emoji Search")

# ES モジュール (.mjs) / wasm を正しい MIME で配信する (ブラウザの module / wasm 読込に必須)。
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")
# static/ 配下 (vendor の MediaPipe 等) を /assets で配信する。
app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")

# --- 重い searcher は遅延ロード (CLIP モデル + index は初回検索時に 1 度だけ) ---
_searcher: EmojiSearcher | None = None
_searcher_lock = asyncio.Lock()


async def get_searcher() -> EmojiSearcher:
    global _searcher
    if _searcher is None:
        async with _searcher_lock:
            if _searcher is None:
                _searcher = await asyncio.to_thread(
                    EmojiSearcher,
                    DATA_DIR / "index.faiss",
                    DATA_DIR / "metadata.jsonl",
                )
    return _searcher


# --- 非同期ジョブ管理 (プロセス内メモリ) ---
@dataclass
class Job:
    id: str
    status: str = "pending"  # pending | running | done | error
    results: list = field(default_factory=list)
    error: str | None = None


JOBS: dict[str, Job] = {}


class TextQuery(BaseModel):
    query: str
    top_k: int = 12


class ImageQuery(BaseModel):
    image: str  # data URL ("data:image/png;base64,....") もしくは生 base64
    top_k: int = 12


def _serialize(result) -> dict:
    return {
        "id": result.id,
        "score": round(result.score, 4),
        "label": result.label,
        "emoji": result.payload.get("emoji", ""),
        "image_url": f"/emoji-img/{result.id}.png",
    }


def _decode_image(data_url: str) -> Image.Image:
    """canvas の data URL / base64 PNG を白背景合成して RGB の PIL 画像にする。"""
    payload = data_url.split(",", 1)[1] if "," in data_url else data_url
    raw = base64.b64decode(payload)
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    background = Image.new("RGBA", img.size, (255, 255, 255, 255))
    background.alpha_composite(img)
    return background.convert("RGB")


async def _process(job_id: str, run) -> None:
    """``run`` (同期・ブロッキング) をスレッドで実行し、結果を job に格納する。"""
    job = JOBS[job_id]
    job.status = "running"
    try:
        searcher = await get_searcher()
        results = await asyncio.to_thread(run, searcher)
        job.results = [_serialize(r) for r in results]
        job.status = "done"
    except Exception as exc:  # noqa: BLE001 - 失敗内容を job に載せて返す
        job.error = str(exc)
        job.status = "error"


def _new_job() -> str:
    job_id = uuid.uuid4().hex
    JOBS[job_id] = Job(id=job_id)
    return job_id


@app.post("/api/search/text")
async def search_text(query: TextQuery) -> dict:
    job_id = _new_job()
    asyncio.create_task(_process(job_id, lambda s: s.search_text(query.query, query.top_k)))
    return {"job_id": job_id, "status": "pending"}


@app.post("/api/search/image")
async def search_image(query: ImageQuery) -> dict:
    image = _decode_image(query.image)
    job_id = _new_job()
    asyncio.create_task(_process(job_id, lambda s: s.search_image(image, query.top_k)))
    return {"job_id": job_id, "status": "pending"}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown job")
    return {"job_id": job.id, "status": job.status, "results": job.results, "error": job.error}


@app.get("/emoji-img/{name}")
def emoji_image(name: str) -> FileResponse:
    path = DATA_DIR / "openmoji" / Path(name).name  # .name でパストラバーサル防止
    if not path.is_file():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(path, media_type="image/png")


class ConvertQuery(BaseModel):
    text: str


@app.post("/api/convert/kanji")
def convert_kanji(query: ConvertQuery) -> dict:
    """ひらがなをかな漢字変換してセグメント候補リストを返す (同期・軽量)。"""
    return {"segments": jp_convert(query.text)}


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")


@app.get("/game", response_class=HTMLResponse)
def game() -> str:
    return (STATIC_DIR / "game.html").read_text(encoding="utf-8")
