"""Oracle 数据源适配器实现

使用 python-oracledb 连接 Oracle 19c，只读模式。
默认使用 Thin 模式（无需安装 Oracle Instant Client）。
"""

import logging
import os

import oracledb

from .base import DataSourceAdapter, QueryResult

logger = logging.getLogger(__name__)


class OracleAdapter(DataSourceAdapter):
    """Oracle 19c 数据源适配器"""

    def __init__(self, config: dict):
        super().__init__(config)
        self._connection = None
        self._lib_dir = config.get("lib_dir") or os.environ.get("ORACLE_LIB_DIR")

        # 如果指定了 lib_dir 则使用 Thick 模式，否则使用 Thin 模式
        if self._lib_dir:
            try:
                oracledb.init_oracle_client(lib_dir=self._lib_dir)
            except Exception as e:
                logger.warning("Oracle Client 初始化失败（可能已初始化）: %s", e)
        else:
            logger.info("使用 oracledb Thin 模式（无需 Oracle Client）")

    def _get_dsn(self) -> str:
        """构建 Oracle DSN"""
        host = self.config.get("host", "localhost")
        port = self.config.get("port", 1521)
        service_name = self.config.get("service_name", "")

        if service_name:
            return oracledb.makedsn(host, port, service_name=service_name)
        return oracledb.makedsn(host, port, sid=self.config.get("sid", "ORCL"))

    def connect(self):
        """建立 Oracle 连接"""
        if self._connection:
            try:
                self._connection.ping()
                return self._connection
            except oracledb.Error:
                self._connection = None

        username = self.config.get("username", "")
        password = self.config.get("password") or os.environ.get("ORACLE_PASSWORD", "")
        dsn = self._get_dsn()

        self._connection = oracledb.connect(user=username, password=password, dsn=dsn)
        self._connection.autocommit = False
        # 驱动层语句级超时（毫秒），与 SQL 执行服务的 30 秒上限保持一致
        try:
            self._connection.call_timeout = 30000
        except Exception:
            logger.warning("当前驱动不支持 connection.call_timeout")
        logger.info("Oracle 连接成功: %s@%s", username, dsn)
        return self._connection

    def test_connection(self) -> bool:
        """测试 Oracle 连通性"""
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM DUAL")
        result = cursor.fetchone()
        cursor.close()
        return result is not None and result[0] == 1

    def execute_query(self, sql: str, params: dict = None) -> QueryResult:
        """执行只读 SELECT 查询"""
        conn = self.connect()
        cursor = conn.cursor()
        try:
            if params:
                cursor.execute(sql, params)
            else:
                cursor.execute(sql)

            columns = [col[0] for col in cursor.description] if cursor.description else []
            rows = cursor.fetchall()
            return QueryResult(columns=columns, rows=rows, row_count=len(rows))
        except Exception as e:
            logger.error("Oracle 查询失败: %s\nSQL: %s", e, sql)
            return QueryResult(error=str(e))
        finally:
            cursor.close()

    def close(self):
        """关闭 Oracle 连接"""
        if self._connection:
            try:
                self._connection.close()
            except Exception as e:
                logger.warning("关闭 Oracle 连接时出错: %s", e)
            finally:
                self._connection = None

    def cancel(self):
        """取消正在执行的 Oracle 查询"""
        if self._connection:
            try:
                self._connection.cancel()
            except Exception as e:
                logger.warning("取消 Oracle 查询时出错: %s", e)

    def get_dialect(self) -> str:
        return "oracle"


def oracle_adapter_factory(request: "WorkerRequest") -> DataSourceAdapter:
    """顶层可 pickle 的生产 Oracle adapter 工厂。

    不在 import 时连接。不记录 request.password。
    使用字符串注解避免循环导入。
    """
    return OracleAdapter({
        "host": request.host,
        "port": request.port,
        "service_name": request.service_name,
        "sid": request.sid,
        "username": request.username,
        "password": request.password,
        "dialect": request.dialect,
        "lib_dir": request.lib_dir,
    })
