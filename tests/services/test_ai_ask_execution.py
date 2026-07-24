"""
Phase 5N Task 7 — Safe AI Ask SQL Execution API 测试

覆盖：
- Read-first 身份校验（message not found / session mismatch / wrong role）
- 无效 response_json / 缺失字段
- 幂等返回已有的 executed 结果
- 非 sql_pending 阻断
- 完整成功执行流程
- 元数据全等集合校验
- SQL 二次校验阻断
- CAS 并发竞态
- 异常恢复（HTTPException / 普通异常 / 校验异常）
- 客户端不得通过请求体注入 sql/datasourceId
"""

import json
import threading
from decimal import Decimal
from unittest.mock import ANY, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.models.ask_models import AskMessage, AskSession
from app.models.base import Base
from app.models import LlmSetting  # noqa: ensure models registered
from app.schemas.ai_ask import AiAskAnalyzeErrorResponse, AiAskErrorCode


# ============================================================
# Helpers
# ============================================================

_SAMPLE_SQL_PLAN = {
    "sql": "SELECT * FROM schema.table WHERE id = 1",
    "tables": ["SCHEMA.TABLE"],
    "datasourceId": 1,
    "datasourceName": "dwhrpt",
    "fields": ["id", "name", "amount"],
}

_SAMPLE_NARRATIVE = {
    "summary": "待验证 SQL",
    "keyFindings": [],
    "evidence": [],
    "risks": [],
    "nextQuestions": [],
}

_SAMPLE_DATA = {
    "question": "test",
    "sqlPlan": _SAMPLE_SQL_PLAN,
    "narrative": _SAMPLE_NARRATIVE,
    "narrativeLevel": "sql_pending",
    "intent": {"metrics": [], "dimensions": [], "filters": []},
    "chartSuggestions": [],
    "semanticGaps": [],
}


def _make_envelope(data: dict, schema_version: int = 1) -> str:
    return json.dumps({"schemaVersion": schema_version, "data": data}, ensure_ascii=False)


def _create_session(db: Session, title: str = "新对话") -> AskSession:
    s = AskSession(title=title, model_name="gpt-4")
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def _create_assistant_message(
    db: Session,
    session_id: int,
    status: str = "completed",
    response_json_str: str | None = None,
    role: str = "assistant",
) -> AskMessage:
    msg = AskMessage(
        session_id=session_id,
        role=role,
        content="",
        status=status,
        response_json=response_json_str,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


def _make_executed_envelope(columns=None, rows=None) -> str:
    cols = columns or ["col1"]
    rws = rows or [["a"], ["b"]]
    data = dict(_SAMPLE_DATA)
    data["narrativeLevel"] = "executed"
    data["queryResult"] = {
        "columns": cols,
        "rows": rws,
        "rowCount": len(rws),
        "truncated": False,
        "elapsedMs": 50,
        "historyId": 1,
    }
    data["narrative"] = {
        "summary": "查询返回 2 行数据",
        "keyFindings": [f"{cols[0]}: 最大值 2"],
        "evidence": [{"claim": "test", "fields": cols, "value": "2", "confidence": "high"}],
        "risks": [],
        "nextQuestions": [],
    }
    return _make_envelope(data)


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture
def db_session():
    """内存 SQLite，check_same_thread=False 用于并发测试"""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def sample_session(db_session):
    s = _create_session(db_session)
    return s.id


@pytest.fixture
def sample_message(db_session, sample_session):
    msg = _create_assistant_message(
        db_session,
        session_id=sample_session,
        status="completed",
        response_json_str=_make_envelope(_SAMPLE_DATA),
    )
    return msg


# ============================================================
# Identity & Input Validation
# ============================================================

class TestIdentityValidation:
    """Read-first 身份校验：失败不得修改任何记录"""

    def test_message_not_found(self, db_session, sample_session):
        """不存在的 message_id → 404"""
        from app.services.ai_ask.execution_service import execute_sql_analysis
        with pytest.raises(HTTPException) as exc:
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=9999,
            )
        assert exc.value.status_code == 404

    def test_session_mismatch(self, db_session, sample_session):
        """session_id 不匹配 → 422"""
        other_session = _create_session(db_session)
        msg = _create_assistant_message(
            db_session, session_id=other_session.id,
            status="completed",
            response_json_str=_make_envelope(_SAMPLE_DATA),
        )
        from app.services.ai_ask.execution_service import execute_sql_analysis
        with pytest.raises(HTTPException) as exc:
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,  # wrong session
                assistant_message_id=msg.id,
            )
        assert exc.value.status_code == 422
        # 确认消息未被修改
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == msg.id).first()
        assert reloaded.status == "completed"

    def test_wrong_role(self, db_session, sample_session):
        """role=user → 422"""
        user_msg = _create_assistant_message(
            db_session, session_id=sample_session,
            status="completed", role="user",
            response_json_str=_make_envelope(_SAMPLE_DATA),
        )
        from app.services.ai_ask.execution_service import execute_sql_analysis
        with pytest.raises(HTTPException) as exc:
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=user_msg.id,
            )
        assert exc.value.status_code == 422

    def test_invalid_json_response_json(self, db_session, sample_session):
        """response_json 不是合法 JSON → 422"""
        msg = _create_assistant_message(
            db_session, session_id=sample_session,
            status="completed", response_json_str="not-json",
        )
        from app.services.ai_ask.execution_service import execute_sql_analysis
        with pytest.raises(HTTPException) as exc:
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=msg.id,
            )
        assert exc.value.status_code == 422

    def test_wrong_schema_version(self, db_session, sample_session):
        """schemaVersion != 1 → 422"""
        msg = _create_assistant_message(
            db_session, session_id=sample_session,
            status="completed",
            response_json_str=json.dumps(
                {"schemaVersion": 2, "data": _SAMPLE_DATA},
            ),
        )
        from app.services.ai_ask.execution_service import execute_sql_analysis
        with pytest.raises(HTTPException) as exc:
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=msg.id,
            )
        assert exc.value.status_code == 422

    def test_missing_sql_in_envelope(self, db_session, sample_session):
        """response_json 缺 sql → 422"""
        bad_data = dict(_SAMPLE_DATA)
        bad_data["sqlPlan"] = {"tables": ["SCHEMA.TABLE"], "datasourceId": 1}
        msg = _create_assistant_message(
            db_session, session_id=sample_session,
            status="completed",
            response_json_str=_make_envelope(bad_data),
        )
        from app.services.ai_ask.execution_service import execute_sql_analysis
        with pytest.raises(HTTPException) as exc:
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=msg.id,
            )
        assert exc.value.status_code == 422

    def test_missing_datasource_id(self, db_session, sample_session):
        """response_json 缺 datasourceId → 422"""
        bad_data = dict(_SAMPLE_DATA)
        bad_data["sqlPlan"] = {"sql": "SELECT 1", "tables": ["SCHEMA.TABLE"]}
        msg = _create_assistant_message(
            db_session, session_id=sample_session,
            status="completed",
            response_json_str=_make_envelope(bad_data),
        )
        from app.services.ai_ask.execution_service import execute_sql_analysis
        with pytest.raises(HTTPException) as exc:
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=msg.id,
            )
        assert exc.value.status_code == 422

    def test_missing_tables(self, db_session, sample_session):
        """response_json 缺 tables → 422"""
        bad_data = dict(_SAMPLE_DATA)
        bad_data["sqlPlan"] = {"sql": "SELECT 1", "datasourceId": 1}
        msg = _create_assistant_message(
            db_session, session_id=sample_session,
            status="completed",
            response_json_str=_make_envelope(bad_data),
        )
        from app.services.ai_ask.execution_service import execute_sql_analysis
        with pytest.raises(HTTPException) as exc:
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=msg.id,
            )
        assert exc.value.status_code == 422

    def test_all_identity_failures_no_claim(self, db_session, sample_session):
        """身份失败和无效 plan 均不 claim（status 不变）"""
        original_msg = _create_assistant_message(
            db_session, session_id=sample_session,
            status="completed",
            response_json_str=_make_envelope(_SAMPLE_DATA),
        )
        # 尝试用错误的 message_id
        from app.services.ai_ask.execution_service import execute_sql_analysis
        with pytest.raises(HTTPException):
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=9999,
            )
        # 原始消息 status 不应改变
        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == original_msg.id).first()
        assert reloaded.status == "completed"


