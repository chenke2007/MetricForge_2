from unittest.mock import MagicMock, patch

import os
import pytest
from app.schemas.ai_ask import (
    AiAskAnalyzeRequest,
    AiAskAnalyzeSuccessResponse,
    AiAskAnalyzeErrorResponse,
    AiAskErrorCode,
)

# Ensure encryption key is available for HTTP tests that exercise the app factory.
os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")
from app.services.ai_ask.llm_service import AiAskLlmService
from app.services.ai_ask.prompt_builder import AiAskPromptBuilder
from app.services.ai_ask.normalizer import AiAskResponseNormalizer
from app.services.ai_ask.validator import validate_ai_ask_response


def test_request_schema_accepts_minimal_payload():
    payload = {
        "question": "各区域销售额排名",
        "datasourceId": 1,
        "datasourceName": "示例数据源",
        "selectedTables": ["sales"],
        "messageHistory": [],
    }
    req = AiAskAnalyzeRequest(**payload)
    assert req.question == "各区域销售额排名"
    assert req.datasource_id == 1


def test_error_response_schema():
    resp = AiAskAnalyzeErrorResponse(
        ok=False,
        error_code=AiAskErrorCode.LLM_NOT_CONFIGURED,
        error_message="没有已启用的 LLM 配置",
    )
    assert resp.ok is False
    assert resp.error_code == "LLM_NOT_CONFIGURED"


def test_success_response_schema():
    resp = AiAskAnalyzeSuccessResponse(
        ok=True,
        data={
            "question": "各区域销售额排名",
            "intent": {"metrics": ["销售额"], "dimensions": ["区域"], "filters": []},
            "sqlPlan": {
                "datasourceId": 1,
                "datasourceName": "示例数据源",
                "sql": "SELECT region, SUM(amount) FROM sales GROUP BY region",
                "tables": ["sales"],
                "fields": ["region", "amount"],
                "assumptions": [],
                "safetyWarnings": [],
            },
            "chartSuggestions": [],
            "narrative": {
                "summary": "...",
                "keyFindings": [],
                "evidence": [{"claim": "...", "fields": ["region"]}],
                "risks": [],
                "nextQuestions": [],
            },
            "semanticGaps": [],
        },
    )
    assert resp.ok is True
    assert resp.data["question"] == "各区域销售额排名"


def test_prompt_includes_required_json_instruction():
    request = {
        "question": "各区域销售额排名",
        "datasource_id": 1,
        "datasource_name": "示例数据源",
        "selected_tables": ["sales"],
        "message_history": [],
    }
    prompt = AiAskPromptBuilder.build(request)
    assert "必须返回合法 JSON" in prompt or "JSON" in prompt
    assert "question" in prompt
    assert "sqlPlan" in prompt
    assert "narrative" in prompt
    assert "chartSuggestions" in prompt


def test_normalizer_fills_optional_arrays():
    raw = {
        "question": "q",
        "intent": {"metrics": ["m"], "dimensions": ["d"], "filters": []},
        "sqlPlan": {
            "datasourceId": 1,
            "datasourceName": "示例数据源",
            "sql": "SELECT * FROM t",
            "tables": ["t"],
            "fields": ["f"],
        },
        "narrative": {"summary": "s", "evidence": [{"claim": "c", "fields": ["f"]}]},
        "chartSuggestions": [{"title": "t", "chartType": "scatter", "yFields": ["f"]}],
        "semanticGaps": [],
    }
    normalized = AiAskResponseNormalizer.normalize(raw)
    assert normalized["sqlPlan"]["assumptions"] == []
    assert normalized["sqlPlan"]["safetyWarnings"] == []
    assert normalized["narrative"]["risks"] == []
    assert normalized["narrative"]["nextQuestions"] == []
    assert "keyFindings" not in normalized["narrative"]  # required field, not defaulted
    assert normalized["chartSuggestions"][0]["chartType"] == "bar"  # invalid 'scatter' -> bar


def test_normalizer_does_not_fill_key_findings():
    raw = {
        "question": "q",
        "intent": {"metrics": ["m"], "dimensions": ["d"], "filters": []},
        "sqlPlan": {
            "datasourceId": 1,
            "datasourceName": "示例数据源",
            "sql": "SELECT * FROM t",
            "tables": ["t"],
            "fields": ["f"],
            "assumptions": [],
            "safetyWarnings": [],
        },
        "narrative": {"summary": "s", "evidence": [{"claim": "c", "fields": ["f"]}]},
        "chartSuggestions": [{"title": "t", "chartType": "bar", "yFields": ["f"]}],
        "semanticGaps": [],
    }
    normalized = AiAskResponseNormalizer.normalize(raw)
    assert "keyFindings" not in normalized["narrative"]
    validation = validate_ai_ask_response(normalized)
    assert validation["valid"] is False
    assert any(e["path"] == "narrative.keyFindings" for e in validation["errors"])
    raw = {"intent": {"metrics": ["m"]}}
    normalized = AiAskResponseNormalizer.normalize(raw)
    assert "question" not in normalized
    assert "sqlPlan" not in normalized


