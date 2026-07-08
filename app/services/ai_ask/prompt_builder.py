"""PromptBuilder — 构建发送给 LLM 的系统 prompt。

Phase 5M 增强：支持注入 metadata_context（ResolvedTableMetadata 列表），
让 LLM 基于真实元数据生成 SQL，不靠模型知识猜测字段。
"""

from .domain_rules import (
    get_table_hints,
    get_partition_field,
    build_partition_filter_instruction,
)

# ── 常量 prompt 片段 ──────────────────────────────────────────────────────

REQUIRED_JSON_SCHEMA = """你必须返回合法 JSON，且必须包含以下顶层字段：
- question: 用户原始问题（字符串）
- intent: { metrics: string[], dimensions: string[], filters: string[] }
- sqlPlan: { datasourceId: number, datasourceName: string, sql: string, tables: string[], fields: string[], assumptions: string[], safetyWarnings: string[] }
- resultSummary: { rowCount: number, durationMs: number }
- chartSuggestions: array of { title: string, chartType: "bar"|"line"|"pie"|"table"|"metric-card"|"combo", xField?: string, yFields: string[], rationale: string, limitations: string[] }
- narrative: { summary: string, keyFindings: string[], evidence: array of { claim: string, fields: string[] }, risks: string[], nextQuestions: string[] }
- semanticGaps: array of { field: string, reason: "not_found"|"ambiguous"|"incomplete" }"""

DEFAULT_CONSTRAINTS = """约束：
1. narrative.evidence 必须非空，每项必须包含 claim 和 fields。
2. sqlPlan.sql 应为有效 SQL，但不要求执行。
3. chartSuggestions 必须非空。
4. 不要编造 datasourceId，使用提供的数据源信息。"""

METADATA_CONSTRAINTS = """## SQL 生成约束（必须遵守）
1. 只能使用以上列出的表结构和字段。禁止创建以上结构中不存在的字段。
2. 表名必须使用上方元数据列出的 schema.table 完整表名，不可以只写裸表名。
   例如可使用元数据中的完整表名，但不要硬编码单一表作为全局规则。
3. 如果用户指定 partition(p20260630)，结合表结构判断：如果目标表有 pt 字段，
   则应使用 pt='20260630' 过滤，不要使用不适配的 partition 语法。
4. 如果用户问题中的业务概念无法对应到任何现有字段，请在 semanticGaps 中报告，
   不要凭空生成不存在的字段名。
5. 只允许生成 SELECT 查询。禁止 DELETE / UPDATE / INSERT / DROP / ALTER / CREATE / TRUNCATE。"""


def _format_columns_with_notes(columns: list) -> list[str]:
    """格式化字段列表，对易混淆字段名附加注释说明。"""
    lines: list[str] = []
    for col in columns:
        # 如果字段名容易被理解成其他含义，附上注意说明
        note = ""
        if col.column_name == "region_name" and col.comment and "区域名称" in (col.comment or ""):
            note = " ← 注意：字段名是 region_name 不是 region"
        elif col.column_name == "region_code":
            note = " ← 注意：字段名是 region_code，如果需要按区域分组请使用 region_name"

        if col.is_partition:
            note += "（分区字段）"

        if col.comment:
            lines.append(f"- `{col.column_name}` {col.column_type} — {col.comment}{note}")
        else:
            lines.append(f"- `{col.column_name}` {col.column_type}{note}")
    return lines


def _build_naming_hints(table_name: str) -> str:
    """从 domain rules 构建表命名提示。"""
    hints = get_table_hints(table_name)
    if hints:
        return "；".join(hints)
    return ""