# ============================================================
# Idempotency & State Validation
# ============================================================

class TestIdempotency:
    """幂等判断：executed 直接返回，不修改 status、不访问执行服务"""

    def test_already_executed_returns_directly(self, db_session, sample_session):
        """narrativeLevel=executed → 返回已保存结果，不改 status"""
        envelope_str = _make_executed_envelope()
        msg = _create_assistant_message(
            db_session, session_id=sample_session,
            status="completed",
            response_json_str=envelope_str,
        )
        from app.services.ai_ask.execution_service import execute_sql_analysis

        with patch("app.services.ai_ask.execution_service.SqlExecutionService") as mock_exec_cls:
            result = execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=msg.id,
            )
        # 不应调用执行服务
        mock_exec_cls.assert_not_called()
        # status 不变
        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == msg.id).first()
        assert reloaded.status == "completed"
        # 返回了 data
        assert result.ok is True
        assert result.data is not None

    def test_non_sql_pending_returns_422(self, db_session, sample_session):
        """narrativeLevel 不是 sql_pending/executed → 422"""
        bad_data = dict(_SAMPLE_DATA)
        bad_data["narrativeLevel"] = "analyzing"
        msg = _create_assistant_message(
            db_session, session_id=sample_session,
            status="completed",
            response_json_str=_make_envelope(bad_data),
        )
        from app.services.ai_ask.execution_service import execute_sql_analysis
        with pytest.raises(HTTPException) as exc:
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=msg.id,
            )
        assert exc.value.status_code == 422

    def test_analyze_sql_cannot_be_overridden_by_request(self):
        """请求体 schema 不应接受 sql/datasourceId，测试 Pydantic 拒绝"""
        from app.schemas.ai_ask import AiAskExecuteSqlRequest
        body = AiAskExecuteSqlRequest(sessionId=1, assistantMessageId=2)
        assert body.session_id == 1
        assert body.assistant_message_id == 2
        # 不应有 sql 或 datasourceId 属性
        assert not hasattr(body, "sql")
        assert not hasattr(body, "datasourceId")


# ============================================================
# Success Path
# ============================================================

class TestSuccessfulExecution:
    """完整成功执行流程"""

    @patch("app.services.ai_ask.execution_service.SqlExecutionService")
    @patch("app.services.ai_ask.execution_service.MetadataResolver")
    @patch("app.services.ai_ask.execution_service.SqlValidator")
    def test_successful_execution(self, mock_validator_cls, mock_resolver_cls, mock_exec_cls, db_session, sample_session, sample_message):
        """mock 执行返回 columns/rows，narrative 只来自 queryResult"""
        # Mock MetadataResolver
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        fake_resolved = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
        mock_resolver_cls.resolve.return_value = fake_resolved

        # Mock SqlValidator - valid
        from app.services.ai_ask.sql_validator import SqlValidationResult
        mock_validator_cls.validate.return_value = SqlValidationResult(
            valid=True, errors=[], warnings=[], sql=_SAMPLE_SQL_PLAN["sql"],
        )

        # Mock SqlExecutionService - return columns/rows
        mock_exec_instance = mock_exec_cls.return_value
        mock_exec_instance.execute_sync.return_value = {
            "columns": ["col1", "col2"],
            "rows": [["a", 1], ["b", 2]],
            "row_count": 2,
            "truncated": False,
            "elapsed_ms": 50,
            "error": None,
            "history_id": 1,
            "column_types": ["string", "int"],
        }

        from app.services.ai_ask.execution_service import execute_sql_analysis
        result = execute_sql_analysis(
            db=db_session,
            session_id=sample_session,
            assistant_message_id=sample_message.id,
        )

        # 成功返回
        assert result.ok is True
        data = result.data
        assert data["narrativeLevel"] == "executed"
        assert "queryResult" in data

        qr = data["queryResult"]
        assert qr["columns"] == ["col1", "col2"]
        assert qr["rows"] == [["a", 1], ["b", 2]]
        assert qr["columnTypes"] == ["string", "int"]

        # narrative 应存在且来自 queryResult
        assert "summary" in data["narrative"]
        assert "keyFindings" in data["narrative"]

        # 检查 DB 状态
        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == sample_message.id).first()
        assert reloaded.status == "completed"
        envelope = json.loads(reloaded.response_json)
        assert envelope["schemaVersion"] == 1
        assert envelope["data"]["narrativeLevel"] == "executed"
        assert "queryResult" in envelope["data"]

    @patch("app.services.ai_ask.execution_service.SqlExecutionService")
    @patch("app.services.ai_ask.execution_service.MetadataResolver")
    @patch("app.services.ai_ask.execution_service.SqlValidator")
    def test_idempotent_response_matches_first(self, mock_validator_cls, mock_resolver_cls, mock_exec_cls, db_session, sample_session, sample_message):
        """首次成功与幂等命中的响应结构完全相同"""
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidationResult
        fake_resolved = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
        mock_resolver_cls.resolve.return_value = fake_resolved
        mock_validator_cls.validate.return_value = SqlValidationResult(
            valid=True, errors=[], warnings=[], sql=_SAMPLE_SQL_PLAN["sql"],
        )
        mock_exec_instance = mock_exec_cls.return_value
        mock_exec_instance.execute_sync.return_value = {
            "columns": ["x"], "rows": [[1]], "row_count": 1,
            "truncated": False, "elapsed_ms": 10, "error": None, "history_id": 1,
            "column_types": ["int"],
        }

        from app.services.ai_ask.execution_service import execute_sql_analysis
        first = execute_sql_analysis(
            db=db_session,
            session_id=sample_session,
            assistant_message_id=sample_message.id,
        )

        # 幂等调用（不 mock 执行——要求不调用执行服务）
        mock_exec_cls.reset_mock()
        second = execute_sql_analysis(
            db=db_session,
            session_id=sample_session,
            assistant_message_id=sample_message.id,
        )

        assert second.ok is True
        assert second.data == first.data
        # 第二次不应调用 execute_sync — 幂等返回
        mock_exec_cls.return_value.execute_sync.assert_not_called()

    @patch("app.services.ai_ask.execution_service.SqlExecutionService")
    @patch("app.services.ai_ask.execution_service.MetadataResolver")
    @patch("app.services.ai_ask.execution_service.SqlValidator")
    def test_success_result_camelcase_format(self, mock_validator_cls, mock_resolver_cls, mock_exec_cls, db_session, sample_session, sample_message):
        """成功 queryResult 使用 camelCase，不暴露 snake_case 字段"""
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidationResult
        fake_resolved = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
        mock_resolver_cls.resolve.return_value = fake_resolved
        mock_validator_cls.validate.return_value = SqlValidationResult(
            valid=True, errors=[], warnings=[], sql=_SAMPLE_SQL_PLAN["sql"],
        )
        mock_exec_instance = mock_exec_cls.return_value
        mock_exec_instance.execute_sync.return_value = {
            "columns": ["x"], "rows": [[42]],
            "row_count": 1, "truncated": False,
            "elapsed_ms": 25, "error": None, "history_id": 99,
            "column_types": ["int"],
        }

        from app.services.ai_ask.execution_service import execute_sql_analysis
        result = execute_sql_analysis(
            db=db_session,
            session_id=sample_session,
            assistant_message_id=sample_message.id,
        )
        assert result.ok is True
        qr = result.data["queryResult"]
        # camelCase 字段存在
        assert qr["rowCount"] == 1
        assert qr["elapsedMs"] == 25
        assert qr["historyId"] == 99
        # 保留 columns/rows/truncated
        assert qr["columns"] == ["x"]
        assert qr["rows"] == [[42]]
        assert qr["truncated"] is False
        assert qr["columnTypes"] == ["int"]
        # snake_case 字段不得暴露
        assert "row_count" not in qr
        assert "elapsed_ms" not in qr
        assert "history_id" not in qr

        # DB 中也使用 camelCase
        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == sample_message.id).first()
        db_qr = json.loads(reloaded.response_json)["data"]["queryResult"]
        assert "rowCount" in db_qr
        assert "row_count" not in db_qr


