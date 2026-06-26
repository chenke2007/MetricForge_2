import json
import logging
import re

from app.services.ask_tools.base import MetadataToolRegistry, ToolCall

logger = logging.getLogger(__name__)

RULE_PATTERNS = [
    {
        "patterns": [r"数据源", r"接了几", r"几个库", r"多少.*数据源"],
        "tool": "datasource_stats",
        "args": {},
    },
    {
        "patterns": [r"采集", r"元数据.*更新", r"最近.*任务", r"采集任务"],
        "tool": "latest_collection_job",
        "args": {},
    },
    {
        "patterns": [r"表", r"字段", r"schema", r"有哪些列", r"列名", r"字段.*哪里"],
        "tool": "schema_metadata_query",
        "args": {"keyword": "", "limit": 10},
    },
    {
        "patterns": [r"治理", r"待办", r"ticket"],
        "tool": "governance_ticket_stats",
        "args": {},
    },
]


class ToolRouter:
    def __init__(self, registry: MetadataToolRegistry, client, model: str):
        self.registry = registry
        self.client = client
        self.model = model

    async def route(self, query: str) -> list[ToolCall]:
        rule_calls = self._rule_route(query)
        if rule_calls:
            return rule_calls
        return await self._llm_route(query)

    def _rule_route(self, query: str) -> list[ToolCall]:
        for rule in RULE_PATTERNS:
            for pat in rule["patterns"]:
                if re.search(pat, query):
                    args = dict(rule["args"])
                    if "keyword" in args:
                        args["keyword"] = self._extract_keyword(query) or query
                    return [ToolCall(name=rule["tool"], arguments=args)]
        return []

    def _extract_keyword(self, query: str) -> str | None:
        # 简单提取：去掉常见疑问词后的第一个 2-4 字片段
        stop = {"什么", "怎么", "如何", "哪些", "哪个", "哪里", "有多少", "几个"}
        cleaned = query
        for s in stop:
            cleaned = cleaned.replace(s, " ")
        cleaned = cleaned.strip()
        if len(cleaned) >= 2:
            return cleaned[:6]
        return None

    async def _llm_route(self, query: str) -> list[ToolCall]:
        if not self.client:
            return []
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": query}],
                tools=self.registry.to_openai_tools(),
                tool_choice="auto",
            )
            message = response.choices[0].message
            if not message.tool_calls:
                return []
            calls = []
            for tc in message.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}
                calls.append(ToolCall(name=tc.function.name, arguments=args))
            return calls
        except Exception:
            logger.exception("LLM 工具路由失败")
            return []
