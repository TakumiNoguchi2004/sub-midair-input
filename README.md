# Mid-Air Flick Input システム

空中フリック入力で **絵文字 / 日本語 / 英語** を入力するシステム。
各モダリティを独立サブシステムとして**分割開発**し、最終的に 1 つの統合アプリ (`midair`) に**束ねる**。

いずれのモダリティも「入力 → 埋め込みベクトル化 → FAISS 近傍検索 → 候補表示」という共通構造を取る。

## サブシステム

| モダリティ | パッケージ | 状態 | 概要 |
|---|---|---|---|
| 絵文字入力 | `emoji-search` | **実装済み (v0)** | OpenMoji を CLIP で埋め込み、テキスト / 手書き画像で検索 |
| 日本語入力 | `japanese-search` | スケルトン | 未実装 |
| 英語入力 | `english-search` | スケルトン | 未実装 |

共通基盤 `midair-shared` が **encoder 契約 / FAISS ユーティリティ / 統合契約 (`Searcher`)** を提供し、
統合アプリ `midair-app` が `mode` に応じて各サブシステムを遅延ロードして振り分ける。
ブラウザ UI は `midair-web`（FastAPI）が提供する — テキスト / 手書き入力、結果を画像表示、非同期検索。

## リポジトリ構成 (uv workspace monorepo)

```
mi-midair-input/
├── pyproject.toml              # uv workspace root (package=false, members=packages/*)
├── README.md / CLAUDE.md
├── Dockerfile / docker-compose.yml / .dockerignore
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
│       └── src/midair_web/     #   app.py / __main__.py / static/index.html
└── data/                       # git 管理外 (.gitkeep のみ追跡)
    ├── emoji_search/           #   openmoji/ + openmoji.json + index.faiss + metadata.jsonl
    ├── japanese_search/
    └── english_search/
```

データはサブシステム別ディレクトリに隔離し、相互に干渉しない設計にしている。

## セットアップ (ローカル実行)

初回は次の順で実行する。途中で止まって見える工程があるため、まずこの章だけで完結するようにしている。

### 0. 前提