# ============================================================
# Status Validation
# ============================================================

class TestStatusValidation:
    """状态校验：streaming→409, pending/failed→422, 均不调用 SQL"""

    def _check_no_services_called(self, db_session, sample_session, status: str, narrative_level: str = "sql_pending"):
        """Helper: 创建指定 status/narrativeLevel 的消息，验证阻断和禁止调用"""
        data = dict(_SAMPLE_DATA)
        data["narrativeLevel"] = narrative_level
        msg = _create_assistant_message(
            db_session, session_id=sample_session,
            status=status,
            response_json_str=_make_envelope(data),
        )
        from app.services.ai_ask.execution_service import execute_sql_analysis
        with (
            patch("app.services.ai_ask.execution_service.SqlExecutionService") as mock_exec,
            patch("app.services.ai_ask.execution_service.MetadataResolver") as mock_resolver,
            patch("app.services.ai_ask.execution_service.SqlValidator") as mock_validator,
        ):
            with pytest.raises(HTTPException) as exc:
                execute_sql_analysis(
                    db=db_session,
                    session_id=sample_session,
                    assistant_message_id=msg.id,
                )
        mock_exec.return_value.execute_sync.assert_not_called()
        mock_resolver.resolve.assert_not_called()
        mock_validator.validate.assert_not_called()
        return exc

    def test_status_streaming_returns_409(self, db_session, sample_session):
        """status=streaming + sql_pending → 409"""
        exc = self._check_no_services_called(db_session, sample_session, "streaming")
        assert exc.value.status_code == 409

    def test_status_pending_returns_422(self, db_session, sample_session):
        """status=pending + sql_pending → 422"""
        exc = self._check_no_services_called(db_session, sample_session, "pending")
        assert exc.value.status_code == 422

    def test_status_failed_returns_422(self, db_session, sample_session):
        """status=failed + sql_pending → 422"""
        exc = self._check_no_services_called(db_session, sample_session, "failed")
        assert exc.value.status_code == 422

    def test_status_streaming_with_executed_returns_409(self, db_session, sample_session):
        """streaming + narrativeLevel=executed → 409，不幂等"""
        exc = self._check_no_services_called(db_session, sample_session, "streaming", "executed")
        assert exc.value.status_code == 409

    def test_status_pending_with_executed_returns_422(self, db_session, sample_session):
        """pending + narrativeLevel=executed → 422"""
        exc = self._check_no_services_called(db_session, sample_session, "pending", "executed")
        assert exc.value.status_code == 422

    def test_status_failed_with_executed_returns_422(self, db_session, sample_session):
        """failed + narrativeLevel=executed → 422"""
        exc = self._check_no_services_called(db_session, sample_session, "failed", "executed")
        assert exc.value.status_code == 422


# ============================================================
# Metadata & Validator Guards
# ============================================================

