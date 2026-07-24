"""
Phase 5N Task 6 — Deterministic Executed Narrative Builder

纯函数：根据 SQL 执行结果的 columns/rows 生成结构化 narrative。
不访问数据库、不调用 LLM、不读取全局状态。

数值处理全程使用 Decimal，避免 float 精度丢失。
聚合运算使用 decimal.localcontext 动态计算 precision，
至少覆盖 Oracle NUMBER(38) 与最多 1000 行求和。
列名分类使用 token 边界匹配，避免子串误判。
"""

from __future__ import annotations

import math
import re
from decimal import Decimal, InvalidOperation, localcontext
from typing import Any


# ── 列名 token 化 ──────────────────────────────────────────────────────────


def _tokenize(name: str) -> list[str]:
    """将列名转换为小写 token 列表。

    - 先将 camelCase 转换为 snake_case（在单词边界插入下划线）
    - 再按 underscore 和非字母数字字符切分
    - 对仍粘连的已知日期/时间前缀（create/update/start/end 等 + time/date）做二次拆分
    """
    # camelCase -> snake_case: 在大写字母前插入下划线
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", "_", name)
    s = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", "_", s)
    # 按 underscore / 非字母数字切分
    tokens = re.split(r"[_\W]+", s)
    tokens = [t.lower() for t in tokens if t]

    # 二次拆分：已知动作前缀 + time/date 的粘连词
    _action_prefixes = frozenset({
        "create", "created", "update", "updated", "start", "end",
        "modify", "modified", "delete", "deleted", "close", "closed",
        "open", "begin", "finish", "insert", "add", "remove",
    })
    result: list[str] = []
    for tok in tokens:
        if not tok:
            continue
        for kw in ("time", "date", "timestamp"):
            if tok.endswith(kw) and len(tok) > len(kw) + 2:
                prefix = tok[: -len(kw)]
                if prefix in _action_prefixes:
                    result.append(prefix)
                    result.append(kw)
                    break
        else:
            result.append(tok)
    return result


# ── 列名匹配（基于完整 token，避免子串误判） ─────────────────────────────────

# 无分隔符的历史兼容名（如 customerid / userid / orderid）
_ID_EXPLICIT: frozenset = frozenset({"customerid", "userid", "orderid"})
_CODE_EXPLICIT: frozenset = frozenset({"isocode"})


def _is_id_column(name: str) -> bool:
    tokens = _tokenize(name)
    if any(t in {"id", "sid", "pk"} for t in tokens):
        return True
    if name.lower() in _ID_EXPLICIT:
        return True
    return False


def _is_code_column(name: str) -> bool:
    tokens = _tokenize(name)
    if any(t == "code" for t in tokens):
        return True
    if name.lower().endswith("code"):
        return True
    return False


def _is_date_column(name: str) -> bool:
    tokens = _tokenize(name)
    if any(t in {"date", "time", "timestamp", "datetime", "ts", "at"} for t in tokens):
        return True
    if re.search(r"(?:^|_)yearmonth(?:_|$)|year_month", name, re.IGNORECASE):
        return True
    return False


def _is_time_column(name: str) -> bool:
    tokens = _tokenize(name)
    if any(t in {"time", "interval"} for t in tokens):
        return True
    if re.search(r"(?:^|_)yearmonth(?:_|$)|year_month", name, re.IGNORECASE):
        return True
    return False


# ── 核心数值转换 ──────────────────────────────────────────────────────────────


def _to_finite_number(value: Any) -> Decimal | None:
    """将输入值转换为有限 Decimal，不可转换则返回 None。"""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        try:
            d = Decimal(str(value))
            if d.is_finite():
                return d
            return None
        except (InvalidOperation, ValueError):
            return None
    if isinstance(value, Decimal):
        try:
            if value.is_finite():
                return value
            return None
        except InvalidOperation:
            return None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            d = Decimal(stripped)
            if d.is_finite():
                return d
            return None
        except (InvalidOperation, ValueError):
            return None
    return None


def _is_numeric(value: Any) -> bool:
    return _to_finite_number(value) is not None


def _safe_numeric(value: Any) -> Decimal | None:
    return _to_finite_number(value)


# ── 列分类 ────────────────────────────────────────────────────────────────────


def _classify_columns(
    columns: list[str], rows: list[list]
) -> list[int]:
    n_cols = len(columns)
    metric_indices: list[int] = []

    for col_idx in range(n_cols):
        col_name = columns[col_idx]

        if _is_id_column(col_name):
            continue
        if _is_code_column(col_name):
            continue
        if _is_date_column(col_name):
            continue
        if _is_time_column(col_name):
            continue

        has_numeric = False
        all_non_null_are_bool = True
        has_non_null = False

        for row in rows:
            if col_idx >= len(row):
                continue
            val = row[col_idx]
            if val is None:
                continue
            has_non_null = True

            if isinstance(val, bool):
                continue

            all_non_null_are_bool = False

            if _is_numeric(val):
                has_numeric = True

        if not has_non_null:
            continue
        if not has_numeric:
            continue
        if all_non_null_are_bool and has_non_null:
            continue

        metric_indices.append(col_idx)

    return metric_indices


