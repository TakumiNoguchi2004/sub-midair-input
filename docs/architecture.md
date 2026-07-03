# 全体構成 (アーキテクチャ) — Mid-Air Flick Input

このドキュメントは、リポジトリ全体で**意図している構造**と、`packages/` 配下の
各ディレクトリの**役割・スコープ・境界**をまとめたもの。
(実行手順は [`README.md`](../README.md) / Docker は [`emoji_search/DOCKER.md`](emoji_search/DOCKER.md) を参照)

---

## 1. 目的と設計方針

- **目的**: 空中フリック入力で **絵文字 / 日本語 / 英語** を入力する。
- **方針**: 各モダリティを独立サブシステムとして**分割開発**し、最終的に 1 つの統合アプリへ
  **疎結合のまま束ねる**。
- **共通構造**: どのモダリティも `入力 → 埋め込みベクトル化 → FAISS 近傍検索 → 候補表示`。
- **レイアウト**: uv workspace monorepo (`packages/*`)。1 つの venv を共有し、依存はパッケージ単位で分離。

### 2 つのレイヤを分けて考える

このシステムは性質の違う 2 層からなる。混同しないことが重要。

| レイヤ | どこ | 何を扱うか | 言語/実行場所 |
|---|---|---|---|
| **入力キャプチャ層** | `packages/web` のフロント (ブラウザ) | 手の検出・ジェスチャ・手書き・Mid-Air ポインタ | JS (MediaPipe, ブラウザ内) |
| **検索層** | `packages/{shared,emoji-search,...,app}` | 埋め込み・FAISS index・mode 振り分け | Python |

Mid-Air の手検出はブラウザ内で完結し (座標もブラウザにしか無い)、検索層は
「テキスト or 画像 → 近い候補」だけを担う。両者は HTTP API で繋がる。

### 入力モードとジェスチャ解釈

カメラ入力の同じ手の動きは、現在の入力モードによって別の意味として扱う。
絵文字モードではピンチ描画 / ピース検索 / 指差しクリア、日本語モードでは
10 種類のピンチパターン + フリック方向による 50 音入力として解釈する。
日本語モードでは 1 文字確定後、デフォルトのパー状態を検出するまで次の文字入力を受け付けない。
英語モードは未実装。言語切替モーションのポーズは未割り当てで、決定後は
フロントの `cycleInputMode()` に接続する。

---

## 2. 依存グラフ (パッケージ間)

```
            midair-shared  ← 全パッケージが依存する共通基盤 (契約 + FAISS utils)
              ▲   ▲   ▲
   ┌──────────┘   │   └───────────┐
emoji-search                                  ← モダリティ別サブシステム (Searcher を実装)
   ▲   ▲             ▲                ▲
   │   └─────────────┼────────────────┘
   │            midair-app  ← mode で各 Searcher を遅延生成する統合 CLI
   │
midair-web      ← FastAPI Web アプリ (Mid-Air 入力 UI + 検索 API)
```

- **依存の向きは常に `midair-shared` へ向かう**（共通基盤は誰にも依存しない）。
- サブシステム同士は**互いに依存しない**（emoji が japanese を知らない、など）。
- 統合は `midair-app` (CLI) と `midair-web` (Web) が担い、`mode` で振り分ける。

---

## 3. 各ディレクトリのスコープ

### `packages/shared` → `midair_shared` (共通基盤)
**スコープ**: モダリティに依存しない「契約」と「FAISS ユーティリティ」だけを置く。
重い ML 依存は持たない (依存は `faiss-cpu` + `numpy` のみ)。

| ファイル | 役割 |
|---|---|
| `encoder.py` | `TextEncoder` / `MultimodalEncoder` の **Protocol (契約)**。返り値は L2 正規化済み `(N,dim)` float32。 |
| `index.py` | FAISS の **構築 / 保存 / 読込 / 検索** (`build_flat_ip` / `save_index` / `load_index` / `search`)。`IndexFlatIP`(内積=cosine)。 |
| `search.py` | **統合の継ぎ目**。`SearchResult` (横断結果) と `Searcher` Protocol (`mode`, `search_text`)。 |

> ここに**具体的なモデルやモダリティ固有のロジックを入れない**のが鉄則。
> 「どのサブシステムも従う型」だけを定義する。

### `packages/emoji-search` → `emoji_search` (絵文字入力 / 実装済み v0)
**スコープ**: 絵文字モダリティの全実装。OpenAI CLIP ViT-B/32 + OpenMoji。

| 場所 | 役割 |
|---|---|
| `src/emoji_search/encoder.py` | CLIP ラッパー (`ClipEncoder`)。`encode_text` / `encode_image` / `dim`。`MultimodalEncoder` 契約を満たす。 |
| `src/emoji_search/data.py` | OpenMoji メタデータ読込 + 画像読込 (`load_rgb_on_white` 等)。 |
| `src/emoji_search/searcher.py` | `EmojiSearcher` = index + metadata + encoder を束ね、`Searcher` 契約を実装 (`search_text` + 画像検索 `search_image`)。 |
| `scripts/download_openmoji.py` | データ取得 (color=表示用 / black=index構築用)。`--variant`。 |
| `scripts/build_index.py` | OpenMoji → CLIP 埋め込み → FAISS index 構築。`--source-variant`。 |

> 他モダリティを作るときの**参照実装**。詳細は [`packages/emoji-search/README.md`](../packages/emoji-search/README.md)、
> 手書きドメイン整合の実験は [`emoji_search/experiment-domain-matched-index.md`](emoji_search/experiment-domain-matched-index.md)。

### 日本語 / 英語入力
日本語入力は現状 Web UI 内の50音フリック試作として実装している。`japanese-search`
バックエンドパッケージはまだ作成していない。

