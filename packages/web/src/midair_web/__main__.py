"""``midair-web`` エントリ: uvicorn で FastAPI アプリを起動する。"""

from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(prog="midair-web", description="絵文字検索 Web アプリ")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8762)
    parser.add_argument("--reload", action="store_true", help="開発用オートリロード")
    args = parser.parse_args()

    import uvicorn

    uvicorn.run("midair_web.app:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
