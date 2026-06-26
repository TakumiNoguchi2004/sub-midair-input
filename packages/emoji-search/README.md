# emoji-search (絵文字入力)

OpenMoji の絵文字画像を CLIP で埋め込み、FAISS で近傍検索するサブシステム。
テキスト / 手書き画像の双方を同じ空間で検索できる。**実装済み (v0)**。

## 構成
- `src/emoji_search/encoder.py` — `ClipEncoder` (OpenAI CLIP ViT-B/32, `MultimodalEncoder`)
- `src/emoji_search/data.py` — OpenMoji メタデータ / 画像ローダ
- `src/emoji_search/searcher.py` — `EmojiSearcher` (`Searcher` 契約を実装)
- `scripts/build_index.py` — データ準備工程 (画像 → 埋め込み → FAISS index)

## データ
`data/emoji_search/` 配下 (git 管理外):
- `openmoji/` — 72×72 PNG (約 4495 枚)
- `openmoji.json` — メタデータ
- `index.faiss` / `metadata.jsonl` / `index_meta.json` — 生成物

OpenMoji は GitHub Releases から取得する (リポジトリ全体は ~1.6GB と重いので submodule 化しない)。
取得スクリプト (冪等。既に在ればスキップ、`--force` で再取得):
```bash
uv run python packages/emoji-search/scripts/download_openmoji.py
```

<details><summary>手動で取得する場合</summary>

```bash
curl -sL -o data/emoji_search/openmoji-72x72-color.zip \
  https://github.com/hfg-gmuend/openmoji/releases/download/17.0.0/openmoji-72x72-color.zip
unzip -q data/emoji_search/openmoji-72x72-color.zip -d data/emoji_search/openmoji
curl -sL -o data/emoji_search/openmoji.json \
  https://raw.githubusercontent.com/hfg-gmuend/openmoji/17.0.0/data/openmoji.json
```
</details>

## index の用意

**基本は Drive から取得**（各環境で CLIP 推論しない。`uvx` で gdown を都度実行）:
```bash
uvx gdown --folder "https://drive.google.com/drive/folders/1ucgsVXXp6jOTWapOPTLsz9i-wpnPS652" -O data
#  -> data/emoji_search/{index.faiss, metadata.jsonl, index_meta.json}
```

Drive を使わずローカル構築する場合 (V4=線画版):
```bash
uv run python packages/emoji-search/scripts/download_openmoji.py --variant both   # color + black
uv run python packages/emoji-search/scripts/build_index.py --source-variant black
```

## 既知の改善余地 (Codex レビューより)
- annotation テキスト埋め込みの late fusion (`0.7*image + 0.3*text`) で語義の曖昧さを緩和
- 手書き(線画) vs カラー絵文字のドメインギャップ対策 (線画 augmentation / 前処理)

ライセンス: OpenMoji は CC BY-SA 4.0 (再配布時は表記が必要)。
