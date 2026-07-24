# Phase 5N — Trusted Analysis Execution and Workbench UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the trusted analysis chain: `sql_pending → user confirm → safe execute → real columns/rows → deterministic narrative/evidence/chart → narrativeLevel = executed`. Fix 8 UX issues: data scope duplication, session cross-contamination, missing titles, inconsistent input area, mock mode UI, no real charts.

**Architecture:** Backend: add `response_json` TEXT column to `ask_messages`, create `POST /api/ai-ask/execute-sql` with read-first-then-claim lifecycle, build deterministic `build_executed_narrative()` in Python. Frontend: remove `DataScopeSelector`, upgrade `DataScopeBar` with object search, fix session isolation in store, remove Mock Switch, unify input layout, add execute button with confirmation.

**Tech Stack:** FastAPI + SQLAlchemy + SQLite, React 18 + Zustand + Ant Design 5 + ECharts 6

## Global Constraints

- No automated test calls real LLM or real Oracle
- No DB migration beyond `schema_migration_service.METADATA_COLUMNS` append (no Alembic)
- No Playwright/Cypress/zod/CI
- No Monaco DOM testing
- SQL must go through Trust Gate — no automatic execution, no browser-submitted SQL
- `POST /api/ai-ask/execute-sql` body only contains `sessionId` + `assistantMessageId` (no `sql`/`datasourceId`)
- MockAdapter only in tests/benchmark/dev injection — never in production UI
- No push / PR / merge / reset / rebase / force-push
- Every Task uses `git add -- <exact-file-list>` and `git commit --only -m "<msg>" -- <exact-file-list>`. Never `git add .`, `git add -A`, or bare `git commit -m`.
- After each Task commit, the review gate must verify that `git diff --cached --name-only` still contains only `docs/superpowers/specs/2026-07-16-install-taste-skill-design.md`.

---

## File Structure

### Files Created

| Path | Responsibility |
|------|---------------|
| `app/services/ai_ask/execution_service.py` | `POST /execute-sql` endpoint handler: read-first-then-claim, MetadataResolver, SqlValidator, SqlExecutionService delegation, finally release |
| `app/services/ai_ask/narrative_builder.py` | `build_executed_narrative()` + `_to_finite_number()` + `_detect_metric_columns()` — deterministic Python template, no LLM |
| `tests/services/test_ai_ask_execution.py` | Integration tests for execute-sql: lifecycle, concurrency, metadata drift, error recovery |
| `tests/services/test_ai_ask_narrative.py` | Unit tests for `build_executed_narrative` and helpers: empty, truncated, mixed data, bool/NaN/Infinity, ID exclusion |

### Files Modified

| Path | Change |
|------|--------|
| `app/models/ask_models.py` | Add `response_json = Column(Text, nullable=True)` to `AskMessage` |
| `app/schemas/ai_ask.py` | Add `ExecuteSqlRequest(sessionId, assistantMessageId)`, `ExecuteSqlResponse`; add `sessionId`, `assistantMessageId` to `AiAskAnalyzeRequest` |
| `app/api/ai_ask.py` | Add `POST /execute-sql` route; extend `POST /analyze` to accept `sessionId` + `assistantMessageId` and write `response_json` |
| `app/services/ai_ask/llm_service.py` | `analyze()` accepts `sessionId` + `assistantMessageId`, validates session/role/status, writes `response_json` to the exact `AskMessage` row; all error paths set status=failed |
| `app/services/ask_service.py` | Add module-level `_safe_load_response_json()`; update `_message_to_dict()` to return `response_json` |
| `app/services/schema_migration_service.py` | Add `("response_json", "TEXT")` to `ask_messages` in `METADATA_COLUMNS` |
| `app/services/ai_ask/__init__.py` | Export `build_executed_narrative` |
| `frontend/src/stores/aiAskStore.ts` | Remove `useRealLlm`/`setUseRealLlm`/`responseHistory`/`saveResponseForMessage`/`getResponseForMessage`; add `isExecuting`/`setExecuting`; add `currentAssistantMessageId`/`setCurrentAssistantMessageId` |
| `frontend/src/api/aiAsk/index.ts` | `useAiAskService` fixed to `RealLlmAdapter.create()`; remove `useRealLlm` option |
| `frontend/src/api/aiAsk/adapter.ts` | Update `AiAskContext` to include `sessionId`/`assistantMessageId` |
| `frontend/src/api/aiAsk/realLlmAdapter.ts` | `analyze()` accepts `AiAskContext` with `sessionId`/`assistantMessageId`; `getChartData()` maps real columns/rows from response |
| `frontend/src/api/askSessions.ts` | Add `updateSessionTitle` function |
| `frontend/src/components/DataScopeBar.tsx` | Add search Input + browse-all Drawer; remove `siderCollapsed`/`onToggleCollapse` props |
| `frontend/src/components/DataScopeBar.test.tsx` | Tests for object search, clear, datasource switch |
| `frontend/src/components/DataScopeSelector.tsx` | **Delete** — replaced by DataScopeBar search |
| `frontend/src/components/AskInput.tsx` | Add `disabled` state with tooltip for no-active-LLM; single wrapper for Tooltip |
| `frontend/src/components/AiChartBoard.tsx` | sql_pending guard prevents chart; executed uses real `queryResult.rows`; explicit `queryResult` prop |
| `frontend/src/pages/AskWorkbenchPage.tsx` | Remove `DataScopeSelector` import/render; remove Mock Switch; unify layout; add execute button; session isolation guard; session-scoped `currentAssistantMessageId` |
| `frontend/src/pages/AskWorkbenchPage.test.tsx` | Remove Mock Switch tests; add session isolation, execute button, Data Scope tests, no-active-LLM disabled state |
| `frontend/src/utils/title.ts` | Add `generateTitle()` utility |
| `frontend/src/types/aiAsk.ts` | Add `QueryResult` interface; update `AiAskResponse` with `queryResult` |

---

### Task 1: response_json Model, Migration & Versioned Envelope

**Files:**
- Modify: `app/models/ask_models.py` — add `response_json` column
- Modify: `app/services/schema_migration_service.py` — add `("response_json", "TEXT")` to `ask_messages`
- Modify: `app/services/ask_service.py` — add module-level `_safe_load_response_json()` helper, update `_message_to_dict()`
- Test: `tests/services/test_ask_service_tools.py` (append test class)

**Interfaces:**
- Consumes: `AskMessage` model (existing), `METADATA_COLUMNS` dict (existing)
- Produces: `_safe_load_response_json(raw: str | None) -> dict | None` as module-level function in `ask_service.py`, `response_json` column on `AskMessage`

---

- [ ] **Step 1: Write failing tests for `_safe_load_response_json`**

```python
# Append to tests/services/test_ask_service_tools.py
import json
from app.services.ask_service import _safe_load_response_json


def test_safe_load_response_json_valid():
    obj = {"schemaVersion": 1, "data": {"narrativeLevel": "sql_pending"}}
    result = _safe_load_response_json(json.dumps(obj))
    assert result == obj


def test_safe_load_response_json_null():
    assert _safe_load_response_json(None) is None


def test_safe_load_response_json_empty():
    assert _safe_load_response_json("") is None


def test_safe_load_response_json_bad_json():
    assert _safe_load_response_json("not json") is None


def test_safe_load_response_json_unknown_version():
    obj = {"schemaVersion": 99, "data": {}}
    assert _safe_load_response_json(json.dumps(obj)) is None


def test_safe_load_response_json_not_dict():
    assert _safe_load_response_json('"string"') is None


def test_response_json_migration_is_idempotent():
    """Create legacy ask_messages table without response_json, run
    ensure_sqlite_schema twice, verify column added only once."""
    from app.services.schema_migration_service import ensure_sqlite_schema
    from sqlalchemy import create_engine, MetaData, Table, Column, Integer, String, Text, text
    engine = create_engine("sqlite://", echo=False)

    # Create legacy ask_messages table (no response_json column)
    meta = MetaData()
    Table(
        "ask_messages", meta,
        Column("id", Integer, primary_key=True),
        Column("session_id", Integer),
        Column("role", String(20)),
        Column("status", String(20)),
        Column("content", Text),
    )
    meta.create_all(engine)

    # First migration run
    ensure_sqlite_schema(engine)

    # Second migration run — must not raise
    ensure_sqlite_schema(engine)

    with engine.connect() as conn:
        result = conn.execute(text(
            "SELECT COUNT(*) FROM pragma_table_info('ask_messages') "
            "WHERE name='response_json'"
        ))
        assert result.scalar() == 1, "response_json column not added or duplicated"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/projects/MetricForge
python -m pytest tests/services/test_ask_service_tools.py::test_safe_load_response_json_valid -v
```
Expected: `FAILED` — `_safe_load_response_json` not yet defined.

- [ ] **Step 3: Add `response_json` column to `AskMessage`**

In `app/models/ask_models.py`, add after `tokens_completion`:
```python
response_json = Column(Text, nullable=True)  # 版本化 AiAskResponse JSON
```

- [ ] **Step 4: Add migration entry in `METADATA_COLUMNS`**

In `app/services/schema_migration_service.py`, in the `"ask_messages"` list, append after `("tokens_completion", "INTEGER")`:
```python
("response_json", "TEXT"),
```

- [ ] **Step 5: Add `_safe_load_response_json` module-level helper**

In `app/services/ask_service.py`, add before the class definition:
```python
import json


def _safe_load_response_json(raw: str | None) -> dict | None:
    """安全加载 response_json，版本不兼容或解析失败时返回 None。"""
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return None
        if parsed.get("schemaVersion") != 1:
            return None
        return parsed
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
```

- [ ] **Step 6: Update `_message_to_dict()` to return `response_json`**

In `app/services/ask_service.py`, inside `_message_to_dict()`, add after `"tokens_completion": m.tokens_completion`:
```python
"response_json": _safe_load_response_json(m.response_json),
```

- [ ] **Step 7: Run tests**

```bash
cd D:/projects/MetricForge
python -m pytest tests/services/test_ask_service_tools.py::test_safe_load_response_json_valid -v
python -m pytest tests/services/test_ask_service_tools.py::test_safe_load_response_json_null -v
python -m pytest tests/services/test_ask_service_tools.py::test_safe_load_response_json_empty -v
python -m pytest tests/services/test_ask_service_tools.py::test_safe_load_response_json_bad_json -v
python -m pytest tests/services/test_ask_service_tools.py::test_safe_load_response_json_unknown_version -v
python -m pytest tests/services/test_ask_service_tools.py::test_safe_load_response_json_not_dict -v
python -m pytest tests/services/test_ask_service_tools.py::test_response_json_migration_is_idempotent -v
```
Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add -- app/models/ask_models.py app/services/schema_migration_service.py app/services/ask_service.py tests/services/test_ask_service_tools.py
git commit --only -m "feat(phase-5n): add response_json column and safe-load helper" -- app/models/ask_models.py app/services/schema_migration_service.py app/services/ask_service.py tests/services/test_ask_service_tools.py
```

- [ ] **Step 9: Review gate — verify staged taste-skill spec is preserved**

```bash
git diff --cached --name-only
```
Expected output: `docs/superpowers/specs/2026-07-16-install-taste-skill-design.md`

---

### Task 2: Analyze Exact Binding to Assistant Message

**Files:**
- Modify: `app/schemas/ai_ask.py` -- add `sessionId`, `assistantMessageId` to `AiAskAnalyzeRequest` with alias
- Modify: `app/services/ai_ask/llm_service.py` -- rename `analyze()` to `_analyze_core()` (keeps existing LLM flow unchanged); new public `analyze()` wraps with identity validation + persistence; all error paths set status=failed on the exact bound message
- Modify: `app/api/ai_ask.py` -- route uses `body.model_dump()`, service reads `request["session_id"]`; no change needed beyond what the new fields provide
- Modify: `tests/test_ai_ask_llm.py` -- migrate all 18 existing `svc.analyze()` calls to `svc._analyze_core()` (same assertions, no behavior change)
- Create: `tests/services/test_ai_ask_execution.py` -- new binding + persistence tests for public `analyze()`
- Modify: `frontend/src/api/aiAsk/realLlmAdapter.ts` -- accept and send `sessionId`/`assistantMessageId`
- Modify: `frontend/src/api/aiAsk/adapter.ts` -- update `AiAskContext` to include session fields

**Interfaces:**
- Consumes: `_safe_load_response_json` from `app.services.ask_service` (Task 1) -- import, never duplicate
- Produces: `_analyze_core(self, request: dict, db) -> AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse` (existing LLM flow, no identity/session logic); public `analyze(self, request: dict, db)` wraps binding logic + persistence + error recovery

---

- [ ] **Step 1: Write failing analyze binding + migration tests**

In `tests/services/test_ai_ask_execution.py` (new file):
```python
import json
from unittest.mock import patch, MagicMock
import pytest
from fastapi import HTTPException


def _sketch_db(db_session):
    \"\"\"Helper: create active LlmSetting + session, return (session_id, msg1_id, msg2_id).\"\"\"
    from app.models.ask_models import AskSession, AskMessage, LlmSetting
    active = LlmSetting(
        name="test-gpt", base_url="https://api.example.com",
        model_name="gpt-4o-mini", api_key="encrypted-key", is_active=1,
    )
    db_session.add(active)
    session = AskSession(title="test", model_name="gpt-4o-mini")
    db_session.add(session)
    db_session.flush()
    msg1 = AskMessage(session_id=session.id, role="assistant", status="pending", content="")
    msg2 = AskMessage(session_id=session.id, role="assistant", status="pending", content="")
    db_session.add_all([msg1, msg2])
    db_session.commit()
    return session.id, msg1.id, msg2.id


def _valid_llm_response_json():
    \"\"\"Returns valid LLM response with non-empty narrative.summary and evidence.
    After sanitize, evidence/keyFindings should be empty, narrativeLevel=sql_pending.\"\"\"
    return json.dumps({
        "question": "each region amount ranking",
        "intent": {"metrics": ["amount"], "dimensions": ["region"],
                    "filters": ["pt='20260630'"]},
        "sqlPlan": {
            "datasourceId": 1,
            "datasourceName": "test-datasource",
            "sql": "SELECT region_name, SUM(amt) AS total_amount FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE pt='20260630' GROUP BY region_name",
            "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            "fields": ["region_name", "amt", "pt"],
            "assumptions": [], "safetyWarnings": [],
        },
        "resultSummary": {"rowCount": 5, "durationMs": 100},
        "chartSuggestions": [
            {"title": "amount ranking", "chartType": "bar", "xField": "region_name",
             "yFields": ["total_amount"], "rationale": "region comparison", "limitations": []},
        ],
        "narrative": {
            "summary": "Regional amount distribution, east region highest",
            "keyFindings": ["East region has highest amount"],
            "evidence": [{"claim": "test claim", "fields": ["amt", "region_name"], "value": "test"}],
            "risks": [], "nextQuestions": [],
        },
        "semanticGaps": [],
    })


