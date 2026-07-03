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

## 入力モード

カメラ入力は入力モードごとに同じ手の動きを別の意味として扱う。

- `絵文字`: 既存のピンチ描画、ピース検索、指差しクリア
- `日本語`: 10種類のピンチパターンで行を選び、フリック方向で母音を選ぶ50音入力の試作。1文字確定後は、パー状態を検出するまで次の文字を受け付けない。
- `英語`: 未実装

言語切替モーション (実験): カメラパネルのセレクタで方式を選ぶと、手の向き (手のひら/手の甲) で
`cycleInputMode()` を呼び `日本語 → 英語 → 絵文字` を巡回する。方式は 2 つ:

- `手の甲を0.5秒`: 手の甲を見せて 0.5 秒キープ
- `手のひら→甲にひっくり返す`: 手のひらから手の甲へ裏返した瞬間

手のひら/甲は「手首→人差し指/小指付け根」の外積符号で判定 (環境で逆なら UI の反転トグル)。
手の甲が見えている間は 描く/検索/クリア(絵文字) や 日本語フリック を停止し、言語切替専用にする。
しきい値・既定方式などは `static/index.html` 冒頭の定数で調整する。

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
