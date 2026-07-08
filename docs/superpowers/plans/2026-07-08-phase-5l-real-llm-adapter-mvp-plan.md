# Phase 5L 真实 LLM Adapter MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不新增 DB/migration 的前提下，新增后端结构化 AI 问数 API `/api/ai-ask/analyze` 和前端 `RealLlmAdapter`，使 AI 问数可在显式开关下调用真实 LLM，默认路径仍为 `MockAdapter`。

**Architecture:** 后端复用 `llm_settings` 与 `key_encryption`，新增独立的 `AiAskLlmService` + Pydantic schema + PromptBuilder/Normalizer/Validator；前端新增 `RealLlmAdapter implements AiAskAdapter` 调用后端接口，并在 `AskWorkbenchPage` 集成显式开关。

**Tech Stack:** Python 3.12 / FastAPI / Pydantic / OpenAI Python SDK / SQLAlchemy / Fernet；TypeScript / React / Zustand / Vitest / TanStack Query / Ant Design。

## Global Constraints

- 核心仍是 AI 问数，不漂移成普通 SQL 工具、通用聊天工具或报告系统。
- SQL Workbench 仍是下游验证/调试工具，不是主入口。
- 不新增 DB 表 / migration / schema 变更。
- 前端不读取真实 API Key；API Key 仅在后端解密。
- 自动化测试不调用真实 LLM；所有 LLM 调用必须 mock。
- 不引入 Playwright / Cypress。
- 不测试 Monaco DOM。
- 不处理历史 untracked docs / .venv / .superpowers/review-packages。
- 每个 task 完成后停下等待 reviewer。

---

## File Structure

### 后端新增/修改

| 文件 | 责任 |
|------|------|
| `app/schemas/ai_ask.py` | `/api/ai-ask/analyze` 请求/响应 Pydantic schema、错误响应协议 |
| `app/services/ai_ask/prompt_builder.py` | 构造面向 `AiAskResponse` 的 system/user prompt |
| `app/services/ai_ask/normalizer.py` | 将 LLM 原始输出规范化为 `AiAskResponse` 形状 |
| `app/services/ai_ask/validator.py` | 后端 `validate_ai_ask_response()`，覆盖 MVP 必填字段校验 |
| `app/services/ai_ask/llm_service.py` | `AiAskLlmService`：读取 active LlmSetting、解密 key、调用 LLM、编排 parse/normalize/validate |
| `app/api/ai_ask.py` | FastAPI router：`POST /api/ai-ask/analyze`，业务错误统一 HTTP 200 + ok:false |
| `app/main.py` | 注册 `/api/ai-ask` router |
| `tests/test_ai_ask_llm.py` | 后端单元测试：mock OpenAI client、覆盖错误码与校验分支 |

### 前端新增/修改

| 文件 | 责任 |
|------|------|
| `frontend/src/api/aiAsk/realLlmAdapter.ts` | `RealLlmAdapter implements AiAskAdapter` |
| `frontend/src/api/aiAsk/realLlmAdapter.test.ts` | 前端 RealLlmAdapter 单元测试 |
| `frontend/src/api/aiAsk/index.ts` | 修改 `useAiAskService()` 支持 `useRealLlm` 开关 |
| `frontend/src/api/client.ts` | 如需，新增 `/api/ai-ask/analyze` 调用辅助 |
| `frontend/src/pages/AskWorkbenchPage.tsx` | 集成真实 LLM 显式开关、错误展示、手动切回模拟模式 |
| `frontend/src/pages/AskWorkbenchPage.test.tsx` | 如需，补充开关相关测试 |

---

## Task 1：后端类型与错误协议

**Files:**
- Create: `app/schemas/ai_ask.py`
- Modify: `app/api/ai_ask.py`（创建 router 骨架）
- Test: `tests/test_ai_ask_llm.py`（schema/错误协议测试）

**Interfaces:**
- Produces: `AiAskAnalyzeRequest`, `AiAskAnalyzeSuccessResponse`, `AiAskAnalyzeErrorResponse`, `AiAskErrorCode`（Pydantic models）
- Produces: `router` with `POST /api/ai-ask/analyze` returning `Union[AiAskAnalyzeSuccessResponse, AiAskAnalyzeErrorResponse]`

- [ ] **Step 1: Write failing schema tests**

```python
# tests/test_ai_ask_llm.py
import pytest
from app.schemas.ai_ask import (
    AiAskAnalyzeRequest,
    AiAskAnalyzeSuccessResponse,
    AiAskAnalyzeErrorResponse,
    AiAskErrorCode,
)


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
python -m pytest tests/test_ai_ask_llm.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.schemas.ai_ask'`