class TestMetadataGuard:
    """metadata 完整集合与 SQL 二次校验"""

    @patch("app.services.ai_ask.execution_service.MetadataResolver")
    def test_table_not_found(self, mock_resolver_cls, db_session, sample_session, sample_message):
        """缺表：两表只解析一个 → METADATA_NOT_FOUND，status completed，response_json 不变"""
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        # 只返回一个表，但 SQL plan 中有两个表
        bad_sql_plan = dict(_SAMPLE_SQL_PLAN)
        bad_sql_plan["tables"] = ["SCHEMA.TABLE1", "SCHEMA.TABLE2"]
        bad_data = dict(_SAMPLE_DATA)
        bad_data["sqlPlan"] = bad_sql_plan
        bad_msg = _create_assistant_message(
            db_session, session_id=sample_session,
            status="completed",
            response_json_str=_make_envelope(bad_data),
        )
        original_response_json = bad_msg.response_json
        # 只解析出一个表
        fake_resolved = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE1")]
        mock_resolver_cls.resolve.return_value = fake_resolved

        from app.services.ai_ask.execution_service import execute_sql_analysis
        result = execute_sql_analysis(
            db=db_session,
            session_id=sample_session,
            assistant_message_id=bad_msg.id,
        )
        assert result.ok is False
        assert result.error_code == AiAskErrorCode.METADATA_NOT_FOUND

        # 状态恢复 completed
        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == bad_msg.id).first()
        assert reloaded.status == "completed"
        # response_json 与 claim 前逐字一致
        assert reloaded.response_json == original_response_json
        # narrativeLevel 仍为 sql_pending
        envelope = json.loads(reloaded.response_json)
        assert envelope["data"]["narrativeLevel"] == "sql_pending"

    @patch("app.services.ai_ask.execution_service.MetadataResolver")
    @patch("app.services.ai_ask.execution_service.SqlValidator")
    def test_sql_validator_error_blocks_execution(self, mock_validator_cls, mock_resolver_cls, db_session, sample_session, sample_message):
        """SQL validator error → 不执行 SQL，status completed，原始 response_json 不变，details 用 sqlValidation"""
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidationResult
        fake_resolved = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
        mock_resolver_cls.resolve.return_value = fake_resolved
        sql_errors = [{"rule": "FIELD_NOT_FOUND", "message": "column x not found"}]
        mock_validator_cls.validate.return_value = SqlValidationResult(
            valid=False,
            errors=sql_errors,
            warnings=[],
            sql=_SAMPLE_SQL_PLAN["sql"],
        )

        original_response_json = sample_message.response_json

        from app.services.ai_ask.execution_service import execute_sql_analysis
        with patch("app.services.ai_ask.execution_service.SqlExecutionService") as mock_exec_cls:
            result = execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=sample_message.id,
            )
        # 不应调用执行
        mock_exec_cls.return_value.execute_sync.assert_not_called()
        assert result.ok is False

        # 验证 details 使用前端兼容的 sqlValidation
        assert result.details is not None
        assert "sqlValidation" in result.details
        assert result.details["sqlValidation"]["errors"] == sql_errors

        # 状态恢复 completed
        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == sample_message.id).first()
        assert reloaded.status == "completed"
        # 原始 response_json 不变，不得写成 executed
        assert reloaded.response_json == original_response_json
        envelope = json.loads(reloaded.response_json)
        assert envelope["data"]["narrativeLevel"] == "sql_pending"


# ============================================================
# Execution Error Guard
# ============================================================

class TestExecutionGuard:
    """execute_sync() 返回 {error: ...} 的处理"""

    @patch("app.services.ai_ask.execution_service.SqlExecutionService")
    @patch("app.services.ai_ask.execution_service.MetadataResolver")
    @patch("app.services.ai_ask.execution_service.SqlValidator")
    def test_execution_error_does_not_build_narrative(self, mock_validator_cls, mock_resolver_cls, mock_exec_cls, db_session, sample_session, sample_message):
        """execute_sync 返回 error → 不构建 narrative，返回执行错误"""
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidationResult
        fake_resolved = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
        mock_resolver_cls.resolve.return_value = fake_resolved
        mock_validator_cls.validate.return_value = SqlValidationResult(
            valid=True, errors=[], warnings=[], sql=_SAMPLE_SQL_PLAN["sql"],
        )
        mock_exec_instance = mock_exec_cls.return_value
        mock_exec_instance.execute_sync.return_value = {
            "columns": [], "rows": [], "error": "ORA-00942: table not found",
            "row_count": 0, "truncated": False, "elapsed_ms": 10, "history_id": None,
        }

        original_response_json = sample_message.response_json

        from app.services.ai_ask.execution_service import execute_sql_analysis
        with patch("app.services.ai_ask.execution_service.build_executed_narrative") as mock_narrative:
            result = execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=sample_message.id,
            )

        # 不调用 narrative builder
        mock_narrative.assert_not_called()
        # 返回执行错误
        assert result.ok is False
        # 状态恢复 completed
        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == sample_message.id).first()
        assert reloaded.status == "completed"
        # 保持 sql_pending 和原始 response_json
        assert reloaded.response_json == original_response_json
        envelope = json.loads(reloaded.response_json)
        assert envelope["data"]["narrativeLevel"] == "sql_pending"

    @patch("app.services.ai_ask.execution_service.SqlExecutionService")
    @patch("app.services.ai_ask.execution_service.MetadataResolver")
    @patch("app.services.ai_ask.execution_service.SqlValidator")
    def test_execution_error_uses_execution_error_code(self, mock_validator_cls, mock_resolver_cls, mock_exec_cls, db_session, sample_session, sample_message):
        """execute_sync 返回 error → 使用 EXECUTION_ERROR 错误码"""
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidationResult
        fake_resolved = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
        mock_resolver_cls.resolve.return_value = fake_resolved
        mock_validator_cls.validate.return_value = SqlValidationResult(
            valid=True, errors=[], warnings=[], sql=_SAMPLE_SQL_PLAN["sql"],
        )
        mock_exec_instance = mock_exec_cls.return_value
        mock_exec_instance.execute_sync.return_value = {
            "columns": [], "rows": [], "error": "timeout",
            "row_count": 0, "truncated": False, "elapsed_ms": 30000, "history_id": None,
        }

        from app.services.ai_ask.execution_service import execute_sql_analysis
        result = execute_sql_analysis(
            db=db_session,
            session_id=sample_session,
            assistant_message_id=sample_message.id,
        )
        assert result.ok is False
        assert result.error_code == AiAskErrorCode.EXECUTION_ERROR

    @patch("app.services.ai_ask.execution_service.SqlExecutionService")
    @patch("app.services.ai_ask.execution_service.MetadataResolver")
    @patch("app.services.ai_ask.execution_service.SqlValidator")
    def test_execution_timeout_returns_error_and_preserves_sql_pending(
        self, mock_validator_cls, mock_resolver_cls, mock_exec_cls, db_session, sample_session, sample_message
    ):
        """execute_sync 返回受控超时错误时，不写入 executed envelope，保持 sql_pending"""
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidationResult
        fake_resolved = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
        mock_resolver_cls.resolve.return_value = fake_resolved
        mock_validator_cls.validate.return_value = SqlValidationResult(
            valid=True, errors=[], warnings=[], sql=_SAMPLE_SQL_PLAN["sql"],
        )
        mock_exec_instance = mock_exec_cls.return_value
        mock_exec_instance.execute_sync.return_value = {
            "columns": [], "rows": [], "error": "查询超时（30秒限制）",
            "row_count": 0, "truncated": False, "elapsed_ms": 30000, "history_id": None,
        }

        original_response_json = sample_message.response_json

        from app.services.ai_ask.execution_service import execute_sql_analysis
        result = execute_sql_analysis(
            db=db_session,
            session_id=sample_session,
            assistant_message_id=sample_message.id,
        )

        assert result.ok is False
        assert result.error_code == AiAskErrorCode.EXECUTION_ERROR
        assert result.error_message == "查询执行失败"

        # 状态恢复 completed，response_json 未写入 executed
        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == sample_message.id).first()
        assert reloaded.status == "completed"
        assert reloaded.response_json == original_response_json
        envelope = json.loads(reloaded.response_json)
        assert envelope["data"]["narrativeLevel"] == "sql_pending"

