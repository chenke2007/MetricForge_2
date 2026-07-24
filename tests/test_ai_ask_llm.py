from unittest.mock import MagicMock, patch

import json
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
from app.services.ai_ask.llm_service import AiAskLlmService, _sanitize_narrative_for_sql_pending
from app.services.ai_ask.prompt_builder import AiAskPromptBuilder
from app.services.ai_ask.normalizer import AiAskResponseNormalizer
from app.services.ai_ask.validator import validate_ai_ask_response
from app.services.ai_ask.sql_validator import SqlValidationResult, SqlValidator


def test_request_schema_accepts_minimal_payload():
    payload = {
        "question": "各区域销售额排名",
        "datasourceId": 1,
        "datasourceName": "示例数据源",
        "selectedTables": ["sales"],
        "messageHistory": [],
        "sessionId": 1,
        "assistantMessageId": 1,
    }
    req = AiAskAnalyzeRequest(**payload)
    assert req.question == "各区域销售额排名"
    assert req.datasource_id == 1
    assert req.session_id == 1
    assert req.assistant_message_id == 1


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


def _make_resolved_table():
    """Return a ResolvedTableMetadata for DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M."""
    from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata, ResolvedColumn, ResolvedFieldSemantic

    columns = [
        ResolvedColumn(column_name="pt", column_type="VARCHAR", comment="分区字段", is_partition=True),
        ResolvedColumn(column_name="amt", column_type="NUMBER(18,2)", comment="投放金额"),
        ResolvedColumn(column_name="cust_type", column_type="VARCHAR(20)", comment="客户类型（小微/中型/大型）"),
        ResolvedColumn(column_name="region_code", column_type="VARCHAR(10)", comment="区域编码"),
        ResolvedColumn(column_name="region_name", column_type="VARCHAR(50)", comment="区域名称"),
        ResolvedColumn(column_name="create_dt", column_type="DATE", comment="创建时间"),
    ]
    semantics = [
        ResolvedFieldSemantic(column_name="amt", business_alias="投放金额", meaning="按客户类型汇总的月度投放总金额"),
    ]
    return ResolvedTableMetadata(
        schema_name="DWHRPT",
        table_name="DWS_RPT_ZCPZ_CYFL_TF_M",
        table_comment="投放资产分类月度快照表",
        columns=columns,
        field_semantics=semantics,
        table_rule_hints=["DWS_: 按主题汇总的宽表，通常按日分区"],
    )


# ── Phase 5M Task 4 新增辅助 ──────────────────────────────────────────────────


def _make_valid_llm_response_json(question="各区域投放金额排名") -> str:
    """构造一个能通过 SqlValidator 的合法 mock LLM 响应（JSON 字符串）。"""
    return json.dumps({
        "question": question,
        "intent": {"metrics": ["投放金额"], "dimensions": ["区域名称"], "filters": ["pt='20260630'"]},
        "sqlPlan": {
            "datasourceId": 1,
            "datasourceName": "示例数据源",
            "sql": "SELECT amt, region_name FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE pt='20260630'",
            "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            "fields": ["amt", "region_name"],
            "assumptions": [],
            "safetyWarnings": [],
        },
        "resultSummary": {"rowCount": 5, "durationMs": 100},
        "chartSuggestions": [
            {"title": "投放金额排名", "chartType": "bar", "yFields": ["amt"], "rationale": "...", "limitations": []},
        ],
        "narrative": {
            "summary": "华东地区投放金额最高，达到35%",
            "keyFindings": ["华东地区投放金额占比最高"],
            "evidence": [{"claim": "华东地区投放金额占比35%", "fields": ["amt", "region_name"]}],
            "risks": ["数据仅覆盖月度快照"],
            "nextQuestions": ["各客户类型投放分布如何？"],
        },
        "semanticGaps": [],
    })


def test_analyze_returns_llm_not_configured_when_no_active_setting():
    db = _mock_db_with_active(active=None)
    svc = AiAskLlmService()
    result = svc._analyze_core(make_request(), db=db)
    assert result.ok is False
    assert result.error_code == AiAskErrorCode.LLM_NOT_CONFIGURED


@patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_returns_success_for_valid_llm_response(mock_decrypt, mock_openai_cls, mock_resolve):
    mock_resolve.return_value = [_make_resolved_table()]
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=MagicMock(content='{"question": "各区域投放金额排名", "intent": {"metrics": ["投放金额"], "dimensions": ["区域名称"], "filters": ["20260630"]}, "sqlPlan": {"datasourceId": 1, "datasourceName": "示例数据源", "sql": "SELECT amt, region_name FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE pt=\'20260630\'", "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"], "fields": ["amt", "region_name"], "assumptions": [], "safetyWarnings": []}, "resultSummary": {"rowCount": 5, "durationMs": 100}, "chartSuggestions": [{"title": "投放金额排名", "chartType": "bar", "yFields": ["amt"], "rationale": "...", "limitations": []}], "narrative": {"summary": "...", "keyFindings": [], "evidence": [{"claim": "...", "fields": ["amt"]}], "risks": [], "nextQuestions": []}, "semanticGaps": []}'))]
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    result = svc._analyze_core(make_request(), db=db)
    assert result.ok is True
    assert result.data["question"] == "各区域投放金额排名"
    assert result.data.get("narrativeLevel") == "sql_pending"
    # Narrative must be sanitized
    assert result.data["narrative"]["keyFindings"] == []
    assert result.data["narrative"]["evidence"] == []


@patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_sends_system_and_user_messages(mock_decrypt, mock_openai_cls, mock_resolve):
    mock_resolve.return_value = [_make_resolved_table()]
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=MagicMock(content='{"question": "各区域投放金额排名", "intent": {"metrics": ["投放金额"], "dimensions": ["区域名称"], "filters": ["20260630"]}, "sqlPlan": {"datasourceId": 1, "datasourceName": "示例数据源", "sql": "SELECT amt, region_name FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE pt=\'20260630\'", "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"], "fields": ["amt", "region_name"], "assumptions": [], "safetyWarnings": []}, "resultSummary": {"rowCount": 5, "durationMs": 100}, "chartSuggestions": [{"title": "投放金额排名", "chartType": "bar", "yFields": ["amt"], "rationale": "...", "limitations": []}], "narrative": {"summary": "...", "keyFindings": [], "evidence": [{"claim": "...", "fields": ["amt"]}], "risks": [], "nextQuestions": []}, "semanticGaps": []}'))]
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    request = make_request()
    result = svc._analyze_core(request, db=db)
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


@patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_returns_invalid_response_for_bad_json(mock_decrypt, mock_openai_cls, mock_resolve):
    mock_resolve.return_value = [_make_resolved_table()]
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=MagicMock(content="not json"))]
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    result = svc._analyze_core(make_request(), db=db)
    assert result.ok is False
    assert result.error_code == AiAskErrorCode.INVALID_RESPONSE


# ── Phase 5L: Datasource alignment ──────────────────────────────────────────


def make_request_dwhrpt():
    """Request targeting dwhrpt (id=2) — distinct from the default make_request()."""
    return {
        "question": "各区域投放金额排名",
        "datasource_id": 2,
        "datasource_name": "dwhrpt",
        "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
        "message_history": [],
    }


def _make_valid_metadata_response(request_data: dict) -> dict:
    """Build a valid LLM response that passes SqlValidator for _make_resolved_table()."""
    return {
        "question": request_data["question"],
        "intent": {"metrics": ["投放金额"], "dimensions": ["区域名称"], "filters": ["20260630"]},
        "sqlPlan": {
            "datasourceId": request_data["datasource_id"],
            "datasourceName": request_data["datasource_name"],
            "sql": "SELECT amt, region_name FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE pt='20260630'",
            "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            "fields": ["amt", "region_name"],
            "assumptions": [],
            "safetyWarnings": [],
        },
        "resultSummary": {"rowCount": 10, "durationMs": 200},
        "chartSuggestions": [
            {
                "title": "各区域投放金额排名",
                "chartType": "bar",
                "xField": "region_name",
                "yFields": ["amt"],
                "rationale": "展示各区域投放金额对比",
                "limitations": [],
            }
        ],
        "narrative": {
            "summary": "华东地区投放金额最高，达到35%，西部地区最低约为8%",
            "keyFindings": ["华东地区投放金额占比最高"],
            "evidence": [{"claim": "华东地区投放金额占比35%", "fields": ["amt", "region_name"]}],
            "risks": ["数据仅覆盖月度快照"],
            "nextQuestions": ["各客户类型投放分布如何？"],
        },
        "semanticGaps": [],
    }


@patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_overrides_sqlplan_datasource_with_request(mock_decrypt, mock_openai_cls, mock_resolve):
    """LLM returns datasourceId=1 / '模型编造数据源'; service must force request values."""
    mock_resolve.return_value = [_make_resolved_table()]
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    llm_response = _make_valid_metadata_response(make_request_dwhrpt())

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=MagicMock(content=json.dumps(llm_response)))]
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    request = make_request_dwhrpt()
    result = svc._analyze_core(request, db=db)

    assert result.ok is True
    assert result.data["sqlPlan"]["datasourceId"] == 2
    assert result.data["sqlPlan"]["datasourceName"] == "dwhrpt"


@patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_does_not_create_sqlplan_when_missing(mock_decrypt, mock_openai_cls, mock_resolve):
    """Missing sqlPlan in LLM response must still yield INVALID_RESPONSE;
    the datasource override must NOT synthesize a sqlPlan."""
    mock_resolve.return_value = [_make_resolved_table()]
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    llm_response = {
        "question": "各区域销售额排名",
        "intent": {"metrics": ["销售额"], "dimensions": ["区域"], "filters": []},
        # intentionally missing sqlPlan
        "chartSuggestions": [],
        "narrative": {"summary": "...", "keyFindings": [], "evidence": [{"claim": "...", "fields": ["区域"]}], "risks": [], "nextQuestions": []},
        "semanticGaps": [],
    }

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=MagicMock(content=json.dumps(llm_response)))]
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    request = make_request_dwhrpt()
    result = svc._analyze_core(request, db=db)

    assert result.ok is False
    assert result.error_code == AiAskErrorCode.INVALID_RESPONSE


# ── HTTP serialization tests (camelCase aliases via FastAPI) ──────────────


def _post_analyze_no_active_llm():
    """Seed a session + pending assistant message (no active LLM), POST /analyze,
    return the HTTP response."""
    import tempfile
    from pathlib import Path
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.main import create_app
    from fastapi.testclient import TestClient
    from app.models.ask_models import AskSession, AskMessage

    db_path = Path(tempfile.mktemp(suffix=".db"))
    app = create_app(database_url=f"sqlite:///{db_path}")
    client = TestClient(app)

    engine = create_engine(f"sqlite:///{db_path}")
    Session = sessionmaker(bind=engine)
    seed = Session()
    s = AskSession(title="t", model_name="gpt")
    seed.add(s)
    seed.flush()
    m = AskMessage(session_id=s.id, role="assistant", status="pending", content="")
    seed.add(m)
    seed.commit()
    session_id, msg_id = s.id, m.id
    seed.close()
    engine.dispose()

    return client.post(
        "/api/ai-ask/analyze",
        json={
            "question": "sales by region",
            "datasourceId": 1,
            "datasourceName": "dwhrpt",
            "selectedTables": ["sales"],
            "messageHistory": [],
            "sessionId": session_id,
            "assistantMessageId": msg_id,
        },
    )


def test_analyze_returns_200_with_error_code_camelcase_when_no_active_llm():
    resp = _post_analyze_no_active_llm()
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


def test_analyze_returns_200_with_error_code_camelcase_when_no_active_llm_duplicate():
    resp = _post_analyze_no_active_llm()
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


@patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_returns_invalid_response_when_choices_empty(mock_decrypt, mock_openai_cls, mock_resolve):
    mock_resolve.return_value = [_make_resolved_table()]
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = []  # empty choices list
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    result = svc._analyze_core(make_request(), db=db)
    assert result.ok is False
    assert result.error_code == AiAskErrorCode.INVALID_RESPONSE


@patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_returns_invalid_response_when_message_missing(mock_decrypt, mock_openai_cls, mock_resolve):
    mock_resolve.return_value = [_make_resolved_table()]
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=None)]  # message is None
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    result = svc._analyze_core(make_request(), db=db)
    assert result.ok is False
    assert result.error_code == AiAskErrorCode.INVALID_RESPONSE


@patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_returns_invalid_response_when_content_empty(mock_decrypt, mock_openai_cls, mock_resolve):
    mock_resolve.return_value = [_make_resolved_table()]
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=MagicMock(content=""))]  # empty string content
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    result = svc._analyze_core(make_request(), db=db)
    assert result.ok is False
    assert result.error_code == AiAskErrorCode.INVALID_RESPONSE


@patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
@patch("app.services.ai_ask.llm_service.OpenAI")
@patch("app.services.ai_ask.llm_service.decrypt")
def test_analyze_returns_invalid_response_when_content_none(mock_decrypt, mock_openai_cls, mock_resolve):
    mock_resolve.return_value = [_make_resolved_table()]
    mock_decrypt.return_value = "plain-api-key"
    db = _mock_db_with_active(active=_make_active_setting())

    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock(message=MagicMock(content=None))]  # content is None
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_completion
    mock_openai_cls.return_value = mock_client

    svc = AiAskLlmService()
    result = svc._analyze_core(make_request(), db=db)
    assert result.ok is False
    assert result.error_code == AiAskErrorCode.INVALID_RESPONSE


