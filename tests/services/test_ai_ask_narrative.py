"""
Phase 5N Task 6 — Deterministic Executed Narrative Builder 测试

覆盖：
- 数值识别：None/bool/int/float/Decimal/数字字符串
- 非数值排除：NaN/Infinity/空字符串/非数字字符串
- ID/code/date/time 类列误判排除
- 空结果
- 基本指标聚合：max/min/sum/avg
- 首行 null、后续正常
- bool-only 列排除
- 混合数值类型
- ragged rows
- 全 null 列
- truncated summary/risk 说明
- 纯函数确定性
"""

from decimal import Decimal, InvalidOperation
import math
import time

import pytest

# 在实现前这行会 ImportError，我们先跑 RED
from app.services.ai_ask.narrative_builder import (
    _is_numeric,
    _is_id_column,
    _is_code_column,
    _is_date_column,
    _is_time_column,
    _safe_numeric,
    _to_finite_number,
    build_executed_narrative,
)


# ============================================================
# _is_numeric 单元测试
# ============================================================

class TestIsNumeric:
    def test_none(self):
        assert _is_numeric(None) is False

    def test_bool_true(self):
        assert _is_numeric(True) is False

    def test_bool_false(self):
        assert _is_numeric(False) is False

    def test_int(self):
        assert _is_numeric(42) is True
        assert _is_numeric(0) is True
        assert _is_numeric(-1) is True

    def test_float(self):
        assert _is_numeric(3.14) is True
        assert _is_numeric(0.0) is True

    def test_decimal(self):
        assert _is_numeric(Decimal("12.34")) is True
        assert _is_numeric(Decimal(0)) is True

    def test_numeric_string(self):
        assert _is_numeric("123") is True
        assert _is_numeric("3.14") is True
        assert _is_numeric("-42.5") is True

    def test_nan(self):
        assert _is_numeric(math.nan) is False
        assert _is_numeric(Decimal("NaN")) is False

    def test_infinity(self):
        assert _is_numeric(math.inf) is False
        assert _is_numeric(-math.inf) is False
        assert _is_numeric(Decimal("Infinity")) is False
        assert _is_numeric(Decimal("-Infinity")) is False

    def test_empty_string(self):
        assert _is_numeric("") is False

    def test_non_numeric_string(self):
        assert _is_numeric("hello") is False
        assert _is_numeric("123abc") is False
        assert _is_numeric("十二") is False


# ============================================================
# _safe_numeric 单元测试
# ============================================================

class TestSafeNumeric:
    def test_int(self):
        result = _safe_numeric(42)
        assert result is not None

    def test_float(self):
        result = _safe_numeric(3.14)
        assert result is not None

    def test_decimal_returns_decimal(self):
        """Decimal 返回 Decimal 类型"""
        result = _safe_numeric(Decimal("12.34"))
        assert isinstance(result, Decimal)
        assert result == Decimal("12.34")

    def test_numeric_string(self):
        assert _safe_numeric("42") is not None
        assert _safe_numeric("3.14") is not None

    def test_none_returns_none(self):
        assert _safe_numeric(None) is None

    def test_bool_returns_none(self):
        assert _safe_numeric(True) is None

    def test_nan_returns_none(self):
        assert _safe_numeric(math.nan) is None

    def test_inf_returns_none(self):
        assert _safe_numeric(math.inf) is None
        assert _safe_numeric(Decimal("Infinity")) is None

    # ── 新增：字符串非有限值 ──

    def test_string_nan_returns_none(self):
        assert _safe_numeric("NaN") is None
        assert _safe_numeric("sNaN") is None
        assert _safe_numeric("nan") is None

    def test_string_infinity_returns_none(self):
        assert _safe_numeric("Infinity") is None
        assert _safe_numeric("-Infinity") is None
        assert _safe_numeric("inf") is None


# ============================================================
# _to_finite_number 单元测试
# ============================================================