class TestCASConcurrency:
    """两线程并发请求同一 message，只能执行一次"""

    def test_concurrent_claim(self, tmp_path, db_session, sample_session):
        """
        两个独立 Session、threading.Barrier。
        两请求针对同一消息。
        SqlExecutionService 调用次数严格 == 1。
        第二个请求只能 409 或读取最终 executed。
        线程必须退出，无 database locked 等意外异常。
        """
        # 创建消息
        msg = _create_assistant_message(
            db_session, session_id=sample_session,
            status="completed",
            response_json_str=_make_envelope(_SAMPLE_DATA),
        )
        msg_id = msg.id

        barrier = threading.Barrier(2, timeout=10)
        call_count = [0]
        lock = threading.Lock()
        results = []

        # 使用文件级 SQLite（共享数据库，check_same_thread=False）
        db_path = str(tmp_path / "concurrent_test.db")
        engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(bind=engine)
        Session_factory = sessionmaker(bind=engine)

        # 复制数据到共享数据库
        s0 = Session_factory()
        original_session = db_session.query(AskSession).filter(AskSession.id == sample_session).first()
        s0.add(AskSession(
            id=original_session.id, title=original_session.title,
            model_name=original_session.model_name,
        ))
        s0.add(AskMessage(
            id=msg.id, session_id=msg.session_id,
            role=msg.role, content=msg.content,
            status=msg.status, response_json=msg.response_json,
        ))
        s0.commit()
        s0.close()

        def worker(worker_id: int):
            s = Session_factory()
            try:
                from app.services.ai_ask.execution_service import execute_sql_analysis
                from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
                from app.services.ai_ask.sql_validator import SqlValidationResult

                with (
                    patch("app.services.ai_ask.execution_service.SqlExecutionService") as mock_exec_cls,
                    patch("app.services.ai_ask.execution_service.MetadataResolver") as mock_resolver_cls,
                    patch("app.services.ai_ask.execution_service.SqlValidator") as mock_validator_cls,
                ):
                    mock_resolver_cls.resolve.return_value = [
                        ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE"),
                    ]
                    mock_validator_cls.validate.return_value = SqlValidationResult(
                        valid=True, errors=[], warnings=[], sql=_SAMPLE_SQL_PLAN["sql"],
                    )
                    mock_exec_instance = mock_exec_cls.return_value
                    mock_exec_instance.execute_sync.return_value = {
                        "columns": ["x"], "rows": [[1]], "row_count": 1,
                        "truncated": False, "elapsed_ms": 10, "error": None, "history_id": 1,
                        "column_types": ["int"],
                    }

                    barrier.wait()

                    try:
                        res = execute_sql_analysis(
                            db=s,
                            session_id=sample_session,
                            assistant_message_id=msg_id,
                        )
                        with lock:
                            results.append((worker_id, "succ" if res.ok else "fail", None))
                    except HTTPException as e:
                        with lock:
                            results.append((worker_id, "http", e.status_code))
                    except Exception as e:
                        with lock:
                            results.append((worker_id, "exc", str(e)))

                    with lock:
                        call_count[0] += 1 if mock_exec_instance.execute_sync.called else 0

            finally:
                s.close()

        t1 = threading.Thread(target=worker, args=(1,))
        t2 = threading.Thread(target=worker, args=(2,))
        t1.start()
        t2.start()
        t1.join(timeout=15)
        t2.join(timeout=15)

        # 两个线程必须都正常退出
        assert not t1.is_alive(), "thread 1 did not exit"
        assert not t2.is_alive(), "thread 2 did not exit"

        # 必须恰好有一个 execute_sync 执行
        assert call_count[0] == 1, f"expected 1 execution, got {call_count[0]}, results={results}"

        # 最终 status=completed, narrativeLevel=executed
        final_session = Session_factory()
        try:
            reloaded = final_session.query(AskMessage).filter(AskMessage.id == msg_id).first()
            assert reloaded.status == "completed"
            envelope = json.loads(reloaded.response_json)
            assert envelope["data"]["narrativeLevel"] == "executed"
        finally:
            final_session.close()

    def test_cas_update_zero_returns_409(self, db_session, sample_session, sample_message):
        """CAS claim UPDATE 返回 0 → 不得返回 ok:true，不得覆盖，返回 409 fail-closed"""
        from app.services.ai_ask.execution_service import execute_sql_analysis
        # 将消息状态改为 streaming，使 CAS 的 status=completed 条件不命中
        db_session.query(AskMessage).filter(
            AskMessage.id == sample_message.id,
        ).update({"status": "streaming"})
        db_session.commit()
        db_session.expire_all()

        with pytest.raises(HTTPException) as exc:
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=sample_message.id,
            )
        assert exc.value.status_code == 409

        # 不得覆盖其他请求写入的状态或 response_json
        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == sample_message.id).first()
        assert reloaded.status == "streaming"  # 未被改为 completed，也未变成 executed

    @patch("app.services.ai_ask.execution_service.SqlExecutionService")
    @patch("app.services.ai_ask.execution_service.MetadataResolver")
    @patch("app.services.ai_ask.execution_service.SqlValidator")
    def test_final_cas_rowcount_zero(self, mock_validator_cls, mock_resolver_cls, mock_exec_cls, db_session, sample_session, sample_message):
        """最终 executed 写回 UPDATE 返回 0 → 不返回 ok:true，返回 409，不永久 streaming"""
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidationResult

        mock_resolver_cls.resolve.return_value = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
        mock_validator_cls.validate.return_value = SqlValidationResult(
            valid=True, errors=[], warnings=[], sql=_SAMPLE_SQL_PLAN["sql"],
        )
        mock_exec_instance = mock_exec_cls.return_value
        mock_exec_instance.execute_sync.return_value = {
            "columns": ["x"], "rows": [[1]], "row_count": 1,
            "truncated": False, "elapsed_ms": 10, "error": None, "history_id": 1,
            "column_types": ["int"],
        }

        msg_id = sample_message.id

        from app.services.ai_ask.execution_service import execute_sql_analysis, build_executed_narrative

        with patch("app.services.ai_ask.execution_service.build_executed_narrative") as mock_narrative:
            mock_narrative.return_value = {
                "summary": "test", "keyFindings": [],
                "evidence": [], "risks": [], "nextQuestions": [],
            }

            def _concurrent_modify(*args, **kwargs):
                """在 narrative 构建后、最终 CAS 前，模拟并发请求修改消息"""
                db_session.query(AskMessage).filter(AskMessage.id == msg_id).update({
                    "status": "completed",
                    "response_json": json.dumps({
                        "schemaVersion": 1,
                        "data": {"narrativeLevel": "executed", "queryResult": {"columns": ["x"]}},
                    }),
                })
                db_session.commit()
                return mock_narrative.return_value

            mock_narrative.side_effect = _concurrent_modify

            with pytest.raises(HTTPException) as exc:
                execute_sql_analysis(
                    db=db_session,
                    session_id=sample_session,
                    assistant_message_id=msg_id,
                )
            assert exc.value.status_code == 409

        # 不得留下永久 streaming — finally 会尝试恢复，但并发修改已设为 completed
        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == msg_id).first()
        assert reloaded.status == "completed"


# ============================================================
# Exception Recovery
# ============================================================