def test_validator_accepts_valid_response():
    response = {
        "question": "q",
        "intent": {"metrics": ["m"], "dimensions": ["d"], "filters": []},
        "sqlPlan": {
            "datasourceId": 1,
            "datasourceName": "示例数据源",
            "sql": "SELECT * FROM t",
            "tables": ["t"],
            "fields": ["f"],
            "assumptions": [],
            "safetyWarnings": [],
        },
        "narrative": {"summary": "s", "keyFindings": [], "evidence": [{"claim": "c", "fields": ["f"]}], "risks": [], "nextQuestions": []},
        "chartSuggestions": [{"title": "t", "chartType": "bar", "yFields": ["f"]}],
        "semanticGaps": [],
    }
    result = validate_ai_ask_response(response)
    assert result["valid"] is True
    assert not result["errors"]


def test_validator_rejects_missing_question():
    response = {"intent": {"metrics": ["m"]}}
    result = validate_ai_ask_response(response)
    assert result["valid"] is False
    assert any(e["path"] == "question" for e in result["errors"])


def test_validator_rejects_missing_evidence():
    response = {
        "question": "q",
        "intent": {"metrics": ["m"], "dimensions": [], "filters": []},
        "sqlPlan": {
            "datasourceId": 1,
            "datasourceName": "示例数据源",
            "sql": "SELECT * FROM t",
            "tables": ["t"],
            "fields": ["f"],
            "assumptions": [],
            "safetyWarnings": [],
        },
        "narrative": {"summary": "s", "keyFindings": [], "evidence": [], "risks": [], "nextQuestions": []},
        "chartSuggestions": [{"title": "t", "chartType": "bar", "yFields": ["f"]}],
        "semanticGaps": [],
    }
    result = validate_ai_ask_response(response)
    assert result["valid"] is False
    assert any("evidence" in e["path"] for e in result["errors"])


def make_request():
    return {
        "question": "各区域销售额排名",
        "datasource_id": 1,
        "datasource_name": "示例数据源",
        "selected_tables": ["sales"],
        "message_history": [],
    }


def _make_active_setting():
    setting = MagicMock()
    setting.base_url = "https://api.example.com"
    setting.model_name = "gpt-4o-mini"
    setting.api_key = "encrypted-key"
    return setting


def _mock_db_with_active(active=None):
    db = MagicMock()
    query = MagicMock()
    filter_mock = MagicMock()
    filter_mock.first.return_value = active
    query.filter.return_value = filter_mock
    db.query.return_value = query
    return db


def test_analyze_returns_llm_not_configured_when_no_active_setting():
    db = _mock_db_with_active(active=None)
    svc = AiAskLlmService()
    result = svc.analyze(make_request(), db=db)
    assert result.ok is False
    assert result.error_code == AiAskErrorCode.LLM_NOT_CONFIGURED


@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_returns_success_for_valid_llm_response(mock_decrypt, mock_openai_cls):
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=MagicMock(content='{"question": "各区域销售额排名", "intent": {"metrics": ["销售额"], "dimensions": ["区域"], "filters": []}, "sqlPlan": {"datasourceId": 1, "datasourceName": "示例数据源", "sql": "SELECT region, SUM(amount) FROM sales GROUP BY region", "tables": ["sales"], "fields": ["region", "amount"], "assumptions": [], "safetyWarnings": []}, "resultSummary": {"rowCount": 5, "durationMs": 100}, "chartSuggestions": [{"title": "销售额排名", "chartType": "bar", "yFields": ["销售额"], "rationale": "...", "limitations": []}], "narrative": {"summary": "...", "keyFindings": [], "evidence": [{"claim": "...", "fields": ["区域"]}], "risks": [], "nextQuestions": []}, "semanticGaps": []}'))]
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    result = svc.analyze(make_request(), db=db)
    assert result.ok is True
    assert result.data["question"] == "各区域销售额排名"