# ── Decimal precision 估算 ────────────────────────────────────────────────────


def _calculate_precision(values: list[Decimal]) -> int:
    """动态计算安全聚合所需的 Decimal context precision。

    使用 exponent span（最大整数位数 + 最大小数位数）估算，
    覆盖 Oracle NUMBER(38) 与极宽 exponent range（如 1E+37 + 1E-37）。
    """
    max_int_places = 1
    max_frac_places = 0
    for v in values:
        adj = v.adjusted()
        int_places = max(adj + 1, 1)
        if int_places > max_int_places:
            max_int_places = int_places
        exp = v.as_tuple().exponent
        if exp < 0:
            frac = -exp
            if frac > max_frac_places:
                max_frac_places = frac
    row_carry = len(str(len(values)))
    span = max_int_places + max_frac_places
    return max(span + row_carry + 2, 50)


# ── 聚合计算（Decimal 全程 + 动态 precision） ──────────────────────────────────


def _aggregate_column(values: list[Decimal]) -> dict[str, Decimal | int]:
    """对一列 Decimal 值进行聚合运算。

    调用者需确保已在合适的 ``decimal.localcontext`` 中执行。
    """
    n = len(values)
    d_sum = sum(values, Decimal(0))
    d_avg = d_sum / Decimal(n)
    return {
        "max": max(values),
        "min": min(values),
        "sum": d_sum,
        "avg": d_avg,
        "count": n,
    }


# ── 格式化 ────────────────────────────────────────────────────────────────────


def _format_number(value: Decimal) -> str:
    """将 Decimal 格式化为友好字符串。"""
    if value == value.to_integral_value():
        return str(int(value))
    normalized = value.normalize()
    trimmed = str(normalized)
    if "E" in trimmed:
        return str(value)
    return trimmed


# ── 主入口 ────────────────────────────────────────────────────────────────────


def build_executed_narrative(
    columns: list[str],
    rows: list[list],
    is_truncated: bool,
    elapsed_ms: int,
) -> dict[str, Any]:
    # ── 空结果处理 ──
    if not rows:
        return {
            "summary": f"查询成功，无返回数据。查询耗时 {elapsed_ms}ms。",
            "keyFindings": [],
            "evidence": [],
            "risks": [],
            "nextQuestions": [],
        }

    # ── 截断风险 ──
    risks: list[dict[str, Any]] = []
    if is_truncated:
        risks.append({
            "risk": "结果集超过上限已截断，仅展示部分数据",
            "severity": "medium",
        })

    # ── 列分类 ──
    metric_indices = _classify_columns(columns, rows)

    # ── 按列聚合 ──
    evidence: list[dict[str, Any]] = []
    key_findings: list[str] = []
    summary_parts: list[str] = []
    total_rows = len(rows)

    for col_idx in metric_indices:
        col_name = columns[col_idx]
        col_values: list[Decimal] = []

        for row in rows:
            if col_idx >= len(row):
                continue
            val = _safe_numeric(row[col_idx])
            if val is not None:
                col_values.append(val)

        if not col_values:
            continue

        # 动态设置 Decimal context precision
        precision = _calculate_precision(col_values)
        with localcontext() as ctx:
            ctx.prec = precision
            agg = _aggregate_column(col_values)

            n_valid: int = agg["count"]  # type: ignore[assignment]

            fmt_max = _format_number(agg["max"])  # type: ignore[arg-type]
            fmt_min = _format_number(agg["min"])  # type: ignore[arg-type]
            fmt_sum = _format_number(agg["sum"])  # type: ignore[arg-type]
            fmt_avg = _format_number(agg["avg"])  # type: ignore[arg-type]

        evidence.append({
            "claim": f"{col_name} 最高 {fmt_max}，最低 {fmt_min}，总和 {fmt_sum}，平均 {fmt_avg}（基于 {n_valid} 行有效数据）",
            "fields": [col_name],
            "value": fmt_sum,
            "confidence": "high",
        })

        key_findings.append(f"{col_name}: 最大值 {fmt_max}，最小值 {fmt_min}")

        summary_parts.append(
            f"{col_name} 范围为 {fmt_min} ~ {fmt_max}，合计 {fmt_sum}，平均 {fmt_avg}"
        )

    # ── Summary 构建 ──
    if summary_parts:
        row_info = f"共 {total_rows} 行数据"
        if is_truncated:
            truncated_note = "（结果已截断，仅展示部分数据）"
        else:
            truncated_note = ""
        summary = f"查询返回 {row_info}{truncated_note}。{'；'.join(summary_parts)}。查询耗时 {elapsed_ms}ms。"
    else:
        summary = f"查询返回 {total_rows} 行数据，未检测到数值指标。查询耗时 {elapsed_ms}ms。"

    return {
        "summary": summary,
        "keyFindings": key_findings,
        "evidence": evidence,
        "risks": risks,
        "nextQuestions": [],
    }