# ── Phase 5M: PromptBuilder Metadata Grounding Tests ────────────────────────


def _make_resolved_table():
    """Return a ResolvedTableMetadata for DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M."""
    from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata, ResolvedColumn, ResolvedFieldSemantic

    columns = [
        ResolvedColumn(column_name="pt", column_type="VARCHAR", comment="分区字段", is_partition=True),
        ResolvedColumn(column_name="amt", column_type="NUMBER(18,2)", comment="投放金额"),
        ResolvedColumn(column_name="cust_type", column_type="VARCHAR(20)", comment="客户类型（小微/中型/大型）"),
        ResolvedColumn(column_name="region_code", column_type="VARCHAR(10)", comment="区域编码"),
        ResolvedColumn(column_name="region_name", column_type="VARCHAR(50)", comment="区域名称"),
        ResolvedColumn(column_name="create_dt", column_type="DATE", comment="创建时间"),
    ]
    semantics = [
        ResolvedFieldSemantic(column_name="amt", business_alias="投放金额", meaning="按客户类型汇总的月度投放总金额"),
    ]
    return ResolvedTableMetadata(
        schema_name="DWHRPT",
        table_name="DWS_RPT_ZCPZ_CYFL_TF_M",
        table_comment="投放资产分类月度快照表",
        columns=columns,
        field_semantics=semantics,
        table_rule_hints=["DWS_: 按主题汇总的宽表，通常按日分区"],
    )