class TestToFiniteNumber:
    def test_none(self):
        assert _to_finite_number(None) is None

    def test_bool(self):
        assert _to_finite_number(True) is None
        assert _to_finite_number(False) is None

    def test_int(self):
        result = _to_finite_number(42)
        assert isinstance(result, Decimal)
        assert result == Decimal("42")

    def test_float(self):
        result = _to_finite_number(3.14)
        assert isinstance(result, Decimal)
        assert result == Decimal("3.14")

    def test_decimal(self):
        result = _to_finite_number(Decimal("12.34"))
        assert isinstance(result, Decimal)
        assert result == Decimal("12.34")

    def test_numeric_string(self):
        assert _to_finite_number("42") == Decimal("42")
        assert _to_finite_number("3.14") == Decimal("3.14")
        assert _to_finite_number("-42.5") == Decimal("-42.5")

    def test_float_nan(self):
        assert _to_finite_number(math.nan) is None

    def test_float_inf(self):
        assert _to_finite_number(math.inf) is None
        assert _to_finite_number(-math.inf) is None

    def test_decimal_nan(self):
        assert _to_finite_number(Decimal("NaN")) is None
        assert _to_finite_number(Decimal("sNaN")) is None

    def test_decimal_inf(self):
        assert _to_finite_number(Decimal("Infinity")) is None
        assert _to_finite_number(Decimal("-Infinity")) is None

    def test_string_nan(self):
        """字符串 "NaN" 等必须返回 None"""
        assert _to_finite_number("NaN") is None
        assert _to_finite_number("sNaN") is None
        assert _to_finite_number("nan") is None
        assert _to_finite_number("NAN") is None

    def test_string_infinity(self):
        assert _to_finite_number("Infinity") is None
        assert _to_finite_number("-Infinity") is None
        assert _to_finite_number("inf") is None
        assert _to_finite_number("-inf") is None

    def test_empty_string(self):
        assert _to_finite_number("") is None
        assert _to_finite_number("  ") is None

    def test_non_numeric_string(self):
        assert _to_finite_number("hello") is None
        assert _to_finite_number("123abc") is None

    def test_large_decimal(self):
        """极大有限 Decimal 不溢出"""
        large = Decimal("9007199254740993")
        result = _to_finite_number(large)
        assert result == large
        assert str(result) == "9007199254740993"

    def test_decimal_precision(self):
        """0.1 + 0.2 精度不丢失"""
        d1 = _to_finite_number(Decimal("0.1"))
        d2 = _to_finite_number(Decimal("0.2"))
        assert d1 is not None and d2 is not None
        assert d1 + d2 == Decimal("0.3")

    def test_large_int_through_string(self):
        """大整数字符串精确转换"""
        result = _to_finite_number("9007199254740993")
        assert result == Decimal("9007199254740993")
        assert str(result) == "9007199254740993"


# ============================================================
# 列名识别测试
# ============================================================

class TestColumnNameFilters:
    def test_id_column(self):
        assert _is_id_column("id") is True
        assert _is_id_column("user_id") is True
        assert _is_id_column("ID") is True
        assert _is_id_column("customerid") is True
        # 不应误判
        assert _is_id_column("width") is False
        assert _is_id_column("quantity") is False

    def test_code_column(self):
        assert _is_code_column("status_code") is True
        assert _is_code_column("type_code") is True
        assert _is_code_column("code") is True
        assert _is_code_column("isocode") is True
        # 不应误判
        assert _is_code_column("income") is False

    def test_date_column(self):
        assert _is_date_column("create_date") is True
        assert _is_date_column("date") is True
        assert _is_date_column("createtime") is True  # 无下划线
        assert _is_date_column("create_time") is True
        assert _is_date_column("updated_at") is True
        assert _is_date_column("ts") is True
        # 不应误判
        assert _is_date_column("rate") is False

    def test_time_column(self):
        assert _is_time_column("start_time") is True
        assert _is_time_column("yearmonth") is True
        # duration 是可聚合时长指标，不自动排除
        assert _is_time_column("duration") is False
        # 不应误判
        assert _is_time_column("amount") is False


# ============================================================
# 空结果
# ============================================================

class TestEmptyResult:
    def test_empty_rows(self):
        result = build_executed_narrative(
            columns=["col1", "col2"],
            rows=[],
            is_truncated=False,
            elapsed_ms=500,
        )
        assert "summary" in result
        assert result["keyFindings"] == []
        assert result["evidence"] == []
        assert result["risks"] == []
        assert isinstance(result["summary"], str)
        # summary 必须指出查询成功但无数据
        assert "无" in result["summary"] or "空" in result["summary"]


# ============================================================
# 基本指标聚合
# ============================================================