- [ ] **Step 3: Implement Pydantic schemas**

```python
# app/schemas/ai_ask.py
from enum import Enum
from typing import Any, Literal
from pydantic import BaseModel, Field


class AiAskErrorCode(str, Enum):
    LLM_NOT_CONFIGURED = "LLM_NOT_CONFIGURED"
    INVALID_RESPONSE = "INVALID_RESPONSE"
    ANALYSIS_TIMEOUT = "ANALYSIS_TIMEOUT"
    LLM_AUTH_ERROR = "LLM_AUTH_ERROR"
    LLM_CONNECTION_ERROR = "LLM_CONNECTION_ERROR"
    LLM_RATE_LIMIT = "LLM_RATE_LIMIT"
    UNKNOWN = "UNKNOWN"


class AiAskAnalyzeRequest(BaseModel):
    question: str
    datasource_id: int = Field(..., alias="datasourceId")
    datasource_name: str = Field(..., alias="datasourceName")
    selected_tables: list[str] = Field(default_factory=list, alias="selectedTables")
    message_history: list[dict[str, Any]] = Field(default_factory=list, alias="messageHistory")

    model_config = {"populate_by_name": True}


class AiAskAnalyzeSuccessResponse(BaseModel):
    ok: Literal[True] = True
    data: dict[str, Any]


class AiAskAnalyzeErrorResponse(BaseModel):
    ok: Literal[False] = False
    error_code: str
    error_message: str
    details: dict[str, Any] | None = None
```

- [ ] **Step 4: Add router skeleton returning LLM_NOT_CONFIGURED**

```python
# app/api/ai_ask.py
from fastapi import APIRouter
from ..schemas.ai_ask import (
    AiAskAnalyzeRequest,
    AiAskAnalyzeSuccessResponse,
    AiAskAnalyzeErrorResponse,
    AiAskErrorCode,
)

router = APIRouter()


@router.post("/analyze")
def analyze(body: AiAskAnalyzeRequest) -> AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse:
    return AiAskAnalyzeErrorResponse(
        error_code=AiAskErrorCode.LLM_NOT_CONFIGURED,
        error_message="没有已启用的 LLM 配置，请先在 LLM 连接管理中启用一个模型",
    )
```

- [ ] **Step 5: Register router in app/main.py**

Add near existing ask_router import:

```python
from .api.ai_ask import router as ai_ask_router
```

Add near existing `app.include_router(ask_router, ...)`:

```python
app.include_router(ai_ask_router, prefix="/api/ai-ask", tags=["AI 问数结构化分析"])
```

- [ ] **Step 6: Run schema tests**

Run:
```bash
python -m pytest tests/test_ai_ask_llm.py -v
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add app/schemas/ai_ask.py app/api/ai_ask.py app/main.py tests/test_ai_ask_llm.py
git commit -m "feat(phase-5l): add ai-ask analyze schema and error protocol

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：后端 PromptBuilder / Normalizer / Validator

**Files:**
- Create: `app/services/ai_ask/__init__.py`
- Create: `app/services/ai_ask/prompt_builder.py`
- Create: `app/services/ai_ask/normalizer.py`
- Create: `app/services/ai_ask/validator.py`
- Test: `tests/test_ai_ask_llm.py`（新增测试）

**Interfaces:**
- Consumes: `AiAskAnalyzeRequest` dict
- Produces: `AiAskPromptBuilder.build(request) -> str`
- Produces: `AiAskResponseNormalizer.normalize(raw: dict) -> dict`
- Produces: `validate_ai_ask_response(response: dict) -> {"valid": bool, "errors": list[dict], "warnings": list[str]}`

- [ ] **Step 1: Write failing tests for PromptBuilder**

```python
# tests/test_ai_ask_llm.py
from app.services.ai_ask.prompt_builder import AiAskPromptBuilder


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
```

- [ ] **Step 2: Create Python package init file**

```bash
touch app/services/ai_ask/__init__.py
```

- [ ] **Step 4: Implement PromptBuilder**

```python
# app/services/ai_ask/prompt_builder.py
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
```

- [ ] **Step 4: Write failing tests for Normalizer**

```python
# tests/test_ai_ask_llm.py
from app.services.ai_ask.normalizer import AiAskResponseNormalizer


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
    assert normalized["chartSuggestions"][0]["chartType"] == "bar"  # invalid 'scatter' -> bar


