"""数据源适配器抽象基类

每个数据源（Oracle、Hive、Doris 等）实现此接口。
主流程通过此接口操作数据源，不依赖具体实现。
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class QueryResult:
    """查询结果"""
    columns: list[str] = field(default_factory=list)
    rows: list[list[Any]] = field(default_factory=list)
    row_count: int = 0
    error: str | None = None


class DataSourceAdapter(ABC):
    """数据源适配器抽象基类"""

    def __init__(self, config: dict):
        self.config = config

    @abstractmethod
    def connect(self) -> Any:
        """建立数据源连接，返回连接对象"""
        ...

    @abstractmethod
    def test_connection(self) -> bool:
        """测试连通性"""
        ...

    @abstractmethod
    def execute_query(self, sql: str, params: dict | None = None) -> QueryResult:
        """执行只读查询"""
        ...

    @abstractmethod
    def close(self):
        """关闭连接"""
        ...

    @abstractmethod
    def get_dialect(self) -> str:
        """返回 SQL 方言标识: oracle / hive / spark / doris / clickhouse"""
        ...