def _build_metadata_section(metadata_context: list) -> str:
    """构建可用数据表结构部分。注入到 system prompt 中。"""
    lines = ["## 可用数据表结构", ""]

    for table in metadata_context:
        full_name = f"{table.schema_name}.{table.table_name}" if table.schema_name else table.table_name
        hint = _build_naming_hints(table.table_name)

        # 表头 - 同时显示表注释和命名规则提示
        lines.append(f"### {full_name}")
        if table.table_comment:
            lines.append(f"表说明：{table.table_comment}")
        if hint:
            lines.append(f"命名规则：{hint}")

        # 字段列表
        col_lines = _format_columns_with_notes(table.columns)
        if col_lines:
            lines.extend(col_lines)
        else:
            lines.append("  （该表无字段信息）")

        # Field semantics
        if table.field_semantics:
            for sem in table.field_semantics:
                alias_parts = []
                if sem.business_alias:
                    alias_parts.append(f"业务名：{sem.business_alias}")
                if sem.meaning:
                    alias_parts.append(f"含义：{sem.meaning}")
                if alias_parts:
                    lines.append(f"  - `{sem.column_name}`：{'；'.join(alias_parts)}")

        lines.append("")  # 空行分隔

    return "\n".join(lines)


def _build_domain_rules_section() -> str:
    """构建数仓规则部分。"""
    lines = [
        "## 数仓规则（dwhrpt）",
        "- 表名前缀约定：",
        "  - DWS_ = 汇总数据层（按主题汇总的宽表，通常按日分区）",
        "  - DIM_ = 维度表（慢变更维度）",
        "  - ADS_ = 应用数据层（面向应用的轻度汇总）",
        "- 分区规则：",
        f"  {build_partition_filter_instruction().replace(chr(10), '  ' + chr(10))}",
        "- 所有真实数仓表必须 schema 限定，例如 SCHEMA.TABLE。",
        "  具体 schema/table 以上方「可用数据表结构」中列出的 full_name 为准。",
        "- 只允许生成 SELECT 查询",
    ]
    return "\n".join(lines)


class AiAskPromptBuilder:
    @staticmethod
    def build(request: dict, metadata_context: list | None = None) -> str:
        """构建 LLM 调用 prompt。

        Args:
            request: 包含 question / datasource_name / selected_tables 的字典
            metadata_context: MetadataResolver.resolve() 返回的元数据列表。
                             当为 None 或空列表时，保持向后兼容（不注入元数据）。

        Returns:
            完整的 system + user prompt 字符串
        """
        question = request["question"]
        datasource_name = request["datasource_name"]
        selected_tables = request.get("selected_tables", [])
        tables_str = ", ".join(selected_tables) if selected_tables else "未指定"

        parts: list[str] = []

        # ── System prompt ──────────────────────────────────────────────────
        system_parts = ["你是 MetricForge 数据分析助手。请根据用户问题生成结构化的分析响应。", ""]
        system_parts.append(REQUIRED_JSON_SCHEMA)
        system_parts.append("")
        system_parts.append(DEFAULT_CONSTRAINTS)

        # 有元数据时注入表结构和规则
        if metadata_context:
            system_parts.append("")
            system_parts.append(_build_metadata_section(metadata_context))
            system_parts.append(_build_domain_rules_section())
            system_parts.append("")
            system_parts.append(METADATA_CONSTRAINTS)

        parts.append("\n".join(system_parts))

        # ── User prompt ────────────────────────────────────────────────────
        user_parts = [f"数据源：{datasource_name}"]
        user_parts.append(f"相关表：{tables_str}")

        if metadata_context:
            # 有元数据时提供简明的语义摘要
            field_summaries = []
            for table in metadata_context:
                col_names = [c.column_name for c in table.columns]
                if table.field_semantics:
                    sem_map = {s.column_name: s.business_alias for s in table.field_semantics if s.business_alias}
                    for cname in col_names:
                        alias = sem_map.get(cname)
                        if alias:
                            field_summaries.append(f"{cname}（{alias}）")
                if not field_summaries:
                    field_summaries = col_names
            if field_summaries:
                # 限定一下长度防止过长
                display_fields = field_summaries[:30]
                user_parts.append(f"可用字段：{', '.join(display_fields)}")

        user_parts.append(f"用户问题：{question}")
        user_parts.append("")
        user_parts.append("请直接返回 JSON，不要包含 markdown 代码块标记。")

        parts.append("\n".join(user_parts))

        return "\n\n".join(parts)
