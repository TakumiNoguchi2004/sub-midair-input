#!/usr/bin/env bash
# 空きホストポートを自動で選んで Web アプリを Docker で起動する。
#
# 既定 8762 から順に空きを探し、MIDAIR_WEB_PORT に入れて `docker compose up web` を実行する。
# (docker compose 自体は固定ポートを自動でずらさないため、その前段でここが空きを探す)
#
# 使い方:
#   scripts/run-web.sh            # 空きポートで起動 (フォアグラウンド)
#   scripts/run-web.sh -d         # バックグラウンド (追加引数は compose に渡る)
#   MIDAIR_WEB_PORT=9000 scripts/run-web.sh   # 探索開始ポートを変える
set -euo pipefail

start_port="${MIDAIR_WEB_PORT:-8762}"
span="${PORT_SCAN_SPAN:-50}"

# ポートが使用中(LISTEN)か判定。全インタフェース/IPv6 まで見れる lsof を優先し、
# 無い環境では bash の /dev/tcp(127.0.0.1) で代替する。
port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  fi
}

chosen=""
for (( p = start_port; p < start_port + span; p++ )); do
  if ! port_in_use "$p"; then
    chosen="$p"
    break
  fi
done

if [ -z "$chosen" ]; then
  echo "[run-web] 空きポートが見つかりませんでした (${start_port}..$((start_port + span - 1)))" >&2
  exit 1
fi

if [ "$chosen" != "$start_port" ]; then
  echo "[run-web] ポート ${start_port} は使用中 -> ${chosen} を使用" >&2
fi
echo "[run-web] http://localhost:${chosen}" >&2

# リポジトリルートから実行 (このスクリプトの 1 つ上)
cd "$(dirname "$0")/.."
MIDAIR_WEB_PORT="$chosen" exec docker compose up web "$@"
