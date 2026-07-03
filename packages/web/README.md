# midair-web (検索 Web アプリ)

絵文字検索をブラウザから使う Web アプリ。**テキスト入力** と **手書きキャンバス** の 2 入力に対応し、
結果を絵文字画像のグリッドで表示する。検索は**非同期ジョブ**でバックグラウンド実行する。

## 構成
- `src/midair_web/app.py` — FastAPI アプリ (検索 API / 画像配信 / ジョブ管理)
- `src/midair_web/static/index.html` — フロント (テキスト + 手書き canvas + ポーリング描画)
- `src/midair_web/__main__.py` — `midair-web` 起動 (uvicorn)

## 非同期処理
```
POST /api/search/text   {query, top_k}      -> {job_id, status:"pending"}
POST /api/search/image  {image(dataURL), top_k} -> {job_id, status:"pending"}
GET  /api/jobs/{job_id}  -> {status, results[], error}
GET  /emoji-img/{hex}.png -> 絵文字画像
```
重い CLIP 推論は `asyncio.to_thread` でワーカースレッドに逃がし、イベントループを塞がない。
フロントは `job_id` を受け取り `GET /api/jobs/{id}` を 300ms 間隔でポーリングして結果を描画する。
検索 UI は、入力開始 → ジェスチャ判定 → 入力確定 → リクエスト → 検索中 → 結果表示のフローと、
合計時間 / 検索待ち時間を表示する。

カメラ入力では、モデル読み込み、権限待ち、権限拒否、検出中、手未検出、ジェスチャ保持中、
検索実行中、エラーを状態表示として分けて表示する。

## 起動
事前に `data/emoji_search/` の index 構築が必要 (ルート README 参照)。

カメラの **Mid-Air 入力 (手ジェスチャ)** を使う場合は、MediaPipe アセットを先に取得する。
テキスト / 手書き検索だけなら不要。**Docker はビルド時に自動取得**するが、uv ローカルでは手動が要る (冪等):
```bash
uv run python packages/web/scripts/fetch_mediapipe.py   # -> src/midair_web/static/vendor/mediapipe/
```

依存 import・OpenMoji・FAISS index・MediaPipe・Web 起動前提をまとめて確認する:
```bash
uv run midair-doctor
```

```bash
uv run midair-web                      # http://127.0.0.1:8762 (既定ポート 8762)
uv run midair-web --reload             # 開発用オートリロード
uv run midair-web --port 9000          # ポートを変えたいとき
```

## 今後
- mode 切替で japanese / english サブシステムも同 UI に載せる。
