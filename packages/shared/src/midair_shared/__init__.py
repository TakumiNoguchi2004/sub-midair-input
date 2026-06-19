"""midair_shared: mid-air input サブシステム共通の基盤。

- ``encoder``: 埋め込み encoder の契約 (Protocol)
- ``index``  : FAISS ベクトル index の構築・保存・検索
- ``search`` : 統合のための ``Searcher`` / ``SearchResult`` 契約
"""

__all__ = ["__version__"]
__version__ = "0.1.0"