def test_normalizer_does_not_fill_required_top_level_fields():
    raw = {"intent": {"metrics": ["m"]}}
    normalized = AiAskResponseNormalizer.normalize(raw)
    assert "question" not in normalized
    assert "sqlPlan" not in normalized
```

- [ ] **Step 5: Implement Normalizer**

```python
# app/services/ai_ask/normalizer.py
VALID_CHART_TYPES = {"bar", "line", "pie", "table", "metric-card", "combo"}


class AiAskResponseNormalizer:
    @staticmethod
    def normalize(raw: dict) -> dict:
        if not isinstance(raw, dict):
            return raw

        normalized = dict(raw)

        # Fill optional/warning-level arrays only
        if isinstance(normalized.get("sqlPlan"), dict):
            plan = normalized["sqlPlan"]
            plan.setdefault("assumptions", [])
            plan.setdefault("safetyWarnings", [])

        if isinstance(normalized.get("narrative"), dict):
            narrative = normalized["narrative"]
            narrative.setdefault("keyFindings", [])
            narrative.setdefault("risks", [])
            narrative.setdefault("nextQuestions", [])

        # Fix invalid chartType
        if isinstance(normalized.get("chartSuggestions"), list):
            for spec in normalized["chartSuggestions"]:
                if isinstance(spec, dict) and spec.get("chartType") not in VALID_CHART_TYPES:
                    spec["chartType"] = "bar"

        # Convert numeric strings to numbers in resultSummary
        if isinstance(normalized.get("resultSummary"), dict):
            rs = normalized["resultSummary"]
            for key in ("rowCount", "durationMs"):
                if isinstance(rs.get(key), str):
                    try:
                        rs[key] = int(rs[key])
                    except ValueError:
                        pass

        return normalized
```

- [ ] **Step 6: Write failing tests for Validator**

```python
# tests/test_ai_ask_llm.py
from app.services.ai_ask.validator import validate_ai_ask_response


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
```

- [ ] **Step 7: Implement Validator**

```python
# app/services/ai_ask/validator.py
from typing import Any


def _is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _is_string_array(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(x, str) for x in value)


def validate_ai_ask_response(response: dict) -> dict:
    errors = []
    warnings = []

    if not isinstance(response, dict):
        errors.append({"path": "", "message": "response 必须为对象"})
        return {"valid": False, "errors": errors, "warnings": warnings}

    # Required top-level fields
    for field in ("question", "intent", "sqlPlan", "narrative", "chartSuggestions", "semanticGaps"):
        if field not in response:
            errors.append({"path": field, "message": f"{field} 缺失"})

    if errors:
        return {"valid": False, "errors": errors, "warnings": warnings}

    # question
    if not _is_non_empty_string(response.get("question")):
        errors.append({"path": "question", "message": "question 不能为空"})

    # intent
    intent = response.get("intent", {})
    if not isinstance(intent, dict):
        errors.append({"path": "intent", "message": "intent 必须为对象"})
    else:
        for key in ("metrics", "dimensions", "filters"):
            if not _is_string_array(intent.get(key)):
                errors.append({"path": f"intent.{key}", "message": f"intent.{key} 必须为 string 数组"})

    # sqlPlan
    plan = response.get("sqlPlan", {})
    if not isinstance(plan, dict):
        errors.append({"path": "sqlPlan", "message": "sqlPlan 必须为对象"})
    else:
        if not isinstance(plan.get("datasourceId"), int):
            errors.append({"path": "sqlPlan.datasourceId", "message": "datasourceId 必须为整数"})
        if not _is_non_empty_string(plan.get("datasourceName")):
            errors.append({"path": "sqlPlan.datasourceName", "message": "datasourceName 不能为空"})
        if not _is_non_empty_string(plan.get("sql")):
            errors.append({"path": "sqlPlan.sql", "message": "sql 不能为空"})
        for key in ("tables", "fields", "assumptions", "safetyWarnings"):
            if not _is_string_array(plan.get(key)):
                errors.append({"path": f"sqlPlan.{key}", "message": f"sqlPlan.{key} 必须为 string 数组"})

    # narrative
    narrative = response.get("narrative", {})
    if not isinstance(narrative, dict):
        errors.append({"path": "narrative", "message": "narrative 必须为对象"})
    else:
        if not _is_non_empty_string(narrative.get("summary")):
            errors.append({"path": "narrative.summary", "message": "narrative.summary 不能为空"})
        if not isinstance(narrative.get("keyFindings"), list):
            errors.append({"path": "narrative.keyFindings", "message": "keyFindings 必须为数组"})
        evidence = narrative.get("evidence")
        if not isinstance(evidence, list) or len(evidence) == 0:
            errors.append({"path": "narrative.evidence", "message": "narrative.evidence 必须为非空数组"})
        else:
            for i, item in enumerate(evidence):
                if not isinstance(item, dict):
                    errors.append({"path": f"narrative.evidence[{i}]", "message": "evidence 项必须为对象"})
                    continue
                if not _is_non_empty_string(item.get("claim")):
                    errors.append({"path": f"narrative.evidence[{i}].claim", "message": "claim 不能为空"})
                if not _is_string_array(item.get("fields")) or len(item.get("fields", [])) == 0:
                    errors.append({"path": f"narrative.evidence[{i}].fields", "message": "fields 必须为非空 string 数组"})
        if not isinstance(narrative.get("risks"), list):
            errors.append({"path": "narrative.risks", "message": "risks 必须为数组"})
        if not isinstance(narrative.get("nextQuestions"), list):
            errors.append({"path": "narrative.nextQuestions", "message": "nextQuestions 必须为数组"})

    # chartSuggestions
    suggestions = response.get("chartSuggestions")
    if not isinstance(suggestions, list) or len(suggestions) == 0:
        errors.append({"path": "chartSuggestions", "message": "chartSuggestions 必须为非空数组"})
    else:
        for i, spec in enumerate(suggestions):
            if not isinstance(spec, dict):
                errors.append({"path": f"chartSuggestions[{i}]", "message": "chartSuggestion 项必须为对象"})
                continue
            if not _is_non_empty_string(spec.get("title")):
                errors.append({"path": f"chartSuggestions[{i}].title", "message": "title 不能为空"})
            if not _is_string_array(spec.get("yFields")):
                errors.append({"path": f"chartSuggestions[{i}].yFields", "message": "yFields 必须为 string 数组"})

    # semanticGaps
    gaps = response.get("semanticGaps")
    if not isinstance(gaps, list):
        errors.append({"path": "semanticGaps", "message": "semanticGaps 必须为数组"})

    return {"valid": len(errors) == 0, "errors": errors, "warnings": warnings}