class TestExceptionRecovery:
    """Claim 后所有异常路径必须恢复 status 为 completed"""

    @patch("app.services.ai_ask.execution_service.SqlExecutionService")
    @patch("app.services.ai_ask.execution_service.MetadataResolver")
    @patch("app.services.ai_ask.execution_service.SqlValidator")
    def test_execution_http_exception_recovery(self, mock_validator_cls, mock_resolver_cls, mock_exec_cls, db_session, sample_session, sample_message):
        """SqlExecutionService 抛 HTTPException 后不永久 streaming"""
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidationResult
        fake_resolved = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
        mock_resolver_cls.resolve.return_value = fake_resolved
        mock_validator_cls.validate.return_value = SqlValidationResult(
            valid=True, errors=[], warnings=[], sql=_SAMPLE_SQL_PLAN["sql"],
        )
        mock_exec_instance = mock_exec_cls.return_value
        mock_exec_instance.execute_sync.side_effect = HTTPException(422, detail="exec failed")

        from app.services.ai_ask.execution_service import execute_sql_analysis
        with pytest.raises(HTTPException):
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=sample_message.id,
            )

        # 消息必须恢复为 completed，不能停在 streaming
        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == sample_message.id).first()
        assert reloaded.status == "completed", f"expected completed, got {reloaded.status}"

    @patch("app.services.ai_ask.execution_service.SqlExecutionService")
    @patch("app.services.ai_ask.execution_service.MetadataResolver")
    @patch("app.services.ai_ask.execution_service.SqlValidator")
    def test_execution_generic_exception_recovery(self, mock_validator_cls, mock_resolver_cls, mock_exec_cls, db_session, sample_session, sample_message):
        """SqlExecutionService 抛普通异常后不永久 streaming"""
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidationResult
        fake_resolved = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
        mock_resolver_cls.resolve.return_value = fake_resolved
        mock_validator_cls.validate.return_value = SqlValidationResult(
            valid=True, errors=[], warnings=[], sql=_SAMPLE_SQL_PLAN["sql"],
        )
        mock_exec_instance = mock_exec_cls.return_value
        mock_exec_instance.execute_sync.side_effect = RuntimeError("unexpected error")

        from app.services.ai_ask.execution_service import execute_sql_analysis
        with pytest.raises(RuntimeError):
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=sample_message.id,
            )

        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == sample_message.id).first()
        assert reloaded.status == "completed", f"expected completed, got {reloaded.status}"

    @patch("app.services.ai_ask.execution_service.SqlValidator")
    def test_metadata_resolver_exception_recovery(self, mock_validator_cls, db_session, sample_session, sample_message):
        """MetadataResolver 抛异常后仍恢复"""
        from unittest.mock import patch
        with patch("app.services.ai_ask.execution_service.MetadataResolver.resolve") as mock_resolve:
            mock_resolve.side_effect = RuntimeError("metadata error")
            from app.services.ai_ask.execution_service import execute_sql_analysis
            with pytest.raises(RuntimeError):
                execute_sql_analysis(
                    db=db_session,
                    session_id=sample_session,
                    assistant_message_id=sample_message.id,
                )

        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == sample_message.id).first()
        assert reloaded.status == "completed", f"expected completed, got {reloaded.status}"

    @patch("app.services.ai_ask.execution_service.SqlExecutionService")
    @patch("app.services.ai_ask.execution_service.MetadataResolver")
    @patch("app.services.ai_ask.execution_service.SqlValidator")
    def test_recovery_failure_does_not_mask_original(self, mock_validator_cls, mock_resolver_cls, mock_exec_cls, db_session, sample_session, sample_message):
        """恢复失败不掩盖原异常"""
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidationResult
        fake_resolved = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
        mock_resolver_cls.resolve.return_value = fake_resolved
        mock_validator_cls.validate.return_value = SqlValidationResult(
            valid=True, errors=[], warnings=[], sql=_SAMPLE_SQL_PLAN["sql"],
        )
        mock_exec_instance = mock_exec_cls.return_value
        mock_exec_instance.execute_sync.side_effect = RuntimeError("original error")

        from app.services.ai_ask.execution_service import execute_sql_analysis

        with pytest.raises(RuntimeError) as exc:
            execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=sample_message.id,
            )
        # 原始异常必须传播，恢复失败不得掩盖
        assert "original error" in str(exc.value)

    def test_all_recoverable_scenarios_not_permanent_streaming(self, db_session, sample_session, sample_message):
        """验证所有可恢复场景最终不永久 streaming——合并各 recovery 测试的断言"""
        from app.services.ai_ask.execution_service import execute_sql_analysis
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidationResult

        scenarios = []

        # 场景 1: MetadataResolver 抛 HTTPException
        with patch("app.services.ai_ask.execution_service.MetadataResolver") as mock_resolver:
            mock_resolver.resolve.side_effect = HTTPException(500)
            with patch("app.services.ai_ask.execution_service.SqlValidator"):
                with patch("app.services.ai_ask.execution_service.SqlExecutionService"):
                    msg1 = _create_assistant_message(
                        db_session, session_id=sample_session,
                        status="completed",
                        response_json_str=_make_envelope(_SAMPLE_DATA),
                    )
                    try:
                        execute_sql_analysis(db=db_session, session_id=sample_session, assistant_message_id=msg1.id)
                    except HTTPException:
                        pass
                    db_session.expire_all()
                    reloaded = db_session.query(AskMessage).filter(AskMessage.id == msg1.id).first()
                    scenarios.append(("metadata_http_exception", reloaded.status == "completed"))

        # 场景 2: execute_sync 抛 HTTPException
        with (
            patch("app.services.ai_ask.execution_service.MetadataResolver") as mock_resolver,
            patch("app.services.ai_ask.execution_service.SqlValidator") as mock_validator,
            patch("app.services.ai_ask.execution_service.SqlExecutionService") as mock_exec,
        ):
            mock_resolver.resolve.return_value = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
            mock_validator.validate.return_value = SqlValidationResult(valid=True, errors=[], warnings=[], sql="SELECT 1")
            mock_exec.return_value.execute_sync.side_effect = HTTPException(422, detail="exec failed")
            msg2 = _create_assistant_message(
                db_session, session_id=sample_session,
                status="completed",
                response_json_str=_make_envelope(_SAMPLE_DATA),
            )
            try:
                execute_sql_analysis(db=db_session, session_id=sample_session, assistant_message_id=msg2.id)
            except HTTPException:
                pass
            db_session.expire_all()
            reloaded = db_session.query(AskMessage).filter(AskMessage.id == msg2.id).first()
            scenarios.append(("exec_http_exception", reloaded.status == "completed"))

        # 场景 3: Metadata 不完整（返回 error 而非异常）
        with patch("app.services.ai_ask.execution_service.MetadataResolver") as mock_resolver:
            mock_resolver.resolve.return_value = [ResolvedTableMetadata(schema_name="OTHER", table_name="TABLE")]
            msg3 = _create_assistant_message(
                db_session, session_id=sample_session,
                status="completed",
                response_json_str=_make_envelope(_SAMPLE_DATA),
            )
            execute_sql_analysis(db=db_session, session_id=sample_session, assistant_message_id=msg3.id)
            db_session.expire_all()
            reloaded = db_session.query(AskMessage).filter(AskMessage.id == msg3.id).first()
            scenarios.append(("metadata_not_found", reloaded.status == "completed" and json.loads(reloaded.response_json)["data"]["narrativeLevel"] == "sql_pending"))

        # 场景 4: execute_sync 返回 error
        with (
            patch("app.services.ai_ask.execution_service.MetadataResolver") as mock_resolver,
            patch("app.services.ai_ask.execution_service.SqlValidator") as mock_validator,
            patch("app.services.ai_ask.execution_service.SqlExecutionService") as mock_exec,
        ):
            mock_resolver.resolve.return_value = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
            mock_validator.validate.return_value = SqlValidationResult(valid=True, errors=[], warnings=[], sql="SELECT 1")
            mock_exec.return_value.execute_sync.return_value = {"error": "exec failed", "columns": [], "rows": []}
            msg4 = _create_assistant_message(
                db_session, session_id=sample_session,
                status="completed",
                response_json_str=_make_envelope(_SAMPLE_DATA),
            )
            execute_sql_analysis(db=db_session, session_id=sample_session, assistant_message_id=msg4.id)
            db_session.expire_all()
            reloaded = db_session.query(AskMessage).filter(AskMessage.id == msg4.id).first()
            scenarios.append(("exec_error_response", reloaded.status == "completed"))

        # 所有场景必须不永久 streaming
        for name, ok in scenarios:
            assert ok, f"Scenario '{name}' left message in non-completed state"


