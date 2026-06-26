# Docker で動かす (Mac / GPU 無し環境)

環境依存を抑えるため、このシステムは Docker 上で動かせる。
torch は **CPU 版** を `uv.lock` で固定し、CLIP モデルはイメージに焼き込むので、
ビルド後はほぼオフラインで動く。**Intel Mac はネイティブ、Apple Silicon は amd64 エミュレーション**で動作する（`linux/amd64` 固定）。

```
構成: Docker image "midair-input"
  - web      : FastAPI + uvicorn の検索 Web アプリ (ホスト 8762 -> コンテナ 8000)
  - prepare  : OpenMoji 取得 + FAISS index 構築 (初回のみ、profile=setup)
  data/      : ホストの ./data を /app/data にマウント (画像・index を永続化)
```

## 0. 前提

- Docker Desktop (Mac)。Compose v2 同梱。
- Apple Silicon Mac で動かす場合も `platform: linux/amd64` でエミュレーション動作する（Intel Mac ならネイティブ）。

## 1. イメージをビルドする

```bash
docker compose build
```

- CPU 版 torch / transformers / faiss を入れ、CLIP ViT-B/32 を焼き込む。
- 初回は数分（モデル約 600MB のダウンロード込み）。以降はキャッシュされる。

## 2. データを用意する（初回のみ・既存 data があればスキップ可）

> **すでに `./data/emoji_search/` に画像 + index がある場合（別マシンからコピーした場合も含む）は、この手順は不要。** そのまま手順 3 へ。

index を得る方法は 2 つ。**基本は Drive から取得（各環境で CLIP 推論しない）**:

```bash
# (基本) 表示用カラー画像を公式から + V4(線画) index を Drive から取得
docker compose --profile setup run --rm fetch
```

Drive を使わずローカルで作る場合（コンテナ内の CLIP 推論で V4=線画 index を構築。重い）:

```bash
# (代替) OpenMoji color+black を取得 + 黒線画から index 構築
docker compose --profile setup run --rm prepare
```

- 生成物: `./data/emoji_search/{openmoji/, openmoji.json, index.faiss, metadata.jsonl, index_meta.json}`
- `fetch` は推論なしで軽い。`prepare` は CPU で数分（Apple Silicon のエミュレーションなら更に）。
- 一度実行すればホストの `./data` に残るので、次回以降は不要。
- index はデバイス非依存。**Drive 取得版・ローカル構築版とも V4（`openmoji_black` 線画）** で揃う。
- 取得元 Drive フォルダを変える場合は `MIDAIR_INDEX_URL` を環境変数で指定（`fetch` が参照）。

### Drive の index を使う（各環境でビルドしない・推奨ルール）

**配布ルール: FAISS index 関連だけを Drive に置く。OpenMoji 画像は Drive に上げない**
（画像の再配布は CC BY-SA 4.0 の手続きが要るため避け、公式 Releases から取得する）。
index (`index.faiss` / `metadata.jsonl` / `index_meta.json`, 約10MB) は**デバイス非依存で移植可能**。
検索は **同じ CLIP モデル**（`index_meta.json` の `model_id`）で行う前提。

**アップ側**（index を作った環境で一度だけ）: 共有 Drive フォルダ内に `emoji_search/` を作り、
`build_index.py` の生成物 3ファイルをその中に**フラットに**置く（リポジトリの `data/` をミラーする構成）。

- 共有フォルダ: <https://drive.google.com/drive/folders/1ucgsVXXp6jOTWapOPTLsz9i-wpnPS652>

```
<共有フォルダ>/            ← gdown --folder <link> -O data
└── emoji_search/
    ├── index.faiss
    ├── metadata.jsonl
    └── index_meta.json
```

（後で `japanese_search/` `english_search/` を兄弟フォルダで足せば、同じコマンドで全サブシステム分が揃う）