```

- [ ] **Step 8: Run tests**

Run:
```bash
python -m pytest tests/test_ai_ask_llm.py -v
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add app/services/ai_ask/ tests/test_ai_ask_llm.py
git commit -m "feat(phase-5l): add ai-ask prompt builder, normalizer and validator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：后端 AiAskLlmService + API route

**Files:**
- Create: `app/services/ai_ask/__init__.py`（若 Task 2 未创建）
- Create: `app/services/ai_ask/llm_service.py`
- Modify: `app/api/ai_ask.py`
- Test: `tests/test_ai_ask_llm.py`（新增测试）

**Interfaces:**
- Consumes: `AiAskAnalyzeRequest` dict, active `LlmSetting` model queried directly from DB
- Produces: `AiAskLlmService.analyze(request) -> AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse`

- [ ] **Step 1: Write failing tests for AiAskLlmService with mocked OpenAI client**

```python
# tests/test_ai_ask_llm.py
from unittest.mock import MagicMock, patch
from app.services.ai_ask.llm_service import AiAskLlmService
from app.schemas.ai_ask import AiAskErrorCode


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
```

- [ ] **Step 2: Implement AiAskLlmService**

```python
# app/services/ai_ask/llm_service.py
import json
import logging
from openai import OpenAI

from ..models import LlmSetting
from ..key_encryption import decrypt
from .prompt_builder import AiAskPromptBuilder
from .normalizer import AiAskResponseNormalizer
from .validator import validate_ai_ask_response
from ...schemas.ai_ask import (
    AiAskAnalyzeSuccessResponse,
    AiAskAnalyzeErrorResponse,
    AiAskErrorCode,
)

logger = logging.getLogger(__name__)


class AiAskLlmService:
    def analyze(self, request: dict, db) -> AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse:
        active = db.query(LlmSetting).filter(LlmSetting.is_active == 1).first()
        if not active:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.LLM_NOT_CONFIGURED,
                error_message="没有已启用的 LLM 配置，请先在 LLM 连接管理中启用一个模型",
            )

        api_key = decrypt(active.api_key)
        client = OpenAI(base_url=f"{active.base_url}/v1", api_key=api_key, timeout=60)

        prompt = AiAskPromptBuilder.build(request)
        messages = [
            {"role": "system", "content": prompt},
        ]

        try:
            completion = client.chat.completions.create(
                model=active.model_name,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.2,
            )
        except Exception as e:
            logger.exception("LLM 调用失败")
            return self._map_exception(e)

        raw_content = completion.choices[0].message.content or ""
        try:
            parsed = json.loads(raw_content)
        except json.JSONDecodeError:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.INVALID_RESPONSE,
                error_message="模型返回的不是合法 JSON",
                details={"raw": raw_content[:500]},
            )

        normalized = AiAskResponseNormalizer.normalize(parsed)
        validation = validate_ai_ask_response(normalized)
        if not validation["valid"]:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.INVALID_RESPONSE,
                error_message="模型返回的结构化响应未通过校验",
                details={"errors": validation["errors"], "warnings": validation["warnings"]},
            )

        return AiAskAnalyzeSuccessResponse(data=normalized)

    def _map_exception(self, e: Exception) -> AiAskAnalyzeErrorResponse:
        msg = str(e).lower()
        if "timeout" in msg:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.ANALYSIS_TIMEOUT,
                error_message="LLM 响应超时，请稍后重试",
            )
        if "401" in msg or "403" in msg or "auth" in msg or "unauthorized" in msg:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.LLM_AUTH_ERROR,
                error_message="LLM 认证失败，请检查 API Key",
            )
        if "connect" in msg or "connection" in msg or "refused" in msg or "dns" in msg:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.LLM_CONNECTION_ERROR,
                error_message="无法连接到 LLM 服务，请检查 Base URL",
            )
        if "rate" in msg or "quota" in msg or "429" in msg:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.LLM_RATE_LIMIT,
                error_message="LLM 请求频率过高，请稍后重试",
            )
        return AiAskAnalyzeErrorResponse(
            error_code=AiAskErrorCode.UNKNOWN,
            error_message=f"LLM 调用失败（{type(e).__name__}）",
        )
```