def test_analyze_writes_to_exact_assistant_message(db_session):
    \"\"\"analyze writes to specified assistantMessageId (second one), first stays None.\"\"\"
    from app.services.ai_ask.llm_service import AiAskLlmService
    from app.services.ai_ask.metadata_resolver import (
        ResolvedTableMetadata, ResolvedColumn,
    )
    import os
    os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")

    session_id, msg1_id, msg2_id = _sketch_db(db_session)

    resolved_table = ResolvedTableMetadata(
        schema_name="DWHRPT", table_name="DWS_RPT_ZCPZ_CYFL_TF_M",
        table_comment="monthly snapshot table",
        columns=[
            ResolvedColumn(column_name="pt", column_type="VARCHAR", comment="partition field", is_partition=True),
            ResolvedColumn(column_name="amt", column_type="NUMBER(18,2)", comment="amount"),
            ResolvedColumn(column_name="region_name", column_type="VARCHAR(50)", comment="region name"),
        ],
        field_semantics=[], table_rule_hints=[],
    )

    with patch("app.services.ai_ask.llm_service.OpenAI") as mock_openai_cls, \
         patch("app.services.ai_ask.llm_service.decrypt") as mock_decrypt, \
         patch("app.services.ai_ask.llm_service.MetadataResolver.resolve") as mock_resolve:
        mock_decrypt.return_value = "plain-api-key"
        mock_resolve.return_value = [resolved_table]
        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock(message=MagicMock(content=_valid_llm_response_json()))]
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = mock_completion
        mock_openai_cls.return_value = mock_client

        service = AiAskLlmService()
        result = service.analyze({
            "session_id": session_id,
            "assistant_message_id": msg2_id,
            "question": "amount by region",
            "datasource_id": 1,
            "datasource_name": "test-datasource",
            "selected_tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
        }, db_session)
    assert result.ok is True
    from app.models.ask_models import AskMessage
    msg1 = db_session.query(AskMessage).filter(AskMessage.id == msg1_id).first()
    msg2 = db_session.query(AskMessage).filter(AskMessage.id == msg2_id).first()
    assert msg1.response_json is None
    assert msg2.response_json is not None
    assert msg2.status == "completed"
    parsed = json.loads(msg2.response_json)
    assert parsed["schemaVersion"] == 1
    assert parsed["data"]["narrativeLevel"] == "sql_pending"
    # After persistence, evidence/keyFindings should be sanitized to empty
    assert parsed["data"]["narrative"]["evidence"] == []
    assert parsed["data"]["narrative"]["keyFindings"] == []


def test_analyze_rejects_wrong_role(db_session):
    \"\"\"role != assistant -> 422, message not modified.\"\"\"
    from app.models.ask_models import AskSession, AskMessage, LlmSetting
    from app.services.ai_ask.llm_service import AiAskLlmService
    db_session.add(LlmSetting(
        name="test", base_url="x", model_name="gpt",
        api_key="k", is_active=1,
    ))
    session = AskSession(title="test", model_name="gpt")
    db_session.add(session)
    db_session.flush()
    msg = AskMessage(session_id=session.id, role="user", status="pending", content="hi")
    db_session.add(msg)
    db_session.commit()
    service = AiAskLlmService()
    with pytest.raises(HTTPException) as exc:
        service.analyze({
            "session_id": session.id,
            "assistant_message_id": msg.id,
            "question": "test", "datasource_id": 1,
            "datasource_name": "test", "selected_tables": [],
        }, db_session)
    assert exc.value.status_code == 422
    # Identity validation failure must NOT modify records
    db_session.refresh(msg)
    assert msg.response_json is None
    assert msg.error_message is None


def test_analyze_rejects_session_mismatch(db_session):
    \"\"\"session_id mismatch -> 422, message not modified.\"\"\"
    from app.models.ask_models import AskSession, AskMessage, LlmSetting
    from app.services.ai_ask.llm_service import AiAskLlmService
    db_session.add(LlmSetting(
        name="test", base_url="x", model_name="gpt",
        api_key="k", is_active=1,
    ))
    s1 = AskSession(title="s1", model_name="gpt")
    s2 = AskSession(title="s2", model_name="gpt")
    db_session.add_all([s1, s2])
    db_session.flush()
    msg = AskMessage(session_id=s1.id, role="assistant", status="pending", content="")
    db_session.add(msg)
    db_session.commit()
    service = AiAskLlmService()
    with pytest.raises(HTTPException) as exc:
        service.analyze({
            "session_id": s2.id,
            "assistant_message_id": msg.id,
            "question": "test", "datasource_id": 1,
            "datasource_name": "test", "selected_tables": [],
        }, db_session)
    assert exc.value.status_code == 422
    db_session.refresh(msg)
    assert msg.response_json is None
    assert msg.error_message is None


def test_analyze_rejects_non_pending_status(db_session):
    \"\"\"status != pending -> 422, message not modified.\"\"\"
    from app.models.ask_models import AskSession, AskMessage, LlmSetting
    from app.services.ai_ask.llm_service import AiAskLlmService
    db_session.add(LlmSetting(
        name="test", base_url="x", model_name="gpt",
        api_key="k", is_active=1,
    ))
    session = AskSession(title="test", model_name="gpt")
    db_session.add(session)
    db_session.flush()
    msg = AskMessage(session_id=session.id, role="assistant", status="completed", content="")
    db_session.add(msg)
    db_session.commit()
    service = AiAskLlmService()
    with pytest.raises(HTTPException) as exc:
        service.analyze({
            "session_id": session.id,
            "assistant_message_id": msg.id,
            "question": "test", "datasource_id": 1,
            "datasource_name": "test", "selected_tables": [],
        }, db_session)
    assert exc.value.status_code == 422
    db_session.refresh(msg)
    assert msg.response_json is None
    assert msg.error_message is None


def test_analyze_business_error_sets_failed(db_session):
    \"\"\"After valid binding, _analyze_core returns ok:false -> exact message goes to failed.\"\"\"
    from app.services.ai_ask.llm_service import AiAskLlmService
    import os
    os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")

    session_id, msg1_id, msg2_id = _sketch_db(db_session)

    with patch("app.services.ai_ask.llm_service.MetadataResolver.resolve") as mock_resolve:
        mock_resolve.return_value = []
        service = AiAskLlmService()
        result = service.analyze({
            "session_id": session_id,
            "assistant_message_id": msg2_id,
            "question": "no metadata",
            "datasource_id": 999,
            "datasource_name": "unknown",
            "selected_tables": ["FAKE.TABLE"],
        }, db_session)
    assert result.ok is False
    assert result.error_code == "METADATA_NOT_FOUND"
    from app.models.ask_models import AskMessage
    msg2 = db_session.query(AskMessage).filter(AskMessage.id == msg2_id).first()
    assert msg2.status == "failed"
    assert msg2.error_message is not None
    # msg1 untouched
    msg1 = db_session.query(AskMessage).filter(AskMessage.id == msg1_id).first()
    assert msg1.response_json is None
    assert msg1.status == "pending"


