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

## セットアップ

```bash
uv sync          # 全 workspace パッケージを 1 つの venv に導入
```

## 絵文字: データ準備 → index 構築

```bash
# 1) OpenMoji データ取得 (data/emoji_search/ に配置。冪等、--force で再取得)
uv run python packages/emoji-search/scripts/download_openmoji.py

# 2) index 構築 -> data/emoji_search/{index.faiss, metadata.jsonl, index_meta.json}
uv run python packages/emoji-search/scripts/build_index.py
```

詳細は [`packages/emoji-search/README.md`](packages/emoji-search/README.md)。

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

## Docker で動かす (Mac / GPU 無し)

環境依存を抑えるため Docker でも動く（torch は CPU 版、CLIP モデルはイメージに焼き込み）。
**Intel Mac はネイティブ、Apple Silicon は amd64 エミュレーション**で動作する（性能は落ちるが手順は同じ）。

```bash
docker compose build                                # イメージ作成
docker compose --profile setup run --rm prepare     # 初回: データ取得 + index 構築
docker compose up web                               # http://localhost:8762
```

詳細は [`docs/emoji_search/DOCKER.md`](docs/emoji_search/DOCKER.md)。

## ドキュメント

- [`docs/architecture.md`](docs/architecture.md) — 全体構成 / 各 packages のスコープと境界 / 統合の継ぎ目
- [`docs/emoji_search/DOCKER.md`](docs/emoji_search/DOCKER.md) — Docker でのローカル実行 (Mac / CPU)
- [`docs/emoji_search/experiment-domain-matched-index.md`](docs/emoji_search/experiment-domain-matched-index.md) — 手書きドメインに合わせた index 構築の実験計画 (別デバイス向け指示書)
- [`CLAUDE.md`](CLAUDE.md) — システム全体構成 / 開発フロー (git-flow) / エージェント向け指針
- `packages/*/README.md` — 各サブシステムの詳細

## ライセンス

OpenMoji の絵文字データは **CC BY-SA 4.0**（再配布時は表記が必要）。
