# 実験計画: 手書きドメインに合わせた検索インデックス構築

> **このドキュメントの位置づけ**
> FAISS index の構築は GPU のある別デバイスで行う前提の **作業指示書**。
> 開発機 (Intel/Apple Mac, CPU) では重い CLIP エンコードが現実的でないため、
> 「別デバイスで何をするか」を手順として書き出したもの。
> ここでは **実験計画と手順のみ** を定義する (本リポジトリへの実装は未反映。
> 6.2 のコード片を追加してから実行する)。

---

## 1. 背景と問題

- **現状の index**: `build_index.py` が OpenMoji の **カラー画像** を
  `load_rgb_on_white`（透過を白背景に合成しただけ）で読み、CLIP 画像埋め込みを作っている。
  `index_meta.json` の `preprocess` は `"rgba_on_white"`。
- **手書き入力 (query)**: Web UI / Mid-Air 入力で得られるのは **白背景＋黒の線画** だけ
  (キャンバスは `#fff` 背景に `#000`・太さ 10px のストローク)。
- **ミスマッチ**: CLIP の埋め込み空間では「カラーで塗られた絵文字」と「黒い線画」は
  見た目が大きく異なり、距離が開きやすい。結果として **画像 (手書き) 検索の精度が出にくい**。
- 一方で **ユーザに見せる候補はカラー絵文字のまま** にしたい。

## 2. 仮説

絵文字側を **線画ドメインに寄せて** から埋め込めば、手書き query との類似度が上がり、
画像検索の精度が改善するはず。

- 表示用画像 (`data/emoji_search/openmoji/` のカラー PNG) は **そのまま保持**する。
- **ベクトル構築の入力にだけ** 前処理 (グレースケール化 / 二値化 / エッジ抽出 /
  公式の黒線画版の利用 など) を適用する。

## 3. 設計原則（最重要・ここを外すと意味がない）

1. **index 側と query 側は「同じ目標ドメイン」に射影する。**
   CLIP の画像埋め込みは同一ドメインでのみ比較可能。
   index を線画で作ったら、検索時の手書き画像も同じ表現に正規化してからエンコードする。
2. **`index_meta.json` の `preprocess` を唯一の真実 (source of truth) にする。**
   検索側 (`searcher.py` / `app.py`) は起動時に `preprocess` を読み、対応する前処理関数を
   query に自動適用する。これで「index とは別の前処理で検索してしまう」事故を防ぐ。
3. **テキスト検索への影響も測る。**
   エッジ/線画は CLIP の学習分布 (自然画像) から外れるため、`encode_text` との整合
   (テキスト→絵文字検索の質) が劣化する可能性がある。**画像検索の改善とテキスト検索の劣化は
   トレードオフ**になりうるので両方評価する。
4. **前処理は「ベクトルの入力」限定。** メタデータ・表示・row 順は一切変えない
   (`metadata.jsonl` はバリアント間で共有できる)。

### 目標ドメイン D の定義

> D = 「**白背景・黒の細線**（塗りつぶし無し、線幅は手書きストロークに近い）」

各ソースを D に射影する写像を用意する:

| ソース | D への射影 |
|---|---|
| OpenMoji カラー | グレースケール / 二値化 / エッジ抽出 / **公式 black 版を使う** |
| 手書き入力 | ほぼ D そのもの。必要なら線幅正規化・2値化のみ |

両者は同じ操作である必要はないが、**出力が似た見た目になる**ことが条件。

## 4. 実験するバリアント

| ID | preprocess 名 | 内容 | 期待 / メモ |
|---|---|---|---|
| V0 | `rgba_on_white` | 現状 (カラー) | ベースライン。比較基準 |
| V1 | `grayscale` | カラーを輝度化 (3ch 複製) | 色情報を捨てるだけ。軽い改善 or 中立 |
| V2 | `binarize` | グレースケール→閾値で白黒 (Otsu/固定/適応) | 線画に近づくが塗り面が黒ベタになりやすい |
| V3 | `edge` | 輪郭抽出 (Canny / morphological gradient / PIL `FIND_EDGES`)→白地に黒線 | 手書きに最も近い合成。線幅は手書きに合わせ膨張 |
| V4 | `openmoji_black` | **OpenMoji 公式の黒線画版** (`openmoji-72x72-black.zip`) を index ソースに使う | ★本命。合成エッジの粗さが無く、手書きと同質。表示はカラーのまま |

