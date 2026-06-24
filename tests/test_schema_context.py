"""Test schema context service."""

import os
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key")

from app.services.schema_context_service import SchemaContextService


def test_extract_keywords():
    """Chinese keyword extraction strips punctuation and stop words."""
    svc = SchemaContextService()
    result = svc._extract_keywords("本月合同到期的租赁物有哪些？")
    assert "合同" in result
    assert "租赁" in result
    assert "到期" in result
    # Stop words filtered
    assert "哪些" not in result


def test_extract_keywords_english():
    """English keyword extraction keeps meaningful terms."""
    svc = SchemaContextService()
    result = svc._extract_keywords("Show me contracts expiring this month")
    # "show" and "me" are stop words
    assert "contracts" in result or "expiring" in result or "month" in result


def test_extract_keywords_empty():
    """Only stop-words / short words yields empty list."""
    svc = SchemaContextService()
    result = svc._extract_keywords("什么")
    assert result == []


def test_extract_keywords_mixed():
    """Mixed Chinese-English extraction works."""
    svc = SchemaContextService()
    result = svc._extract_keywords("查询租赁合同 contracts 本月到期")
    assert "合同" in result or "contracts" in result
    assert "租赁" in result
    assert "到期" in result
    assert "本月" in result


def test_extract_keywords_punctuation_removed():
    """Punctuation is stripped and does not produce keywords."""
    svc = SchemaContextService()
    result = svc._extract_keywords("a, b; c! d? （e） 【f】")
    # All single chars filtered
    assert result == []


def test_build_context_no_keywords_returns_empty():
    """When query has no useful keywords, build_context returns empty string."""
    svc = SchemaContextService()
    result = svc.build_context("什么")
    assert result == ""


@patch("app.services.schema_context_service.get_session")
def test_build_context_no_match_returns_empty(mock_get_session):
    """When no DB records match, build_context returns empty string."""
    mock_db = MagicMock()
    mock_query = MagicMock()
    # All chained filter/limit calls return the same mock; .all() returns empty
    mock_query.filter.return_value = mock_query
    mock_query.limit.return_value = mock_query
    mock_query.all.return_value = []
    mock_db.query.return_value = mock_query
    mock_get_session.return_value = mock_db

    svc = SchemaContextService()
    result = svc.build_context("xyznonexistent12345xyz")
    assert result == ""


def test_extract_keywords_single_chars_filtered():
    """Single-character tokens are always filtered out."""
    svc = SchemaContextService()
    result = svc._extract_keywords("a b c d e 的 了")
    assert result == []


def test_extract_keywords_case_sensitivity():
    """Stop-word filtering is case-insensitive."""
    svc = SchemaContextService()
    result = svc._extract_keywords("SHOW Me The Money")
    # "SHOW", "me", "the" are stop words
    assert "Money" in result
    assert "SHOW" not in result
