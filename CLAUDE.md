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

### 統合の継ぎ目 (重要)

- 各サブシステムは `midair_shared.search.Searcher` を実装する (`mode`, `search_text`)。
- 統合側 (`midair_app.registry`) は実装詳細を知らず、`mode` で振り分けるだけ。重い依存 (torch 等) は選択モードのみ遅延 import。
- **新サブシステム追加手順**: (1) `packages/` に追加 → (2) `Searcher` を実装 → (3) `registry.build_searcher` に登録。
- **データ隔離**: サブシステム別に `data/<name>_search/` に置き、相互干渉させない。中身は git 管理外 (`.gitkeep` のみ追跡)。
- **モデル整合**: encoder の差し替え・モデル変更時は index を再構築する (index 構築時と検索時で同一モデル = 共通空間が前提)。`data/<name>_search/index_meta.json` に `model_id`/`dim`/`normalize` を記録している。

## 開発フロー (git-flow)

- **git-flow を採用する。**
- **現状**: `main` 上で初期開発中 (これは許容)。
- **一区切りついたら** `feature/emoji_search` ブランチへ移行する。
- 以降はサブシステムごとに `feature/<name>_search` で並行開発する (`feature/japanese_search`, `feature/english_search`)。
- `main` は安定版。機能開発は feature ブランチで行い、完了後にマージする。
- **commit / push はユーザの明示指示があるときのみ**行う。

## アクセス禁止領域

- **`.git/` は直接読み書き・改変しない** (手動編集 / 削除をしない)。git 操作は通常の git コマンド経由で、かつユーザ指示時のみ。