> **V4 が筋が良い理由**: OpenMoji は同じ hexcode で **color 版と black(line) 版**を配布している。
> black 版は元から「黒の線画 (透過背景)」で、白地に合成すれば D とほぼ一致する。
> 合成エッジ (V3) の人工的なノイズが無く、評価セットとしても使える。

### query 側の対応（バリアント別）

検索時、手書きキャンバス画像にも同じ正規化を入れる:

| preprocess | query (手書き) への処理 |
|---|---|
| `rgba_on_white` | 白背景合成のみ (現状どおり) |
| `grayscale` | グレースケール化 |
| `binarize` | グレースケール→二値化 (index と同じ閾値方式) |
| `edge` | 手書きは既に線。**線幅を index 側エッジに合わせる** (膨張/細線化) のみ |
| `openmoji_black` | 白背景合成 + 黒線正規化 (二値化/線幅調整)。手書きはほぼそのまま |

## 5. 評価方法

ラベル付き手書きデータが無いので、以下を併用する。

### 5.1 自動 proxy: OpenMoji black 版で self-retrieval
- 各絵文字の **black 版** を「擬似手書き」として query にし、(同じ前処理で作った) index を引く。
- 正解 = その絵文字自身。**Recall@k / MRR / top-1 accuracy** を測る。
- パイプライン健全性と「ドメイン整合がどれだけ効くか」を安価に定量化できる。

### 5.2 主評価: 小規模な実手書きセット
- 自分で 15〜30 個ほど手描き (cat, heart, fire, star, …) し、期待 hexcode を付ける。
- 各バリアント index で **Recall@1/3/5・MRR** を算出。
- これを最終判断の主指標にする。

### 5.3 定性評価
- 代表 query の top-k をカラー絵文字で並べ目視。明らかな改善/破綻を確認。

### 5.4 テキスト検索の回帰チェック (原則 3)
- 既知クエリ (例: `"cat" → 1F408` 系) の Recall を V0 と各バリアントで比較し、
  **テキスト性能が大きく落ちていないか**を確認。

### 比較表テンプレ

| variant | 手書きR@1 | 手書きR@5 | MRR | text R@5 | 所見 |
|---|---|---|---|---|---|
| V0 baseline | | | | | |
| V1 grayscale | | | | | |
| … | | | | | |

---

## 6. 別デバイスでの手順（指示書本体）

### 6.1 環境セットアップ

```bash
git clone <repo> && cd mi-midair-input
git switch feature/emoji_search        # 本ブランチ

# GPU を使うなら CPU 既定を上書き (例: CUDA 12.4)
UV_TORCH_BACKEND=cu124 uv sync          # GPU 無しなら単に: uv sync

# OpenMoji カラー画像 + メタデータを取得 (表示用 & V0〜V3 のソース)
uv run python packages/emoji-search/scripts/download_openmoji.py
```

V4 (`openmoji_black`, **採用方針**) を使うなら **黒線画版も取得**する。
`download_openmoji.py` は `--variant` 対応済み:

```bash
# color (表示用) と black (index構築用) を両方取得
uv run python packages/emoji-search/scripts/download_openmoji.py --variant both
#   color -> data/emoji_search/openmoji/        (表示)
#   black -> data/emoji_search/openmoji_black/  (ベクトル構築)
```

### 6.2 追加するコード

