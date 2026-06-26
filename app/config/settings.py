"""Pydantic Settings 配置模型（类型安全访问）"""

from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """应用配置，从环境变量和 .env 文件加载"""

    # === 应用 ===
    app_name: str = "MetricForge"
    app_version: str = "0.1.0"
    debug: bool = True

    # === 数据库 ===
    database_url: str = "sqlite:///./data/metricforge.db"

    # === Oracle 连接 ===
    oracle_password: Optional[str] = None
    oracle_lib_dir: Optional[str] = None  # Instant Client 路径

    # === 密钥 ===
    encryption_key: Optional[str] = None  # 用于密码加密

    # === 日志 ===
    log_level: str = "INFO"

    model_config = {
        "env_prefix": "METRICFORGE_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": False,
        "extra": "ignore",
    }
