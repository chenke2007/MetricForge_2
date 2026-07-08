"""Domain Rules 单元测试"""

import pytest
from app.services.ai_ask.domain_rules import (
    DOMAIN_RULES,
    get_table_hints,
    get_partition_field,
    parse_partition_expr,
    build_partition_filter_instruction,
)


class TestGetTableHints:
    def test_dws_prefix_returns_dws_hint(self):
        hints = get_table_hints("DWS_RPT_ZCPZ_CYFL_TF_M")
        assert len(hints) >= 1
        assert any("DWS_" in h and "汇总" in h for h in hints)

    def test_dim_prefix_returns_dim_hint(self):
        hints = get_table_hints("DIM_CUSTOMER")
        assert len(hints) >= 1
        assert any("DIM_" in h and "维度" in h for h in hints)

    def test_ads_prefix_returns_ads_hint(self):
        hints = get_table_hints("ADS_SALES_DAILY")
        assert len(hints) >= 1
        assert any("ADS_" in h and "应用" in h for h in hints)

    def test_unknown_prefix_returns_empty(self):
        hints = get_table_hints("UNKNOWN_TABLE")
        assert hints == []

    def test_plain_name_returns_empty(self):
        hints = get_table_hints("employees")
        assert hints == []

    def test_empty_string_returns_empty(self):
        hints = get_table_hints("")
        assert hints == []


class TestGetPartitionField:
    def test_default_partition_field_is_pt(self):
        assert get_partition_field() == "pt"

    def test_matches_domain_config(self):
        assert get_partition_field() == DOMAIN_RULES["partition"]["default_field"]


class TestParsePartitionExpr:
    def test_full_partition_syntax(self):
        result = parse_partition_expr("partition(p20260630)")
        assert result == "20260630"

    def test_partition_with_spaces(self):
        result = parse_partition_expr("partition (p20260630)")
        assert result == "20260630"

    def test_just_p_value(self):
        result = parse_partition_expr("p20260630")
        assert result == "20260630"

    def test_invalid_date_format(self):
        result = parse_partition_expr("p2026")  # not 8 digits
        assert result is None

    def test_no_match(self):
        result = parse_partition_expr("some random text")
        assert result is None

    def test_empty_string(self):
        result = parse_partition_expr("")
        assert result is None

    def test_uppercase_partition(self):
        result = parse_partition_expr("PARTITION(P20260630)")
        assert result == "20260630"


class TestBuildPartitionFilterInstruction:
    def test_contains_pt_field(self):
        result = build_partition_filter_instruction()
        assert "pt" in result
        assert "yyyymmdd" in result
        assert "partition(p20260630)" in result or "p20260630" in result


class TestDomainRulesImmutability:
    def test_domain_rules_has_required_keys(self):
        assert "naming_conventions" in DOMAIN_RULES
        assert "partition" in DOMAIN_RULES
        assert "strict_schema" in DOMAIN_RULES

    def test_strict_schema_is_true(self):
        assert DOMAIN_RULES["strict_schema"] is True

    def test_partition_has_expected_keys(self):
        part = DOMAIN_RULES["partition"]
        assert part["default_field"] == "pt"
        assert part["type"] == "varchar"
        assert part["format"] == "yyyymmdd"