英語入力は未実装。実装時は emoji と同じ構造 (encoder / data / searcher + 必要なら scripts)
を踏襲し、`Searcher` 契約を実装する。

### `packages/app` → `midair_app` (統合 CLI)
**スコープ**: 実装詳細を知らずに `mode` で各サブシステムへ振り分ける統合層。

| ファイル | 役割 |
|---|---|
| `registry.py` | `build_searcher(mode, data_dir)`。**選択された mode のときだけ重い依存を import** (遅延ロード)。 |
| `__main__.py` | `midair` CLI エントリ (`--mode` / `--query` / `--top-k`)。 |
| `doctor.py` | `midair-doctor` CLI エントリ。依存 import、OpenMoji、FAISS index、MediaPipe、Web 起動前提を一括検証する。 |

> japanese/english を選んだときに emoji の torch を読み込まないため、import は関数内で遅延させる。

### `packages/web` → `midair_web` (Web アプリ + Mid-Air 入力 UI)
**スコープ**: ブラウザ向けの単一 Web UI。**Mid-Air 入力 (手検出) はここのフロントで完結**。

| 場所 | 役割 |
|---|---|
| `src/midair_web/app.py` | FastAPI。非同期ジョブで検索 (`/api/search/{text,image}` → `/api/jobs/{id}`)、結果画像配信 (`/emoji-img/...`)、`/assets` 静的配信。 |
| `src/midair_web/__main__.py` | `midair-web` エントリ (uvicorn 起動, 既定 port 8762)。 |
| `src/midair_web/static/index.html` | UI 本体。テキスト/手書き入力 + **MediaPipe による Mid-Air 入力** (ジェスチャ・ポインタ)。 |
| `static/vendor/mediapipe/` | MediaPipe 本体 (JS/wasm/モデル) を自前同梱 (オフライン)。**git 管理外**、`fetch_mediapipe.py` / Dockerfile で取得。 |
| `scripts/fetch_mediapipe.py` | 上記 vendor の取得スクリプト (冪等)。 |

> Mid-Air のジェスチャ判定・座標変換・ポインタ描画は **モダリティ非依存** に作ってあり、
> 将来 japanese/english を同 UI に mode 追加しても入力部はそのまま使える。
> 詳細は [`packages/web/README.md`](../packages/web/README.md)。

---

## 4. 統合の継ぎ目 (重要なルール)

1. 各サブシステムは `midair_shared.search.Searcher` を実装する (`mode`, `search_text`、必要なら追加 API)。
2. 統合側 (`midair_app.registry` / 将来の web) は**実装を知らず `mode` で振り分けるだけ**。
3. 重い依存 (torch 等) は**選択 mode のときだけ遅延 import**。
4. **モデル整合**: index 構築時と検索時は同一モデル (= 同一埋め込み空間) が前提。
   `data/<name>_search/index_meta.json` に `model_id` / `dim` / `preprocess` 等を記録する。

### 新しいモダリティの追加手順
1. `packages/<name>-search/` を作成 (emoji を参照実装に)。
2. `midair_shared.search.Searcher` を実装 (`mode`, `search_text`, …)。
3. `midair_app.registry.build_searcher` に分岐を追加 (遅延 import)。
4. データは `data/<name>_search/` に隔離。

---

## 5. データレイアウトと配布

```
data/                         # git 管理外 (.gitkeep のみ追跡)
└── <name>_search/            # 例: emoji_search/
    ├── (画像など素材)         # 例: openmoji/ (カラー=表示), openmoji_black/ (線画=index構築)
    ├── index.faiss           # FAISS index (デバイス非依存・移植可)
    ├── metadata.jsonl        # row_id ↔ メタ (表示は常にカラー画像を指す)
    └── index_meta.json       # model_id / dim / normalize / preprocess / count
```

- **データ隔離**: サブシステム別ディレクトリに置き相互干渉させない。
- **配布ルール**: **index 3 ファイルだけ**を共有ストレージ (Drive 等) に置く。
  OpenMoji 画像は再配布せず公式から取得 (CC BY-SA 4.0 の手続き回避)。

---

## 6. 実行時のデータフロー

```
[ブラウザ]                                   [サーバ: midair-web]            [検索層]
 手 → MediaPipe → ジェスチャ/座標
   ピンチ=描画 / ピース=検索 / 指差し=クリア
   キャンバス(白地+黒線) ──PNG──► POST /api/search/image ─► EmojiSearcher.search_image
 テキスト入力        ──────────► POST /api/search/text  ─► EmojiSearcher.search_text
                                            │                       │ CLIP 埋め込み
                                            │                       │ FAISS 近傍検索
                                  job 完了 ◄─┘   結果(hexcode 等) ◄───┘
   候補をカラー絵文字で表示 ◄── GET /api/jobs/{id} + /emoji-img/{id}.png
```

CLI 経路は `uv run midair --mode emoji --query ...` → `midair_app.registry` → `EmojiSearcher`。

---

## 7. 横断的な規約

- **import 名**: ディレクトリ `xxx-search` ⇔ パッケージ `xxx-search` ⇔ import `xxx_search` (ハイフン/アンダースコア)。
- **CPU torch 既定**: 配布ターゲットが GPU 無し (Intel Mac) のため `pyproject.toml` で CPU 版に固定。
  GPU で index 構築するときだけ `UV_TORCH_BACKEND=cu124 uv sync` 等で上書き。
- **ポート**: Web はホスト `8762` (コンテナ内 8000)。定番ポートとの衝突回避のため 8762 を既定に。
- **commit/push はユーザ明示時のみ**。`.git/` は直接編集しない。
- 開発フローは git-flow (`feature/<name>_search` で並行開発 → `main` へ)。詳細は [`CLAUDE.md`](../CLAUDE.md)。
</content>