class TestBasicAggregations:
    def test_single_numeric_column(self):
        result = build_executed_narrative(
            columns=["amount"],
            rows=[[10], [20], [30], [40], [50]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        assert len(ev) > 0
        # 找到 amount 相关的证据
        amount_ev = [e for e in ev if "amount" in e["fields"]]
        assert len(amount_ev) > 0

        # 验证数值：max=50, min=10, sum=150, avg=30
        texts = " ".join(e["claim"] for e in amount_ev)
        nums = " ".join(str(e.get("value", "")) for e in amount_ev)
        combined = texts + " " + nums
        assert "50" in combined
        assert "10" in combined
        assert "150" in combined
        assert "30" in combined

    def test_multiple_numeric_columns(self):
        result = build_executed_narrative(
            columns=["revenue", "cost", "name"],
            rows=[
                [100, 30, "A"],
                [200, 50, "B"],
                [300, 70, "C"],
            ],
            is_truncated=False,
            elapsed_ms=200,
        )
        ev = result["evidence"]
        revenue_ev = [e for e in ev if "revenue" in e["fields"]]
        cost_ev = [e for e in ev if "cost" in e["fields"]]
        assert len(revenue_ev) > 0
        assert len(cost_ev) > 0

        # revenue: max=300, min=100, sum=600, avg=200
        rev_text = " ".join(e["claim"] + " " + str(e.get("value", "")) for e in revenue_ev)
        assert "300" in rev_text
        assert "100" in rev_text
        assert "600" in rev_text
        assert "200" in rev_text

        # cost: max=70, min=30, sum=150, avg=50
        cost_text = " ".join(e["claim"] + " " + str(e.get("value", "")) for e in cost_ev)
        assert "70" in cost_text
        assert "30" in cost_text
        assert "150" in cost_text
        assert "50" in cost_text


# ============================================================
# 首行为 null、后续正常
# ============================================================

class TestFirstRowNull:
    def test_first_row_nulls(self):
        result = build_executed_narrative(
            columns=["value"],
            rows=[[None], [10], [20], [30]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        value_ev = [e for e in ev if "value" in e["fields"]]
        assert len(value_ev) > 0
        combined = " ".join(e["claim"] + " " + str(e.get("value", "")) for e in value_ev)
        # 仍应检测到数值: max=30, min=10, sum=60, avg=20
        assert "30" in combined
        assert "10" in combined
        assert "60" in combined
        assert "20" in combined


# ============================================================
# bool-only 列
# ============================================================

class TestBoolOnlyColumn:
    def test_bool_only_not_treated_as_metric(self):
        """仅有 bool 值的列不应作为指标"""
        result = build_executed_narrative(
            columns=["is_active", "score"],
            rows=[
                [True, 100],
                [False, 200],
                [True, 300],
            ],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        is_active_ev = [e for e in ev if "is_active" in e["fields"]]
        score_ev = [e for e in ev if "score" in e["fields"]]
        assert len(is_active_ev) == 0, "bool-only 列不应产生证据"
        assert len(score_ev) > 0


# ============================================================
# ID/code/date/time 列排除
# ============================================================

class TestNonMetricColumns:
    def test_id_column_excluded(self):
        result = build_executed_narrative(
            columns=["id", "amount"],
            rows=[[1, 100], [2, 200], [3, 300]],
            is_truncated=False,
            elapsed_ms=50,
        )
        ev = result["evidence"]
        id_ev = [e for e in ev if "id" in e["fields"]]
        amount_ev = [e for e in ev if "amount" in e["fields"]]
        assert len(id_ev) == 0, "id 列不应作为指标"
        assert len(amount_ev) > 0

    def test_code_column_excluded(self):
        result = build_executed_narrative(
            columns=["type_code", "value"],
            rows=[["A", 10], ["B", 20], ["C", 30]],
            is_truncated=False,
            elapsed_ms=50,
        )
        ev = result["evidence"]
        code_ev = [e for e in ev if "type_code" in e["fields"]]
        value_ev = [e for e in ev if "value" in e["fields"]]
        assert len(code_ev) == 0
        assert len(value_ev) > 0

    def test_date_column_excluded(self):
        result = build_executed_narrative(
            columns=["create_date", "amount"],
            rows=[["2024-01-01", 100], ["2024-02-01", 200]],
            is_truncated=False,
            elapsed_ms=50,
        )
        ev = result["evidence"]
        date_ev = [e for e in ev if "create_date" in e["fields"]]
        amount_ev = [e for e in ev if "amount" in e["fields"]]
        assert len(date_ev) == 0
        assert len(amount_ev) > 0

    def test_time_column_excluded(self):
        result = build_executed_narrative(
            columns=["start_time", "duration"],
            rows=[["09:00", 3600], ["10:00", 7200]],
            is_truncated=False,
            elapsed_ms=50,
        )
        ev = result["evidence"]
        time_ev = [e for e in ev if "start_time" in e["fields"]]
        # start_time 被排除，duration 是可聚合时长指标
        duration_ev = [e for e in ev if "duration" in e["fields"]]
        assert len(time_ev) == 0
        assert len([e for e in ev if "start_time" in e["fields"]]) == 0
        assert len(duration_ev) > 0, "duration 应为可聚合指标"


# ============================================================
# 混合数值类型
# ============================================================

class TestMixedNumericTypes:
    def test_int_float_decimal_mixed(self):
        result = build_executed_narrative(
            columns=["col"],
            rows=[
                [10],
                [Decimal("20.5")],
                [30],
                [Decimal("40.7")],
            ],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        col_ev = [e for e in ev if "col" in e["fields"]]
        assert len(col_ev) > 0
        combined = " ".join(e["claim"] + " " + str(e.get("value", "")) for e in col_ev)
        # max~=40.7, min=10, sum~=101.2, avg~=25.3
        assert "40" in combined
        assert "10" in combined
        assert any("101" in part for part in [combined])


# ============================================================
# Ragged rows（列数不一致）
# ============================================================

class TestRaggedRows:
    def test_short_row_does_not_crash(self):
        result = build_executed_narrative(
            columns=["a", "b"],
            rows=[
                [1, 2],
                [3],       # short row
                [5, 6],
            ],
            is_truncated=False,
            elapsed_ms=100,
        )
        # 不应 IndexError，至少返回合理结构
        assert "summary" in result
        assert "keyFindings" in result
        assert "evidence" in result
        # a 列应有部分数据
        a_ev = [e for e in result["evidence"] if "a" in e["fields"]]
        assert len(a_ev) > 0


# ============================================================
# 全 null 列
# ============================================================

class TestAllNullColumn:
    def test_all_null_column(self):
        result = build_executed_narrative(
            columns=["useless", "good"],
            rows=[
                [None, 100],
                [None, 200],
                [None, 300],
            ],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        useless_ev = [e for e in ev if "useless" in e["fields"]]
        assert len(useless_ev) == 0
        good_ev = [e for e in ev if "good" in e["fields"]]
        assert len(good_ev) > 0


# ============================================================
# 截断结果
# ============================================================

class TestTruncated:
    def test_truncated_in_summary_and_risks(self):
        result = build_executed_narrative(
            columns=["amount"],
            rows=[[10], [20], [30]],
            is_truncated=True,
            elapsed_ms=200,
        )
        assert "截断" in result["summary"] or "truncat" in result["summary"].lower() or "超过" in result["summary"]
        risks = result["risks"]
        risk_strs = [r if isinstance(r, str) else "" for r in risks]
        assert any("截断" in r or "truncat" in r.lower() for r in risk_strs) or any(
            isinstance(r, dict) and ("截断" in r.get("risk", "") or "truncat" in r.get("risk", "").lower()) for r in risks
        )

    def test_not_truncated_no_risk(self):
        result = build_executed_narrative(
            columns=["amount"],
            rows=[[10], [20]],
            is_truncated=False,
            elapsed_ms=100,
        )
        # 非截断不应包含截断风险
        risks = result["risks"]
        risk_texts = [r if isinstance(r, str) else r.get("risk", "") for r in risks]
        assert not any("截断" in r or "truncat" in r.lower() for r in risk_texts)


# ============================================================
# 确定性（纯函数）
# ============================================================

class TestDeterministic:
    def test_same_input_same_output(self):
        cols = ["amount"]
        rows = [[1], [2], [3], [4], [5]]
        r1 = build_executed_narrative(cols, rows, False, 100)
        r2 = build_executed_narrative(cols, rows, False, 100)
        assert r1 == r2


# ============================================================
# 数字字符串
# ============================================================

class TestNumericStringInRows:
    def test_numeric_string_as_value(self):
        result = build_executed_narrative(
            columns=["amount"],
            rows=[["10"], ["20"], ["30"]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        amount_ev = [e for e in ev if "amount" in e["fields"]]
        assert len(amount_ev) > 0
        combined = " ".join(e["claim"] + " " + str(e.get("value", "")) for e in amount_ev)
        assert "30" in combined  # max
        assert "10" in combined  # min
        # sum=60, avg=20


# ============================================================
# 字符串非有限值（NaN/Infinity）
# ============================================================

class TestStringNonFinite:
    def test_string_nan_not_in_evidence(self):
        """字符串 NaN 不得写入 keyFindings/evidence"""
        result = build_executed_narrative(
            columns=["amount"],
            rows=[["NaN"], ["20"], ["30"]],
            is_truncated=False,
            elapsed_ms=100,
        )
        # 只有 20,30 是有效值
        ev = result["evidence"]
        amount_ev = [e for e in ev if "amount" in e["fields"]]
        assert len(amount_ev) > 0
        combined = " ".join(e["claim"] + " " + str(e.get("value", "")) for e in amount_ev)
        assert "NaN" not in combined
        assert "30" in combined  # max
        assert "20" in combined  # min

    def test_string_snan_not_in_evidence(self):
        result = build_executed_narrative(
            columns=["val"],
            rows=[["sNaN"], [Decimal("10")], [Decimal("20")]],
            is_truncated=False,
            elapsed_ms=100,
        )
        combined = " ".join(
            e["claim"] + " " + str(e.get("value", ""))
            for e in result["evidence"]
            if "val" in e["fields"]
        )
        assert "sNaN" not in combined

    def test_string_infinity_not_in_evidence(self):
        result = build_executed_narrative(
            columns=["val"],
            rows=[["Infinity"], ["-Infinity"], [Decimal("100")]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        val_ev = [e for e in ev if "val" in e["fields"]]
        assert len(val_ev) > 0
        combined = " ".join(e["claim"] + " " + str(e.get("value", "")) for e in val_ev)
        assert "Infinity" not in combined
        assert "inf" not in combined.lower()

    def test_all_string_nan_no_metrics(self):
        """全部是非有限值时列不产生证据"""
        result = build_executed_narrative(
            columns=["val"],
            rows=[["NaN"], ["Infinity"], ["-Infinity"]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = [e for e in result["evidence"] if "val" in e["fields"]]
        assert len(ev) == 0


# ============================================================
# Decimal 精度
# ============================================================

class TestDecimalPrecision:
    def test_large_decimal_preserved(self):
        """极大 Decimal 必须精确保留"""
        large = Decimal("9007199254740993")
        result = build_executed_narrative(
            columns=["val"],
            rows=[[large]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        val_ev = [e for e in ev if "val" in e["fields"]]
        assert len(val_ev) > 0
        claim = val_ev[0]["claim"]
        assert "9007199254740993" in claim

    def test_decimal_fraction_precision(self):
        """0.1 + 0.2 == 0.3 在 Decimal 下成立"""
        result = build_executed_narrative(
            columns=["val"],
            rows=[[Decimal("0.1")], [Decimal("0.2")]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        val_ev = [e for e in ev if "val" in e["fields"]]
        assert len(val_ev) > 0
        claim = val_ev[0]["claim"]
        # 总和必须是 0.3，不是 0.30000000000000004
        assert "0.3" in claim
        assert "0.30000000000000004" not in claim

    def test_mixed_int_decimal_string_precision(self):
        """int/Decimal/数字字符串混合时精度保持"""
        result = build_executed_narrative(
            columns=["val"],
            rows=[[1], [Decimal("2.5")], ["3.75"]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        val_ev = [e for e in ev if "val" in e["fields"]]
        assert len(val_ev) > 0
        claim = val_ev[0]["claim"]
        # sum = 1 + 2.5 + 3.75 = 7.25
        assert "7.25" in claim


# ============================================================
# 有限值与字符串 NaN 混合
# ============================================================

class TestMixedFiniteAndNanStrings:
    def test_only_finite_are_counted(self):
        """纯数字列包含有限值与字符串 NaN 混合时，只统计有限值"""
        result = build_executed_narrative(
            columns=["amount"],
            rows=[
                [10],
                ["NaN"],
                [20],
                ["Infinity"],
                [30],
            ],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        amount_ev = [e for e in ev if "amount" in e["fields"]]
        assert len(amount_ev) > 0
        combined = " ".join(e["claim"] + " " + str(e.get("value", "")) for e in amount_ev)
        # 只统计 10,20,30: max=30, min=10, sum=60, avg=20
        assert "30" in combined
        assert "10" in combined
        assert "60" in combined
        assert "20" in combined

# ============================================================
# 空字符串和非数字字符串不参与计算
# ============================================================

class TestNonNumericInNumericColumn:
    def test_mixed_non_numeric_in_numeric_col(self):
        result = build_executed_narrative(
            columns=["amount"],
            rows=[
                [10],
                ["N/A"],
                [30],
                ["-"],
                [50],
            ],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        amount_ev = [e for e in ev if "amount" in e["fields"]]
        assert len(amount_ev) > 0
        combined = " ".join(e["claim"] + " " + str(e.get("value", "")) for e in amount_ev)
        # 只计算 10,30,50: max=50, min=10, sum=90, avg=30
        assert "50" in combined
        assert "10" in combined
        assert "90" in combined
        assert "30" in combined


# ============================================================
# Oracle Decimal 精度（38 位及以上）
# ============================================================

class TestOracleDecimalPrecision:
    def test_38_digit_single_value(self):
        """38 位 Decimal 的 min/max/sum/avg 均保持准确"""
        large = Decimal("12345678901234567890123456789012345678")
        result = build_executed_narrative(
            columns=["val"],
            rows=[[large]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        val_ev = [e for e in ev if "val" in e["fields"]]
        assert len(val_ev) > 0
        claim = val_ev[0]["claim"]
        assert "12345678901234567890123456789012345678" in claim

    def test_two_38_digit_sum_39_digits(self):
        """两个 38 位值相加产生 39 位结果时仍准确"""
        a = Decimal("50000000000000000000000000000000000000")
        b = Decimal("50000000000000000000000000000000000000")
        result = build_executed_narrative(
            columns=["val"],
            rows=[[a], [b]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        val_ev = [e for e in ev if "val" in e["fields"]]
        assert len(val_ev) > 0
        claim = val_ev[0]["claim"]
        # sum = 100000000000000000000000000000000000000 (39 digits)
        assert "100000000000000000000000000000000000000" in claim
        # max also 39 digits since both values are equal
        assert val_ev[0]["value"] is not None

    def test_high_precision_decimal_sum(self):
        """带小数的高精度 NUMBER 求和不得截断"""
        a = Decimal("0.12345678901234567890123456789012345678")
        b = Decimal("0.23456789012345678901234567890123456789")
        result = build_executed_narrative(
            columns=["val"],
            rows=[[a], [b]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        val_ev = [e for e in ev if "val" in e["fields"]]
        assert len(val_ev) > 0
        claim = val_ev[0]["claim"]
        # sum = 0.35802467913580246791358024679135802467
        assert "0.35802467913580246791358024679135802467" in claim

    def test_oracle_decimal_no_truncation(self):
        """Oracle NUMBER 精度不丢失：整数 38 位 + 小数"""
        val = Decimal("99999999999999999999999999999999999999")
        result = build_executed_narrative(
            columns=["val"],
            rows=[[val], [Decimal("1")]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = result["evidence"]
        val_ev = [e for e in ev if "val" in e["fields"]]
        assert len(val_ev) > 0
        claim = val_ev[0]["claim"]
        # sum = 100000000000000000000000000000000000000 (39 digits)
        assert "100000000000000000000000000000000000000" in claim


# ============================================================
# 列名正反例
# ============================================================

class TestMetricColumnNames:
    def test_amounts_is_metric(self):
        """amounts 是有限数值列，必须识别为指标"""
        result = build_executed_narrative(
            columns=["amounts"],
            rows=[[10], [20], [30]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = [e for e in result["evidence"] if "amounts" in e["fields"]]
        assert len(ev) > 0

    def test_profits_is_metric(self):
        result = build_executed_narrative(
            columns=["profits"],
            rows=[[100], [200]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = [e for e in result["evidence"] if "profits" in e["fields"]]
        assert len(ev) > 0

    def test_update_count_is_metric(self):
        result = build_executed_narrative(
            columns=["update_count"],
            rows=[[1], [2], [3]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = [e for e in result["evidence"] if "update_count" in e["fields"]]
        assert len(ev) > 0

    def test_paid_is_metric(self):
        """paid 不是 ID 列，应当是指标"""
        result = build_executed_narrative(
            columns=["paid"],
            rows=[[1000], [2000], [3000]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = [e for e in result["evidence"] if "paid" in e["fields"]]
        assert len(ev) > 0

    def test_valid_is_metric(self):
        """valid 不是 ID 列，应当是指标"""
        result = build_executed_narrative(
            columns=["valid"],
            rows=[[1], [0], [1]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = [e for e in result["evidence"] if "valid" in e["fields"]]
        assert len(ev) > 0

    def test_duration_is_metric(self):
        """duration 是可聚合时长指标，不因名称自动排除"""
        result = build_executed_narrative(
            columns=["duration"],
            rows=[[3600], [7200], [1800]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ev = [e for e in result["evidence"] if "duration" in e["fields"]]
        assert len(ev) > 0

    def test_id_excluded(self):
        result = build_executed_narrative(
            columns=["id", "value"],
            rows=[[1, 10], [2, 20]],
            is_truncated=False,
            elapsed_ms=100,
        )
        id_ev = [e for e in result["evidence"] if "id" in e["fields"]]
        value_ev = [e for e in result["evidence"] if "value" in e["fields"]]
        assert len(id_ev) == 0
        assert len(value_ev) > 0

    def test_user_id_excluded(self):
        result = build_executed_narrative(
            columns=["user_id", "value"],
            rows=[[1, 10], [2, 20]],
            is_truncated=False,
            elapsed_ms=100,
        )
        uid_ev = [e for e in result["evidence"] if "user_id" in e["fields"]]
        assert len(uid_ev) == 0

    def test_customerid_excluded(self):
        result = build_executed_narrative(
            columns=["customerid", "value"],
            rows=[[1, 10], [2, 20]],
            is_truncated=False,
            elapsed_ms=100,
        )
        cid_ev = [e for e in result["evidence"] if "customerid" in e["fields"]]
        value_ev = [e for e in result["evidence"] if "value" in e["fields"]]
        assert len(cid_ev) == 0
        assert len(value_ev) > 0

    def test_order_code_excluded(self):
        result = build_executed_narrative(
            columns=["order_code", "value"],
            rows=[[1, 10], [2, 20]],
            is_truncated=False,
            elapsed_ms=100,
        )
        code_ev = [e for e in result["evidence"] if "order_code" in e["fields"]]
        assert len(code_ev) == 0

    def test_create_date_excluded(self):
        result = build_executed_narrative(
            columns=["create_date", "value"],
            rows=[[1, 10], [2, 20]],
            is_truncated=False,
            elapsed_ms=100,
        )
        date_ev = [e for e in result["evidence"] if "create_date" in e["fields"]]
        assert len(date_ev) == 0

    def test_created_at_excluded(self):
        result = build_executed_narrative(
            columns=["created_at", "value"],
            rows=[[1, 10], [2, 20]],
            is_truncated=False,
            elapsed_ms=100,
        )
        at_ev = [e for e in result["evidence"] if "created_at" in e["fields"]]
        assert len(at_ev) == 0

    def test_timestamp_excluded(self):
        result = build_executed_narrative(
            columns=["timestamp", "value"],
            rows=[[1, 10], [2, 20]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ts_ev = [e for e in result["evidence"] if "timestamp" in e["fields"]]
        assert len(ts_ev) == 0

    def test_ts_excluded(self):
        result = build_executed_narrative(
            columns=["ts", "value"],
            rows=[[1, 10], [2, 20]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ts_ev = [e for e in result["evidence"] if "ts" in e["fields"]]
        assert len(ts_ev) == 0

    def test_yearmonth_excluded(self):
        result = build_executed_narrative(
            columns=["yearmonth", "value"],
            rows=[[1, 10], [2, 20]],
            is_truncated=False,
            elapsed_ms=100,
        )
        ym_ev = [e for e in result["evidence"] if "yearmonth" in e["fields"]]
        assert len(ym_ev) == 0


# ============================================================
# 列名边界（token 化后不得误判）
# ============================================================

class TestIdentifierTokens:
    def test_prepaid_is_metric(self):
        """prepaid 不应被 ID 模式排除"""
        result = build_executed_narrative(
            columns=["prepaid"],
            rows=[[100], [200], [300]],
            is_truncated=False, elapsed_ms=100,
        )
        ev = [e for e in result["evidence"] if "prepaid" in e["fields"]]
        assert len(ev) > 0

    def test_invalid_is_metric(self):
        result = build_executed_narrative(
            columns=["invalid"],
            rows=[[1], [0], [1]],
            is_truncated=False, elapsed_ms=100,
        )
        ev = [e for e in result["evidence"] if "invalid" in e["fields"]]
        assert len(ev) > 0

    def test_hybrid_is_metric(self):
        result = build_executed_narrative(
            columns=["hybrid"],
            rows=[[10], [20]],
            is_truncated=False, elapsed_ms=100,
        )
        ev = [e for e in result["evidence"] if "hybrid" in e["fields"]]
        assert len(ev) > 0

    def test_liquid_is_metric(self):
        result = build_executed_narrative(
            columns=["liquid"],
            rows=[[50], [100]],
            is_truncated=False, elapsed_ms=100,
        )
        ev = [e for e in result["evidence"] if "liquid" in e["fields"]]
        assert len(ev) > 0

    def test_lifetime_value_is_metric(self):
        """lifetime 中的 time 子串不得误判日期列"""
        result = build_executed_narrative(
            columns=["lifetime_value"],
            rows=[[1000], [2000], [3000]],
            is_truncated=False, elapsed_ms=100,
        )
        ev = [e for e in result["evidence"] if "lifetime_value" in e["fields"]]
        assert len(ev) > 0

    def test_runtime_seconds_is_metric(self):
        """runtime 中的 time 子串不得误判日期列"""
        result = build_executed_narrative(
            columns=["runtime_seconds"],
            rows=[[60], [120], [180]],
            is_truncated=False, elapsed_ms=100,
        )
        ev = [e for e in result["evidence"] if "runtime_seconds" in e["fields"]]
        assert len(ev) > 0

    def test_customerId_excluded(self):
        """camelCase customerId 必须被排除"""
        result = build_executed_narrative(
            columns=["customerId", "value"],
            rows=[[1, 10], [2, 20]],
            is_truncated=False, elapsed_ms=100,
        )
        cid_ev = [e for e in result["evidence"] if "customerId" in e["fields"]]
        assert len(cid_ev) == 0

    def test_createdAt_excluded(self):
        """camelCase createdAt 必须被排除"""
        result = build_executed_narrative(
            columns=["createdAt", "value"],
            rows=[[1, 10], [2, 20]],
            is_truncated=False, elapsed_ms=100,
        )
        ca_ev = [e for e in result["evidence"] if "createdAt" in e["fields"]]
        assert len(ca_ev) == 0

    def test_customerId_token_excluded(self):
        """customerId 通过 token 'id' 排除"""
        from app.services.ai_ask.narrative_builder import _is_id_column
        assert _is_id_column("customerId") is True

    def test_prepaid_token_not_id(self):
        """prepaid 的 token 不含 id"""
        from app.services.ai_ask.narrative_builder import _is_id_column
        assert _is_id_column("prepaid") is False

    def test_lifetime_token_not_date(self):
        """lifetime_value 不得被 _is_date_column 排除"""
        from app.services.ai_ask.narrative_builder import _is_date_column
        assert _is_date_column("lifetime_value") is False

    def test_runtime_token_not_date(self):
        """runtime_seconds 不得被 _is_date_column 排除"""
        from app.services.ai_ask.narrative_builder import _is_date_column
        assert _is_date_column("runtime_seconds") is False


# ============================================================
# Decimal exponent span
# ============================================================

class TestDecimalExponentSpan:
    def test_exp_span_preserved(self):
        """1E+37 + 1E-37 必须精确保留两部分"""
        result = build_executed_narrative(
            columns=["val"],
            rows=[[Decimal("1E+37")], [Decimal("1E-37")]],
            is_truncated=False, elapsed_ms=100,
        )
        ev = result["evidence"]
        val_ev = [e for e in ev if "val" in e["fields"]]
        assert len(val_ev) > 0
        claim = val_ev[0]["claim"]
        # sum = 10000000000000000000000000000000000000.0000000000000000000000000000000000001
        # The large part (38 integer digits) must appear
        assert "10000000000000000000000000000000000000" in claim

    def test_38_int_plus_38_frac(self):
        """38 位整数 + 38 位小数相加不得丢失小数"""
        a = Decimal("99999999999999999999999999999999999999")
        b = Decimal("0.00000000000000000000000000000000000001")
        result = build_executed_narrative(
            columns=["val"],
            rows=[[a], [b]],
            is_truncated=False, elapsed_ms=100,
        )
        ev = result["evidence"]
        val_ev = [e for e in ev if "val" in e["fields"]]
        assert len(val_ev) > 0
        claim = val_ev[0]["claim"]
        # sum = 99999999999999999999999999999999999999.00000000000000000000000000000000000001
        assert "99999999999999999999999999999999999999" in claim
        # The fraction part must not be lost (min may show as 1E-38)
        assert "00000000000000000000000000000000000001" in claim or "1E-38" in claim

    def test_1000_rows_number38_sum(self):
        """1000 行 NUMBER(38) 求和仍准确"""
        val = Decimal("12345678901234567890123456789012345678")
        rows = [[val] for _ in range(1000)]
        result = build_executed_narrative(
            columns=["val"],
            rows=rows,
            is_truncated=False, elapsed_ms=100,
        )
        ev = result["evidence"]
        val_ev = [e for e in ev if "val" in e["fields"]]
        assert len(val_ev) > 0
        claim = val_ev[0]["claim"]
        from decimal import localcontext
        with localcontext() as ctx:
            ctx.prec = 100
            expected = str(val * 1000)
        assert expected in claim

    def test_min_max_not_affected_by_avg(self):
        """min/max/sum 不受平均值除法舍入影响"""
        a = Decimal("1E+37")
        b = Decimal("1E-37")
        result = build_executed_narrative(
            columns=["val"],
            rows=[[a], [b]],
            is_truncated=False, elapsed_ms=100,
        )
        ev = result["evidence"]
        val_ev = [e for e in ev if "val" in e["fields"]]
        assert len(val_ev) > 0
        claim = val_ev[0]["claim"]
        # max = 1E+37 = 10000000000000000000000000000000000000
        assert "10000000000000000000000000000000000000" in claim
        # min = 1E-37 = 0.0000000000000000000000000000000000001
        assert "0.0000000000000000000000000000000000001" in claim
