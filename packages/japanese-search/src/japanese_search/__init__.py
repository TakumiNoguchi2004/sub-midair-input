"""japanese_search: 日本語入力サブシステム (スケルトン)。

mid-air flick 入力の日本語モダリティ。埋め込み + FAISS 近傍探索で候補を返す設計を想定。
encoder は ``midair_shared.encoder.TextEncoder`` 契約、検索は
``midair_shared.search.Searcher`` 契約に従って実装する。
"""

__all__ = ["__version__"]
__version__ = "0.1.0"