**取得側のセットアップ**:
```bash
# 1) OpenMoji 画像を公式 Releases から取得 (再配布なし、GPU 不要)
python packages/emoji-search/scripts/download_openmoji.py     # -> data/emoji_search/{openmoji/, openmoji.json}

# 2) index を Drive フォルダから取得 (data/ をミラー展開、pip install gdown)
gdown --folder "https://drive.google.com/drive/folders/1ucgsVXXp6jOTWapOPTLsz9i-wpnPS652" -O data

# 3) 起動
docker compose up web
```

→ 重い CLIP エンコードは走らず、`data/emoji_search/` が揃えば手順 3 へ。

## 3. ローカルホストで起動する

```bash
docker compose up web          # フォアグラウンド (ホスト 8762)
docker compose up -d web       # バックグラウンド
```

**8762 が他で使われている環境**は、空きポートを自動で選んで起動するラッパーを使う:
```bash
scripts/run-web.sh             # 8762 から空きを探して起動し、URL を表示
scripts/run-web.sh -d          # バックグラウンド (追加引数は compose に渡る)
MIDAIR_WEB_PORT=9000 docker compose up web   # 手動でポート指定する場合
```

ブラウザで表示された **http://localhost:&lt;ポート&gt;**（既定 8762）を開く。テキスト入力 / 手書きキャンバスで検索できる。

停止:
```bash
docker compose down
```

## 4. コンテナに入る / 中身を見る

```bash
docker compose exec web bash          # 起動中コンテナにシェルで入る
docker compose logs -f web            # ログ追尾
docker compose run --rm web bash      # 使い捨てコンテナで入る
```

コンテナ内では venv が有効済み（`/app/.venv/bin` に PATH）。例:
```bash
python -c "import torch; print(torch.__version__)"     # 2.12.1+cpu
midair --mode emoji --query "cat" --top-k 5            # CLI 検索 (画像は出ないがスコア確認)
```

CLI をワンショットで使う:
```bash
docker compose run --rm web midair --mode emoji --query "fire" --top-k 5
```

## 5. 実装・開発の仕方

ワークスペース各パッケージ (`packages/*`) は editable install されている。
ソースをマウントすれば、イメージを再ビルドせずに変更を反映できる（`--reload` でホットリロード）:

```bash
docker compose run --rm -p 8762:8000 \
  -v "$(pwd)/packages:/app/packages" \
  web uvicorn midair_web.app:app --host 0.0.0.0 --port 8000 --reload
```
（`-p 8762:8000` の左がホスト側ポート。コンテナ内 uvicorn は 8000 のまま。）

- Python コードの編集 → 自動リロード。
- **依存を変えたとき**（`pyproject.toml` のパッケージ追加など）は lock 更新 + 再ビルドが必要:
  ```bash
  uv lock                 # ホスト側で lock 更新
  docker compose build    # イメージ再ビルド
  ```
- `data/` 配下はマウント共有なので、ホストで作った index をそのままコンテナが読む（逆も同様）。

## 6. よくあるハマり

| 症状 | 対処 |
|------|------|
| `address already in use` / `port is already allocated` (8762) | `scripts/run-web.sh`（空きポート自動選択）で起動するか、`MIDAIR_WEB_PORT=9000 docker compose up web` で別番号を指定 |
| 検索が `index が見つかりません` | 手順 2 (prepare) を未実行。`docker compose --profile setup run --rm prepare` |
| Apple Silicon で遅い | amd64 エミュレーションのため。Intel Mac ならネイティブで高速 |
| イメージを作り直したい | `docker compose build --no-cache` |

## 7. CPU / GPU について

- 既定は CPU 版 torch（`pyproject.toml` の `[[tool.uv.index]] pytorch-cpu` + `torch = { index = "pytorch-cpu" }`）。
- GPU マシンで高速に index 構築したいときだけ、ホストで `UV_TORCH_BACKEND=cu124 uv sync` のように上書きする（Docker 運用は CPU のまま）。