- [ ] **Step 3: Update API route to use AiAskLlmService**

```python
# app/api/ai_ask.py
from fastapi import APIRouter, Depends
from ..models.base import get_session as get_db_session
from ..schemas.ai_ask import (
    AiAskAnalyzeRequest,
    AiAskAnalyzeSuccessResponse,
    AiAskAnalyzeErrorResponse,
)
from ..services.ai_ask.llm_service import AiAskLlmService

router = APIRouter()
service = AiAskLlmService()


def get_db():
    db = get_db_session()
    try:
        yield db
    finally:
        db.close()


@router.post("/analyze")
def analyze(
    body: AiAskAnalyzeRequest, db=Depends(get_db)
) -> AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse:
    return service.analyze(body.model_dump(), db)
```

- [ ] **Step 4: Run tests**

Run:
```bash
python -m pytest tests/test_ai_ask_llm.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/ai_ask/llm_service.py app/api/ai_ask.py tests/test_ai_ask_llm.py
git commit -m "feat(phase-5l): add AiAskLlmService and structured analyze endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：前端 RealLlmAdapter + API client

**Files:**
- Create: `frontend/src/api/aiAsk/realLlmAdapter.ts`
- Create: `frontend/src/api/aiAsk/realLlmAdapter.test.ts`
- Modify: `frontend/src/api/aiAsk/index.ts`
- Modify: `frontend/src/api/client.ts`（如需）

**Interfaces:**
- Consumes: `AiAskContext`, `AiAskResponse`, `AiChartSpec`
- Produces: `RealLlmAdapter implements AiAskAdapter`

- [ ] **Step 1: Write failing RealLlmAdapter tests**

```typescript
// frontend/src/api/aiAsk/realLlmAdapter.test.ts
import { describe, it, expect, vi } from 'vitest'
import { RealLlmAdapter } from './realLlmAdapter'
import { AiAskError } from './errors'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('RealLlmAdapter', () => {
  it('calls /api/ai-ask/analyze and returns valid response', async () => {
    const response = {
      ok: true,
      data: {
        question: 'q',
        intent: { metrics: ['m'], dimensions: ['d'], filters: [] },
        sqlPlan: {
          datasourceId: 1,
          datasourceName: '示例数据源',
          sql: 'SELECT * FROM t',
          tables: ['t'],
          fields: ['f'],
          assumptions: [],
          safetyWarnings: [],
        },
        chartSuggestions: [{ title: 't', chartType: 'bar', yFields: ['f'], rationale: '', limitations: [] }],
        narrative: { summary: 's', keyFindings: [], evidence: [{ claim: 'c', fields: ['f'] }], risks: [], nextQuestions: [] },
        semanticGaps: [],
      },
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => response,
    })

    const adapter = RealLlmAdapter.create()
    const result = await adapter.analyze('q', {
      datasourceId: 1,
      datasourceName: '示例数据源',
      selectedTables: ['t'],
    })

    expect(result.question).toBe('q')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/ai-ask/analyze'),
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws INVALID_RESPONSE when backend returns invalid data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: { question: 'q' }, // missing required fields
      }),
    })

    const adapter = RealLlmAdapter.create()
    await expect(
      adapter.analyze('q', { datasourceId: 1, datasourceName: '示例数据源', selectedTables: [] })
    ).rejects.toThrow(AiAskError)
  })

  it('returns isEmpty chart data with explanatory error', () => {
    const adapter = RealLlmAdapter.create()
    const result = adapter.getChartData({} as any, {} as any)
    expect(result.isEmpty).toBe(true)
    expect(result.error).toContain('真实 LLM MVP 暂不返回图表数据')
  })
})
```

- [ ] **Step 2: Implement RealLlmAdapter**

```typescript
// frontend/src/api/aiAsk/realLlmAdapter.ts
import type { AiAskAdapter, AiAskContext, ChartDataResult } from './adapter'
import type { AiAskResponse, AiChartSpec } from '../../types/aiAsk'
import { AiAskError } from './errors'
import { validateAiAskResponse } from './validator'