def test_analyze_http_exception_sets_failed_then_raises(db_session):
    \"\"\"After valid binding, _analyze_core raises HTTPException -> message set to failed then re-raised.\"\"\"
    from app.services.ai_ask.llm_service import AiAskLlmService
    import os
    os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")

    session_id, msg1_id, msg2_id = _sketch_db(db_session)

    with patch("app.services.ai_ask.llm_service.MetadataResolver.resolve") as mock_resolve:
        mock_resolve.side_effect = HTTPException(503, detail="DB unavailable")
        service = AiAskLlmService()
        with pytest.raises(HTTPException) as exc:
            service.analyze({
                "session_id": session_id,
                "assistant_message_id": msg2_id,
                "question": "test",
                "datasource_id": 1,
                "datasource_name": "test",
                "selected_tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            }, db_session)
    assert exc.value.status_code == 503
    from app.models.ask_models import AskMessage
    msg2 = db_session.query(AskMessage).filter(AskMessage.id == msg2_id).first()
    assert msg2.status == "failed"
    # msg1 untouched
    msg1 = db_session.query(AskMessage).filter(AskMessage.id == msg1_id).first()
    assert msg1.status == "pending"
    assert msg1.response_json is None


def test_analyze_generic_exception_marks_failed_and_re_raises(db_session):
    \"\"\"_analyze_core raises RuntimeError -> exact message set to failed, original RuntimeError re-raised.\"\"\"
    from app.services.ai_ask.llm_service import AiAskLlmService
    import os
    os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")

    session_id, msg1_id, msg2_id = _sketch_db(db_session)

    with patch("app.services.ai_ask.llm_service.MetadataResolver.resolve") as mock_resolve:
        mock_resolve.side_effect = RuntimeError("unexpected internal error")
        service = AiAskLlmService()
        with pytest.raises(RuntimeError) as exc:
            service.analyze({
                "session_id": session_id,
                "assistant_message_id": msg2_id,
                "question": "test",
                "datasource_id": 1,
                "datasource_name": "test",
                "selected_tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            }, db_session)
    assert str(exc.value) == "unexpected internal error"
    from app.models.ask_models import AskMessage
    msg2 = db_session.query(AskMessage).filter(AskMessage.id == msg2_id).first()
    assert msg2.status == "failed"
    # msg1 untouched
    msg1 = db_session.query(AskMessage).filter(AskMessage.id == msg1_id).first()
    assert msg1.status == "pending"
    assert msg1.response_json is None


def test_analyze_commit_failure_does_not_suppress_original_error(db_session):
    \"\"\"Simulate db.commit() permanently failing after _analyze_core error.
    Verify original RuntimeError surfaces, rollback is called, other messages not polluted.\"\"\"
    from app.services.ai_ask.llm_service import AiAskLlmService
    import os
    os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")

    session_id, msg1_id, msg2_id = _sketch_db(db_session)
    from app.models.ask_models import AskMessage

    original_commit = db_session.commit
    original_rollback = db_session.rollback
    commit_calls = 0
    rollback_calls = 0

    def flaky_commit():
        nonlocal commit_calls
        commit_calls += 1
        raise Exception("DB connection lost during commit")

    def tracking_rollback():
        nonlocal rollback_calls
        rollback_calls += 1
        original_rollback()

    with patch("app.services.ai_ask.llm_service.MetadataResolver.resolve") as mock_resolve:
        mock_resolve.side_effect = RuntimeError("original error")
        # Patch the bound session's commit to always fail
        original_session_commit = db_session.commit
        db_session.commit = flaky_commit
        db_session.rollback = tracking_rollback

        service = AiAskLlmService()
        with pytest.raises(RuntimeError) as exc:
            service.analyze({
                "session_id": session_id,
                "assistant_message_id": msg2_id,
                "question": "test",
                "datasource_id": 1,
                "datasource_name": "test",
                "selected_tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            }, db_session)

    # Restore original methods to avoid affecting subsequent tests
    db_session.commit = original_session_commit
    db_session.rollback = original_rollback

    # Original RuntimeError must surface, not the commit error
    assert str(exc.value) == "original error"
    # Rollback must have been called (at least once)
    assert rollback_calls >= 1
    # Commit error did not suppress the original exception
    assert commit_calls >= 1
    # msg1 untouched (no pollution)
    msg1 = db_session.query(AskMessage).filter(AskMessage.id == msg1_id).first()
    assert msg1.status == "pending"
    # NOTE: Do NOT assert msg2.status == "failed" — commit permanently fails,
    # so the failed status was never persisted to the database.


def test_analyze_api_camelcase_integration(tmp_path):
    \"\"\"Integration test: POST /api/ai-ask/analyze with camelCase JSON.
    TestClient shares the same tmp_path SQLite as verification session.
    Create messages with only {"content": "..."}, no role/status.\"\"\"
    from app.main import create_app
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from fastapi.testclient import TestClient
    from app.models.ask_models import AskMessage, LlmSetting
    from app.services.ai_ask.metadata_resolver import (
        ResolvedTableMetadata, ResolvedColumn,
    )
    import os
    os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")

    db_path = tmp_path / "api-analyze-test.db"
    app = create_app(database_url=f"sqlite:///{db_path}")
    with TestClient(app) as client:

        engine = create_engine(f"sqlite:///{db_path}")
        Session = sessionmaker(bind=engine)
        verify_session = Session()

        verify_session.add(LlmSetting(
            name="test-gpt", base_url="https://api.example.com",
            model_name="gpt-4o-mini", api_key="encrypted-key", is_active=1,
        ))
        verify_session.commit()

        sess_resp = client.post("/api/ask/sessions", json={"title": "test"})
        assert sess_resp.status_code == 201
        session_id = sess_resp.json()["id"]

        # Create user message
        client.post(f"/api/ask/sessions/{session_id}/messages",
                    json={"content": "amount by region"})

        # Create two assistant messages -- only second should be written
        msg1_resp = client.post(f"/api/ask/sessions/{session_id}/messages",
                                json={"content": "first question"})
        assert msg1_resp.status_code == 201
        msg1_id = msg1_resp.json()["assistant_message"]["id"]

        msg2_resp = client.post(f"/api/ask/sessions/{session_id}/messages",
                                json={"content": "second question"})
        assert msg2_resp.status_code == 201
        msg2_id = msg2_resp.json()["assistant_message"]["id"]

        resolved_table = ResolvedTableMetadata(
            schema_name="DWHRPT", table_name="DWS_RPT_ZCPZ_CYFL_TF_M",
            table_comment="monthly snapshot",
            columns=[
                ResolvedColumn(column_name="pt", column_type="VARCHAR", comment="partition", is_partition=True),
                ResolvedColumn(column_name="amt", column_type="NUMBER(18,2)", comment="amount"),
                ResolvedColumn(column_name="region_name", column_type="VARCHAR(50)", comment="region"),
            ],
            field_semantics=[], table_rule_hints=[],
        )

        with patch("app.services.ai_ask.llm_service.OpenAI") as mock_openai_cls, \
             patch("app.services.ai_ask.llm_service.decrypt") as mock_decrypt, \
             patch("app.services.ai_ask.llm_service.MetadataResolver.resolve") as mock_resolve:
            mock_decrypt.return_value = "plain-api-key"
            mock_resolve.return_value = [resolved_table]
            mock_completion = MagicMock()
            mock_completion.choices = [MagicMock(message=MagicMock(content=_valid_llm_response_json()))]
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = mock_completion
            mock_openai_cls.return_value = mock_client

            resp = client.post("/api/ai-ask/analyze", json={
                "sessionId": session_id,
                "assistantMessageId": msg2_id,
                "question": "amount by region",
                "datasourceId": 1,
                "datasourceName": "test-datasource",
                "selectedTables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
                "messageHistory": [],
            })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert data["ok"] is True

        # Verify via the same DB: only msg2 was written
        msg1 = verify_session.query(AskMessage).filter(AskMessage.id == msg1_id).first()
        msg2 = verify_session.query(AskMessage).filter(AskMessage.id == msg2_id).first()
        assert msg1.response_json is None, "msg1 should not be written"
        assert msg2.response_json is not None, "msg2 should be written"
        assert msg2.status == "completed"
        parsed = json.loads(msg2.response_json)
        assert parsed["schemaVersion"] == 1
        assert parsed["data"]["narrativeLevel"] == "sql_pending"

        verify_session.close()
        engine.dispose()
```

- [ ] **Step 2: Run tests -- expect failure**

```bash
cd D:/projects/MetricForge
python -m pytest tests/services/test_ai_ask_execution.py -v
```
Expected: FAIL -- requested schemas and service changes not yet made.

- [ ] **Step 3: Add `sessionId`/`assistantMessageId` to `AiAskAnalyzeRequest`**

In `app/schemas/ai_ask.py`, add to `AiAskAnalyzeRequest`:
```python
session_id: int = Field(..., alias="sessionId")
assistant_message_id: int = Field(..., alias="assistantMessageId")
model_config = {"populate_by_name": True}
```

- [ ] **Step 4: Split `AiAskLlmService.analyze()` into `_analyze_core()` + new public `analyze()`**

Rename the existing `analyze()` method (lines 57-152 of `llm_service.py`) to `_analyze_core()`. The method body remains exactly the same as the current `analyze()` (metadata resolve -> OpenAI -> normalizer -> validator -> SqlValidator -> sanitize -> return).

Then add the new public `analyze()` and `_mark_failed_best_effort()` as class-level methods of `AiAskLlmService`:
```python
import json
from fastapi import HTTPException
from sqlalchemy.orm import Session
from app.models.ask_models import AskMessage
from app.services.ask_service import _safe_load_response_json


class AiAskLlmService:
    def analyze(self, request: dict, db: Session):
        session_id = request.get("session_id")
        assistant_message_id = request.get("assistant_message_id")

        # -- Read-only identity validation (must NOT modify records on failure) --
        msg = db.query(AskMessage).filter(AskMessage.id == assistant_message_id).first()
        if not msg:
            raise HTTPException(404, detail="message not found")
        if msg.session_id != session_id:
            raise HTTPException(422, detail="session mismatch")
        if msg.role != "assistant":
            raise HTTPException(422, detail="wrong role")
        if msg.status != "pending":
            raise HTTPException(422, detail="status not pending")

        # -- Identity passed -- subsequent failures may update this exact message --
        bound_msg = msg

        try:
            analysis_result = self._analyze_core(request, db)

            if not analysis_result.ok:
                bound_msg.status = "failed"
                bound_msg.error_message = analysis_result.error_message or "analysis failed"
                db.commit()
                return analysis_result

            # Success: persist versioned response_json
            response_json = json.dumps({
                "schemaVersion": 1,
                "data": analysis_result.data,
            }, ensure_ascii=False)
            bound_msg.response_json = response_json
            bound_msg.status = "completed"
            bound_msg.error_message = None
            db.commit()
            return analysis_result
        except HTTPException:
            self._mark_failed_best_effort(db, assistant_message_id, session_id)
            raise
        except Exception:
            self._mark_failed_best_effort(db, assistant_message_id, session_id)
            raise

    def _mark_failed_best_effort(self, db: Session, message_id: int, session_id: int) -> None:
        \"\"\"Best-effort mark an assistant message as failed.
        Rollback -> re-load by primary key -> verify session/role -> mark failed -> commit.
        If commit fails, rollback again but never suppress the original exception.\"\"\"
        db.rollback()
        fresh = db.query(AskMessage).filter(
            AskMessage.id == message_id,
            AskMessage.session_id == session_id,
            AskMessage.role == "assistant",
        ).first()
        if not fresh:
            return
        fresh.status = "failed"
        fresh.error_message = "analysis failed"
        try:
            db.commit()
        except Exception:
            db.rollback()

    def _analyze_core(self, request: dict, db) -> AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse:
        \"\"\"Core LLM analysis flow -- no session/identity binding.
        Same as former analyze(). Returns success or error response.
        Called by the new public analyze() which handles identity + persistence.\"\"\"
        # -- Step 0: Check LLM config --
        active = db.query(LlmSetting).filter(LlmSetting.is_active == 1).first()
        if not active:
            return AiAskAnalyzeErrorResponse(...)
        # -- Steps 1-9 unchanged: metadata resolve -> OpenAI -> normalizer -> validator -> SQL Trust Gate --
```

- [ ] **Step 5: Migrate existing 18 tests in `tests/test_ai_ask_llm.py` to call `_analyze_core()`**

For each test that currently calls `svc.analyze(make_request(), db=db)`, change to `svc._analyze_core(make_request(), db=db)`. All existing assertions remain identical -- `_analyze_core` returns the same `AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse` types.

Tests to migrate (18 total):
| Test function | Current call | New call |
|---|---|---|
| `test_analyze_returns_llm_not_configured_when_no_active_setting` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_analyze_returns_success_for_valid_llm_response` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_analyze_sends_system_and_user_messages` | `svc.analyze(request, db=db)` | `svc._analyze_core(request, db=db)` |
| `test_analyze_returns_invalid_response_for_bad_json` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_analyze_overrides_sqlplan_datasource_with_request` | `svc.analyze(request, db=db)` | `svc._analyze_core(request, db=db)` |
| `test_analyze_does_not_create_sqlplan_when_missing` | `svc.analyze(request, db=db)` | `svc._analyze_core(request, db=db)` |
| `test_analyze_returns_invalid_response_when_choices_empty` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_analyze_returns_invalid_response_when_message_missing` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_analyze_returns_invalid_response_when_content_empty` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_analyze_returns_invalid_response_when_content_none` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_metadata_not_found_returns_error_and_does_not_call_llm` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_with_metadata_prompt_builder_receives_context` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_invalid_field_returns_invalid_response_with_sql_validation` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_table_schema_missing_in_sql_validator` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_partition_filter_missing_for_partition_table` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_sql_valid_pass_returns_ok_with_sql_pending` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_sql_pending_sanitizes_narrative` | `svc.analyze(make_request(), db=db)` | `svc._analyze_core(make_request(), db=db)` |
| `test_phase_5l_datasource_override_behavior_preserved` | `svc.analyze(request, db=db)` | `svc._analyze_core(request, db=db)` |

No assertion changes needed -- all test the LLM flow behavior, not identity binding.

- [ ] **Step 6: Update `POST /analyze` endpoint**

The existing route at `app/api/ai_ask.py` already calls `body.model_dump()` (no `by_alias`). The new fields (`session_id`, `assistant_message_id`) are part of `AiAskAnalyzeRequest` with Pydantic aliases, so they are included automatically. No route change needed.

The API integration test in Step 1 (`test_analyze_api_camelcase_integration`) covers the full pipeline: camelCase JSON -> Pydantic alias -> `body.model_dump()` -> service -> exact-message DB write via shared `tmp_path`.

- [ ] **Step 7: Update `RealLlmAdapter` and `AiAskContext`**

In `frontend/src/api/aiAsk/adapter.ts`, add to `AiAskContext`:
```typescript
sessionId?: number
assistantMessageId?: number
```

In `frontend/src/api/aiAsk/realLlmAdapter.ts`, update `analyze()` to include in fetch body:
```typescript
async analyze(question: string, context: AiAskContext): Promise<AiAskResponse> {
  const body = {
    question,
    datasourceId: context.datasourceId,
    datasourceName: context.datasourceName,
    selectedTables: context.selectedTables,
    messageHistory: context.messageHistory ?? [],
    sessionId: context.sessionId,
    assistantMessageId: context.assistantMessageId,
  }
  // ... existing fetch logic unchanged ...
}
```

- [ ] **Step 8: Run new binding tests**

```bash
cd D:/projects/MetricForge
python -m pytest tests/services/test_ai_ask_execution.py -v
```
Expected: All PASS.

- [ ] **Step 9: Run migrated existing tests**

```bash
cd D:/projects/MetricForge
python -m pytest tests/test_ai_ask_llm.py -v
```
Expected: All 18 tests PASS (same assertions, no behavior regression).

- [ ] **Step 10: Run broader tests**

```bash
cd D:/projects/MetricForge
python -m pytest tests/ -q
```
Expected: No regressions.

- [ ] **Step 11: Commit**

```bash
git add -- app/schemas/ai_ask.py app/services/ai_ask/llm_service.py app/api/ai_ask.py frontend/src/api/aiAsk/realLlmAdapter.ts frontend/src/api/aiAsk/adapter.ts tests/test_ai_ask_llm.py tests/services/test_ai_ask_execution.py
git commit --only -m "feat(phase-5n): split analyze into _analyze_core + binding wrapper, migrate tests" -- app/schemas/ai_ask.py app/services/ai_ask/llm_service.py app/api/ai_ask.py frontend/src/api/aiAsk/realLlmAdapter.ts frontend/src/api/aiAsk/adapter.ts tests/test_ai_ask_llm.py tests/services/test_ai_ask_execution.py
```

- [ ] **Step 12: Review gate**

```bash
git diff --cached --name-only
```
Expected: `docs/superpowers/specs/2026-07-16-install-taste-skill-design.md`

---


### Task 3: Session Isolation, Restoration & Auto-Title

**Files:**
- Modify: `frontend/src/stores/aiAskStore.ts` — remove `responseHistory`/`saveResponseForMessage`/`getResponseForMessage`; add `isExecuting`/`setExecuting`, `currentAssistantMessageId`/`setCurrentAssistantMessageId`
- Modify: `frontend/src/stores/askStore.ts` — ensure `currentSessionId` is cleared on new session creation
- Modify: `frontend/src/pages/AskWorkbenchPage.tsx` — handleSend uses resolvedSessionId; session-scoped `currentAssistantMessageId`; late response guard compares resolvedSessionId; restore response from last assistant message with valid response_json; auto-title call only when title is "新对话"
- Modify: `frontend/src/pages/AskWorkbenchPage.test.tsx` — add session isolation, late response guard, auto-title tests
- Create: `frontend/src/utils/title.ts` — `generateTitle()` utility
- Modify: `frontend/src/api/askSessions.ts` — add `useUpdateSessionTitle` mutation

---

- [ ] **Step 1: Write failing frontend tests for session isolation**

```typescript
// In frontend/src/pages/AskWorkbenchPage.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AskWorkbenchPage from './AskWorkbenchPage'
import { useAskStore } from '../stores/askStore'
import { useAiAskStore } from '../stores/aiAskStore'


test('switching sessions clears currentResponse from previous session', async () => {
  // Create session A with a response, session B with no messages.
  // Switch from A to B → B's currentResponse is null.
})


test('old request does not overwrite current session on late return', async () => {
  // Send question in session A (slow analyze).
  // Switch to session B before analyze completes.
  // Session A's late response must not change session B's state.
  // Use resolvedSessionId guard in handleSend.
})


test('auto-title updates session after first successful analysis', async () => {
  // Mock PUT /api/ask/sessions/{id} for title update
  // Submit first question
  // Verify PUT called with generated title
})


test('page refresh restores response from last valid assistant message', async () => {
  // Mock useAskMessages to return messages with one containing valid response_json
  // Verify on mount that currentResponse is restored
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd D:/projects/MetricForge/frontend
npx vitest run --reporter=verbose src/pages/AskWorkbenchPage.test.tsx 2>&1
```
Expected: Test failures due to missing behavior.

- [ ] **Step 3: Add `currentAssistantMessageId` to `aiAskStore`**

In `frontend/src/stores/aiAskStore.ts`:
- Delete `responseHistory`, `saveResponseForMessage`, `getResponseForMessage`
- Add:
```typescript
isExecuting: boolean
setExecuting: (v: boolean) => void
currentAssistantMessageId: number | null
setCurrentAssistantMessageId: (id: number | null) => void
```

- [ ] **Step 4: Implement `handleSend` with resolvedSessionId guard**

```typescript
// In AskWorkbenchPage.tsx
const handleSend = async (question: string) => {
  // Determine resolvedSessionId
  let resolvedSessionId = currentSessionId
  if (!resolvedSessionId) {
    const newSession = await createSession.mutateAsync({ title: '新对话' })
    resolvedSessionId = newSession.id
    setCurrentSessionId(resolvedSessionId)
  }

  // Create messages and get assistantMessageId
  const assistantMessage = await createMessage.mutateAsync({
    sessionId: resolvedSessionId,
    role: 'assistant',
    status: 'pending',
  })
  const assistantMessageId = assistantMessage.id

  // Store the assistantMessageId for this session
  setCurrentAssistantMessageId(assistantMessageId)

  // Invoke analyze with resolvedSessionId and assistantMessageId
  try {
    const result = await adapter.analyze(question, {
      datasourceId,
      datasourceName,
      selectedTables,
      messageHistory: buildMessageHistory(messages),
      sessionId: resolvedSessionId,
      assistantMessageId,
    })

    // Late response guard: only apply if session hasn't changed
    if (useAskStore.getState().currentSessionId !== resolvedSessionId) {
      return
    }

    setCurrentResponse(result)

    // Auto-title
    const session = useAskStore.getState().currentSessionId
    if (session && title === '新对话') {
      updateSessionTitle.mutate({ id: session, title: generateTitle(question) })
    }
  } catch (e) {
    if (useAskStore.getState().currentSessionId === resolvedSessionId) {
      setError(...)
    }
  }
}
```

- [ ] **Step 5: Add `generateTitle` utility**

In `frontend/src/utils/title.ts`:
```typescript
export function generateTitle(question: string): string {
  const match = question.match(/^(.+?[。？！\n])/)
  let title = match ? match[1] : question
  const MAX_CHARS = 48
  if (title.length > MAX_CHARS) {
    title = title.slice(0, MAX_CHARS) + '…'
  }
  return title.trim()
}
```

- [ ] **Step 6: Add `useUpdateSessionTitle` mutation**

In `frontend/src/api/askSessions.ts`:
```typescript
import { useMutation } from '@tanstack/react-query'

export function useUpdateSessionTitle() {
  return useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      fetch(`/api/ask/sessions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }).then(r => r.json()),
  })
}
```

- [ ] **Step 7: Add session restoration on mount**

On AskWorkbenchPage mount, when `currentSessionId` changes:
1. Fetch messages via `useAskMessages`
2. Find the last assistant message whose `response_json` is non-null and parseable
3. Call `setCurrentResponse(data)` and `setCurrentAssistantMessageId(msg.id)`
4. On new session creation or deletion, clear both `currentResponse` and `currentAssistantMessageId`

- [ ] **Step 8: Run tests**

```bash
cd D:/projects/MetricForge/frontend
npx vitest run --reporter=verbose src/pages/AskWorkbenchPage.test.tsx 2>&1
```
Expected: Session isolation tests pass.

- [ ] **Step 9: Commit**

```bash
git add -- frontend/src/stores/aiAskStore.ts frontend/src/pages/AskWorkbenchPage.tsx frontend/src/pages/AskWorkbenchPage.test.tsx frontend/src/utils/title.ts frontend/src/api/askSessions.ts
git commit --only -m "feat(phase-5n): session isolation and auto-title generation" -- frontend/src/stores/aiAskStore.ts frontend/src/pages/AskWorkbenchPage.tsx frontend/src/pages/AskWorkbenchPage.test.tsx frontend/src/utils/title.ts frontend/src/api/askSessions.ts
```

- [ ] **Step 10: Review gate**

```bash
git diff --cached --name-only
```

---

### Task 4: Unified Data Scope

**Files:**
- Delete: `frontend/src/components/DataScopeSelector.tsx`
- Delete: related DataScopeSelector test files if they exist (e.g., any `DataScopeSelector.test.tsx`)
- Modify: `frontend/src/components/DataScopeBar.tsx` — replace `siderCollapsed`/`onToggleCollapse` props with search Input + browse-all Drawer; datasource switch clears selectedTables; search uses 300ms debounce; results show schema_name.table_name, object type, matched_on
- Modify: `frontend/src/pages/AskWorkbenchPage.tsx` — remove `DataScopeSelector` import and `<Sider>` rendering; update `DataScopeBar` usage (no props)
- Test: `frontend/src/components/DataScopeBar.test.tsx` — modify (already exists or add new)
- Modify: `frontend/src/pages/AskWorkbenchPage.test.tsx` — remove `DataScopeSelector` references

**Interfaces:**
- Consumes: `useAiAskStore.datasourceId`, `setDatasource`, `setSelectedTables`, existing SQL Workbench query hook for `/api/sql/schema/search`
- Produces: `selectedTables` always in `SCHEMA.OBJECT` format; zero default foreign table list rendered

---

- [ ] **Step 1: Write failing `DataScopeBar.test.tsx` tests**

```typescript
// frontend/src/components/DataScopeBar.test.tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import DataScopeBar from './DataScopeBar'
import { useAiAskStore } from '../stores/aiAskStore'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'


function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient()
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}


