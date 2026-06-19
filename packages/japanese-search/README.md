# japanese-search (日本語入力)

mid-air flick 入力の **日本語** モダリティ。**未実装 (スケルトン)**。

## 実装方針 (案)
- `src/japanese_search/encoder.py` — `TextEncoder` 契約に従う埋め込み (日本語対応モデルを想定)
- `src/japanese_search/searcher.py` — `Searcher` 契約を満たす `JapaneseSearcher`
- データは `data/japanese_search/` 配下に隔離 (他サブシステムと干渉しない)

統合アプリからは `midair --mode japanese ...` で呼ばれる。
共通契約は `midair_shared`（`encoder` / `index` / `search`）を参照。