export class RealLlmAdapter implements AiAskAdapter {
  readonly name = 'RealLlmAdapter'

  static create(): RealLlmAdapter {
    return new RealLlmAdapter()
  }

  async analyze(question: string, context: AiAskContext): Promise<AiAskResponse> {
    const payload = {
      question,
      datasourceId: context.datasourceId,
      datasourceName: context.datasourceName,
      selectedTables: context.selectedTables,
      messageHistory: context.messageHistory ?? [],
    }

    let resp: Response
    try {
      resp = await fetch('/api/ai-ask/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch (networkErr) {
      throw new AiAskError(
        '无法连接到 AI 问数服务，请检查网络',
        'LLM_CONNECTION_ERROR',
        { originalError: String(networkErr) }
      )
    }

    let body: any
    try {
      body = await resp.json()
    } catch (parseErr) {
      throw new AiAskError(
        'AI 问数服务返回了无法解析的响应',
        'INVALID_RESPONSE',
        { status: resp.status, text: await resp.text().catch(() => '') }
      )
    }

    if (!resp.ok || !body || typeof body !== 'object') {
      throw new AiAskError(
        body?.errorMessage || `AI 问数服务错误（HTTP ${resp.status}）`,
        body?.errorCode || 'UNKNOWN',
        body?.details ?? {}
      )
    }

    if (!body.ok) {
      throw new AiAskError(
        body.errorMessage || 'LLM 分析失败',
        body.errorCode || 'UNKNOWN',
        body.details ?? {}
      )
    }

    const validation = validateAiAskResponse(body.data)
    if (!validation.valid) {
      throw new AiAskError('模型响应未通过前端二次校验', 'INVALID_RESPONSE', {
        errors: validation.errors,
      })
    }

    return body.data as AiAskResponse
  }

  getChartData(_spec: AiChartSpec, _response: AiAskResponse): ChartDataResult {
    return {
      columns: [],
      rows: [],
      isEmpty: true,
      error: '真实 LLM MVP 暂不返回图表数据，请在 SQL Workbench 验证 SQL 后查看结果',
    }
  }

  isAvailable(): boolean {
    return true
  }
}
```

- [ ] **Step 3: Update useAiAskService**

```typescript
// frontend/src/api/aiAsk/index.ts
import { RealLlmAdapter } from './realLlmAdapter'

export function useAiAskService(options?: { useRealLlm?: boolean }) {
  const useReal = options?.useRealLlm ?? false
  const adapter = useReal ? RealLlmAdapter.create() : MockAdapter.create()
  return {
    analyze: adapter.analyze.bind(adapter),
    getChartData: adapter.getChartData.bind(adapter),
    isAvailable: adapter.isAvailable.bind(adapter),
    name: adapter.name,
    validate: validateAiAskResponse,
  }
}
```

- [ ] **Step 4: Run frontend tests**

Run:
```bash
cd frontend && npx vitest run src/api/aiAsk/realLlmAdapter.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/aiAsk/realLlmAdapter.ts frontend/src/api/aiAsk/realLlmAdapter.test.ts frontend/src/api/aiAsk/index.ts
git commit -m "feat(phase-5l): add RealLlmAdapter and wire useAiAskService

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：AskWorkbenchPage 显式开关集成

**Files:**
- Modify: `frontend/src/pages/AskWorkbenchPage.tsx`
- Modify: `frontend/src/pages/AskWorkbenchPage.test.tsx`
- Modify: `frontend/src/stores/aiAskStore.ts`

**Interfaces:**
- Consumes: `useAiAskService({ useRealLlm })`
- Consumes: `useLlmSettings()` query to detect active LLM setting

- [ ] **Step 1: Write failing tests for real LLM toggle in AskWorkbenchPage**

```typescript
// frontend/src/pages/AskWorkbenchPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import AskWorkbenchPage from './AskWorkbenchPage'
import { useAiAskStore } from '../stores/aiAskStore'

// Mock useLlmSettings to avoid real backend calls
vi.mock('../api/llmSettings', () => ({
  useLlmSettings: () => ({ data: undefined, isLoading: false }),
}))

// Mock other dependencies as needed (useAskMessages, useCreateSession, etc.)

function renderPage() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AskWorkbenchPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useAiAskStore.getState().reset()
})

describe('Real LLM toggle', () => {
  it('defaults to MockAdapter and real LLM toggle is off', () => {
    renderPage()
    const toggle = screen.getByRole('switch')
    expect(toggle).not.toBeChecked()
    expect(useAiAskStore.getState().useRealLlm).toBe(false)
  })

  it('disables real LLM toggle and shows hint when no active LLM setting exists', () => {
    vi.mocked(useLlmSettings).mockReturnValue({ data: [], isLoading: false } as any)
    renderPage()
    const toggle = screen.getByRole('switch')
    expect(toggle).toBeDisabled()
    expect(screen.getByText(/请先在 LLM 连接管理中启用模型/)).toBeInTheDocument()
  })

  it('allows enabling real LLM when active setting exists', () => {
    vi.mocked(useLlmSettings).mockReturnValue({
      data: [{ id: 1, name: 'openai', is_active: true, base_url: '', api_key_masked: '***', model_name: 'gpt-4o-mini', last_tested_at: null, last_tested_ok: null, created_at: '', updated_at: '' }],
      isLoading: false,
    } as any)
    renderPage()
    const toggle = screen.getByRole('switch')
    expect(toggle).not.toBeDisabled()
    fireEvent.click(toggle)
    expect(useAiAskStore.getState().useRealLlm).toBe(true)
  })

  it('shows manual fallback button on LLM errors without auto fallback', async () => {
    vi.mocked(useLlmSettings).mockReturnValue({
      data: [{ id: 1, name: 'openai', is_active: true, base_url: '', api_key_masked: '***', model_name: 'gpt-4o-mini', last_tested_at: null, last_tested_ok: null, created_at: '', updated_at: '' }],
      isLoading: false,
    } as any)
    useAiAskStore.setState({ useRealLlm: true })
    useAiAskStore.setState({
      error: { code: 'LLM_CONNECTION_ERROR', message: '连接失败' } as any,
    })

    renderPage()
    expect(screen.getByText(/切回模拟模式再试/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/切回模拟模式再试/))
    await waitFor(() => expect(useAiAskStore.getState().useRealLlm).toBe(false))
  })
})
```

- [ ] **Step 2: Add useRealLlm state to aiAskStore**

```typescript
// frontend/src/stores/aiAskStore.ts
interface AiAskStore {
  // ... existing fields
  useRealLlm: boolean
  setUseRealLlm: (v: boolean) => void
}

export const useAiAskStore = create<AiAskStore>((set) => ({
  // ... existing defaults
  useRealLlm: false,
  setUseRealLlm: (v) => set({ useRealLlm: v }),
}))
```

- [ ] **Step 3: Add LLM switch and error handling to AskWorkbenchPage**

In `AskWorkbenchPage.tsx`:

```typescript
import { useLlmSettings } from '../api/llmSettings'
import { Switch, Tooltip } from 'antd'

const AskWorkbenchPage: React.FC = () => {
  // ... existing hooks
  const useRealLlm = useAiAskStore((s) => s.useRealLlm)
  const setUseRealLlm = useAiAskStore((s) => s.setUseRealLlm)
  const { data: llmSettings } = useLlmSettings()
  const hasActiveLlm = llmSettings?.some((s) => s.is_active) ?? false

  const adapter = useAiAskService({ useRealLlm })

  // ... rest of component

  return (
    <Layout style={{ height: 'calc(100vh - 104px)', background: '#fff' }}>
      {/* Agent nav bar */}
      <div style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', padding: '0 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <AgentNav activeKey={agentMode} onChange={() => {}} />
          <Tooltip
            title={
              hasActiveLlm
                ? '真实 LLM 开关关闭时将使用 MockAdapter'
                : '没有已启用的 LLM 配置，请先在 LLM 连接管理中启用模型'
            }
          >
            <Switch
              checked={useRealLlm}
              onChange={setUseRealLlm}
              disabled={!hasActiveLlm}
              checkedChildren="真实 LLM"
              unCheckedChildren="模拟模式"
            />
          </Tooltip>
        </div>
      </div>
      {/* ... rest of JSX */}
    </Layout>
  )
}
```

- [ ] **Step 4: Update error display for manual fallback**

In the `catch (err)` block of `handleSend`, when `useRealLlm` is true and error is timeout/connection/rate-limit/auth:

```typescript
if (useRealLlm && err instanceof AiAskError) {
  // Do NOT auto fallback. Show manual option to switch back to MockAdapter.
  setError(err)
  // UI will render a button: "切回模拟模式再试"
}
```

Add manual fallback button in error Alert:

```tsx
{storeError && !isAnalyzing && (
  <Alert
    type="error"
    showIcon
    style={{ borderRadius: 8, marginBottom: 12 }}
    message={
      <div>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>分析异常</div>
        <div style={{ fontSize: 12 }}>{getAiAskErrorMessage(storeError.code)}</div>
        {useRealLlm && (
          <Space style={{ marginTop: 6 }}>
            <Button size="small" onClick={() => setUseRealLlm(false)}>
              切回模拟模式再试
            </Button>
          </Space>
        )}
      </div>
    }
  />
)}
```

- [ ] **Step 5: Run frontend tests**

Run:
```bash
cd frontend && npx vitest run src/pages/AskWorkbenchPage.test.tsx
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stores/aiAskStore.ts frontend/src/pages/AskWorkbenchPage.tsx frontend/src/pages/AskWorkbenchPage.test.tsx
git commit -m "feat(phase-5l): integrate real LLM toggle into AskWorkbenchPage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6：测试与最终验证

**Files:**
- All previous files

- [ ] **Step 1: Run backend tests**

```bash
python -m pytest tests/test_ai_ask_llm.py -q
```

Expected: all PASS.

- [ ] **Step 2: Run full Python test suite**

```bash
python -m pytest tests/ -q
```

Expected: 299 passed（基准）.

- [ ] **Step 3: Run frontend type check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run frontend tests**

```bash
cd frontend && npm test
```

Expected: 47 files / 519 tests passed（或更多，含新增测试）.

- [ ] **Step 5: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: built successfully.

- [ ] **Step 6: Run quality benchmarks**

```bash
cd frontend && npm run benchmark
```

Expected: 156/156 passed（不调用真实 LLM）.

- [ ] **Step 7: Constraint check**

Run:
```bash
git status --short
```

Confirm:
- Only expected files are modified/added
- No changes to `llm_settings` schema or migration files
- No Playwright/Cypress files
- No Monaco DOM test additions

- [ ] **Step 8: Final report to reviewer**

Report:
- `git status --short --branch`
- Test results summary
- Request review authorization before any further action

---

## Self-Review

### Spec Coverage

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 复用 `llm_settings` / active LlmSetting / key_encryption | Task 3 |
| 新增 `POST /api/ai-ask/analyze` | Task 1, Task 3 |
| 业务错误统一 HTTP 200 + ok:false | Task 1, Task 3 |
| PromptBuilder / Normalizer / Validator | Task 2 |
| 前端 `RealLlmAdapter` | Task 4 |
| `getChartData` 返回 isEmpty:true + 错误文案 | Task 4 |
| 显式开关 / 不自动 fallback / 手动切回模拟模式 | Task 5 |
| 测试不调用真实 LLM | 所有 Task |
| 不新增 DB / migration | Task 1, Task 3, Task 6 |
| SQL Workbench 仍是下游验证工具 | Task 4 (chart data 错误文案) |

### Placeholder Scan

- 无 "TBD" / "TODO" / "implement later"
- 无 "add appropriate error handling" 等模糊表述
- 每个代码步骤包含完整代码示例
- 每个测试步骤包含完整测试代码

### Type Consistency

- `AiAskAnalyzeRequest` 使用 `populate_by_name=True`，API route 使用 `body.model_dump()` 传入 snake_case，后端内部统一使用 snake_case。
- `validate_ai_ask_response` 返回结构 `{valid, errors, warnings}` 与前端 `validateAiAskResponse` 语义一致
- `RealLlmAdapter.analyze` 返回 `AiAskResponse`，与 `AiAskAdapter` 接口一致

---

## Execution Options

**Plan complete and saved to `docs/superpowers/plans/2026-07-08-phase-5l-real-llm-adapter-mvp-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
