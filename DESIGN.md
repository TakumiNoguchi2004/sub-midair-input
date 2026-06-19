# 設計メモ: 絵文字入力検索システム

README に書いた構想を踏まえ、実装に入る前に構成を整理しておくメモ。
FAISS index 構築は計算量が大きいので、ここでは **「データ準備工程」と「検索工程」を別環境に分ける** ことを前提に整理する。

---

## 1. 概要

OpenMoji の絵文字画像をベクトル化して FAISS のファイルベース index に保存し、
ユーザの入力 (テキスト / 手書き画像) に近い絵文字を top-k で返す検索システム。

- 画像とテキストを共通の特徴空間に写像できる CLIP 系モデルを利用
- 検索ロジックは「入力をベクトル化 → FAISS で近傍検索」だけのシンプルな構成

---

## 2. 全体構成

```
┌────────────────────────┐        ┌────────────────────────┐
│  データ準備 (オフライン)  │        │  検索 (オンライン / CLI)  │
│ ──────────────────────│        │ ──────────────────────│
│ 1. OpenMoji 取得         │        │ A. 入力受け取り          │
│ 2. 画像 → Image-Encoder  │   ──▶  │    - text                │
│ 3. 埋め込みベクトル列     │ 成果物 │    - handwrite (image)   │
│ 4. FAISS index 構築      │        │ B. 同じモデルで埋め込み   │
│ 5. index + metadata 保存 │        │ C. FAISS top-k 検索       │
└────────────────────────┘        │ D. 該当絵文字を表示       │
                                   └────────────────────────┘
```

- **データ準備工程**: クラウド/Colab などの GPU 環境で実行。生成物 (`index.faiss`, `metadata.jsonl`) のみローカルに持ってくる。
- **検索工程**: ローカル。CPU だけでも十分動く想定 (絵文字数は数千オーダー)。

---

## 3. データソース

- リポジトリ: [hfg-gmuend/openmoji](https://github.com/hfg-gmuend/openmoji)
- 取得形式: PNG (72×72 か 618×618)。SVG はベクタなので扱いが面倒なため後回し
- メタデータ: `openmoji.json` (絵文字, hexcode, annotation, group, subgroup, …)
- ライセンス: CC BY-SA 4.0 (再配布時は表記が必要)

---

## 4. モデル候補

| 候補 | 言語 | 備考 |
|------|------|------|
| OpenAI CLIP (ViT-B/32) | 英語のみ | 軽い、定番 |
| OpenCLIP (multilingual) | 多言語 | 日本語クエリを許すならこちら |
| rinna/japanese-clip-vit-b-16 | 日本語 | 日本語前提なら有力 |

- 入力モダリティの扱い:
  - **text**: tokenizer → text encoder → ベクトル
  - **image (手書き)**: 前処理 (リサイズ・正規化) → image encoder → ベクトル
- **重要**: index 構築時と検索時で同一モデルを使うこと (共通空間が前提)

クエリが日本語になることを想定するなら OpenCLIP 多言語版 or japanese-clip を第一候補にする。

---

## 5. ベクトルDB (FAISS)

- 絵文字数は約 4000 程度なので、まずは `IndexFlatIP` (内積) で十分なはず
- 規模が大きくなったら `IndexHNSWFlat` 等に切り替え
- 保存物:
  - `index.faiss`: FAISS index 本体
  - `metadata.jsonl`: `row_id` ↔ `hexcode`, `annotation`, `image_path`, …

---

## 6. 入力方式

### 6.1 テキスト入力
- CLI 引数で `--query "笑顔"` のように渡す
- text encoder でベクトル化 → FAISS 検索 → top-k

### 6.2 手書き入力
- 起動時にキャンバス window を表示
  - 候補: **tkinter** (標準) / pygame / PyQt
  - まずは依存を増やさずに済む tkinter で十分そう
- マウスクリック + ドラッグで描画
- 「入力」ボタンでキャンバスを画像 (PNG) として書き出し
- image encoder でベクトル化 → FAISS 検索 → top-k

---

## 7. CLI 仕様 (案)

```bash
# テキスト検索
python -m emoji_search --mode text --query "笑顔" --top-k 10

# 手書き検索 (window が立ち上がる)
python -m emoji_search --mode draw --top-k 10
```

| オプション | 説明 | デフォルト |
|------------|------|------------|
| `--mode {text,draw}` | 入力方式 | `text` |
| `--query` | text モード時のテキスト | (必須) |
| `--top-k` | 返す件数 | `5` |
| `--index-path` | FAISS index のパス | `data/index.faiss` |
| `--model` | 使用する CLIP モデル名 | (固定 or 設定ファイル) |

結果表示は、まずは「ターミナルに hexcode + annotation を並べる」だけで進め、
余裕があれば該当絵文字画像を別ウィンドウで表示する形にする。

---

## 8. ディレクトリ構成 (案)

```
mi-midair-input/
├── README.md
├── DESIGN.md                     ← 本ファイル
├── pyproject.toml
├── src/
│   └── emoji_search/
│       ├── __init__.py
│       ├── __main__.py           ← CLI entry
│       ├── encoder.py            ← CLIP wrapper (text/image)
│       ├── index.py              ← FAISS load/search
│       ├── handwrite.py          ← 手書き入力 window
│       └── data.py               ← OpenMoji ローダ / metadata
├── scripts/
│   ├── download_openmoji.py      ← 画像 + metadata 取得
│   └── build_index.py            ← クラウド側で実行する index 構築
└── data/
    ├── openmoji/                 ← 画像群 (git 管理外)
    ├── index.faiss               ← 生成物
    └── metadata.jsonl            ← 生成物
```

`data/` は基本 `.gitignore` に入れる。`index.faiss` / `metadata.jsonl` は
サイズ次第で Git LFS or 別ストレージ (GCS / S3 / Hugging Face Hub) からの取得に切り替える。

---

## 9. 環境分離

| 工程 | 環境 | 理由 |
|------|------|------|
| OpenMoji 取得 | ローカル or クラウド | I/O 中心 |
| 画像ベクトル化 + index 構築 | **Colab / GPU クラウド** | モデルロード + 数千枚の forward |
| 検索 (CLI / 手書き UI) | **ローカル** | 軽量 + UI を出すため |

→ 今回ローカルから一旦離れるのはこの真ん中の工程をやるため。
ローカルに戻ってきたときに必要なのは「index ファイル + metadata + 同じモデル名」だけになるよう設計する。

---

## 10. 直近やること

- [ ] OpenMoji の取得スクリプト (`scripts/download_openmoji.py`)
- [ ] CLIP モデル決定 (日本語クエリ対応の有無で分岐)
- [ ] クラウド側で実行する `build_index.py` (画像 → ベクトル → FAISS index)
- [ ] CLI スケルトン (`emoji_search/__main__.py`)
- [ ] 手書き入力 window 実装 (tkinter ベース)
- [ ] top-k 結果の表示方法を決める (ターミナル / 別ウィンドウ)