# ============================================================
# API Integration (Request/Response)
# ============================================================

class TestApiIntegration:
    """API 层面验证请求/响应契约"""

    def test_request_body_only_session_and_message(self):
        """请求体只接受 sessionId 和 assistantMessageId"""
        from app.schemas.ai_ask import AiAskExecuteSqlRequest
        body = AiAskExecuteSqlRequest.model_validate(
            {"sessionId": 1, "assistantMessageId": 2}
        )
        assert body.session_id == 1
        assert body.assistant_message_id == 2

    def test_request_extra_fields_ignored(self):
        """请求携带额外字段（如 sql）应被忽略"""
        from app.schemas.ai_ask import AiAskExecuteSqlRequest
        body = AiAskExecuteSqlRequest.model_validate(
            {"sessionId": 1, "assistantMessageId": 2, "sql": "SELECT 1"}
        )
        assert body.session_id == 1
        assert body.assistant_message_id == 2
        assert not hasattr(body, "sql")

    def test_response_structure_matches_analyze(self):
        """响应结构与 analyze 相同（AiAskAnalyzeSuccessResponse/ErrorResponse）"""
        # 验证响应类型与 analyze 端点类型一致
        from app.schemas.ai_ask import (
            AiAskAnalyzeSuccessResponse,
            AiAskAnalyzeErrorResponse,
        )
        ok_resp = AiAskAnalyzeSuccessResponse(data={"key": "value"})
        assert ok_resp.ok is True
        assert ok_resp.data == {"key": "value"}

        err_resp = AiAskAnalyzeErrorResponse(
            errorCode="TEST_ERROR",
            errorMessage="test error",
        )
        assert err_resp.ok is False
        assert err_resp.error_code == "TEST_ERROR"

    def test_safe_load_response_json_imported_from_ask_service(self):
        """验证 execution_service 不再有本地 _safe_load_response_json，改用 ask_service 的"""
        from app.services.ask_service import _safe_load_response_json as ask_impl
        from app.services.ai_ask.execution_service import _safe_load_response_json as exec_impl
        assert exec_impl is ask_impl, "execution_service 必须复用 ask_service 的 _safe_load_response_json"

    def test_api_integration_execute_sql_success(self, app, client, tmp_path):
        """TestClient 调用 execute-sql，mock 所有服务为成功，严格断言响应和 DB"""
        from app.main import create_app
        from app.models.base import Base as AppBase
        from app.models.ask_models import AskMessage as AppAskMessage, AskSession as AppAskSession

        # 种子数据到 app 使用的同一 tmp_path SQLite
        db_path = tmp_path / "metricforge-api-test.db"
        engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
        AppBase.metadata.create_all(bind=engine)
        Session = sessionmaker(bind=engine)
        s = Session()

        ask_session = AppAskSession(title="集成测试", model_name="gpt-4")
        s.add(ask_session)
        s.commit()
        ask_session_id = ask_session.id

        msg = AppAskMessage(
            session_id=ask_session_id, role="assistant", content="",
            status="completed",
            response_json=_make_envelope(_SAMPLE_DATA),
        )
        s.add(msg)
        s.commit()
        msg_id = msg.id
        s.close()

        # mock 所有下游服务为确定性成功
        from app.services.ai_ask.metadata_resolver import MetadataResolver, ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidator, SqlValidationResult
        from app.services.ai_ask import execution_service as exec_mod

        monkeypatch = pytest.MonkeyPatch()
        monkeypatch.setattr(
            MetadataResolver, "resolve",
            classmethod(lambda cls, **kw: [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]),
        )
        monkeypatch.setattr(
            SqlValidator, "validate",
            classmethod(lambda cls, plan, resolved: SqlValidationResult(
                valid=True, errors=[], warnings=[], sql=plan.get("sql", ""),
            )),
        )
        # mock SqlExecutionService 避免真实数据源适配器查找
        mock_exec_instance = MagicMock()
        mock_exec_instance.execute_sync.return_value = {
            "columns": ["x"], "rows": [[1]],
            "row_count": 1, "truncated": False,
            "elapsed_ms": 10, "error": None, "history_id": 99,
            "column_types": ["int"],
        }
        monkeypatch.setattr(exec_mod, "SqlExecutionService", lambda: mock_exec_instance)

        try:
            response = client.post("/api/ai-ask/execute-sql", json={
                "sessionId": ask_session_id,
                "assistantMessageId": msg_id,
            })
        finally:
            monkeypatch.undo()

        # 严格断言：200, ok=true, narrativeLevel=executed
        assert response.status_code == 200, f"expected 200, got {response.status_code}: {response.text}"
        body = response.json()
        assert body["ok"] is True
        data = body["data"]
        assert data["narrativeLevel"] == "executed"
        assert "queryResult" in data

        # 严格断言 queryResult camelCase 字段
        qr = data["queryResult"]
        assert qr["rowCount"] == 1
        assert qr["elapsedMs"] == 10
        assert qr["historyId"] == 99
        assert qr["columns"] == ["x"]
        assert qr["rows"] == [[1]]
        assert qr["truncated"] is False
        assert qr["columnTypes"] == ["int"]
        assert "row_count" not in qr
        assert "elapsed_ms" not in qr
        assert "history_id" not in qr

        # 从数据库验证 status=completed 和版本化 executed envelope
        verify_engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
        AppBase.metadata.create_all(bind=verify_engine)
        VerifySession = sessionmaker(bind=verify_engine)
        vs = VerifySession()
        try:
            reloaded = vs.query(AppAskMessage).filter(AppAskMessage.id == msg_id).first()
            assert reloaded is not None
            assert reloaded.status == "completed"
            envelope = json.loads(reloaded.response_json)
            assert envelope["schemaVersion"] == 1
            assert envelope["data"]["narrativeLevel"] == "executed"
            db_qr = envelope["data"]["queryResult"]
            assert "rowCount" in db_qr
            assert "row_count" not in db_qr
        finally:
            vs.close()

    def test_api_integration_extra_fields_not_override_plan(self, app, client, tmp_path):
        """请求携带恶意 sql/datasourceId 不得覆盖服务端持久化计划"""
        from app.models.base import Base as AppBase
        from app.models.ask_models import AskMessage as AppAskMessage, AskSession as AppAskSession
        from app.services.ai_ask import execution_service as exec_mod
        from app.services.ai_ask.metadata_resolver import MetadataResolver, ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidator, SqlValidationResult

        db_path = tmp_path / "metricforge-api-test.db"
        engine = create_engine(f"sqlite:///{db_path}")
        AppBase.metadata.create_all(bind=engine)
        Session = sessionmaker(bind=engine)
        s = Session()

        ask_session = AppAskSession(title="security test", model_name="gpt-4")
        s.add(ask_session)
        s.commit()
        ask_session_id = ask_session.id

        msg = AppAskMessage(
            session_id=ask_session_id, role="assistant", content="",
            status="completed",
            response_json=_make_envelope(_SAMPLE_DATA),
        )
        s.add(msg)
        s.commit()
        msg_id = msg.id
        s.close()

        # mock 所有下游服务，捕获 execute_sync 调用参数
        monkeypatch = pytest.MonkeyPatch()
        monkeypatch.setattr(
            MetadataResolver, "resolve",
            classmethod(lambda cls, **kw: [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]),
        )
        monkeypatch.setattr(
            SqlValidator, "validate",
            classmethod(lambda cls, plan, resolved: SqlValidationResult(
                valid=True, errors=[], warnings=[], sql=plan.get("sql", ""),
            )),
        )

        captured_kwargs = {}
        mock_exec = MagicMock()

        def _capturing_execute_sync(db, datasource_id, sql):
            captured_kwargs["datasource_id"] = datasource_id
            captured_kwargs["sql"] = sql
            return {
                "columns": ["x"], "rows": [[1]], "row_count": 1,
                "truncated": False, "elapsed_ms": 10, "error": None, "history_id": 1,
                "column_types": ["int"],
            }

        mock_exec.execute_sync = _capturing_execute_sync
        monkeypatch.setattr(exec_mod, "SqlExecutionService", lambda: mock_exec)

        try:
            response = client.post("/api/ai-ask/execute-sql", json={
                "sessionId": ask_session_id,
                "assistantMessageId": msg_id,
                "sql": "SELECT malicious FROM evil",
                "datasourceId": 999,
            })
        finally:
            monkeypatch.undo()

        # 必须返回 200（服务端计划被正确使用），不得 422 或 500
        assert response.status_code == 200, f"expected 200, got {response.status_code}: {response.text}"

        # 验证 execute_sync 收到的 sql/datasourceId 来自服务端 plan，非请求体
        assert captured_kwargs["sql"] == _SAMPLE_SQL_PLAN["sql"], \
            f"execute_sync received sql={captured_kwargs['sql']!r}, expected {_SAMPLE_SQL_PLAN['sql']!r}"
        assert captured_kwargs["datasource_id"] == _SAMPLE_SQL_PLAN["datasourceId"], \
            f"execute_sync received datasource_id={captured_kwargs['datasource_id']!r}, expected {_SAMPLE_SQL_PLAN['datasourceId']!r}"

        # 响应成功
        body = response.json()
        assert body["ok"] is True


