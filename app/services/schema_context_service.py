"""轻量级 Schema 上下文检索服务。

通过关键词匹配从现有元数据、字段语义、指标口径中检索上下文。
暂不引入向量 RAG。
"""

import re
import logging
from typing import Optional
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import (
    TableMetadata,
    ColumnMetadata,
    FieldSemantic,
    MetricDefinition,
    get_session,
)

logger = logging.getLogger(__name__)

# 默认忽略的 Schema
_IGNORE_SCHEMAS = {"INFORMATION_SCHEMA", "SYS", "SYSTEM", "DBA"}

# Token 预算：system prompt 不超过模型 context 的 60%
# 按 ~4 chars/token 估算
_MAX_SYSTEM_CHARS = 4000  # 约 1000 tokens，足够 MVP 使用

# 无意义停用词
_STOP_WORDS = frozenset({
    "什么", "怎么", "如何", "哪些", "哪个",
    "where", "how", "what", "list", "show",
    "give", "find", "get", "all", "the",
})

# CJK 统一表意文字范围（含扩展A区）
_CJK_RE = re.compile(r"[一-鿿㐀-䶿]{2,}")


class SchemaContextService:
    """从现有元数据中构建 Schema 上下文"""

    def build_context(self, query: str, db: Optional[Session] = None) -> str:
        """根据用户查询构建 Schema Context 文本。"""
        keywords = self._extract_keywords(query)
        if not keywords:
            return ""

        close_db = False
        if db is None:
            db = get_session()
            close_db = True
        try:
            parts = []

            # 1. 匹配表名
            tables_text = self._find_tables(keywords, db)
            if tables_text:
                parts.append(tables_text)

            # 2. 匹配字段语义
            semantics_text = self._find_field_semantics(keywords, db)
            if semantics_text:
                parts.append(semantics_text)

            # 3. 匹配指标口径
            metrics_text = self._find_metrics(keywords, db)
            if metrics_text:
                parts.append(metrics_text)

            if not parts:
                return ""

            combined = "\n\n".join(parts)
            # Token 预算截断
            if len(combined) > _MAX_SYSTEM_CHARS:
                combined = combined[:_MAX_SYSTEM_CHARS] + "\n\n（上下文过长，已截断）"
            return combined
        finally:
            if close_db:
                db.close()

    def _extract_keywords(self, query: str) -> list[str]:
        """从查询中提取关键词（中文 + 英文术语）。"""
        # 移除标点，分割中文和英文词
        text = re.sub(
            r"[，。！？、；：\"\"''（）【】《》\-\+\=\.\,\;\:\!\?\(\)\[\]\{\}]",
            " ",
            query,
        )
        words = text.split()
        result = []
        for w in words:
            if not w:
                continue
            w_lower = w.lower()
            # 跳过停用词（精确匹配）
            if w_lower in _STOP_WORDS:
                continue
            if len(w) > 1:
                result.append(w)
                # CJK 连续字符拆分为滑动 2-3 字词用于模糊匹配
                cjk_runs = _CJK_RE.findall(w)
                for run in cjk_runs:
                    if len(run) <= 2:
                        continue
                    for i in range(len(run) - 1):
                        token = run[i : i + 2]
                        if token.lower() not in _STOP_WORDS:
                            result.append(token)
        return result

    def _find_tables(self, keywords: list[str], db: Session) -> Optional[str]:
        """模糊匹配表名。"""
        if not keywords:
            return None
        filters = []
        for kw in keywords:
            filters.append(TableMetadata.table_name.ilike(f"%{kw}%"))
            filters.append(TableMetadata.table_comment.ilike(f"%{kw}%"))
        tables = (
            db.query(TableMetadata)
            .filter(or_(*filters))
            .filter(TableMetadata.schema_name.notin_(_IGNORE_SCHEMAS))
            .limit(10)
            .all()
        )
        if not tables:
            return None

        lines = ["### 数据表结构"]
        for t in tables:
            comment = f"（{t.table_comment}）" if t.table_comment else ""
            lines.append(f"- **{t.schema_name}.{t.table_name}** {comment}")
            # 获取该表的字段
            cols = (
                db.query(ColumnMetadata)
                .filter(ColumnMetadata.table_id == t.id)
                .filter(ColumnMetadata.is_active == True)
                .order_by(ColumnMetadata.column_id)
                .limit(20)
                .all()
            )
            for c in cols:
                col_comment = f" — {c.comment}" if c.comment else ""
                pk = " (PK)" if c.is_primary_key else ""
                lines.append(f"  - `{c.column_name}` {c.column_type}{pk}{col_comment}")
        return "\n".join(lines)

    def _find_field_semantics(
        self, keywords: list[str], db: Session
    ) -> Optional[str]:
        """匹配字段语义（业务术语）。"""
        if not keywords:
            return None
        filters = []
        for kw in keywords:
            filters.append(FieldSemantic.business_alias.ilike(f"%{kw}%"))
            filters.append(FieldSemantic.meaning.ilike(f"%{kw}%"))
        semantics = (
            db.query(FieldSemantic)
            .filter(or_(*filters))
            .limit(10)
            .all()
        )
        if not semantics:
            return None
        lines = ["### 业务字段语义"]
        for s in semantics:
            alias = s.business_alias or ""
            meaning = s.meaning or ""
            title = f"**{alias}**" if alias else "（未命名）"
            if meaning:
                title += f" — {meaning[:200]}"
            lines.append(f"- {title}")
        return "\n".join(lines)

    def _find_metrics(self, keywords: list[str], db: Session) -> Optional[str]:
        """匹配指标口径。"""
        if not keywords:
            return None
        filters = []
        for kw in keywords:
            filters.append(MetricDefinition.metric_name.ilike(f"%{kw}%"))
            filters.append(MetricDefinition.metric_code.ilike(f"%{kw}%"))
            filters.append(MetricDefinition.definition.ilike(f"%{kw}%"))
            filters.append(MetricDefinition.formula.ilike(f"%{kw}%"))
        metrics = (
            db.query(MetricDefinition)
            .filter(or_(*filters))
            .limit(10)
            .all()
        )
        if not metrics:
            return None
        lines = ["### 指标口径"]
        for m in metrics:
            lines.append(f"- **{m.metric_name}**（{m.metric_code}）")
            if m.definition:
                lines.append(f"  - 定义: {m.definition[:200]}")
            if m.formula:
                lines.append(f"  - 公式: {m.formula[:200]}")
        return "\n".join(lines)
