"""midair_app: 3 サブシステム (emoji / japanese / english) を束ねる統合アプリ。

各サブシステムは ``midair_shared.search.Searcher`` 契約を実装し、
ここでは ``mode`` に応じて遅延ロードして振り分けるだけ。
"""

__all__ = ["__version__"]
__version__ = "0.1.0"
