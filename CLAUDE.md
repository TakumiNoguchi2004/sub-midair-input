# Mid-Air Flick Input — プロジェクト指針

このリポジトリで作業する際の、システム全体構成・開発フロー・禁止事項。
(オーケストレーション全般の方針は `~/CLAUDE.md` / `~/.claude/rules` を参照)

## システム全体構成

- **目的**: 空中フリック入力で 絵文字 / 日本語 / 英語 を入力する。
- **方針**: 各モダリティを独立サブシステムとして**分割開発**し、最終的に 1 つの統合アプリ (`midair`) に**束ねる**。
- **共通構造**: 入力 → 埋め込みベクトル化 → FAISS 近傍検索 → 候補表示。
- **レイアウト**: uv workspace monorepo (`packages/*`)。1 つの venv を共有し、依存はパッケージ単位で分離。

### パッケージ

| パッケージ | import 名 | 役割 |
|---|---|---|
| `midair-shared` | `midair_shared` | 共通基盤: encoder 契約 (`encoder.py`)、FAISS utils (`index.py`)、統合契約 (`search.py`) |
| `emoji-search` | `emoji_search` | 絵文字入力 (実装済み)。OpenAI CLIP ViT-B/32 + OpenMoji |
| `japanese-search` | `japanese_search` | 日本語入力 (スケルトン) |
| `english-search` | `english_search` | 英語入力 (スケルトン) |
| `midair-app` | `midair_app` | 統合アプリ。`mode` で各 Searcher を遅延ロードして振り分け。`midair` CLI |
| `midair-web` | `midair_web` | 検索 Web アプリ (FastAPI)。テキスト/手書き入力、非同期ジョブ、画像で結果表示。port 8000 |

### 統合の継ぎ目 (重要)

- 各サブシステムは `midair_shared.search.Searcher` を実装する (`mode`, `search_text`)。
- 統合側 (`midair_app.registry`) は実装詳細を知らず、`mode` で振り分けるだけ。重い依存 (torch 等) は選択モードのみ遅延 import。
- **新サブシステム追加手順**: (1) `packages/` に追加 → (2) `Searcher` を実装 → (3) `registry.build_searcher` に登録。
- **データ隔離**: サブシステム別に `data/<name>_search/` に置き、相互干渉させない。中身は git 管理外 (`.gitkeep` のみ追跡)。
- **モデル整合**: encoder の差し替え・モデル変更時は index を再構築する (index 構築時と検索時で同一モデル = 共通空間が前提)。`data/<name>_search/index_meta.json` に `model_id`/`dim`/`normalize` を記録している。

## 実行環境 (ローカル / Docker)

- **配布ターゲットは Intel Mac (linux/amd64, GPU 無し)**。環境依存を抑えるため Docker ベースで動かす (`DOCKER.md`)。
- torch は **CPU 版が既定**: `pyproject.toml` の `[[tool.uv.index]] pytorch-cpu` + emoji-search の `torch = { index = "pytorch-cpu" }`。`uv.lock` も CPU 解決済み (nvidia-* を含まない)。
- GPU で index 構築を高速化したいときだけ `UV_TORCH_BACKEND=cu124 uv sync` 等で上書きする (Docker 運用は CPU のまま)。
- Docker: `data/` はボリュームマウントで永続化、CLIP モデルはイメージに焼き込み (実行時ネット不要)。`MIDAIR_DATA_DIR` で各エントリのデータルートを上書きできる。

### データ配布ルール

- **FAISS index 関連 (`index.faiss` / `metadata.jsonl` / `index_meta.json`) のみ共有ストレージ (Drive 等) に配置**し、各環境はそれを取得して使う (重い CLIP エンコードを各環境で再実行しなくても良いように設計)。
- **OpenMoji 画像 (`openmoji/`) は Drive に再配布しない** (CC BY-SA 4.0 の再配布手続き回避)。`download_openmoji.py` で公式 Releases から取得する。
- index はデバイス非依存。検索は `index_meta.json` の `model_id` と同一の CLIP モデルで行う前提。

## 開発フロー (git-flow)

- **git-flow を採用する。**
- サブシステムごとに `feature/<name>_search` で並行開発する (`feature/japanese_search`, `feature/english_search`)。
- `main` は安定版。機能開発は feature ブランチで行い、完了後にマージする。
- **commit / push はユーザの明示指示があるときのみ**行う。

## アクセス禁止領域

- **`.git/` は直接読み書き・改変しない** (手動編集 / 削除をしない)。git 操作は通常の git コマンド経由で、かつユーザ指示時のみ。
