"""dwhrpt 数仓领域规则 — 命名约定、分区规则、SQL 约束

可供 MetadataResolver 和 PromptBuilder 引用。
所有规则为纯函数，不依赖 DB。
"""

import re

# ── 领域规则定义 ──────────────────────────────────────────────────────────
# 这些规则基于 dwhrpt 数据仓库的实际设计约定。
# 扩展方式：往 naming_conventions 中添加新前缀，或修改 partition 配置。

DOMAIN_RULES = {
    "naming_conventions": {
        "DWS_": {
            "layer": "汇总数据层",
            "description": "按主题汇总的宽表，通常按日分区",
        },
        "DIM_": {
            "layer": "维度表",
            "description": "慢变更维度，通常全量快照",
        },
        "ADS_": {
            "layer": "应用数据层",
            "description": "面向应用的轻度汇总/数据集市",
        },
    },
    "partition": {
        "default_field": "pt",
        "type": "varchar",
        "format": "yyyymmdd",
        "description": "用户说 partition(p20260630) 时应转换为 pt='20260630' 过滤条件",
    },
    "strict_schema": True,  # 所有真实表必须 schema 限定
}


# ── 查询函数 ──────────────────────────────────────────────────────────────


def get_table_hints(table_name: str) -> list[str]:
    """根据表名前缀返回领域规则提示。

    Args:
        table_name: 表名（不含 schema），如 DWS_RPT_ZCPZ_CYFL_TF_M

    Returns:
        匹配的规则提示列表，无匹配时返回空列表
    """
    hints: list[str] = []
    for prefix, rule in DOMAIN_RULES["naming_conventions"].items():
        if table_name.startswith(prefix):
            hints.append(f"{prefix}: {rule['description']}")
    return hints


def get_partition_field() -> str:
    """返回分区字段名。"""
    return DOMAIN_RULES["partition"]["default_field"]


def parse_partition_expr(expr: str) -> str | None:
    """从 partition(p20260630) 类表达式中提取分区值。

    Args:
        expr: 分区表达式，如 "partition(p20260630)" 或 "p20260630"

    Returns:
        分区日期字符串如 "20260630"，无法解析时返回 None
    """
    # 匹配: partition(p20260630), partition (p20260630), p20260630
    m = re.search(
        r'(?:partition\s*\()?\s*p(\d{8})\s*(?:\))?',
        expr.strip(),
        re.IGNORECASE,
    )
    if m:
        return m.group(1)
    return None


def build_partition_filter_instruction() -> str:
    """构建分区过滤说明，供 prompt 注入使用。"""
    pf = get_partition_field()
    return (
        f"- 分区字段为 {pf}，VARCHAR 类型，格式 yyyymmdd\n"
        f"- 用户说 partition(p20260630) 时，转换为 {pf}='20260630' 过滤\n"
        f"- 快照表必须使用 {pf} 字段过滤对应分区"
    )