> **採用方針 (V4 = `openmoji_black`) は実装済み。** 以下のフラグで完結し、コード追加は不要:
> - `download_openmoji.py --variant {color,black,both}`
> - `build_index.py --source-variant {color,black}`（black 指定で `openmoji_black/` から構築し、
>   `index_meta.json` の `preprocess` を `"openmoji_black"` に記録。**metadata の `image_path` は常に
>   `openmoji/`＝カラーを指す**ので表示はカラーのまま）。
>
> V4 は **検索側 (searcher/app) の変更も不要**。理由: index は黒線画を `load_rgb_on_white` で
> 「黒線＋白背景」にして埋め込む。手書き query も `_decode_image` が「黒線＋白背景」に合成する。
> 両者が最初から同ドメインなので、原則 1 (index↔query 一致) が追加処理なしで満たされる。
>
> 以下 (a)(b)(c) は **追加バリアント (V1 grayscale / V2 binarize / V3 edge) も比較したい場合のみ** 反映する。
> V4 だけで進めるなら読み飛ばしてよい。

**(a) `packages/emoji-search/src/emoji_search/data.py` に前処理関数を追加**

```python
import numpy as np
from PIL import Image, ImageFilter, ImageOps

def _to_rgb(img: Image.Image) -> Image.Image:
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    bg.alpha_composite(img.convert("RGBA"))
    return bg.convert("RGB")

def pp_rgba_on_white(img): return _to_rgb(img)                       # V0
def pp_grayscale(img):     return _to_rgb(img).convert("L").convert("RGB")  # V1

def pp_binarize(img, thresh=200):                                    # V2
    g = _to_rgb(img).convert("L")
    b = g.point(lambda p: 255 if p >= thresh else 0)
    return b.convert("RGB")

def pp_edge(img, dilate=1):                                          # V3
    g = _to_rgb(img).convert("L")
    e = g.filter(ImageFilter.FIND_EDGES)        # 白地に白エッジ
    e = ImageOps.invert(e)                       # 白地に黒線へ
    # 線幅を手書きに寄せたいときは MaxFilter 等で太らせる:
    for _ in range(dilate):
        e = e.filter(ImageFilter.MinFilter(3))   # 黒線を膨張 (背景白前提)
    return e.convert("RGB")

# V4 は前処理ではなく「黒線画版を読む」: build 側で images_dir を openmoji_black に向ける。

PREPROCESS = {
    "rgba_on_white": pp_rgba_on_white,
    "grayscale": pp_grayscale,
    "binarize": pp_binarize,
    "edge": pp_edge,
    "openmoji_black": pp_rgba_on_white,   # 画像自体が黒線なので白背景合成のみ
}
```

> Canny を使いたい場合は `opencv-python-headless` を依存に足し、`pp_edge` を Canny に差し替える
> (PIL の `FIND_EDGES` より輪郭が安定することがある)。

**(b) `packages/emoji-search/scripts/build_index.py` に `--preprocess` を追加**

```python
# parse_args に追記
parser.add_argument("--preprocess", default="rgba_on_white",
                    choices=["rgba_on_white","grayscale","binarize","edge","openmoji_black"])

# main(): 画像読み込みを差し替え
from emoji_search.data import PREPROCESS
pp = PREPROCESS[args.preprocess]
images = [pp(Image.open(r.image_path)) for r in tqdm(records, desc="      load images")]

# index_meta の preprocess を実際の値に
meta["preprocess"] = args.preprocess
```

**(c) 検索側 (`searcher.py` / `app.py`) を index_meta に追従させる**（原則 1・2）

```python
# searcher.py: __init__ で index_meta.json を読み、preprocess を記憶
meta = json.load(open(Path(index_path).with_name("index_meta.json")))
self.preprocess = PREPROCESS[meta.get("preprocess", "rgba_on_white")]

# search_image: encode 前に query へ同じ前処理を適用
def search_image(self, image, top_k=5):
    vectors = self.encoder.encode_image([self.preprocess(image)])
    return self._search(vectors, top_k)
```

> これで「index と検索の前処理がズレる」事故を構造的に防げる。手書きキャンバスの
> `_decode_image` (app.py) はそのまま (白背景合成済み PIL を渡す) でよい。

### 6.3 index を構築（出力は衝突させない）

