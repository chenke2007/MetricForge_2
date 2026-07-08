class AiAskPromptBuilder:
    @staticmethod
    def build(request: dict) -> str:
        question = request["question"]
        datasource_name = request["datasource_name"]
        selected_tables = request.get("selected_tables", [])
        tables_str = ", ".join(selected_tables) if selected_tables else "未指定"

        system = """你是 MetricForge 数据分析助手。请根据用户问题生成结构化的分析响应。

你必须返回合法 JSON，且必须包含以下顶层字段：
- question: 用户原始问题（字符串）
- intent: { metrics: string[], dimensions: string[], filters: string[] }
- sqlPlan: { datasourceId: number, datasourceName: string, sql: string, tables: string[], fields: string[], assumptions: string[], safetyWarnings: string[] }
- resultSummary: { rowCount: number, durationMs: number }
- chartSuggestions: array of { title: string, chartType: "bar"|"line"|"pie"|"table"|"metric-card"|"combo", xField?: string, yFields: string[], rationale: string, limitations: string[] }
- narrative: { summary: string, keyFindings: string[], evidence: array of { claim: string, fields: string[] }, risks: string[], nextQuestions: string[] }
- semanticGaps: array of { field: string, reason: "not_found"|"ambiguous"|"incomplete" }

约束：
1. narrative.evidence 必须非空，每项必须包含 claim 和 fields。
2. sqlPlan.sql 应为有效 SQL，但不要求执行。
3. chartSuggestions 必须非空。
4. 不要编造 datasourceId，使用提供的数据源信息。"""

        user = f"""数据源：{datasource_name}
相关表：{tables_str}
用户问题：{question}

请直接返回 JSON，不要包含 markdown 代码块标记。"""

        return f"{system}\n\n{user}"