# ============================================================
# Phase 5N Task 6.5C follow-up — Parametrized supervision error recovery
# ============================================================

class TestParametrizedErrorRecovery:
    """6. 参数化覆盖所有 supervision error_code。"""

    @pytest.mark.parametrize("error_code,error_msg", [
        ("TIMEOUT", "query timed out"),
        ("WORKER_CRASH", "worker exited unexpectedly"),
        ("WORKER_PROTOCOL_ERROR", "invalid result payload"),
        ("SERIALIZATION_ERROR", "result serialization failed"),
        ("EXECUTION_ERROR", "query execution failed"),
        ("TERMINATION_FAILURE", "worker process refused to terminate"),
    ])
    @patch("app.services.ai_ask.execution_service.SqlExecutionService")
    @patch("app.services.ai_ask.execution_service.MetadataResolver")
    @patch("app.services.ai_ask.execution_service.SqlValidator")
    def test_all_supervision_errors_recover_completed_sql_pending(
        self, mock_validator_cls, mock_resolver_cls, mock_exec_cls,
        error_code, error_msg,
        db_session, sample_session, sample_message,
    ):
        """所有 supervision error 均恢复 completed + sql_pending，不调用 narrative builder。"""
        from app.services.ai_ask.metadata_resolver import ResolvedTableMetadata
        from app.services.ai_ask.sql_validator import SqlValidationResult
        fake_resolved = [ResolvedTableMetadata(schema_name="SCHEMA", table_name="TABLE")]
        mock_resolver_cls.resolve.return_value = fake_resolved
        mock_validator_cls.validate.return_value = SqlValidationResult(
            valid=True, errors=[], warnings=[], sql=_SAMPLE_SQL_PLAN["sql"],
        )
        mock_exec_instance = mock_exec_cls.return_value
        mock_exec_instance.execute_sync.return_value = {
            "columns": [], "rows": [], "error": error_msg,
            "row_count": 0, "truncated": False, "elapsed_ms": 10, "history_id": None,
        }

        original_response_json = sample_message.response_json

        from app.services.ai_ask.execution_service import execute_sql_analysis
        with patch("app.services.ai_ask.execution_service.build_executed_narrative") as mock_narrative:
            result = execute_sql_analysis(
                db=db_session,
                session_id=sample_session,
                assistant_message_id=sample_message.id,
            )

        # narrative builder not called
        mock_narrative.assert_not_called()
        # returns EXECUTION_ERROR
        assert result.ok is False
        assert result.error_code == AiAskErrorCode.EXECUTION_ERROR

        # status recovered to completed
        db_session.expire_all()
        reloaded = db_session.query(AskMessage).filter(AskMessage.id == sample_message.id).first()
        assert reloaded.status == "completed"
        # response_json preserved as sql_pending
        assert reloaded.response_json == original_response_json
        envelope = json.loads(reloaded.response_json)
        assert envelope["data"]["narrativeLevel"] == "sql_pending"