test('renders search input only when datasourceId is set', () => {
  useAiAskStore.getState().setDatasource(null, null)
  const { rerender } = renderWithQuery(<DataScopeBar />)
  expect(screen.queryByPlaceholderText(/搜索/i)).not.toBeInTheDocument()

  useAiAskStore.getState().setDatasource(1, 'test_db')
  rerenderWithQuery(<DataScopeBar />)
  expect(screen.getByPlaceholderText(/搜索/i)).toBeInTheDocument()
})


test('search calls API with datasource_id and query', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [{ table_name: 'TEST', schema_name: 'PUBLIC', matched_on: 'table_name' }],
  })
  useAiAskStore.getState().setDatasource(1, 'test_db')
  renderWithQuery(<DataScopeBar />)
  const input = screen.getByPlaceholderText(/搜索/i)
  fireEvent.change(input, { target: { value: 'test' } })
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/sql/schema/search?datasource_id=1&q=test')
    )
  })
})


test('selectedTables displayed as tags with SCHEMA.OBJECT format', () => {
  useAiAskStore.getState().setDatasource(1, 'test_db')
  useAiAskStore.getState().setSelectedTables(['PUBLIC.TEST', 'PUBLIC.ANOTHER'])
  renderWithQuery(<DataScopeBar />)
  expect(screen.getByText('PUBLIC.TEST')).toBeInTheDocument()
  expect(screen.getByText('PUBLIC.ANOTHER')).toBeInTheDocument()
})


test('switching datasource clears selectedTables via UI onChange', async () => {
  useAiAskStore.getState().setDatasource(1, 'old_db')
  useAiAskStore.getState().setSelectedTables(['PUBLIC.TEST'])
  renderWithQuery(<DataScopeBar />)
  // Change datasource through the Select component
  const select = screen.getByRole('combobox')
  fireEvent.mouseDown(select)
  const option = await screen.findByTitle('new_db')
  fireEvent.click(option)
  expect(useAiAskStore.getState().selectedTables).toEqual([])
})


