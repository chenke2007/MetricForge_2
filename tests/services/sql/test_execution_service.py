import pytest
from unittest.mock import MagicMock, patch
from app.services.sql_execution_service import SqlExecutionService
from app.adapters.base import QueryResult


class ServiceTestBase:
    """Helper base for execution service tests"""
    @pytest.fixture(autouse=True)
    def setup(self, request):
        self.service = SqlExecutionService()
        yield


@pytest.fixture
def service():
    return SqlExecutionService()


class TestValidateThenExecute:
    def test_validation_failure_returns_422(self, service):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            service._raise_if_invalid("DROP TABLE t")
        assert exc.value.status_code == 422
        detail = exc.value.detail
        assert "code" in detail

    def test_valid_sql_passes_validation(self, service):
        result = service._raise_if_invalid("SELECT * FROM DUAL")
        assert result.is_valid
        assert result.sanitized_sql is not None


class TestExecute(ServiceTestBase):
    @patch('app.services.sql_execution_service.get_adapter_for_datasource')
    def test_execute_success(self, mock_get_adapter, db_session):
        mock_adapter = MagicMock()
        mock_adapter.execute_query.return_value = QueryResult(
            columns=["ID", "NAME"],
            rows=[[1, "Alice"], [2, "Bob"]],
            row_count=2,
        )
        mock_get_adapter.return_value = mock_adapter

        response = self.service.execute_sync(db_session, datasource_id=1, sql="SELECT * FROM users")
        assert response["columns"] == ["ID", "NAME"]
        assert len(response["rows"]) == 2
        assert response["row_count"] == 2
        assert response["truncated"] is False
        assert response["error"] is None
        assert response["history_id"] is not None
        mock_adapter.close.assert_called_once()

    @patch('app.services.sql_execution_service.get_adapter_for_datasource')
    def test_execute_adapter_returns_error(self, mock_get_adapter, db_session):
        mock_adapter = MagicMock()
        mock_adapter.execute_query.return_value = QueryResult(error="ORA-00942: 表或视图不存在")
        mock_get_adapter.return_value = mock_adapter

        response = self.service.execute_sync(db_session, datasource_id=1, sql="SELECT * FROM nonexistent")
        assert response["error"] == "ORA-00942: 表或视图不存在"
        assert response["row_count"] == 0
        assert response["history_id"] is not None
        mock_adapter.close.assert_called_once()

    @patch('app.services.sql_execution_service.get_adapter_for_datasource')
    def test_execute_marks_truncated(self, mock_get_adapter, db_session):
        mock_adapter = MagicMock()
        many_rows = [[i] for i in range(1500)]
        mock_adapter.execute_query.return_value = QueryResult(
            columns=["ID"], rows=many_rows, row_count=1500,
        )
        mock_get_adapter.return_value = mock_adapter

        with patch.object(self.service.validator, 'MAX_RESULT_ROWS', 10):
            response = self.service.execute_sync(db_session, datasource_id=1, sql="SELECT * FROM big_table")
        # adapter 实际返回 1500，但 LIMIT 包裹后 Oracle 返回 <= 1000
        # 这里 mock 返回了 1500，所以我们验证 truncated
        assert response["truncated"] is True

    def test_execute_datasource_not_found(self, db_session):
        with pytest.raises(Exception):
            self.service.execute_sync(db_session, datasource_id=999, sql="SELECT 1")

    @patch('app.services.sql_execution_service.get_adapter_for_datasource')
    def test_close_called_on_failure(self, mock_get_adapter, db_session):
        mock_adapter = MagicMock()
        mock_adapter.execute_query.side_effect = RuntimeError("连接断开")
        mock_get_adapter.return_value = mock_adapter

        response = self.service.execute_sync(db_session, datasource_id=1, sql="SELECT 1")
        assert response["error"] is not None
        mock_adapter.close.assert_called_once()
