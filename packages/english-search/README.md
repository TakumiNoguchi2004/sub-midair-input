# english-search (英語入力)

mid-air flick 入力の **英語** モダリティ。**未実装 (スケルトン)**。

## 実装方針 (案)
- `src/english_search/encoder.py` — `TextEncoder` 契約に従う埋め込み
- `src/english_search/searcher.py` — `Searcher` 契約を満たす `EnglishSearcher`
- データは `data/english_search/` 配下に隔離 (他サブシステムと干渉しない)

統合アプリからは `midair --mode english ...` で呼ばれる。
共通契約は `midair_shared`（`encoder` / `index` / `search`）を参照。
