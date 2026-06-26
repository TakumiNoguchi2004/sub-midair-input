"""``midair-web`` エントリ: uvicorn で FastAPI アプリを起動する。

指定ポート (既定 8762) が使用中なら、自動で次の空きポートにずらして起動する
(``--strict-port`` で無効化)。選んだ URL を表示する。
"""

from __future__ import annotations

import argparse
import socket
import sys


def _port_is_free(host: str, port: int) -> bool:
    """host:port に bind できれば空き。LISTEN 中のポートには bind 失敗する。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
            return True
        except OSError:
            return False


def pick_port(host: str, preferred: int, span: int = 50) -> int:
    """preferred から順に空きポートを探す。見つからなければ OS 割当 (port 0)。"""
    for port in range(preferred, preferred + span):
        if _port_is_free(host, port):
            return port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return sock.getsockname()[1]


def main() -> None:
    parser = argparse.ArgumentParser(prog="midair-web", description="絵文字検索 Web アプリ")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8762)
    parser.add_argument(
        "--strict-port",
        action="store_true",
        help="指定ポートが使用中でもずらさず失敗する",
    )
    parser.add_argument("--reload", action="store_true", help="開発用オートリロード")
    args = parser.parse_args()

    port = args.port
    if not args.strict_port:
        port = pick_port(args.host, args.port)
        if port != args.port:
            print(f"[midair-web] port {args.port} は使用中 -> {port} を使用", file=sys.stderr)
    print(f"[midair-web] http://{args.host}:{port}", file=sys.stderr)

    import uvicorn

    uvicorn.run("midair_web.app:app", host=args.host, port=port, reload=args.reload)


if __name__ == "__main__":
    main()