- Python 3.12 以上
- [`uv`](https://docs.astral.sh/uv/) が使えること
- 初回のみネットワーク接続が必要
  - PyPI / PyTorch index: Python 依存パッケージ
  - GitHub Releases: OpenMoji 画像とメタデータ
  - Hugging Face Hub: CLIP モデル
  - jsDelivr / Google Cloud Storage: Web カメラ入力用の MediaPipe

CPU 環境では CLIP の推論が遅い。`build_index.py` は GPU が無い場合 `device=cpu` で動き、数千枚の画像埋め込みに数十分かかることがある。

### 1. Python 依存を入れる

```bash
uv sync
```

全 workspace パッケージを 1 つの `.venv/` に導入する。既に同期済みなら短時間で終わる。

確認:

```bash
uv run python -c "import torch, transformers, faiss; print('ok')"
```

### 2. OpenMoji データを取得する

```bash
uv run python packages/emoji-search/scripts/download_openmoji.py
```

`data/emoji_search/` に次が作られる。

- `openmoji-72x72-color.zip`
- `openmoji/` (PNG 約 4495 枚)
- `openmoji.json`

確認:

```bash
find data/emoji_search/openmoji -maxdepth 1 -name '*.png' | wc -l
ls -lh data/emoji_search/openmoji.json
```

既に存在するファイルはスキップされる。取り直したい場合は `--force` を付ける。

### 3. 絵文字検索 index を構築する

推奨は、まず既に作成済みの index を Google Drive から取得する方法。これにより、時間のかかる CLIP 埋め込み計算を各マシンで実行せずに済む。

```bash
uvx gdown --folder "https://drive.google.com/drive/folders/1ucgsVXXp6jOTWapOPTLsz9i-wpnPS652" -O data
```

Drive には index 関連の 3 ファイルだけを置いている。OpenMoji 画像と `openmoji.json` は手順 2 で公式から取得する。

- `data/emoji_search/index.faiss`
- `data/emoji_search/metadata.jsonl`
- `data/emoji_search/index_meta.json`

Drive から取得できない場合、または index を作り直したい場合だけ、次を実行する。

```bash
uv run python packages/emoji-search/scripts/build_index.py
```

この工程で初回のみ Hugging Face Hub から `openai/clip-vit-base-patch32` を取得する。`Warning: You are sending unauthenticated requests to the HF Hub...` は警告であり、即エラーではない。通信が遅い場合はモデル取得でしばらく止まって見える。

`[2/4] model=... device=cpu` まで進んだ後は、ダウンロードではなくローカルの CLIP 埋め込み計算中。CPU 使用率が高ければ処理は進んでいる。

完了または Drive からの取得後、次が揃っていればよい。

- `data/emoji_search/index.faiss`
- `data/emoji_search/metadata.jsonl`
- `data/emoji_search/index_meta.json`

確認:

```bash
ls -lh data/emoji_search/index.faiss data/emoji_search/metadata.jsonl data/emoji_search/index_meta.json
```

### 4. Web カメラ入力用 MediaPipe を取得する

手書きキャンバスだけを使う場合でも、Web UI のカメラ操作を使うならこの工程が必要。

```bash
uv run python packages/web/scripts/fetch_mediapipe.py
```

`packages/web/src/midair_web/static/vendor/mediapipe/` に `vision_bundle.mjs`、wasm、`hand_landmarker.task` が配置される。これが無いとブラウザで次のようなエラーになる。

```text
カメラエラー: Failed to fetch dynamically imported module:
http://localhost:8762/assets/vendor/mediapipe/vision_bundle.mjs
```

確認:

```bash
find packages/web/src/midair_web/static/vendor/mediapipe -maxdepth 2 -type f | sort
```

### 5. 動作確認

CLI:

```bash
uv run midair --mode emoji --query "lemon" --top-k 5
```

Web:

```bash
uv run midair-web
```

ブラウザで <http://127.0.0.1:8762> を開く。MediaPipe ファイルを後から取得した場合は、Web サーバーを再起動してからブラウザをハードリロードする。

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

基本多分無視でよい。

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

詳細は [`packages/emoji-search/README.md`](packages/emoji-search/README.md) と [`packages/web/README.md`](packages/web/README.md)。

## 使い方 (統合 CLI)

```bash
uv run midair --mode emoji --query "cat" --top-k 5
# 0.250  🐈‍⬛  1F408-200D-2B1B  black cat
# 0.246  🐈️  1F408            cat
# ...

uv run midair --mode japanese --query "..."   # 未実装 (スケルトン)
uv run midair --mode english  --query "..."   # 未実装 (スケルトン)
```

## 使い方 (Web アプリ)

```bash
uv run midair-web                 # http://127.0.0.1:8762 (既定ポート 8762)
```

テキスト入力と手書きキャンバスの 2 入力に対応。結果は絵文字画像のグリッドで表示し、
検索は非同期ジョブでバックグラウンド実行する。詳細は [`packages/web/README.md`](packages/web/README.md)。

## Docker で動かす (Intel Mac / GPU 無し)

環境依存を抑えるため Docker でも動く（torch は CPU 版、CLIP モデルはイメージに焼き込み）。

```bash
docker compose build                                # イメージ作成
docker compose --profile setup run --rm prepare     # 初回: データ取得 + index 構築
docker compose up web                               # http://localhost:8762
```

詳細は [`docs/emoji_search/DOCKER.md`](docs/emoji_search/DOCKER.md)。

## ドキュメント

- [`docs/architecture.md`](docs/architecture.md) — 全体構成 / 各 packages のスコープと境界 / 統合の継ぎ目
- [`docs/emoji_search/DOCKER.md`](docs/emoji_search/DOCKER.md) — Docker でのローカル実行 (Intel Mac / CPU)
- [`docs/emoji_search/experiment-domain-matched-index.md`](docs/emoji_search/experiment-domain-matched-index.md) — 手書きドメインに合わせた index 構築の実験計画 (別デバイス向け指示書)
- [`CLAUDE.md`](CLAUDE.md) — システム全体構成 / 開発フロー (git-flow) / エージェント向け指針
- `packages/*/README.md` — 各サブシステムの詳細

## ライセンス

OpenMoji の絵文字データは **CC BY-SA 4.0**（再配布時は表記が必要）。
