"""数据源管理业务逻辑"""

import logging

from ..models import DatasourceConfig, get_session

logger = logging.getLogger(__name__)


def get_adapter_for_datasource(ds_id: int) -> "OracleAdapter | None":
    """根据数据源 ID 获取适配器实例"""
    from ..adapters.oracle import OracleAdapter

    db = get_session()
    try:
        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == ds_id).first()
        if not ds:
            logger.error("数据源不存在: id=%s", ds_id)
            return None

        config = {
            "host": ds.host,
            "port": ds.port,
            "service_name": ds.service_name,
            "username": ds.username,
            "password": ds.password_enc,
            "lib_dir": None,  # 由环境变量或 app_config 配置
        }

        if ds.ds_type == "oracle":
            return OracleAdapter(config)
        else:
            logger.warning("不支持的数据库类型: %s", ds.ds_type)
            return None
    finally:
        db.close()


def test_datasource_connection(ds_id: int) -> bool:
    """测试数据源连通性"""
    adapter = get_adapter_for_datasource(ds_id)
    if not adapter:
        return False
    try:
        return adapter.test_connection()
    finally:
        adapter.close()
