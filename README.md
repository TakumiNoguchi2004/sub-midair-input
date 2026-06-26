# Mid-Air Flick Input システム

空中フリック入力で **絵文字 / 日本語 / 英語** を入力するシステム。
各モダリティを独立サブシステムとして**分割開発**し、最終的に 1 つの統合アプリ (`midair`) に**束ねる**。

いずれのモダリティも「入力 → 埋め込みベクトル化 → FAISS 近傍検索 → 候補表示」という共通構造を取る。

## サブシステム

| モダリティ | パッケージ | 状態 | 概要 |
|---|---|---|---|
| 絵文字入力 | `emoji-search` | **実装済み (v0)** | OpenMoji を CLIP で埋め込み、テキスト / 手書き画像 / カメラで検索 |
| 日本語入力 | `japanese-search` | スケルトン | 未実装 |
| 英語入力 | `english-search` | スケルトン | 未実装 |

共通基盤 `midair-shared` が **encoder 契約 / FAISS ユーティリティ / 統合契約 (`Searcher`)** を提供し、
統合アプリ `midair-app` が `mode` に応じて各サブシステムを遅延ロードして振り分ける。
ブラウザ UI は `midair-web`（FastAPI）が提供する — テキスト / 手書き / カメラの Mid-Air 入力、結果を画像表示、非同期検索。

## リポジトリ構成 (uv workspace monorepo)

```
mi-midair-input/
├── pyproject.toml              # uv workspace root (package=false, members=packages/*)
├── README.md / CLAUDE.md
├── Dockerfile / docker-compose.yml / .dockerignore
├── scripts/run-web.sh          # Docker 起動 (空きポート自動選択)
├── docs/                        # ドキュメント
│   └── emoji_search/            #   DOCKER.md / 実験計画 など
├── packages/
│   ├── shared/                 # midair-shared: 共通基盤
│   │   └── src/midair_shared/
│   │       ├── encoder.py      #   TextEncoder / MultimodalEncoder 契約
│   │       ├── index.py        #   FAISS 構築・保存・検索
│   │       └── search.py       #   Searcher / SearchResult 契約 (統合の継ぎ目)
│   ├── emoji-search/           # 絵文字入力 (実装済み)
│   │   ├── scripts/           #   download_openmoji.py / build_index.py
│   │   └── src/emoji_search/   #   encoder.py / data.py / searcher.py
│   ├── japanese-search/        # 日本語入力 (スケルトン)
│   ├── english-search/         # 英語入力 (スケルトン)
│   ├── app/                    # midair-app: 統合 CLI (`midair`)
│   │   └── src/midair_app/     #   registry.py / __main__.py
│   └── web/                    # midair-web: Web アプリ (FastAPI, 非同期検索)
│       ├── scripts/           #   fetch_mediapipe.py (カメラ入力用 MediaPipe 取得)
│       └── src/midair_web/     #   app.py / __main__.py / static/index.html
└── data/                       # git 管理外 (.gitkeep のみ追跡)
    ├── emoji_search/           #   openmoji/ + openmoji.json + index.faiss + metadata.jsonl
    ├── japanese_search/
    └── english_search/
```

データはサブシステム別ディレクトリに隔離し、相互に干渉しない設計にしている。

---

# 動かし方

動かし方は **Docker** と **uv** の 2 通り。やりたいことに合わせてどちらかを選ぶ。