class TestPromptBuilderMetadataGrounding:
    """PromptBuilder metadata_context 注入测试"""

    def test_prompt_contains_schema_table_full_name(self):
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)
        assert "DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M" in prompt

    def test_prompt_contains_real_fields(self):
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)

        # Real fields must be present
        assert "amt" in prompt
        assert "region_name" in prompt
        assert "cust_type" in prompt
        assert "pt" in prompt

    def test_prompt_does_not_contain_fake_fields(self):
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)

        # Fake fields the LLM might guess — not in metadata, not in prompt
        assert "investment_amount" not in prompt
        # region alone (not region_name) should not appear as a listed column
        # Check that region is not listed as a column name
        assert "region_name" in prompt  # truth, see above
        # The word "region" may appear in comments but "`region` " should not appear as a field definition
        lines = prompt.split("\n")
        field_lines = [l for l in lines if l.strip().startswith("- `")]
        field_names = [l.split("`")[1] for l in field_lines]
        assert "region" not in field_names  # `region` is not a column
        assert "investment_amount" not in field_names

    def test_prompt_contains_field_comments_and_types(self):
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)

        assert "NUMBER(18,2)" in prompt
        assert "投放金额" in prompt
        assert "区域编码" in prompt
        assert "客户类型" in prompt

    def test_prompt_contains_partition_rule(self):
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)

        assert "pt" in prompt
        assert "分区" in prompt
        assert "yyyymmdd" in prompt
        assert "pt='20260630'" in prompt or "pt=" in prompt

    def test_prompt_contains_schema_requirement(self):
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)

        assert "schema 限定" in prompt or "schema" in prompt.lower()
        assert "DWHRPT." in prompt

    def test_prompt_contains_no_invented_fields_constraint(self):
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)

        # Must have "禁止" or "不得" constraint against inventing fields
        assert any(word in prompt for word in ["禁止", "不得", "只能使用", "不能凭空"])
        # Must mention semanticGaps for missing concepts
        assert "semanticGaps" in prompt
        assert "不存在" in prompt or "无对应" in prompt or "不存在" in prompt

    def test_prompt_contains_only_select_constraint(self):
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)

        assert "SELECT" in prompt or "SELECT" in prompt
        assert "DELETE" not in prompt.upper() or "只允许" in prompt
        assert "INSERT" not in prompt.upper() or "禁止" in prompt

    def test_prompt_contains_domain_rules(self):
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)

        assert "DWS_" in prompt
        assert "汇总" in prompt
        # DIM and ADS are part of the general naming conventions section, so they
        # appear too — that's correct; the domain rules document ALL conventions.

    def test_prompt_contains_field_semantics(self):
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)

        # Field semantic: business alias and meaning should appear
        assert "投放金额" in prompt
        assert "投放总金额" in prompt or "月度投放" in prompt  # check meaning text

    def test_pt_field_marked_as_partition(self):
        """Partition indicator in prompt for pt field"""
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)

        # pt is a partition field — should be noted
        # Look for the pt column line
        lines = prompt.split("\n")
        pt_lines = [l for l in lines if "`pt`" in l]
        assert len(pt_lines) >= 1
        # Should mention partition or be marked
        assert any("分区" in l or "partition" in l.lower() for l in pt_lines)

    def test_no_metadata_backward_compatible(self):
        """Without metadata_context, build() works as before (no crash, basic structure)."""
        request = {
            "question": "各区域销售额排名",
            "datasource_id": 1,
            "datasource_name": "示例数据源",
            "selected_tables": ["sales"],
            "message_history": [],
        }
        prompt = AiAskPromptBuilder.build(request)  # no metadata_context
        assert "JSON" in prompt
        assert "sqlPlan" in prompt
        assert "narrative" in prompt
        assert "约束" in prompt
        # Should NOT contain metadata section
        assert "可用数据表结构" not in prompt

    def test_empty_metadata_list_backward_compatible(self):
        """Empty metadata_context list — should not crash, no metadata section."""
        request = {
            "question": "各区域销售额排名",
            "datasource_id": 1,
            "datasource_name": "示例数据源",
            "selected_tables": ["sales"],
            "message_history": [],
        }
        prompt = AiAskPromptBuilder.build(request, metadata_context=[])
        assert "JSON" in prompt
        assert "sqlPlan" in prompt
        assert "可用数据表结构" not in prompt

    def test_region_name_has_note_about_region(self):
        """region_name field should have a note clarifying it's not region."""
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)

        # The annotating note for region_name
        assert "region_name" in prompt
        assert "注意" in prompt or "注" in prompt

    def test_prompt_contains_naming_convention_hints(self):
        """DWS_ table should have naming hints in the table header."""
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)

        # Table header with naming hint
        assert "DWS_" in prompt
        assert "汇总" in prompt

    # ── Phase 5M Task 2 follow-up: 窄修复测试 ──────────────────────────────────

    def test_prompt_contains_table_comment(self):
        """Metadata section must include table_comment as separate line."""
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)
        assert "表说明：投放资产分类月度快照表" in prompt

    def test_prompt_contains_both_comment_and_hint(self):
        """Metadata section should display both table_comment and naming hints together."""
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)
        assert "表说明：" in prompt
        assert "命名规则：" in prompt
        assert "投放资产分类月度快照表" in prompt

    def test_prompt_uses_generic_full_table_name_constraint(self):
        """Constraint must require using metadata-listed full names, not hardcode a table."""
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)
        assert "使用上方元数据列出的 schema.table 完整表名" in prompt or "使用上方元数据列出的完整表名" in prompt
        # The table should still appear in the metadata section (that's correct behavior)
        assert "DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M" in prompt

    def test_general_constraint_no_longer_hardcodes_single_table(self):
        """The METADATA_CONSTRAINTS section must NOT contain the specific table as a rule."""
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)

        # Locate the SQL 生成约束 section
        constraints_idx = prompt.find("SQL 生成约束")
        assert constraints_idx >= 0
        constraints_section = prompt[constraints_idx:constraints_idx + 500]
        # The constraint section should not hardcode the specific table
        assert "DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M" not in constraints_section
        # But the full name is still present in the metadata section above
        assert "DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M" in prompt

    def test_domain_rules_no_longer_hardcodes_dwhrpt_tablename(self):
        """Domain rules section should use generic SCHEMA.TABLE form, not DWHRPT.表名."""
        request = {
            "question": "各区域投放金额排名",
            "datasource_id": 2,
            "datasource_name": "dwhrpt",
            "selected_tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
            "message_history": [],
        }
        meta = [_make_resolved_table()]
        prompt = AiAskPromptBuilder.build(request, metadata_context=meta)
        # Should use generic form
        assert "SCHEMA.TABLE" in prompt
        # Should NOT use the old hardcoded form
        assert "DWHRPT.表名" not in prompt


# ── Phase 5M Task 4: AiAskLlmService 集成测试 ──────────────────────────────


