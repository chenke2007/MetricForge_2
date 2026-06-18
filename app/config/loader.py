"""配置加载模块 — 加载 YAML 配置 + 环境变量覆盖"""

import os
from pathlib import Path
from typing import Any, Dict, Optional

import yaml

_CONFIG_CACHE: Dict[str, Any] = {}


def find_config_path(custom_path: Optional[str] = None) -> Path:
    """查找配置文件路径

    优先级: 1) 自定义路径  2) METRICFORGE_CONFIG 环境变量  3) 默认路径
    """
    if custom_path:
        return Path(custom_path)

    env_path = os.environ.get("METRICFORGE_CONFIG")
    if env_path:
        return Path(env_path)

    # 从项目根目录查找
    root = Path(__file__).resolve().parent
    candidates = [
        root / "app_config.yaml",
        root.parent / "config" / "app_config.yaml",
        Path.cwd() / "config" / "app_config.yaml",
        Path.cwd() / "app_config.yaml",
    ]
    for p in candidates:
        if p.exists():
            return p

    raise FileNotFoundError(
        "找不到 app_config.yaml。"
        "请设置 METRICFORGE_CONFIG 环境变量或在默认路径放置配置文件。"
    )


def load_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """加载 YAML 配置，支持环境变量覆盖

    首次加载后缓存，除非显式调用 reload_config()。
    """
    global _CONFIG_CACHE
    if _CONFIG_CACHE:
        return _CONFIG_CACHE

    cfg_path = find_config_path(config_path)
    with open(cfg_path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    # 环境变量覆盖数据库密码等敏感字段
    _apply_env_overrides(raw)

    _CONFIG_CACHE = raw
    return _CONFIG_CACHE


def reload_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """重新加载配置（清除缓存）"""
    global _CONFIG_CACHE
    _CONFIG_CACHE = {}
    return load_config(config_path)


def _apply_env_overrides(cfg: Dict[str, Any]) -> None:
    """用环境变量覆盖敏感配置项"""
    # Oracle 密码
    oracle_pwd = os.environ.get("ORACLE_PASSWORD")
    if oracle_pwd and "datasource_adapters" in cfg:
        adapters = cfg["datasource_adapters"]
        if "oracle" in adapters and isinstance(adapters["oracle"], dict):
            adapters["oracle"]["password"] = oracle_pwd

    # 数据库连接 URL
    db_url = os.environ.get("METRICFORGE_DB_URL")
    if db_url and "database" in cfg:
        cfg["database"]["url"] = db_url

    # Debug 模式
    debug = os.environ.get("METRICFORGE_DEBUG")
    if debug and "app" in cfg:
        cfg["app"]["debug"] = debug.lower() in ("true", "1", "yes")


def get_config(key: str, default: Any = None) -> Any:
    """按点号分隔的 key 获取配置值，如 'database.url'"""
    cfg = load_config()
    parts = key.split(".")
    val: Any = cfg
    for part in parts:
        if isinstance(val, dict):
            val = val.get(part)
            if val is None:
                return default
        else:
            return default
    return val