`metadata.jsonl` は全バリアント共通なので 1 度だけ生成し、index と meta はバリアント別に置く。

**採用方針 (V4 = 線画版) の構築 — これだけで運用可能:**

```bash
ROOT=data/emoji_search
mkdir -p $ROOT/experiments/openmoji_black
uv run python packages/emoji-search/scripts/build_index.py \
  --source-variant black \
  --index-path    $ROOT/experiments/openmoji_black/index.faiss \
  --metadata-out  $ROOT/experiments/openmoji_black/metadata.jsonl
# -> openmoji_black/ からベクトル構築。index_meta.preprocess="openmoji_black"。
#    metadata の image_path は openmoji/(カラー) を指すので表示はカラー。
```

**他バリアントも比較する場合 (6.2 のコード追加が前提):**

```bash
ROOT=data/emoji_search
for V in rgba_on_white grayscale edge; do
  uv run python packages/emoji-search/scripts/build_index.py \
    --preprocess $V \
    --index-path   $ROOT/experiments/$V/index.faiss \
    --metadata-out $ROOT/experiments/$V/metadata.jsonl
done
```

各 `experiments/<V>/` に `index.faiss` / `index_meta.json` / `metadata.jsonl` が揃う。

### 6.4 評価を回す
- 5.1 の self-retrieval スクリプト（black 版を query に index を引く）を各 variant で実行。
- 5.2 の手描きセットで Recall/MRR。
- 5.4 のテキスト回帰。
- 6.5 の比較表を埋める。

> 評価スクリプトは未実装。`EmojiSearcher` を各 `experiments/<V>` に向けて
> 簡単なループ (query → top-k → 正解 hexcode が含まれるか) を書けばよい。

### 6.5 成果物の返却（配布ルール厳守）

- **Drive に上げるのは index 関連 3 ファイルのみ** (`index.faiss` / `metadata.jsonl` / `index_meta.json`)。
  **OpenMoji 画像 (color/black とも) は Drive に再配布しない** (CC BY-SA 4.0 の手続き回避)。
- バリアントごとにフォルダを分けて配置 (リポジトリの `data/` 構成をミラー):

```
<共有Driveフォルダ>/
└── emoji_search/
    └── experiments/
        ├── rgba_on_white/  { index.faiss, metadata.jsonl, index_meta.json }
        ├── edge/           { ... }
        └── openmoji_black/ { ... }
```

- 採用版が決まったら、その 3 ファイルを `data/emoji_search/` 直下にも置けば既存の
  Web/CLI がそのまま使う (検索側は `index_meta.json` の `preprocess` を読んで自動整合)。

---

## 7. 判断基準・撤退条件

- **採用条件**: 手描きセットの Recall@1/MRR が V0 を有意に上回り、かつテキスト検索 (5.4) が
  大きく劣化しない (例: text R@5 の低下が許容幅内)。
- **撤退**: どのバリアントも V0 を超えない、または画像改善 < テキスト劣化 なら却下し V0 継続。
- 改善が `openmoji_black` だけなら、それを既定にするのが運用上もシンプル (合成処理不要)。

## 8. リスク・注意

- **CLIP は線画/エッジに対し OOD**。改善しない可能性は十分ある (本命は V4)。
- 線幅・解像度依存: CLIP は内部で 224px にリサイズ。線が細いと潰れる → V3/V4 は線幅正規化が効く。
- query 側の線幅 (キャンバス 10px) と index 側の線幅を**揃える**ほど効く。
- `index_meta.json` の `preprocess` と検索側 `PREPROCESS` の対応が崩れると即破綻する (原則 2)。
- テキスト整合の劣化を見落とさない (原則 3 / 5.4)。

## 9. 発展（今回のスコープ外）

- **sketch 特化エンコーダ**: CLIP を sketch でファインチューン、または sketch-photo 共有空間モデル。
- **線幅・スタイルの augmentation** を index 側に複数持たせ、query の揺れに頑健化。
- 日本語/英語サブシステムへ横展開する場合の前処理契約の共通化 (`midair_shared`)。
</content>