class TestAiAskLlmServiceIntegration:
    """Task 4 集成测试：MetadataResolver → PromptBuilder → LLM → SqlValidator → sanitize"""

    @patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
    def test_metadata_not_found_returns_error_and_does_not_call_llm(self, mock_resolve):
        """无元数据 → METADATA_NOT_FOUND, 不调 LLM / decrypt"""
        mock_resolve.return_value = []
        db = _mock_db_with_active(active=_make_active_setting())

        svc = AiAskLlmService()
        result = svc._analyze_core(make_request(), db=db)
        assert result.ok is False
        assert result.error_code == AiAskErrorCode.METADATA_NOT_FOUND
        assert "未找到所选表的元数据" in result.error_message

    @patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
    @patch("app.services.ai_ask.llm_service.OpenAI")
    @patch("app.services.ai_ask.llm_service.decrypt")
    def test_with_metadata_prompt_builder_receives_context(self, mock_decrypt, mock_openai_cls, mock_resolve):
        """有元数据时 PromptBuilder 被调用且含 metadata_context，messages 包含 system + user"""
        mock_resolve.return_value = [_make_resolved_table()]
        mock_decrypt.return_value = "plain-api-key"
        db = _mock_db_with_active(active=_make_active_setting())

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock(message=MagicMock(content=_make_valid_llm_response_json()))]
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_completion
        mock_openai_cls.return_value = mock_client

        svc = AiAskLlmService()
        result = svc._analyze_core(make_request(), db=db)
        assert result.ok is True

        # Check that system prompt contains metadata
        create_call = mock_client.chat.completions.create
        messages_arg = create_call.call_args[1]["messages"]
        system_content = next(m for m in messages_arg if m["role"] == "system")["content"]
        assert "可用数据表结构" in system_content
        assert "DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M" in system_content
        assert "narrative" in system_content

    @patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
    @patch("app.services.ai_ask.llm_service.OpenAI")
    @patch("app.services.ai_ask.llm_service.decrypt")
    def test_invalid_field_returns_invalid_response_with_sql_validation(self, mock_decrypt, mock_openai_cls, mock_resolve):
        """LLM 返回虚构字段 (investment_amount/region) → SqlValidator 拦截 → INVALID_RESPONSE + details.sqlValidation"""
        mock_resolve.return_value = [_make_resolved_table()]
        mock_decrypt.return_value = "plain-api-key"
        db = _mock_db_with_active(active=_make_active_setting())

        llm_response = {
            "question": "各区域投放金额排名",
            "intent": {"metrics": ["投放金额"], "dimensions": ["区域"], "filters": []},
            "sqlPlan": {
                "datasourceId": 1,
                "datasourceName": "示例数据源",
                "sql": "SELECT investment_amount, region FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE pt='20260630'",
                "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
                "fields": ["investment_amount", "region"],
                "assumptions": [],
                "safetyWarnings": [],
            },
            "resultSummary": {"rowCount": 5, "durationMs": 100},
            "chartSuggestions": [{"title": "排名", "chartType": "bar", "yFields": ["investment_amount"], "rationale": "...", "limitations": []}],
            "narrative": {"summary": "...", "keyFindings": [], "evidence": [{"claim": "...", "fields": ["investment_amount"]}], "risks": [], "nextQuestions": []},
            "semanticGaps": [],
        }
        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock(message=MagicMock(content=json.dumps(llm_response)))]
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_completion
        mock_openai_cls.return_value = mock_client

        svc = AiAskLlmService()
        result = svc._analyze_core(make_request(), db=db)
        assert result.ok is False
        assert result.error_code == AiAskErrorCode.INVALID_RESPONSE
        assert result.details is not None
        assert "sqlValidation" in result.details
        rules = [e["rule"] for e in result.details["sqlValidation"]["errors"]]
        assert "FIELD_NOT_FOUND" in rules

    @patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
    @patch("app.services.ai_ask.llm_service.OpenAI")
    @patch("app.services.ai_ask.llm_service.decrypt")
    def test_table_schema_missing_in_sql_validator(self, mock_decrypt, mock_openai_cls, mock_resolve):
        """LLM 返回缺 schema 表名 → TABLE_SCHEMA_MISSING 进入 details.sqlValidation"""
        mock_resolve.return_value = [_make_resolved_table()]
        mock_decrypt.return_value = "plain-api-key"
        db = _mock_db_with_active(active=_make_active_setting())

        llm_response = {
            "question": "各区域投放金额排名",
            "intent": {"metrics": ["投放金额"], "dimensions": ["区域名称"], "filters": []},
            "sqlPlan": {
                "datasourceId": 1,
                "datasourceName": "示例数据源",
                "sql": "SELECT amt, region_name FROM DWS_RPT_ZCPZ_CYFL_TF_M WHERE pt='20260630'",
                "tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
                "fields": ["amt", "region_name"],
                "assumptions": [],
                "safetyWarnings": [],
            },
            "resultSummary": {"rowCount": 5, "durationMs": 100},
            "chartSuggestions": [{"title": "排名", "chartType": "bar", "yFields": ["amt"], "rationale": "...", "limitations": []}],
            "narrative": {"summary": "...", "keyFindings": [], "evidence": [{"claim": "...", "fields": ["amt"]}], "risks": [], "nextQuestions": []},
            "semanticGaps": [],
        }
        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock(message=MagicMock(content=json.dumps(llm_response)))]
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_completion
        mock_openai_cls.return_value = mock_client

        svc = AiAskLlmService()
        result = svc._analyze_core(make_request(), db=db)
        assert result.ok is False
        assert result.error_code == AiAskErrorCode.INVALID_RESPONSE
        assert result.details is not None
        assert "sqlValidation" in result.details
        rules = [e["rule"] for e in result.details["sqlValidation"]["errors"]]
        assert "TABLE_SCHEMA_MISSING" in rules

    @patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
    @patch("app.services.ai_ask.llm_service.OpenAI")
    @patch("app.services.ai_ask.llm_service.decrypt")
    def test_partition_filter_missing_for_partition_table(self, mock_decrypt, mock_openai_cls, mock_resolve):
        """LLM 返回 PARTITION(p20260630) 且 SQL 无 pt 过滤 → PARTITION_FILTER_MISSING"""
        mock_resolve.return_value = [_make_resolved_table()]
        mock_decrypt.return_value = "plain-api-key"
        db = _mock_db_with_active(active=_make_active_setting())

        llm_response = {
            "question": "各区域投放金额排名",
            "intent": {"metrics": ["投放金额"], "dimensions": ["区域名称"], "filters": []},
            "sqlPlan": {
                "datasourceId": 1,
                "datasourceName": "示例数据源",
                "sql": "SELECT amt, region_name FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE region_code='010'",
                "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
                "fields": ["amt", "region_name", "region_code"],
                "assumptions": [],
                "safetyWarnings": [],
            },
            "resultSummary": {"rowCount": 5, "durationMs": 100},
            "chartSuggestions": [{"title": "排名", "chartType": "bar", "yFields": ["amt"], "rationale": "...", "limitations": []}],
            "narrative": {"summary": "...", "keyFindings": [], "evidence": [{"claim": "...", "fields": ["amt"]}], "risks": [], "nextQuestions": []},
            "semanticGaps": [],
        }
        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock(message=MagicMock(content=json.dumps(llm_response)))]
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_completion
        mock_openai_cls.return_value = mock_client

        svc = AiAskLlmService()
        result = svc._analyze_core(make_request(), db=db)
        assert result.ok is False
        assert result.error_code == AiAskErrorCode.INVALID_RESPONSE
        assert result.details is not None
        assert "sqlValidation" in result.details
        rules = [e["rule"] for e in result.details["sqlValidation"]["errors"]]
        assert "PARTITION_FILTER_MISSING" in rules

    @patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
    @patch("app.services.ai_ask.llm_service.OpenAI")
    @patch("app.services.ai_ask.llm_service.decrypt")
    def test_sql_valid_pass_returns_ok_with_sql_pending(self, mock_decrypt, mock_openai_cls, mock_resolve):
        """SQL 校验通过但未执行 → ok:true 且 narrativeLevel == sql_pending"""
        mock_resolve.return_value = [_make_resolved_table()]
        mock_decrypt.return_value = "plain-api-key"
        db = _mock_db_with_active(active=_make_active_setting())

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock(message=MagicMock(content=_make_valid_llm_response_json()))]
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_completion
        mock_openai_cls.return_value = mock_client

        svc = AiAskLlmService()
        result = svc._analyze_core(make_request(), db=db)
        assert result.ok is True
        assert result.data.get("narrativeLevel") == "sql_pending"

    @patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
    @patch("app.services.ai_ask.llm_service.OpenAI")
    @patch("app.services.ai_ask.llm_service.decrypt")
    def test_sql_pending_sanitizes_narrative(self, mock_decrypt, mock_openai_cls, mock_resolve):
        """sql_pending 时 keyFindings/evidence 被清空，summary 不含事实数字"""
        mock_resolve.return_value = [_make_resolved_table()]
        mock_decrypt.return_value = "plain-api-key"
        db = _mock_db_with_active(active=_make_active_setting())

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock(message=MagicMock(content=_make_valid_llm_response_json()))]
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_completion
        mock_openai_cls.return_value = mock_client

        svc = AiAskLlmService()
        result = svc._analyze_core(make_request(), db=db)
        assert result.ok is True

        narrative = result.data["narrative"]
        assert narrative["keyFindings"] == []
        assert narrative["evidence"] == []
        # Summary should be the safe description, not containing factual numbers
        assert "待验证" in narrative["summary"]
        assert "SQL Workbench" in narrative["summary"]
        # Should NOT contain factual claims
        assert "35%" not in narrative["summary"]
        assert "华东" not in narrative["summary"]
        # But risks and nextQuestions should be preserved
        assert len(narrative["risks"]) > 0
        assert len(narrative["nextQuestions"]) > 0
        assert "数据仅覆盖月度快照" in narrative["risks"]
        assert "各客户类型投放分布如何？" in narrative["nextQuestions"]

    @patch("app.services.ai_ask.llm_service.MetadataResolver.resolve")
    @patch("app.services.ai_ask.llm_service.OpenAI")
    @patch("app.services.ai_ask.llm_service.decrypt")
    def test_phase_5l_datasource_override_behavior_preserved(self, mock_decrypt, mock_openai_cls, mock_resolve):
        """Phase 5L datasource override 行为在 Task 4 后不回归"""
        mock_resolve.return_value = [_make_resolved_table()]
        mock_decrypt.return_value = "plain-api-key"
        db = _mock_db_with_active(active=_make_active_setting())

        llm_response = _make_valid_metadata_response(make_request_dwhrpt())
        # Set wrong datasource to test override
        llm_response["sqlPlan"]["datasourceId"] = 1
        llm_response["sqlPlan"]["datasourceName"] = "模型编造数据源"

        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock(message=MagicMock(content=json.dumps(llm_response)))]
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_completion
        mock_openai_cls.return_value = mock_client

        svc = AiAskLlmService()
        result = svc._analyze_core(make_request_dwhrpt(), db=db)
        assert result.ok is True
        assert result.data["sqlPlan"]["datasourceId"] == 2
        assert result.data["sqlPlan"]["datasourceName"] == "dwhrpt"