| 方法 | 向いている用途 | 特徴 |
|---|---|---|
| **[A. Docker](#a-docker-で動かす)** | 配布・再現性重視 | torch は CPU 版、CLIP / MediaPipe をイメージに焼き込み → ほぼオフライン。Intel Mac はネイティブ、Apple Silicon は amd64 エミュレーション |
| **[B. uv](#b-uv-で動かす-ローカル開発)** | ローカル開発 | ホットリロード等。CLIP モデルは初回実行時に取得 |

絵文字検索に必要な準備は次の 3 つ（方式ごとに手順が違う。下記参照）:

- **OpenMoji 画像** … 結果の表示用（公式 Releases から取得）
- **Drive の faiss index** … 検索用。各環境で重い CLIP 推論をやり直さないよう、ビルド済み index を共有 Drive から取得するのが基本
- **MediaPipe (Hand Landmarker)** … カメラの Mid-Air 入力（手ジェスチャ）を使う場合のみ

> `data/emoji_search/` に画像 + index が既に揃っている環境（別マシンからコピーした場合も含む）は、データ準備をスキップして起動へ進んでよい。

---

## A. Docker で動かす

### A-1. イメージをビルド

```bash
docker compose build
```

- CPU 版 torch / transformers / faiss を導入し、**CLIP ViT-B/32** をイメージに焼き込む（初回は CLIP 約 600MB のダウンロード込みで数分）。
- **MediaPipe（手検出）の JS / wasm / モデルもビルド時に同梱**される（`Dockerfile` が `fetch_mediapipe.py` を実行）。→ カメラの Mid-Air 入力も**追加準備なし・実行時オフライン**で動く。

### A-2. データ準備（OpenMoji 画像 + Drive の faiss index）

```bash
# 基本: 表示用カラー画像(公式) と index(Drive) をまとめて取得 (CLIP 推論なし・軽い)
docker compose --profile setup run --rm fetch
#   -> data/emoji_search/{openmoji/, openmoji.json, index.faiss, metadata.jsonl, index_meta.json}
```

- **OpenMoji / Drive faiss はこの 1 コマンドで両方そろう**（`fetch` サービスが `download_openmoji.py` と `gdown` を実行）。
- **MediaPipe は A-1 でイメージに焼き込み済みのため、ここでの準備は不要。**
- 取得元 Drive フォルダを変えるとき: `MIDAIR_INDEX_URL="<別フォルダの共有リンク>" docker compose --profile setup run --rm fetch`。
- ⚠️ `gdown --folder` は `data/<Drive フォルダ名>/` に展開する。`data/emoji_search/` に入るのは**共有フォルダ名が `emoji_search` の場合**（リネームすると別ディレクトリに落ちる）。

Drive を使わずローカルで index を構築する場合（線画ソースから、CLIP 推論で重い）:

```bash
docker compose --profile setup run --rm prepare
```

### A-3. 起動（ポートの自動割り当て）

**推奨は `scripts/run-web.sh`**。これは「**空きポートを先に決めてから `docker compose up` を呼ぶ**」ラッパーで、決まったポートの URL を表示する:

1. host の 8762 から順に空きポートを探す（使用中ならずらす。例: 8762/8763 が埋まっていれば 8764）
2. `MIDAIR_WEB_PORT=<空きポート>` を入れて `docker compose up web` を実行
3. `http://localhost:<空きポート>` を表示

```bash
scripts/run-web.sh               # 空きポートを選んで起動し、URL を表示
scripts/run-web.sh -d            # バックグラウンド (追加引数は compose に渡る)
```

ポートを固定したい場合は素の `docker compose` を使う（host ポートは固定。**8762 が埋まっていると起動失敗**し、URL も表示しない）:

```bash
# 既定: ホスト 8762 -> コンテナ 8000
docker compose up web            # フォアグラウンド  http://localhost:8762
docker compose up -d web         # バックグラウンド
MIDAIR_WEB_PORT=9000 docker compose up web   # ポートを手動指定
```

停止:

```bash
docker compose down
```

### A-4. アプリの使い方

- **ブラウザ** で表示された URL（既定 http://localhost:8762）を開く。テキスト入力 / 手書きキャンバス / カメラの Mid-Air 入力で検索でき、結果は絵文字画像のグリッドで表示される（検索は非同期ジョブ）。
- **CLI をワンショットで使う**:
  ```bash
  docker compose run --rm web midair --mode emoji --query "cat" --top-k 5
  ```

詳細は [`docs/emoji_search/DOCKER.md`](docs/emoji_search/DOCKER.md)。

---

## B. uv で動かす (ローカル開発)

### B-0. セットアップ

```bash
uv sync          # 全 workspace パッケージを 1 つの venv に導入
```

確認:

```bash
uv run python -c "import torch, transformers, faiss; print('ok')"
```

### B-1. OpenMoji 画像をダウンロード（表示用）

```bash
uv run python packages/emoji-search/scripts/download_openmoji.py
#   -> data/emoji_search/{openmoji/, openmoji.json}   (冪等: 既存はスキップ、--force で再取得)
```

### B-2. Drive から faiss index をダウンロード（検索用）

```bash
uvx gdown --folder "https://drive.google.com/drive/folders/1ucgsVXXp6jOTWapOPTLsz9i-wpnPS652" -O data
#   -> data/emoji_search/{index.faiss, metadata.jsonl, index_meta.json}
```

- ⚠️ `gdown --folder` は `data/<Drive フォルダ名>/` に展開する。上の例で `data/emoji_search/` に入るのは**共有フォルダ名が `emoji_search` の場合**。
- 検索は `index_meta.json` の `model_id` と**同じ CLIP モデル**で行う前提（index はデバイス非依存・移植可能）。

Drive を使わずローカルで index を構築する場合（線画ソースから、CLIP 推論で重い）:

```bash
uv run python packages/emoji-search/scripts/download_openmoji.py --variant both
uv run python packages/emoji-search/scripts/build_index.py --source-variant black
```

### B-3. MediaPipe をダウンロード（カメラの Mid-Air 入力を使う場合のみ）

```bash
uv run python packages/web/scripts/fetch_mediapipe.py
#   -> packages/web/src/midair_web/static/vendor/mediapipe/ (冪等、--force で再取得)
```

- テキスト / 手書きだけ使うなら不要。**カメラ入力を使うときだけ**実行する（Docker では A-1 で自動同梱されるため不要）。

### B-4. アプリの使い方

```bash
# Web アプリ (ポート自動割り当て内蔵)
uv run midair-web
#   既定 http://127.0.0.1:8762。8762 が使用中なら自動で次の空きポートへずらす。
#   --port <開始ポート> / --strict-port (ずらさず固定) / --reload (開発オートリロード) / --host

# 統合 CLI
uv run midair --mode emoji --query "cat" --top-k 5
#   0.250  🐈‍⬛  1F408-200D-2B1B  black cat
#   0.246  🐈️  1F408            cat
#   ...
uv run midair --mode japanese --query "..."   # 未実装 (スケルトン、exit 2)
uv run midair --mode english  --query "..."   # 未実装 (スケルトン、exit 2)
```

詳細は [`packages/emoji-search/README.md`](packages/emoji-search/README.md) と [`packages/web/README.md`](packages/web/README.md)。

---

## 詰まったときの確認

### `uv run ...` がインストールで止まって見える

どのプロセスが動いているか確認する。

```bash
ps -ef | grep -E 'uv run|build_index|fetch_mediapipe|download_openmoji'
```

`build_index.py` の Python プロセスが CPU を使っている場合は、インストールではなく index 構築中。`[2/4]` 以降は CLIP のローカル計算なので待つ。

### Hugging Face の警告が出る

```text
Warning: You are sending unauthenticated requests to the HF Hub.
```

未認証アクセスなので遅くなったり制限されやすい、という警告。すぐに失敗を意味しない。index 構築が遅いだけなら、ローカルで構築せず Drive から取得する。

```bash
uvx gdown --folder "https://drive.google.com/drive/folders/1ucgsVXXp6jOTWapOPTLsz9i-wpnPS652" -O data
```

モデル取得だけ先に分けて確認する場合:

```bash
uv run python -c "from transformers import CLIPModel, CLIPProcessor; m='openai/clip-vit-base-patch32'; CLIPModel.from_pretrained(m); CLIPProcessor.from_pretrained(m)"
```

### `vision_bundle.mjs` のカメラエラーが出る

MediaPipe の静的ファイルが未取得、または取得後にサーバーを再起動していない状態。

```bash
uv run python packages/web/scripts/fetch_mediapipe.py
uv run midair-web
```

その後、ブラウザをハードリロードする。

### 生成物があるかだけ確認したい

```bash
ls -lh data/emoji_search/index.faiss data/emoji_search/metadata.jsonl data/emoji_search/index_meta.json
find packages/web/src/midair_web/static/vendor/mediapipe -maxdepth 2 -type f | sort
```

---

## ドキュメント

- [`docs/architecture.md`](docs/architecture.md) — 全体構成 / 各 packages のスコープと境界 / 統合の継ぎ目
- [`docs/emoji_search/DOCKER.md`](docs/emoji_search/DOCKER.md) — Docker でのローカル実行 (Mac / CPU)
- [`docs/emoji_search/experiment-domain-matched-index.md`](docs/emoji_search/experiment-domain-matched-index.md) — 手書きドメインに合わせた index 構築の実験計画 (別デバイス向け指示書)
- [`CLAUDE.md`](CLAUDE.md) — システム全体構成 / 開発フロー (git-flow) / エージェント向け指針
- `packages/*/README.md` — 各サブシステムの詳細

## ライセンス

OpenMoji の絵文字データは **CC BY-SA 4.0**（再配布時は表記が必要）。