test('search result shows schema.table and matched_on', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [
      { schema_name: 'PUBLIC', table_name: 'CUSTOMERS', matched_on: 'table_name' },
    ],
  })
  useAiAskStore.getState().setDatasource(1, 'test_db')
  renderWithQuery(<DataScopeBar />)
  const input = screen.getByPlaceholderText(/搜索/i)
  fireEvent.change(input, { target: { value: 'cust' } })
  await waitFor(() => {
    expect(screen.getByText('PUBLIC.CUSTOMERS')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd D:/projects/MetricForge/frontend
npx vitest run --reporter=verbose src/components/DataScopeBar.test.tsx 2>&1
```
Expected: FAIL — component doesn't have search yet.

- [ ] **Step 3: Remove `DataScopeSelector.tsx`**

```bash
rm frontend/src/components/DataScopeSelector.tsx
# Also remove any DataScopeSelector test file
rm -f frontend/src/components/DataScopeSelector.test.tsx
```

- [ ] **Step 4: Rewrite `DataScopeBar.tsx`**

Remove `siderCollapsed`/`onToggleCollapse` props. New structure:

```tsx
import React, { useState, useEffect, useCallback } from 'react'
import { Select, Input, Tag, Button, Drawer, Collapse, List, Spin } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useAiAskStore } from '../stores/aiAskStore'
import { useDatasources } from '../api/sqlDatasources'

const DataScopeBar: React.FC = () => {
  const { datasourceId, datasourceName, selectedTables, setDatasource, setSelectedTables } = useAiAskStore()
  const { data: datasources } = useDatasources()
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [browseOpen, setBrowseOpen] = useState(false)

  const handleDatasourceChange = (value: number, option: any) => {
    setDatasource(value, option.label)
    setSelectedTables([])
    setQuery('')
    setSearchResults([])
  }

  // 300ms debounce search
  useEffect(() => {
    if (!datasourceId || !query.trim()) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const resp = await fetch(`/api/sql/schema/search?datasource_id=${datasourceId}&q=${encodeURIComponent(query)}`)
        const data = await resp.json()
        setSearchResults(data ?? [])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [datasourceId, query])

  const handleSelectTable = (schemaTable: string) => {
    const current = new Set(selectedTables)
    if (!current.has(schemaTable)) {
      setSelectedTables([...current, schemaTable])
    }
  }

  const handleRemoveTable = (schemaTable: string) => {
    setSelectedTables(selectedTables.filter(t => t !== schemaTable))
  }

  const handleClearSearch = () => {
    setQuery('')
    setSearchResults([])
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', flexWrap: 'wrap', borderBottom: '1px solid #f0f0f0' }}>
      <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>数据范围</span>
      <Select
        value={datasourceId ? { value: datasourceId, label: datasourceName } : undefined}
        placeholder="选择数据源"
        onChange={handleDatasourceChange}
        labelInValue
        options={(datasources ?? []).map(ds => ({ value: ds.id, label: ds.name }))}
        style={{ width: 180 }}
        allowClear
        onClear={() => { setDatasource(null, null); setSelectedTables([]) }}
      />
      {datasourceId && (
        <>
          <Input.Search
            placeholder="搜索表名、字段名或注释"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onSearch={handleClearSearch}
            loading={searching}
            style={{ width: 280 }}
          />
          <Button size="small" onClick={() => setBrowseOpen(true)}>浏览全部</Button>
        </>
      )}
      {/* Search results dropdown */}
      {query && searchResults.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: '#fff', border: '1px solid #d9d9d9', borderRadius: 4, maxHeight: 300, overflow: 'auto', marginTop: 4 }}>
          {searchResults.map((r, i) => (
            <div key={i} style={{ padding: '6px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
                 onClick={() => handleSelectTable(`${r.schema_name}.${r.table_name}`)}>
              <span>{r.schema_name}.{r.table_name}</span>
              <span style={{ color: '#888', fontSize: 12 }}>
                {r.object_type || '数据对象'} · {r.matched_on}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* Selected tables as tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {selectedTables.map(t => (
          <Tag key={t} closable onClose={() => handleRemoveTable(t)}>{t}</Tag>
        ))}
      </div>
      <Drawer title="浏览全部数据对象" open={browseOpen} onClose={() => setBrowseOpen(false)} width={400}>
        {/* TODO: Load full schema list from /api/sql/schema?datasource_id=X
            Group by schema, show schema_name.table_name in Collapse panels.
            Click to add to selectedTables.
            If existing metadata cannot distinguish TABLE/VIEW, display "数据对象". */}
      </Drawer>
    </div>
  )
}
```

- [ ] **Step 5: Remove `DataScopeSelector` import and `<Sider>` content from `AskWorkbenchPage`**

- Delete `import DataScopeSelector from '../components/DataScopeSelector'`
- Remove `<DataScopeSelector ... />` JSX from the `<Sider>` section
- Change `<DataScopeBar siderCollapsed={...} onToggleCollapse={...} />` to `<DataScopeBar />`
- The Sider now only contains `<SessionList />`

- [ ] **Step 6: Run tests**

```bash
cd D:/projects/MetricForge/frontend
npx vitest run --reporter=verbose src/components/DataScopeBar.test.tsx 2>&1
```
Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add -- frontend/src/components/DataScopeBar.tsx frontend/src/components/DataScopeSelector.tsx frontend/src/pages/AskWorkbenchPage.tsx frontend/src/pages/AskWorkbenchPage.test.tsx frontend/src/components/DataScopeBar.test.tsx
git commit --only -m "feat(phase-5n): unify data scope with search and browse-all" -- frontend/src/components/DataScopeBar.tsx frontend/src/components/DataScopeSelector.tsx frontend/src/pages/AskWorkbenchPage.tsx frontend/src/pages/AskWorkbenchPage.test.tsx frontend/src/components/DataScopeBar.test.tsx
```

- [ ] **Step 8: Review gate**

```bash
git diff --cached --name-only
```

---

### Task 5: Remove Mock Switch & Unify Input Area

**Files:**
- Modify: `frontend/src/stores/aiAskStore.ts` — remove `useRealLlm`/`setUseRealLlm`; keep `MockAdapter` named export for tests/benchmark but delete production selection logic
- Modify: `frontend/src/api/aiAsk/index.ts` — `useAiAskService` returns `RealLlmAdapter.create()` always; remove `useRealLlm` option
- Modify: `frontend/src/pages/AskWorkbenchPage.tsx` — remove `<Switch>` JSX, tooltip texts, "切回模拟模式再试" buttons; unify Layout into single structure; remove conditional rendering branches for input area
- Modify: `frontend/src/pages/AskWorkbenchPage.test.tsx` — remove Mock Switch tests; add no-active-LLM disabled state test; add layout stability test (welcome/sql_pending/executed all have exactly one AskInput)
- Modify: `frontend/src/components/AskInput.tsx` — add `disabled` prop with `Tooltip` single-wrapper; do not put multiple siblings inside Tooltip

---

- [ ] **Step 1: Write failing tests**

```typescript
// In AskWorkbenchPage.test.tsx
test('send button disabled with tooltip when no active LLM', () => {
  // Mock useLlmSettings to return empty array
  // Verify send button area is disabled with expected tooltip text
})


test('no mock switch rendered on page', () => {
  render(<AskWorkbenchPage />)
  expect(screen.queryByText(/模拟模式|真实 LLM/i)).not.toBeInTheDocument()
})


test('single unified AskInput container across all states', () => {
  // Render with welcome state — exactly one AskInput
  // Render with sql_pending state — exactly one AskInput (same container)
  // Render with executed state — exactly one AskInput (same container)
  const { container } = render(<AskWorkbenchPage />)
  const askInputs = container.querySelectorAll('.ask-input-container')
  expect(askInputs.length).toBe(1)
})
```

- [ ] **Step 2: Remove `useRealLlm` from store**

In `frontend/src/stores/aiAskStore.ts`:
- Delete `useRealLlm: false` from initial state
- Delete `setUseRealLlm: (v: boolean) => void` from interface
- Delete `setUseRealLlm` from actions
- Remove `useRealLlm` from `reset()` if present

Keep `MockAdapter` import in the store removed. The `MockAdapter` named export in `mockAdapter.ts` must be preserved for test/benchmark imports.

- [ ] **Step 3: Fix `useAiAskService`**

In `frontend/src/api/aiAsk/index.ts`:
```typescript
import { RealLlmAdapter } from './realLlmAdapter'

export function useAiAskService() {
  const adapter = RealLlmAdapter.create()
  return {
    analyze: adapter.analyze.bind(adapter),
    getChartData: adapter.getChartData.bind(adapter),
    isAvailable: adapter.isAvailable.bind(adapter),
    name: adapter.name,
    validate: validateAiAskResponse,
  }
}
```

Remove `MockAdapter` export from index.ts (keep import in test files and mockAdapter.ts itself; mockAdapter.ts still exports `MockAdapter`).

- [ ] **Step 4: Remove Mock Switch JSX from `AskWorkbenchPage`**

Delete the entire `<Switch>` block with `checkedChildren="真实 LLM"` / `unCheckedChildren="模拟模式"`.
Delete all "切回模拟模式再试" buttons.
Remove any adapter-selection logic from the JSX.

- [ ] **Step 5: Unify Layout to single structure**

Replace three separate layout branches with a single Layout:
```tsx
<Layout style={{ height: '100vh' }}>
  <Sider width={280}><SessionList /></Sider>
  <Layout>
    <Header><AgentNav /></Header>
    <DataScopeBar />
    <Content style={{ overflowY: 'auto', flex: 1, padding: 16 }}>
      {/* Conditionally render welcome / messages / results */}
      {!currentSessionId && <Welcome />}
      {currentSessionId && messages && <MessagesView />}
    </Content>
    <div className="ask-input-container" style={{ padding: '12px 24px', borderTop: '1px solid #f0f0f0' }}>
      <AskInput disabled={!hasActiveLlm} />
    </div>
  </Layout>
</Layout>
```

This ensures the input container is always present and sized identically.

- [ ] **Step 6: Add `disabled` + tooltip to `AskInput`**

In `AskInput.tsx`:
```typescript
interface AskInputProps {
  disabled?: boolean
}

// When disabled:
<Tooltip title="未启用 LLM 模型，请前往配置">
  <Input.TextArea disabled />
</Tooltip>
```

Use a single wrapper around TextArea. Do not wrap multiple siblings inside Tooltip.

- [ ] **Step 7: Run tests**

```bash
cd D:/projects/MetricForge/frontend
npx vitest run --reporter=verbose src/pages/AskWorkbenchPage.test.tsx 2>&1
```
Expected: Tests pass, Mock Switch tests removed, new tests pass.

- [ ] **Step 8: Commit**

```bash
git add -- frontend/src/stores/aiAskStore.ts frontend/src/api/aiAsk/index.ts frontend/src/pages/AskWorkbenchPage.tsx frontend/src/pages/AskWorkbenchPage.test.tsx frontend/src/components/AskInput.tsx
git commit --only -m "feat(phase-5n): remove mock switch, unify input layout" -- frontend/src/stores/aiAskStore.ts frontend/src/api/aiAsk/index.ts frontend/src/pages/AskWorkbenchPage.tsx frontend/src/pages/AskWorkbenchPage.test.tsx frontend/src/components/AskInput.tsx
```

- [ ] **Step 9: Review gate**

```bash
git diff --cached --name-only
```

---

### Task 6: Deterministic Executed Narrative Builder

**Files:**
- Create: `app/services/ai_ask/narrative_builder.py` — `_to_finite_number`, `_detect_metric_columns`, `_format_compact`, `build_executed_narrative`
- Create: `tests/services/test_ai_ask_narrative.py` — pure-function unit tests
- Modify: `app/services/ai_ask/__init__.py` — export `build_executed_narrative`

**Interfaces:**
- Produces: `build_executed_narrative(columns: list[str], rows: list[list], is_truncated: bool, elapsed_ms: int) -> dict`
- Consumes: None (pure function, no DB or LLM calls)

---

- [ ] **Step 1: Write failing narrative tests**

```python
# tests/services/test_ai_ask_narrative.py
from decimal import Decimal
from app.services.ai_ask.narrative_builder import (
    _to_finite_number, _detect_metric_columns, build_executed_narrative,
)


class TestToFiniteNumber:
    def test_none(self):
        assert _to_finite_number(None) is None

    def test_bool_is_not_numeric(self):
        assert _to_finite_number(True) is None
        assert _to_finite_number(False) is None

    def test_int(self):
        assert _to_finite_number(42) == Decimal("42")

    def test_float(self):
        assert _to_finite_number(3.14) == Decimal("3.14")

    def test_numeric_string(self):
        assert _to_finite_number("12.50") == Decimal("12.50")

    def test_nan(self):
        import math
        assert _to_finite_number(float("nan")) is None
        assert _to_finite_number(float("inf")) is None
        assert _to_finite_number(float("-inf")) is None

    def test_empty_string(self):
        assert _to_finite_number("") is None

    def test_non_numeric_string(self):
        assert _to_finite_number("abc") is None

    def test_decimal(self):
        assert _to_finite_number(Decimal("99.9")) == Decimal("99.9")


class TestBuildExecutedNarrative:
    def test_empty_result(self):
        result = build_executed_narrative(["col"], [], False, 0)
        assert result["summary"] == "查询成功但无数据"
        assert result["keyFindings"] == []
        assert result["evidence"] == []

    def test_basic_metrics(self):
        cols = ["name", "amount", "count"]
        rows = [["A", Decimal("100"), 10], ["B", Decimal("200"), 20]]
        result = build_executed_narrative(cols, rows, False, 150)
        assert "150ms" in result["summary"]
        assert result["keyFindings"]  # amount and count metrics present

    def test_id_column_excluded(self):
        cols = ["id", "name", "amount"]
        rows = [[1, "A", Decimal("100")]]
        result = build_executed_narrative(cols, rows, False, 10)
        # 'id' should not be a metric — id is in _NON_METRIC_KEYWORDS
        metric_findings = [k for k in result["keyFindings"] if str(k).startswith("id")]
        assert len(metric_findings) == 0

    def test_truncated_indicator(self):
        cols = ["col"]
        rows = [["x"]]
        result = build_executed_narrative(cols, rows, True, 200)
        assert "已截断" in result["summary"]
        assert len(result.get("risks", [])) > 0

    def test_mixed_numeric_types(self):
        cols = ["val"]
        rows = [[Decimal("10.5")], [20], ["30.75"], [True]]
        result = build_executed_narrative(cols, rows, False, 50)
        # True should be excluded from numeric — remaining: 10.5, 20, 30.75
        assert len(result["keyFindings"]) > 0


class TestDetectMetricColumns:
    def test_first_row_null_still_scans_rest(self):
        """First row has null, second row has Decimal — column is metric."""
        cols = ["amount"]
        rows = [[None], [Decimal("100")]]
        result = _detect_metric_columns(cols, rows)
        assert "amount" in result

    def test_bool_not_metric(self):
        cols = ["active"]
        rows = [[True], [False]]
        result = _detect_metric_columns(cols, rows)
        assert "active" not in result

    def test_id_not_metric(self):
        cols = ["user_id"]
        rows = [[1], [2]]
        result = _detect_metric_columns(cols, rows)
        assert "user_id" not in result
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd D:/projects/MetricForge
python -m pytest tests/services/test_ai_ask_narrative.py -v
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `narrative_builder.py`**

Write to `app/services/ai_ask/narrative_builder.py`:
```python
from decimal import Decimal, InvalidOperation
from math import isfinite
from typing import Any, Optional


_NON_METRIC_KEYWORDS = frozenset({
    "id", "code", "cd", "no", "num",
    "date", "time", "timestamp", "datetime",
    "key", "hash", "guid",
})


def _to_finite_number(value: Any) -> Optional[Decimal]:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value if isfinite(value) else None
    if isinstance(value, (int, float)):
        return Decimal(str(value)) if isfinite(value) else None
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return None
        try:
            d = Decimal(v)
            return d if isfinite(d) else None
        except (InvalidOperation, TypeError, ValueError):
            return None
    return None


def _detect_metric_columns(columns: list[str], rows: list[list]) -> list[str]:
    if not rows:
        return []
    metrics = []
    for i, col in enumerate(columns):
        col_lower = col.lower()
        # Skip columns whose names contain non-metric keywords
        if any(kw in col_lower for kw in _NON_METRIC_KEYWORDS):
            continue
        # Look through all rows — first non-null value decides
        for row in rows:
            val = row[i] if i < len(row) else None
            if val is not None and _to_finite_number(val) is not None:
                metrics.append(col)
                break
            # Continue to next row if current is None or non-numeric
        # If all rows are None/empty, the column is not a metric
    return metrics


def _format_compact(value: Decimal) -> str:
    fval = float(value)
    if abs(fval) >= 100_000_000:
        return f"{fval / 100_000_000:.2f}亿"
    elif abs(fval) >= 10_000:
        return f"{fval / 10_000:.2f}万"
    return f"{fval:,.2f}"


def build_executed_narrative(columns, rows, is_truncated, elapsed_ms):
    row_count = len(rows)
    if row_count == 0:
        return {
            "summary": "查询成功但无数据",
            "keyFindings": [], "evidence": [],
            "risks": [], "nextQuestions": [],
        }

    metric_cols = _detect_metric_columns(columns, rows)
    dim_cols = [c for c in columns if c not in metric_cols]

    summary = (
        f"查询返回 {row_count} 行数据（已截断，仅展示前 {row_count} 行），耗时 {elapsed_ms}ms。"
        if is_truncated else
        f"查询返回 {row_count} 行数据，耗时 {elapsed_ms}ms。"
    )

    key_findings = []
    for col in metric_cols:
        col_idx = columns.index(col)
        vals = [_to_finite_number(row[col_idx]) for row in rows if col_idx < len(row)]
        vals = [v for v in vals if v is not None]
        if vals:
            key_findings.append(
                f"{col}：最大值 {_format_compact(max(vals))}，最小值 {_format_compact(min(vals))}"
            )

    for col in dim_cols[:3]:
        col_idx = columns.index(col)
        uniq = set()
        for row in rows:
            if col_idx < len(row) and row[col_idx] is not None:
                uniq.add(str(row[col_idx]))
        key_findings.append(f"{col}：共 {len(uniq)} 个不同值")

    evidence = []
    for col in metric_cols:
        col_idx = columns.index(col)
        vals = [_to_finite_number(row[col_idx]) for row in rows if col_idx < len(row)]
        vals = [v for v in vals if v is not None]
        if vals:
            total = sum(vals, Decimal("0"))
            avg = total / len(vals)
            evidence.append({
                "claim": f"{col} 汇总",
                "fields": [col],
                "value": f"总和 {_format_compact(total)}，平均 {_format_compact(avg)}",
                "confidence": "high",
            })

    risks = []
    if is_truncated:
        risks.append({
            "risk": f"结果已截断，仅显示前 {row_count} 行",
            "suggestion": "建议细化查询条件",
        })

    return {
        "summary": summary,
        "keyFindings": key_findings,
        "evidence": evidence,
        "risks": risks,
        "nextQuestions": [],
    }
```

- [ ] **Step 4: Run tests**

```bash
cd D:/projects/MetricForge
python -m pytest tests/services/test_ai_ask_narrative.py -v
```
Expected: All PASS.

- [ ] **Step 5: Export `build_executed_narrative` from package**

In `app/services/ai_ask/__init__.py`, add:
```python
from .narrative_builder import build_executed_narrative
```

- [ ] **Step 6: Commit**

```bash
git add -- app/services/ai_ask/narrative_builder.py app/services/ai_ask/__init__.py tests/services/test_ai_ask_narrative.py
git commit --only -m "feat(phase-5n): deterministic executed narrative builder" -- app/services/ai_ask/narrative_builder.py app/services/ai_ask/__init__.py tests/services/test_ai_ask_narrative.py
```

- [ ] **Step 7: Review gate**

```bash
git diff --cached --name-only
```

---

### Task 6.5: SQL Supervision Architecture Correction

> **目标**：修正当前 `SqlExecutionService` 的子进程超时架构，实现 parent-resolved datasource、explicit spawn、atomic result file、bounded payload、safe janitor 和凭据脱敏。采用 TDD。

**Files:**

- Create: `app/services/sql_supervision.py` — `WorkerRequest`、`_supervise_sync`、spawn state machine、atomic result file transport、operational deadline
- Create: `app/services/sql_result_serializer.py` — cross-process serialization/deserialization with incremental `MAX_RESULT_BYTES` budget
- Create: `app/services/sql_temp_janitor.py` — background janitor based on `worker.json` metadata
- Create: `tests/__init__.py` — ensure `tests` is a package so fresh spawn can import `tests.support`
- Create: `tests/support/__init__.py` — make `tests.support` importable
- Create: `tests/support/sql_worker_factories.py` — pickle-safe top-level fake adapter factories
- Create: `tests/services/sql/test_execution_supervision.py` — RED tests for state machine, transport, async boundary, janitor, credential redaction
- Modify: `requirements.txt` — add `psutil>=5.9.0`
- Modify: `app/main.py` — start/stop SQL temp janitor in app lifespan
- Modify: `app/services/sql_execution_service.py` — remove env adapter hook; accept `adapter_factory` in constructor; `execute()` uses `asyncio.to_thread`; `execute_sync` uses same core
- Modify: `app/adapters/oracle.py` — add `oracle_adapter_factory` top-level function
- Modify: `app/services/ai_ask/execution_service.py` — adapt to new `SqlExecutionService.execute_sync` signature
- Modify: `frontend/src/types/aiAsk.ts` — add optional `columnTypes?: string[]` to queryResult type
- Modify: `frontend/src/api/aiAsk/validator.ts` — use `columnTypes` if present; fallback to runtime inference
- Modify: `frontend/src/api/aiAsk/recommendation.ts` — consider `columnTypes`; treat `decimal` as numeric; degrade on incompatible types
- Modify: `frontend/src/components/AiChartBoard.tsx` — use `columnTypes` for field type detection
- Modify: `frontend/src/components/ChartCard.tsx` — validate field types before chart; show explanation for unsafe Decimal
- Modify: `frontend/src/components/ChartCanvas.tsx` — handle `decimal` string conversion; degrade to table when unsafe
- Modify: `frontend/src/pages/AskWorkbenchPage.tsx` — store `columnTypes` into chart data after execution
- Delete: `app/adapters/fake_slow_adapter.py`
- Delete: `_METRICFORGE_SQL_ADAPTER_CLASS` env hook and tests relying on it

**Interfaces:**

- `WorkerRequest(adapter_type, host, port, service_name, sid, username, password, dialect, lib_dir, sql)`
- `oracle_adapter_factory(request: WorkerRequest) -> DataSourceAdapter`
- `fake_adapter_factory(request: WorkerRequest) -> DataSourceAdapter`
- `_supervise_sync(adapter_factory, request, timeout_seconds) -> dict`
- `MAX_RESULT_ROWS = 1000`, `MAX_RESULT_BYTES = 10 * 1024 * 1024`
- Error codes: `TIMEOUT`, `WORKER_CRASH`, `WORKER_PROTOCOL_ERROR`, `SERIALIZATION_ERROR`, `EXECUTION_ERROR`, `TERMINATION_FAILURE`

---

- [ ] **Step 0: Dependency preparation**

Update `requirements.txt`:

```text
psutil>=5.9.0
```

Install dependencies and verify:

```bash
pip install -r requirements.txt
python -c "import psutil; print(psutil.__version__)"
```

- [ ] **Step 1: Write RED tests**

Create `tests/services/sql/test_execution_supervision.py` with failing tests for:

1. `test_exit_0_without_result_returns_worker_protocol_error`
2. `test_termination_failure_does_not_cleanup`
3. `test_natural_exit_grace_respected`
4. `test_state_machine_no_early_return`
5. `test_hanging_worker_returns_before_outer_watchdog_timeout`
6. `test_timeout_after_multiple_consecutive_timeouts_no_leak`
7. `test_1000_large_string_rows_no_deadlock`
8. `test_exceeds_max_result_bytes`
9. `test_worker_crash_returns_worker_crash`
10. `test_corrupt_result_returns_worker_protocol_error`
11. `test_serialization_failure_returns_serialization_error`
12. `test_missing_datasource_404_no_history`
13. `test_production_resolution_uses_oracle_factory`
14. `test_fresh_spawn_imports_test_factory`
15. `test_async_endpoint_heartbeat_during_query`
16. `test_session_not_crossed_into_worker_thread`
17. `test_decimal_date_datetime_bytes_contract`
18. `test_mixed_and_null_column_types`
19. `test_lob_within_byte_budget`
20. `test_unsafe_decimal_not_charted`
21. `test_janitor_skips_live_worker`
22. `test_janitor_skips_termination_failure_directory`
23. `test_stale_temp_directory_janitor`
24. `test_credentials_redacted_from_result_and_api`
25. `test_parent_supervision_exception_maps_to_execution_error`
26. `test_ai_ask_timeout_restores_completed_sql_pending`
27. `test_active_children_empty_after_timeout`

Run `python -m pytest tests/services/sql/test_execution_supervision.py -v` and confirm they fail.

- [ ] **Step 2: Implement serializer and typed payload**

Implement `app/services/sql_result_serializer.py`:

- `_serialize_value(cell)` with type tags for `null/bool/int/float/decimal/date/datetime/bytes/str`
- `_read_lob_within_budget(lob, remaining)` chunked read
- `serialize_result(columns, rows)` with incremental `MAX_RESULT_BYTES` budget
- `_deserialize_value(item)` for the reverse direction
- `SerializationError` for unknown types or budget exceeded

Tests in `tests/services/sql/test_execution_supervision.py` should now pass for serialization contract tests.

- [ ] **Step 3: Implement spawn-safe factories**

Implement in `app/adapters/oracle.py`:

```python
def oracle_adapter_factory(request: WorkerRequest) -> DataSourceAdapter:
    return OracleAdapter({...})
```

Create the following package files so fresh spawn can import `tests.support`:

- `tests/__init__.py`
- `tests/support/__init__.py`
- `tests/support/sql_worker_factories.py`

```python
# tests/__init__.py
```

```python
# tests/support/__init__.py
```

```python
# tests/support/sql_worker_factories.py
from app.adapters.base import DataSourceAdapter, QueryResult

class FakeDataSourceAdapter(DataSourceAdapter):
    ...

def fake_adapter_factory(request: WorkerRequest) -> DataSourceAdapter:
    return FakeDataSourceAdapter({"password": request.password})
```

Delete `app/adapters/fake_slow_adapter.py`. Remove `_METRICFORGE_SQL_ADAPTER_CLASS` usage.

- [ ] **Step 4: Implement parent datasource resolution**

Implement `resolve_worker_request(db, datasource_id, sql)` in `app/services/sql_supervision.py`:

- Query `DatasourceConfig` with given Session.
- 404 if missing; no history written; no child spawned.
- `password = ds.password_enc or ""` (do not call `key_encryption.decrypt()` in Phase 5N).
- Return `WorkerRequest`.

- [ ] **Step 5: Implement supervision state machine**

Implement `_supervise_sync(adapter_factory, request, timeout_seconds)` in `app/services/sql_supervision.py`:

- Single `outcome` variable; no early return.
- `time.monotonic()` everywhere.
- Spawn with `multiprocessing.get_context("spawn")`.
- Poll `result.json` and `process.exitcode` concurrently.
- `EXEC_TIMEOUT` → `TIMEOUT`.
- Non-zero exit without result → `WORKER_CRASH`.
- Zero exit without result → `WORKER_PROTOCOL_ERROR`.
- Empty/corrupt/unparseable `result.json` → `WORKER_PROTOCOL_ERROR`.
- File size > `MAX_RESULT_BYTES` → `SERIALIZATION_ERROR`.
- `TERMINATION_FAILURE` if `kill()` does not terminate child.
- `finally` schedules cleanup only when safe.

- [ ] **Step 6: Implement async boundary**

Modify `app/services/sql_execution_service.py`:

- Constructor accepts `adapter_factory=None`.
- `execute(...)` uses `asyncio.to_thread(self._supervise_sync, ...)`.
- `execute_sync(...)` calls `self._supervise_sync(...)` directly on current thread.
- `_finalize` writes history in the owning thread.

- [ ] **Step 7: Implement janitor**

Implement `app/services/sql_temp_janitor.py`:

- Write `worker.json` metadata (pid, createdAt, state) into each work dir.
- Skip active worker and `termination_failure` directories.
- Use psutil process name/creation time to mitigate Windows PID reuse.
- Clean only directories older than 24h with confirmed-dead worker.

Modify `app/main.py` to start/stop janitor in the app lifespan:

```python
from contextlib import asynccontextmanager

@asynccontextmanager
def lifespan(app: FastAPI):
    janitor_thread, stop_event = start_sql_temp_janitor()
    try:
        yield
    finally:
        stop_event.set()
        janitor_thread.join(timeout=5.0)
```

Requirements:

- Do not create an un-stoppable background thread.
- On shutdown, set the stop event and perform a bounded `join()`.
- Add a test that repeatedly creates the app via `create_app()`/`TestClient()` and asserts no janitor thread leaks.

- [ ] **Step 8: AI Ask 状态恢复**

Modify `app/services/ai_ask/execution_service.py`:

- Use new `SqlExecutionService(adapter_factory=oracle_adapter_factory).execute_sync(...)`.
- On any error from `execute_sync`, keep `status=completed`, `narrativeLevel=sql_pending`.
- Map `TERMINATION_FAILURE`/`WORKER_CRASH` to `AiAskErrorCode.EXECUTION_ERROR`.

- [ ] **Step 9: Frontend columnTypes and unsafe Decimal protection**

Modify frontend files:

- `frontend/src/types/aiAsk.ts`: add `columnTypes?: string[]` to queryResult type.
- `frontend/src/api/aiAsk/validator.ts`: use `columnTypes` if present; fallback compatible.
- `frontend/src/api/aiAsk/recommendation.ts`: `decimal` numeric; `mixed`/`unknown` no chart.
- `frontend/src/components/AiChartBoard.tsx`: use `columnTypes`.
- `frontend/src/components/ChartCard.tsx`: unsafe Decimal → explanation.
- `frontend/src/components/ChartCanvas.tsx`: safe conversion; degrade to table.
- `frontend/src/pages/AskWorkbenchPage.tsx`: store `columnTypes`.

- [ ] **Step 10: Scoped and full verification**

Scoped verification:

```bash
python -m pytest tests/services/sql/test_execution_supervision.py -v
python -m pytest tests/services/test_ai_ask_execution.py -v
```

Full verification:

```bash
python -m pytest tests/ -q
cd frontend && npx vitest run --reporter=verbose
npx tsc --noEmit
npm run build
```

Review gate:

```bash
git diff --cached --name-only
```

Must only contain `docs/superpowers/specs/2026-07-16-install-taste-skill-design.md`.

```bash
git add -- app/services/sql_supervision.py app/services/sql_result_serializer.py app/services/sql_temp_janitor.py tests/__init__.py tests/support/__init__.py tests/support/sql_worker_factories.py tests/services/sql/test_execution_supervision.py app/services/sql_execution_service.py app/adapters/oracle.py app/services/ai_ask/execution_service.py app/main.py requirements.txt frontend/src/types/aiAsk.ts frontend/src/api/aiAsk/validator.ts frontend/src/api/aiAsk/recommendation.ts frontend/src/components/AiChartBoard.tsx frontend/src/components/ChartCard.tsx frontend/src/components/ChartCanvas.tsx frontend/src/pages/AskWorkbenchPage.tsx
git commit --only -m "feat(phase-5n): bounded SQL supervision architecture" -- app/services/sql_supervision.py app/services/sql_result_serializer.py app/services/sql_temp_janitor.py tests/__init__.py tests/support/__init__.py tests/support/sql_worker_factories.py tests/services/sql/test_execution_supervision.py app/services/sql_execution_service.py app/adapters/oracle.py app/services/ai_ask/execution_service.py app/main.py requirements.txt frontend/src/types/aiAsk.ts frontend/src/api/aiAsk/validator.ts frontend/src/api/aiAsk/recommendation.ts frontend/src/components/AiChartBoard.tsx frontend/src/components/ChartCard.tsx frontend/src/components/ChartCanvas.tsx frontend/src/pages/AskWorkbenchPage.tsx
```

---

### Task 7: Backend Safe Execution API

**Files:**
- Create: `app/services/ai_ask/execution_service.py` — `execute_sql()` handler with read-first-then-claim lifecycle; imports `_safe_load_response_json` from `app.services.ask_service` (no duplication)
- Modify: `tests/services/test_ai_ask_execution.py` — append execution lifecycle tests, real concurrency test, metadata drift, HTTPException and unhandled exception recovery
- Modify: `app/schemas/ai_ask.py` — add `ExecuteSqlRequest` and `ExecuteSqlResponse` schemas
- Modify: `app/api/ai_ask.py` — add `POST /api/ai-ask/execute-sql` route; route test covers camelCase request → model_dump → service pipeline

**Interfaces:**
- Consumes: `_safe_load_response_json` from `app.services.ask_service` (Task 1), `AskMessage.status` check constraint `IN ('pending','streaming','completed','failed')`, `SqlExecutionService.execute_sync(datasource_id, sql, db)`, `MetadataResolver.resolve()`, `SqlValidator.validate()`
- Produces: `POST /api/ai-ask/execute-sql` with consistent response format; no SQL/datasourceId in request body

---

- [ ] **Step 1: Write failing execution lifecycle tests**

Append to `tests/services/test_ai_ask_execution.py`:

```python
import json
from unittest.mock import patch, MagicMock
import pytest
from fastapi import HTTPException
from sqlalchemy import update, text


class TestExecuteSqlLifecycle:
    def _setup_executable_message(self, db_session):
        """Helper: create a session + assistant msg with valid sql_pending response_json."""
        from app.models.ask_models import AskSession, AskMessage
        session = AskSession(title="test", model_name="gpt")
        db_session.add(session)
        db_session.flush()
        msg = AskMessage(session_id=session.id, role="assistant", status="completed", content="")
        msg.response_json = json.dumps({
            "schemaVersion": 1,
            "data": {
                "narrativeLevel": "sql_pending",
                "question": "test",
                "sqlPlan": {
                    "sql": "SELECT 1 FROM DUAL",
                    "datasourceId": 1,
                    "datasourceName": "test_db",
                    "tables": ["PUBLIC.DUAL"],
                },
            },
        }, ensure_ascii=False)
        db_session.add(msg)
        db_session.commit()
        return session, msg

    def test_execute_read_first_returns_executed_without_claim(self, db_session):
        """narrativeLevel=executed returns data immediately, no status change, no DB access."""
        from app.models.ask_models import AskSession, AskMessage
        session = AskSession(title="test", model_name="gpt")
        db_session.add(session)
        db_session.flush()
        msg = AskMessage(session_id=session.id, role="assistant", status="completed", content="")
        msg.response_json = json.dumps({
            "schemaVersion": 1,
            "data": {
                "narrativeLevel": "executed",
                "queryResult": {"columns": ["c"], "rows": [["x"]], "rowCount": 1},
            },
        }, ensure_ascii=False)
        db_session.add(msg)
        db_session.commit()

        from app.services.ai_ask.execution_service import execute_sql
        result = execute_sql({"session_id": session.id, "assistant_message_id": msg.id}, db_session)
        assert result["ok"] is True
        assert result["data"]["narrativeLevel"] == "executed"
        # status unchanged — still "completed"
        db_session.refresh(msg)
        assert msg.status == "completed"

    def test_execute_rejects_non_sql_pending(self, db_session):
        """narrativeLevel that is not sql_pending or executed → 422."""
        from app.models.ask_models import AskSession, AskMessage
        session = AskSession(title="test", model_name="gpt")
        db_session.add(session)
        db_session.flush()
        msg = AskMessage(session_id=session.id, role="assistant", status="completed", content="")
        msg.response_json = json.dumps({
            "schemaVersion": 1,
            "data": {"narrativeLevel": "analyzing"},
        }, ensure_ascii=False)
        db_session.add(msg)
        db_session.commit()

        from app.services.ai_ask.execution_service import execute_sql
        with pytest.raises(HTTPException) as exc:
            execute_sql({"session_id": session.id, "assistant_message_id": msg.id}, db_session)
        assert exc.value.status_code == 422

    def test_execute_concurrent_only_one_wins(self, db_session):
        """Sequential execute: first claims and executes, second hits idempotent path."""
        session, msg = self._setup_executable_message(db_session)

        from app.services.ai_ask.execution_service import execute_sql
        with patch("app.services.ai_ask.execution_service.SqlExecutionService") as MockExec:
            MockExec.return_value.execute_sync.return_value = {
                "columns": ["c"], "rows": [["x"]], "row_count": 1,
                "truncated": False, "elapsed_ms": 10, "history_id": None, "error": None,
            }
            with patch("app.services.ai_ask.execution_service.MetadataResolver.resolve") as MockRes:
                MockRes.return_value = [MagicMock(schema_name="PUBLIC", table_name="DUAL")]
                result1 = execute_sql(
                    {"sessionId": session.id, "assistantMessageId": msg.id}, db_session
                )
        assert result1["ok"] is True

        # Second call: narrativeLevel now executed → return cached
        result2 = execute_sql(
            {"sessionId": session.id, "assistantMessageId": msg.id}, db_session
        )
        assert result2["ok"] is True
        assert result2["data"]["narrativeLevel"] == "executed"

    def test_execute_invalid_response_json_not_streaming(self, db_session):
        """Bad response_json — 422 before any claim attempt, status stays completed."""
        from app.models.ask_models import AskSession, AskMessage
        session = AskSession(title="test", model_name="gpt")
        db_session.add(session)
        db_session.flush()
        msg = AskMessage(session_id=session.id, role="assistant", status="completed", content="not json")
        db_session.add(msg)
        db_session.commit()

        from app.services.ai_ask.execution_service import execute_sql
        with pytest.raises(HTTPException) as exc:
            execute_sql({"session_id": session.id, "assistant_message_id": msg.id}, db_session)
        assert exc.value.status_code == 422
        db_session.refresh(msg)
        assert msg.status == "completed"  # never became streaming

    def test_execute_incomplete_sql_plan(self, db_session):
        """Missing sql/datasourceId/tables — 422, status stays completed."""
        from app.models.ask_models import AskSession, AskMessage
        session = AskSession(title="test", model_name="gpt")
        db_session.add(session)
        db_session.flush()
        msg = AskMessage(session_id=session.id, role="assistant", status="completed", content="")
        msg.response_json = json.dumps({
            "schemaVersion": 1,
            "data": {
                "narrativeLevel": "sql_pending",
                "question": "test",
                "sqlPlan": {"sql": "", "datasourceId": None, "tables": []},
            },
        }, ensure_ascii=False)
        db_session.add(msg)
        db_session.commit()

        from app.services.ai_ask.execution_service import execute_sql
        with pytest.raises(HTTPException) as exc:
            execute_sql({"session_id": session.id, "assistant_message_id": msg.id}, db_session)
        assert exc.value.status_code == 422
        db_session.refresh(msg)
        assert msg.status == "completed"

    def test_execute_http_exception_restores_completed(self, db_session):
        """If SqlExecutionService raises HTTPException, status restored to completed."""
        session, msg = self._setup_executable_message(db_session)
        from app.services.ai_ask.execution_service import execute_sql
        with patch("app.services.ai_ask.execution_service.SqlExecutionService") as MockExec:
            MockExec.return_value.execute_sync.side_effect = HTTPException(503, detail="DB down")
            with patch("app.services.ai_ask.execution_service.MetadataResolver.resolve") as MockRes:
                MockRes.return_value = [MagicMock(schema_name="PUBLIC", table_name="DUAL")]
                with pytest.raises(HTTPException):
                    execute_sql(
                        {"sessionId": session.id, "assistantMessageId": msg.id}, db_session
                    )
        db_session.refresh(msg)
        assert msg.status == "completed"

    def test_execute_metadata_partial_fail(self, db_session):
        """Only 1 of 2 tables resolved → METADATA_NOT_FOUND, status completed."""
        from app.models.ask_models import AskSession, AskMessage
        session = AskSession(title="test", model_name="gpt")
        db_session.add(session)
        db_session.flush()
        msg = AskMessage(session_id=session.id, role="assistant", status="completed", content="")
        msg.response_json = json.dumps({
            "schemaVersion": 1,
            "data": {
                "narrativeLevel": "sql_pending",
                "question": "test",
                "sqlPlan": {
                    "sql": "SELECT * FROM A JOIN B",
                    "datasourceId": 1,
                    "datasourceName": "test_db",
                    "tables": ["PUBLIC.A", "PUBLIC.B"],
                },
            },
        }, ensure_ascii=False)
        db_session.add(msg)
        db_session.commit()

        from app.services.ai_ask.execution_service import execute_sql
        with patch("app.services.ai_ask.execution_service.MetadataResolver.resolve") as MockRes:
            MockRes.return_value = [MagicMock(schema_name="PUBLIC", table_name="A")]
            result = execute_sql(
                {"sessionId": session.id, "assistantMessageId": msg.id}, db_session
            )
        assert result.get("error") == "METADATA_NOT_FOUND"
        db_session.refresh(msg)
        assert msg.status == "completed"

    def test_first_and_idempotent_response_identical(self, db_session):
        """First execute and idempotent hit return same structure (ok + data with narrativeLevel)."""
        session, msg = self._setup_executable_message(db_session)
        from app.services.ai_ask.execution_service import execute_sql
        with patch("app.services.ai_ask.execution_service.SqlExecutionService") as MockExec:
            MockExec.return_value.execute_sync.return_value = {
                "columns": ["c"], "rows": [["x"]], "row_count": 1,
                "truncated": False, "elapsed_ms": 10, "history_id": None, "error": None,
            }
            with patch("app.services.ai_ask.execution_service.MetadataResolver.resolve") as MockRes:
                MockRes.return_value = [MagicMock(schema_name="PUBLIC", table_name="DUAL")]
                first = execute_sql(
                    {"sessionId": session.id, "assistantMessageId": msg.id}, db_session
                )
        second = execute_sql(
            {"sessionId": session.id, "assistantMessageId": msg.id}, db_session
        )
        assert "ok" in first and "ok" in second
        assert "data" in first and "data" in second
        assert first["data"]["narrativeLevel"] == "executed"
        assert second["data"]["narrativeLevel"] == "executed"

    def test_execute_streaming_conflict_returns_409(self, db_session):
        """Message already streaming → 409 EXECUTION_IN_PROGRESS."""
        from app.models.ask_models import AskSession, AskMessage
        session = AskSession(title="test", model_name="gpt")
        db_session.add(session)
        db_session.flush()
        msg = AskMessage(session_id=session.id, role="assistant", status="streaming", content="")
        msg.response_json = json.dumps({
            "schemaVersion": 1,
            "data": {"narrativeLevel": "sql_pending", "sqlPlan": {"sql": "SELECT 1"}},
        }, ensure_ascii=False)
        db_session.add(msg)
        db_session.commit()

        from app.services.ai_ask.execution_service import execute_sql
        with pytest.raises(HTTPException) as exc:
            execute_sql({"session_id": session.id, "assistant_message_id": msg.id}, db_session)
        assert exc.value.status_code == 409

    def test_execute_camelcase_api_integration(self, client, db_session):
        """Route accepts camelCase, passes to service correctly."""
        from app.models.ask_models import AskSession, AskMessage
        session = AskSession(title="test", model_name="gpt")
        db_session.add(session)
        db_session.flush()
        msg = AskMessage(session_id=session.id, role="assistant", status="completed", content="")
        msg.response_json = json.dumps({
            "schemaVersion": 1,
            "data": {
                "narrativeLevel": "sql_pending",
                "question": "test",
                "sqlPlan": {
                    "sql": "SELECT 1",
                    "datasourceId": 1,
                    "datasourceName": "test_db",
                    "tables": ["PUBLIC.DUAL"],
                },
            },
        }, ensure_ascii=False)
        db_session.add(msg)
        db_session.commit()

        with patch("app.services.ai_ask.execution_service.MetadataResolver.resolve") as MockRes:
            MockRes.return_value = [MagicMock(schema_name="PUBLIC", table_name="DUAL")]
            with patch("app.services.ai_ask.execution_service.SqlExecutionService") as MockExec:
                MockExec.return_value.execute_sync.return_value = {
                    "columns": ["c"], "rows": [["x"]], "row_count": 1,
                    "truncated": False, "elapsed_ms": 10, "history_id": None, "error": None,
                }
                resp = client.post("/api/ai-ask/execute-sql", json={
                    "sessionId": session.id,
                    "assistantMessageId": msg.id,
                })
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["data"]["narrativeLevel"] == "executed"

    def test_concurrent_two_requests_only_one_calls_sql_execution(self, tmp_path):
        """Two threads sharing the same on-disk SQLite file, synchronized via barrier.
        Only one request may reach SqlExecutionService.
        The other must get 409 or idempotent executed."""
        import threading
        from sqlalchemy import create_engine, text
        from sqlalchemy.orm import sessionmaker
        from app.models.ask_models import Base, AskSession, AskMessage
        import json

        db_path = tmp_path / "test_concurrent.db"
        engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        Base.metadata.create_all(engine)
        Session_factory = sessionmaker(bind=engine)

        # Seed the shared DB with one executable message
        seed_db = Session_factory()
        session = AskSession(title="concurrent_test", model_name="gpt")
        seed_db.add(session)
        seed_db.flush()
        msg = AskMessage(session_id=session.id, role="assistant", status="completed", content="")
        msg.response_json = json.dumps({
            "schemaVersion": 1,
            "data": {
                "narrativeLevel": "sql_pending",
                "question": "test",
                "sqlPlan": {
                    "sql": "SELECT 1 FROM DUAL",
                    "datasourceId": 1,
                    "datasourceName": "test_db",
                    "tables": ["PUBLIC.DUAL"],
                },
            },
        }, ensure_ascii=False)
        seed_db.add(msg)
        seed_db.commit()
        msg_id = msg.id
        session_id = session.id
        seed_db.close()

        call_count = 0
        call_lock = threading.Lock()
        results = []
        results_lock = threading.Lock()
        barrier = threading.Barrier(2, timeout=10)

        def patched_execute_sync(db=None, datasource_id=None, sql=None):
            nonlocal call_count
            with call_lock:
                call_count += 1
            return {"columns": ["c"], "rows": [["x"]], "row_count": 1,
                    "truncated": False, "elapsed_ms": 10, "history_id": None, "error": None}

        def patched_resolve(datasource_id=None, table_names=None, question=None, db=None):
            return [MagicMock(schema_name="PUBLIC", table_name="DUAL")]

        def execute_in_thread():
            from app.services.ai_ask.execution_service import execute_sql
            local_db = Session_factory()
            try:
                # Barrier synchronizes both threads before they enter execute_sql.
                # The first thread to reach the CAS claim UPDATE wins.
                barrier.wait()
                result = execute_sql(
                    {"session_id": session_id, "assistant_message_id": msg_id}, local_db
                )
                with results_lock:
                    results.append(("ok", result))
            except HTTPException as e:
                with results_lock:
                    results.append(("exception", e.status_code, e.detail))
            except Exception as e:
                with results_lock:
                    results.append(("error", str(e)))
            finally:
                local_db.close()

        with patch("app.services.ai_ask.execution_service.SqlExecutionService.execute_sync", patched_execute_sync), \
             patch("app.services.ai_ask.execution_service.MetadataResolver.resolve", patched_resolve):
            t1 = threading.Thread(target=execute_in_thread)
            t2 = threading.Thread(target=execute_in_thread)
            t1.start()
            t2.start()
            t1.join(timeout=15)
            t2.join(timeout=15)

        # Threads must have exited
        assert not t1.is_alive(), "Thread 1 did not finish"
        assert not t2.is_alive(), "Thread 2 did not finish"

        # No unexpected errors (e.g. database locked)
        error_results = [r for r in results if r[0] == "error"]
        assert error_results == [], f"Unexpected errors: {error_results}"

        # Exactly 1 SQL execution
        assert call_count == 1, f"Expected exactly 1 SQL execution call, got {call_count}"
        assert len(results) == 2, f"Expected 2 results, got {len(results)}"

        ok_results = [r for r in results if r[0] == "ok"]
        exception_results = [r for r in results if r[0] == "exception"]

        # One request succeeds
        assert len(ok_results) >= 1, "At least one request must succeed"
        for r in ok_results:
            assert r[1]["ok"] is True
            assert r[1]["data"]["narrativeLevel"] == "executed"

        # The other request is either 409 (streaming conflict) or idempotent executed
        for r in exception_results:
            assert r[1] in (409,), f"Expected 409, got {r[1]}"

        # If both succeeded, that's also valid (one was idempotent)
        if len(ok_results) == 2:
            pass  # Second was idempotent read
        elif len(ok_results) == 1 and len(exception_results) == 1:
            pass  # One succeeded, one hit 409

        # Verify final DB state is executed
        verify_db = Session_factory()
        try:
            verify_msg = verify_db.query(AskMessage).filter(AskMessage.id == msg_id).first()
            assert verify_msg is not None
            assert verify_msg.status == "completed"
            parsed = json.loads(verify_msg.response_json)
            assert parsed["data"]["narrativeLevel"] == "executed"
        finally:
            verify_db.close()
        engine.dispose()
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd D:/projects/MetricForge
python -m pytest tests/services/test_ai_ask_execution.py -v
```
Expected: FAIL — execution_service.py not yet created.

- [ ] **Step 3: Add `ExecuteSqlRequest` and `ExecuteSqlResponse` schemas**

In `app/schemas/ai_ask.py`, add:
```python
class ExecuteSqlRequest(BaseModel):
    session_id: int = Field(..., alias="sessionId")
    assistant_message_id: int = Field(..., alias="assistantMessageId")
    model_config = {"populate_by_name": True}


class ExecuteSqlResponse(BaseModel):
    ok: bool
    data: dict[str, Any] | None = None
    error: str | None = None
```

- [ ] **Step 4: Create `execution_service.py`**

Write to `app/services/ai_ask/execution_service.py`:
```python
import json
from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session
from app.models.ask_models import AskMessage
from app.services.ask_service import _safe_load_response_json
from app.services.ai_ask.narrative_builder import build_executed_narrative
from app.services.sql_execution_service import SqlExecutionService
from app.services.ai_ask.metadata_resolver import MetadataResolver
from app.services.ai_ask.sql_validator import SqlValidator


def _resolve_claim_conflict(msg: AskMessage) -> dict:
    rj = _safe_load_response_json(msg.response_json)
    nlv = (rj.get("data") or {}).get("narrativeLevel") if rj else None
    if nlv == "executed":
        return {"ok": True, "data": rj["data"]}
    if msg.status == "streaming":
        raise HTTPException(409, detail="EXECUTION_IN_PROGRESS")
    raise HTTPException(422, detail="当前状态不允许执行")


def execute_sql(payload: dict, db: Session) -> dict:
    session_id = payload.get("session_id")
    assistant_message_id = payload.get("assistant_message_id")

    # Phase 1: Load message + validate identity
    msg = db.query(AskMessage).filter(AskMessage.id == assistant_message_id).first()
    if not msg:
        raise HTTPException(404, detail="消息不存在")
    if msg.session_id != session_id:
        raise HTTPException(422, detail="消息不属于该会话")
    if msg.role != "assistant":
        raise HTTPException(422, detail="消息类型不正确")

    # Phase 2: Read-only validate response_json and narrativeLevel
    rj = _safe_load_response_json(msg.response_json)
    if rj is None:
        raise HTTPException(422, detail="消息无有效的结构化响应")
    data = rj.get("data") or {}
    narrative_level = data.get("narrativeLevel")

    if narrative_level == "executed":
        return {"ok": True, "data": data}

    if narrative_level != "sql_pending":
        raise HTTPException(422, detail=f"当前 narrativeLevel={narrative_level} 不允许执行")

    # Validate sqlPlan completeness (before claim — avoid streaming bad messages)
    sql_plan = data.get("sqlPlan") or {}
    sql = sql_plan.get("sql", "")
    datasource_id = sql_plan.get("datasourceId")
    selected_tables = sql_plan.get("tables", [])
    question = data.get("question", "")
    if not sql or not datasource_id or not selected_tables:
        raise HTTPException(422, detail="SQL 计划不完整")

    # Phase 3: Atomic claim with compare-and-swap
    # 条件包含原始 response_json，防止第一个请求写回新值后第二个仍能 claim
    original_response_json = msg.response_json
    acquired = False
    try:
        rows_updated = db.execute(
            update(AskMessage)
            .where(AskMessage.id == assistant_message_id)
            .where(AskMessage.status == "completed")
            .where(AskMessage.response_json == original_response_json)
            .values(status="streaming")
        ).rowcount
        db.commit()

        if rows_updated == 0:
            db.refresh(msg)
            return _resolve_claim_conflict(msg)

        acquired = True

        # Phase 4: Re-resolve metadata (exact set match)
        expected_tables = {t.upper().strip() for t in selected_tables}
        resolved = MetadataResolver.resolve(
            datasource_id=datasource_id,
            table_names=list(expected_tables),
            question=question,
            db=db,
        )
        resolved_tables = {
            f"{r.schema_name}.{r.table_name}".upper()
            for r in (resolved or [])
        }
        if expected_tables != resolved_tables:
            msg.error_message = "METADATA_NOT_FOUND：执行时元数据已变化"
            raise HTTPException(422, detail=msg.error_message)

        # Phase 5: SqlValidator (Phase 5M Trust Gate)
        sql_validation = SqlValidator.validate(sql_plan, resolved)
        if not sql_validation.valid:
            msg.error_message = "SQL_VALIDATION_FAILED：元数据可能已变化"
            raise HTTPException(422, detail=msg.error_message)

        # Phase 6: Delegate to SqlExecutionService (reuses timeout, row limit, security, history)
        exec_result = SqlExecutionService().execute_sync(
            db=db, datasource_id=datasource_id, sql=sql,
        )
        if exec_result.get("error"):
            msg.error_message = exec_result["error"]
            return {"ok": False, "error": exec_result["error"]}

        # Phase 7: Build queryResult
        query_result = {
            "columns": exec_result["columns"],
            "rows": exec_result["rows"],
            "rowCount": exec_result["row_count"],
            "truncated": exec_result["truncated"],
            "elapsedMs": exec_result["elapsed_ms"],
            "historyId": exec_result.get("history_id"),
        }

        # Phase 8: Deterministic narrative
        narrative = build_executed_narrative(
            exec_result["columns"], exec_result["rows"],
            exec_result["truncated"], exec_result["elapsed_ms"],
        )

        # Phase 9: Atomic update response_json
        data["narrativeLevel"] = "executed"
        data["queryResult"] = query_result
        data["narrative"] = narrative
        msg.response_json = json.dumps(
            {"schemaVersion": 1, "data": data}, ensure_ascii=False
        )
        msg.status = "completed"
        msg.error_message = None
        db.commit()
        acquired = False
        return {"ok": True, "data": data}

    except HTTPException:
        raise
    except Exception:
        msg.error_message = "执行过程中发生未预期错误"
        raise
    finally:
        if acquired:
            msg.status = "completed"
            db.commit()
```

- [ ] **Step 5: Add `POST /execute-sql` route to `app/api/ai_ask.py`**

```python
from app.schemas.ai_ask import ExecuteSqlRequest, ExecuteSqlResponse
from app.services.ai_ask.execution_service import execute_sql as execute_sql_service


@router.post("/execute-sql", response_model=ExecuteSqlResponse)
def execute_sql_route(body: ExecuteSqlRequest, db=Depends(get_db)):
    return execute_sql_service(body.model_dump(), db)
```

- [ ] **Step 6: Run execution tests**

```bash
cd D:/projects/MetricForge
python -m pytest tests/services/test_ai_ask_execution.py -v
```
Expected: All PASS.

- [ ] **Step 7: Run broader tests**

```bash
cd D:/projects/MetricForge
python -m pytest tests/ -q
```
Expected: All green.

- [ ] **Step 8: Commit**

```bash
git add -- app/services/ai_ask/execution_service.py app/schemas/ai_ask.py app/api/ai_ask.py tests/services/test_ai_ask_execution.py
git commit --only -m "feat(phase-5n): safe execution API with read-first-then-claim lifecycle" -- app/services/ai_ask/execution_service.py app/schemas/ai_ask.py app/api/ai_ask.py tests/services/test_ai_ask_execution.py
```

- [ ] **Step 9: Review gate**

```bash
git diff --cached --name-only
```

---

### Task 8: Frontend Execute, Real Result Table & Chart

**Files:**
- Modify: `frontend/src/pages/AskWorkbenchPage.tsx` — add "验证并执行" button in SqlPlan card; handleExecute uses `currentAssistantMessageId` (from Task 3 store), not `lastAssistantMessageId` inference; call execute API client instead of raw fetch
- Modify: `frontend/src/api/aiAsk/realLlmAdapter.ts` — update `getChartData()` to map real `queryResult.columns`/`queryResult.rows` with case-insensitive column matching
- Create: `frontend/src/api/aiAsk/executeApi.ts` — execute API client (encapsulated fetch + error mapping for 409/422/business errors)
- Modify: `frontend/src/components/AiChartBoard.tsx` — add explicit `queryResult` prop; sql_pending guard; fallback to ResultTable when fields don't match
- Modify: `frontend/src/types/aiAsk.ts` — add `QueryResult` to `AiAskResponse`
- Modify: `frontend/src/pages/AskWorkbenchPage.test.tsx` — add execute button tests (body has no sql/datasourceId)
- Modify: `frontend/src/components/AiChartBoard.test.tsx` — add sql_pending guard and real-rows tests

---

- [ ] **Step 1: Write failing execute button tests**

```typescript
// In AskWorkbenchPage.test.tsx

test('execute button visible in sql_pending state', () => {
  // Mock currentResponse with narrativeLevel=sql_pending
  // Verify "验证并执行" button rendered in SqlPlan section
})

test('execute button not visible in executed state', () => {
  // Mock currentResponse with narrativeLevel=executed
  // Verify no execute button
})

test('execute request body does not contain sql or datasourceId', async () => {
  // Mock fetch for execute-sql via executeApi client
  // Click execute button
  // Verify request body is { sessionId, assistantMessageId }
})

test('chart board shows nothing when sql_pending', () => {
  // Mock currentResponse with narrativeLevel=sql_pending
  // Verify AiChartBoard does not call ECharts render
})

test('chart board uses real rows when executed', () => {
  // Mock currentResponse with narrativeLevel=executed + queryResult.rows
  // Verify chart columns/rows match queryResult
})

test('chart board falls back to table when columns mismatch', () => {
  // Mock executed response where xField doesn't match any column
  // Verify ResultTable rendered instead of empty/no-chart
})

test('empty query rows shows "查询成功但无数据" without chart', () => {
  // Mock executed response with empty rows
  // Verify no chart rendered, "查询成功但无数据" displayed
})
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd D:/projects/MetricForge/frontend
npx vitest run --reporter=verbose src/pages/AskWorkbenchPage.test.tsx 2>&1
```
Expected: FAIL — execute button not yet present.

- [ ] **Step 3: Add `QueryResult` type**

In `frontend/src/types/aiAsk.ts`:
```typescript
export interface QueryResult {
  columns: string[]
  rows: any[][]
  rowCount: number
  truncated: boolean
  elapsedMs: number
  historyId: number | null
}

// Update AiAskResponse to include optional queryResult
export interface AiAskResponse {
  // ... existing fields ...
  narrativeLevel: 'sql_pending' | 'executed'
  queryResult?: QueryResult | null
}
```

- [ ] **Step 4: Create execute API client**

In `frontend/src/api/aiAsk/executeApi.ts`:
```typescript
export interface ExecuteRequest {
  sessionId: number
  assistantMessageId: number
}

export interface ExecuteResponse {
  ok: boolean
  data?: AiAskResponse
  error?: string
}

export async function executeQuery(request: ExecuteRequest): Promise<ExecuteResponse> {
  const resp = await fetch('/api/ai-ask/execute-sql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (resp.status === 409) {
    return { ok: false, error: 'EXECUTION_IN_PROGRESS' }
  }
  if (resp.status === 422 || resp.status === 404) {
    const body = await resp.json()
    return { ok: false, error: body.detail || '执行失败' }
  }
  return resp.json()
}
```

- [ ] **Step 5: Add execute button in SqlPlan area**

In `AskWorkbenchPage.tsx`, in the `SqlPlan` card area (when `narrativeLevel === 'sql_pending'`):
```tsx
<div style={{ marginTop: 12 }}>
  <p style={{ fontSize: 12, color: '#888' }}>
    将安全执行当前 SQL（最大返回 1000 行，30 秒超时，仅允许 SELECT）。
  </p>
  <Button type="primary" loading={isExecuting} onClick={handleExecute}>
    验证并执行
  </Button>
</div>
```

- [ ] **Step 6: Add `handleExecute` using `currentAssistantMessageId`**

```typescript
const handleExecute = async () => {
  if (!currentSessionId || !currentAssistantMessageId) return

  setExecuting(true)
  try {
    const resp = await executeQuery({
      sessionId: currentSessionId,
      assistantMessageId: currentAssistantMessageId,
    })
    if (resp.ok && resp.data) {
      setCurrentResponse(resp.data)  // resp.data is full AiAskResponse with queryResult
    } else {
      setError({ code: 'EXECUTION_ERROR', message: resp.error || '执行失败' })
    }
  } catch (e) {
    setError({ code: 'EXECUTION_ERROR', message: '执行请求失败' })
  } finally {
    setExecuting(false)
  }
}
```

- [ ] **Step 7: Update `getChartData` in `RealLlmAdapter`**

In `frontend/src/api/aiAsk/realLlmAdapter.ts`:
```typescript
getChartData(spec: AiChartSpec, response: AiAskResponse): ChartDataResult {
  if (!response.queryResult || response.narrativeLevel !== 'executed') {
    return { columns: [], rows: [], isEmpty: true }
  }

  const { columns, rows } = response.queryResult
  const xField = spec.xField
  const yFields = spec.yFields || []

  // Case-insensitive column matching
  const colSet = new Set(columns.map(c => c.toLowerCase()))
  if (xField && !colSet.has(xField.toLowerCase())) {
    return { columns, rows, isEmpty: true, error: 'xField not found in result columns' }
  }
  for (const yf of yFields) {
    if (!colSet.has(yf.toLowerCase())) {
      return { columns, rows, isEmpty: true, error: 'yField not found in result columns' }
    }
  }

  return { columns, rows, isEmpty: rows.length === 0 }
}
```

When fields don't match (isEmpty + error), the parent must render `ResultTable` instead of hiding everything.

- [ ] **Step 8: Update `AiChartBoard` with explicit `queryResult` prop and guards**

```typescript
interface AiChartBoardProps {
  narrativeLevel: 'sql_pending' | 'executed'
  queryResult?: QueryResult | null
  chartSuggestions?: ChartSuggestion[]
}

// In component:
if (narrativeLevel === 'sql_pending' || !queryResult) {
  return null  // Don't render chart in sql_pending state
}

if (queryResult.rows.length === 0) {
  return <div>查询成功但无数据</div>
}

// Only render ECharts when executed with real rows and matching fields
// If fields don't match, render ResultTable instead
```

- [ ] **Step 9: Run tests**

```bash
cd D:/projects/MetricForge/frontend
npx vitest run --reporter=verbose 2>&1
```
Expected: All tests pass.

- [ ] **Step 10: TypeScript check**

```bash
cd D:/projects/MetricForge/frontend
npx tsc --noEmit 2>&1
```
Expected: No errors.

- [ ] **Step 11: Commit**

```bash
git add -- frontend/src/types/aiAsk.ts frontend/src/api/aiAsk/executeApi.ts frontend/src/pages/AskWorkbenchPage.tsx frontend/src/pages/AskWorkbenchPage.test.tsx frontend/src/api/aiAsk/realLlmAdapter.ts frontend/src/components/AiChartBoard.tsx frontend/src/components/AiChartBoard.test.tsx
git commit --only -m "feat(phase-5n): execute button, real result table and chart rendering" -- frontend/src/types/aiAsk.ts frontend/src/api/aiAsk/executeApi.ts frontend/src/pages/AskWorkbenchPage.tsx frontend/src/pages/AskWorkbenchPage.test.tsx frontend/src/api/aiAsk/realLlmAdapter.ts frontend/src/components/AiChartBoard.tsx frontend/src/components/AiChartBoard.test.tsx
```

- [ ] **Step 12: Review gate**

```bash
git diff --cached --name-only
```

---

### Task 9: Integration Verification & Real Smoke

**Files:** No code changes — run all existing tests and manual smoke. Report generated at `.superpowers/sdd/task-9-final-review.md`.

---

- [ ] **Step 1: Python full test suite**

```bash
cd D:/projects/MetricForge
python -m pytest tests/ -q
```
Expected: All tests pass (no calls to real LLM or Oracle).

- [ ] **Step 2: Frontend full test suite**

```bash
cd D:/projects/MetricForge/frontend
npx vitest run --reporter=verbose 2>&1
```
Expected: All tests pass.

- [ ] **Step 3: Frontend benchmark**

```bash
cd D:/projects/MetricForge/frontend
npm run benchmark 2>&1
```
Expected: All benchmark scenarios pass. Record total, pass, fail, and pass rate.

- [ ] **Step 4: TypeScript type check**

```bash
cd D:/projects/MetricForge/frontend
npx tsc --noEmit 2>&1
```
Expected: No errors.

- [ ] **Step 5: Frontend build**

```bash
cd D:/projects/MetricForge/frontend
npm run build 2>&1
```
Expected: Build succeeds (tsc + vite build).

- [ ] **Step 6: Migration idempotency check (using pytest in-memory DB)**

```bash
cd D:/projects/MetricForge
python -m pytest tests/services/test_ask_service_tools.py::test_response_json_migration_is_idempotent -v
```
Expected: PASS. The test creates a legacy table without response_json, runs ensure_sqlite_schema twice, and asserts the column exists exactly once.

Do NOT use `data/metricforge.db` for migration validation — only in-memory or pytest tmp_path.

- [ ] **Step 7: Real smoke test**

With real LLM configured and target datasource active:

1. Open AI 问数页面 at `http://localhost:8000/app/ask`
2. Select a datasource
3. Type a question and submit
4. Confirm SQL Trust Gate passes → `sql_pending` state visible
5. Confirm no database query fired (no chart, no narrative evidence)
6. Click "验证并执行" button
7. Confirm execution disclaimer shows (1000 rows, 30s timeout, SELECT only)
8. After execution:
   - Verify result table columns and rows match expected
   - Verify chart xField/yFields match result columns
   - Verify narrative numbers can be recalculated from rows
   - Verify truncated indicator present when applicable
9. Test empty result, timeout, error states
10. Verify page refresh restores analysis state

- [ ] **Step 8: Generate final report**

Write to `.superpowers/sdd/task-9-final-review.md`:
```markdown
# Phase 5N Verification Report

## Test Results
- Python: (output of `python -m pytest tests/ -q`)
- Frontend: (output of `npx vitest run --reporter=verbose`)
- Benchmark: (total, pass, fail, pass rate from `npm run benchmark`)
- TypeScript: (output of `npx tsc --noEmit`)
- Build: (output of `npm run build`)

## Git Status
(output of `git status --short --branch`)
(output of `git log --oneline`)
```

Generate using:
```bash
cd D:/projects/MetricForge
cat > .superpowers/sdd/task-9-final-review.md << 'REPORT'
# Phase 5N Verification Report

## Test Results
REPORT
python -m pytest tests/ -q >> .superpowers/sdd/task-9-final-review.md 2>&1
echo "" >> .superpowers/sdd/task-9-final-review.md
echo "## Frontend Tests" >> .superpowers/sdd/task-9-final-review.md
cd frontend && npx vitest run --reporter=verbose >> ../.superpowers/sdd/task-9-final-review.md 2>&1
echo "" >> ../.superpowers/sdd/task-9-final-review.md
echo "## Benchmark" >> ../.superpowers/sdd/task-9-final-review.md
npm run benchmark >> ../.superpowers/sdd/task-9-final-review.md 2>&1
echo "" >> ../.superpowers/sdd/task-9-final-review.md
echo "## TypeScript Check" >> ../.superpowers/sdd/task-9-final-review.md
npx tsc --noEmit >> ../.superpowers/sdd/task-9-final-review.md 2>&1
echo "" >> ../.superpowers/sdd/task-9-final-review.md
echo "## Build" >> ../.superpowers/sdd/task-9-final-review.md
npm run build >> ../.superpowers/sdd/task-9-final-review.md 2>&1
cd ..
echo "" >> .superpowers/sdd/task-9-final-review.md
echo "## Git Status" >> .superpowers/sdd/task-9-final-review.md
git status --short --branch >> .superpowers/sdd/task-9-final-review.md
echo "" >> .superpowers/sdd/task-9-final-review.md
git log --oneline -10 >> .superpowers/sdd/task-9-final-review.md
```

- [ ] **Step 9: No commit for this task**

This task only produces a report. All production commits were made in Tasks 1–8. The `.superpowers/sdd/task-9-final-review.md` file is untracked and should not be committed in this Task.

---

## Plan Self-Check

- [ ] All commit commands use `git add -- <files>` and `git commit --only -m "..." -- <files>` — never bare `git commit -m`
- [ ] `_safe_load_response_json` is module-level in `ask_service.py`, not a static method — Task 1 and Task 7 both import from there
- [ ] Task 1 migration test creates legacy table without response_json first
- [ ] Task 2 AiAskAnalyzeRequest uses `session_id` with alias `sessionId`, service reads `request["session_id"]`
- [ ] Task 2 API integration test sends camelCase JSON and validates exact message write
- [ ] Task 2 does not mock non-existent `_call_llm` — uses `@patch("app.services.ai_ask.llm_service.OpenAI")` + `decrypt` + `MetadataResolver.resolve`
- [ ] Task 2 API integration test sends camelCase JSON, validates only exact assistantMessageId is written
- [ ] Task 3 handleSend uses `resolvedSessionId` and session-scoped `currentAssistantMessageId`
- [ ] Task 3 `currentAssistantMessageId` is set on analyze, cleared on session switch/delete, restored from last valid response_json on refresh
- [ ] Task 4 DataScopeBar.test.tsx marked as Modify, not Create
- [ ] Task 4 search uses existing SQL Workbench API, not raw `global.fetch` paths
- [ ] Task 4 datasource switch test triggers through UI onChange, not direct store call
- [ ] Task 5 keeps MockAdapter named export, only deletes production selection logic
- [ ] Task 5 AskInput tooltip uses single wrapper, no multiple siblings inside Tooltip
- [ ] Task 6 `_detect_metric_columns` scans all rows, not just first row; bool never metric
- [ ] Task 7 imports `_safe_load_response_json` from `app.services.ask_service`, no duplication
- [ ] Task 7 CAS: claim WHERE includes `response_json == original_response_json`
- [ ] Task 7 execute-sql route uses `body.model_dump()` (no `by_alias`), service reads `session_id` / `assistant_message_id`
- [ ] Task 7 concurrency test uses shared on-disk SQLite via `tmp_path`, `barrier.wait()`, asserts exactly 1 SQL call
- [ ] Task 7 concurrency test: one request succeeds, the other returns 409 or idempotent; final state is executed
- [ ] Task 7 concurrency test: `not t1.is_alive()`, `not t2.is_alive()`, `error_results == []`, `call_count == 1`
- [ ] Task 7 concurrency test: SQLite engine uses `timeout=30` to avoid `database locked`
- [ ] Task 8 `currentAssistantMessageId` from Task 3 store, not inferred from message list
- [ ] Task 8 execute API client is encapsulated in `executeApi.ts`
- [ ] Task 8 AiChartBoard has explicit `queryResult` prop
- [ ] Task 8 chart matching is case-insensitive; non-matching fields show ResultTable
- [ ] Task 9 no `--timeout` flag, no `data/metricforge.db` migration check, only pytest in-memory
- [ ] Task 9 final report at `.superpowers/sdd/task-9-final-review.md`, not `/tmp/`
- [ ] No `Task N: Task N` titles — all use `Task N: Description` format
- [ ] No TODO comment placeholders in test code — all tests have explicit setup/action/assert
- [ ] Each Task has review gate verifying `git diff --cached --name-only` only contains taste-skill spec
- [ ] No typos (e.g. "head/tail" pipes, `--timeout`, `--cached` correctly spelled)
- [ ] Every new API (analyze binding, execute-sql) has real API integration test