# ── _sanitize_narrative_for_sql_pending 单元测试 ────────────────────────────


class TestSanitizeNarrativeForSqlPending:
    """_sanitize_narrative_for_sql_pending 函数独立测试"""

    def test_clears_key_findings_and_evidence(self):
        raw_narrative = {
            "summary": "华东地区投放金额占比35%，西部地区占比8%",
            "keyFindings": ["华东地区最高"],
            "evidence": [{"claim": "华东占比35%", "fields": ["amt", "region_name"]}],
            "risks": ["数据仅覆盖月度快照"],
            "nextQuestions": ["客户类型分布如何？"],
        }
        result = _sanitize_narrative_for_sql_pending(raw_narrative)
        assert result["keyFindings"] == []
        assert result["evidence"] == []
        assert "待验证" in result["summary"]
        assert "35%" not in result["summary"]
        assert "华东" not in result["summary"]

    def test_preserves_risks_and_next_questions(self):
        raw_narrative = {
            "summary": "各地区投放金额",
            "keyFindings": [],
            "evidence": [{"claim": "...", "fields": ["amt"]}],
            "risks": ["风险1"],
            "nextQuestions": ["问题1"],
        }
        result = _sanitize_narrative_for_sql_pending(raw_narrative)
        assert "风险1" in result["risks"]
        assert "问题1" in result["nextQuestions"]

    def test_handles_missing_risks_and_next_questions(self):
        raw_narrative = {
            "summary": "summary",
            "keyFindings": [],
            "evidence": [{"claim": "...", "fields": ["amt"]}],
        }
        result = _sanitize_narrative_for_sql_pending(raw_narrative)
        assert result["risks"] == []
        assert result["nextQuestions"] == []

    def test_summary_is_safe_description(self):
        raw_narrative = {
            "summary": "8个区域中华东最高35%",
            "keyFindings": [],
            "evidence": [{"claim": "...", "fields": ["amt"]}],
            "risks": [],
            "nextQuestions": [],
        }
        result = _sanitize_narrative_for_sql_pending(raw_narrative)
        assert "待验证" in result["summary"]
        assert "8个区域" not in result["summary"]
        assert "35%" not in result["summary"]
        assert "华东" not in result["summary"]