@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_sends_system_and_user_messages(mock_decrypt, mock_openai_cls):
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=MagicMock(content='{"question": "各区域销售额排名", "intent": {"metrics": ["销售额"], "dimensions": ["区域"], "filters": []}, "sqlPlan": {"datasourceId": 1, "datasourceName": "示例数据源", "sql": "SELECT region, SUM(amount) FROM sales GROUP BY region", "tables": ["sales"], "fields": ["region", "amount"], "assumptions": [], "safetyWarnings": []}, "resultSummary": {"rowCount": 5, "durationMs": 100}, "chartSuggestions": [{"title": "销售额排名", "chartType": "bar", "yFields": ["销售额"], "rationale": "...", "limitations": []}], "narrative": {"summary": "...", "keyFindings": [], "evidence": [{"claim": "...", "fields": ["区域"]}], "risks": [], "nextQuestions": []}, "semanticGaps": []}'))]
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    request = make_request()
    result = svc.analyze(request, db=db)
    assert result.ok is True

    # Assert messages sent to OpenAI contain both system and user roles
    create_call = mock_client.chat.completions.create
    messages_arg = create_call.call_args[1]["messages"]
    roles = [m["role"] for m in messages_arg]
    assert "system" in roles
    assert "user" in roles
    # Assert user content equals the original question
    user_msg = next(m for m in messages_arg if m["role"] == "user")
    assert user_msg["content"] == "各区域销售额排名"


@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_returns_invalid_response_for_bad_json(mock_decrypt, mock_openai_cls):
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=MagicMock(content="not json"))]
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    result = svc.analyze(make_request(), db=db)
    assert result.ok is False
    assert result.error_code == AiAskErrorCode.INVALID_RESPONSE


# ── HTTP serialization tests (camelCase aliases via FastAPI) ──────────────


@pytest.fixture
def client():
    """FastAPI TestClient with fresh in-memory database for ai_ask endpoint tests."""
    import tempfile
    from pathlib import Path
    db_path = Path(tempfile.mktemp(suffix=".db"))
    from app.main import create_app
    from fastapi.testclient import TestClient

    return TestClient(create_app(database_url=f"sqlite:///{db_path}"))


def test_analyze_returns_200_with_error_code_camelcase_when_no_active_llm(client):
    resp = client.post(
        "/api/ai-ask/analyze",
        json={
            "question": "sales by region",
            "datasourceId": 1,
            "datasourceName": "dwhrpt",
            "selectedTables": ["sales"],
            "messageHistory": [],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    # Must use camelCase keys in JSON
    assert "errorCode" in data
    assert "errorMessage" in data
    assert data["errorCode"] == "LLM_NOT_CONFIGURED"
    # Must NOT contain snake_case keys
    assert "error_code" not in data
    assert "error_message" not in data


def test_analyze_returns_200_with_error_code_camelcase_when_no_active_llm(client):
    resp = client.post(
        "/api/ai-ask/analyze",
        json={
            "question": "sales by region",
            "datasourceId": 1,
            "datasourceName": "dwhrpt",
            "selectedTables": ["sales"],
            "messageHistory": [],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    # Must use camelCase keys in JSON
    assert "errorCode" in data
    assert "errorMessage" in data
    assert data["errorCode"] == "LLM_NOT_CONFIGURED"
    # Must NOT contain snake_case keys
    assert "error_code" not in data
    assert "error_message" not in data


def test_error_response_model_accessible_with_snake_case():
    """Python code can still use error_code / error_message when constructing or reading."""
    resp = AiAskAnalyzeErrorResponse(
        ok=False,
        error_code=AiAskErrorCode.LLM_NOT_CONFIGURED,
        error_message="some message",
    )
    # Python-side access via snake_case field names
    assert resp.error_code == "LLM_NOT_CONFIGURED"
    assert resp.error_message == "some message"
    # model_dump(by_alias=False) returns snake_case
    dumped = resp.model_dump(by_alias=False)
    assert dumped["error_code"] == "LLM_NOT_CONFIGURED"
    assert dumped["error_message"] == "some message"
    # model_dump(by_alias=True) returns camelCase
    aliased = resp.model_dump(by_alias=True)
    assert "errorCode" in aliased
    assert "errorMessage" in aliased
    assert "error_code" not in aliased
    assert "error_message" not in aliased


# ── Empty choices edge cases ──────────────────────────────────────────────


@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_returns_invalid_response_when_choices_empty(mock_decrypt, mock_openai_cls):
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = []  # empty choices list
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    result = svc.analyze(make_request(), db=db)
    assert result.ok is False
    assert result.error_code == AiAskErrorCode.INVALID_RESPONSE


@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_returns_invalid_response_when_message_missing(mock_decrypt, mock_openai_cls):
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=None)]  # message is None
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    result = svc.analyze(make_request(), db=db)
    assert result.ok is False
    assert result.error_code == AiAskErrorCode.INVALID_RESPONSE


@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_returns_invalid_response_when_content_empty(mock_decrypt, mock_openai_cls):
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=MagicMock(content=""))]  # empty string content
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    result = svc.analyze(make_request(), db=db)
    assert result.ok is False
    assert result.error_code == AiAskErrorCode.INVALID_RESPONSE


@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_returns_invalid_response_when_content_none(mock_decrypt, mock_openai_cls):
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=MagicMock(content=None))]  # content is None
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    result = svc.analyze(make_request(), db=db)
    assert result.ok is False
    assert result.error_code == AiAskErrorCode.INVALID_RESPONSE
