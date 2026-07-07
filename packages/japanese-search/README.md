# japanese-search

かな漢字変換: 辞書ベースの最長一致セグメンテーションによる、ひらがな→漢字の変換。

## 構成

- `dictionary.py` — 読み(ひらがな) → 候補(表記)のリスト。数百語規模の手作業収録辞書
  (数万語規模の本格 IME 辞書ではないプロトタイプ)。
- `converter.py` — 貪欲な最長一致で読みをセグメントに分割し、各セグメントへ候補を割り当てる。
- `searcher.py` — `midair_shared.search.Searcher` 契約を満たす `JapaneseSearcher`。
  統合アプリからは `search_text` で最有力の変換結果を、Web フロントエンドからは
  `convert(text) -> [{reading, candidates}, ...]` でセグメント単位の候補を取得する。

## 使い方

```python
from japanese_search.searcher import JapaneseSearcher

searcher = JapaneseSearcher()
segments = searcher.convert("きょうはあめです")
# [{"reading": "きょう", "candidates": ["今日", "きょう"]}, ...]
```

## 辞書の拡張

`DICTIONARY`(`dictionary.py`)はプレーンな `{読み: [候補, ...]}` の dict。
SKK-JISYO 等の公開辞書を取り込む場合は、同じ形式に変換してマージすればよい。
