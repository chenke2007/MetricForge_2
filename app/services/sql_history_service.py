from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.sql_workbench import SqlExecutionHistory


class SqlHistoryService:
    """执行历史查询服务（仅读和创建，不提供修改/删除）"""

    def create(self, data: dict, db: Session) -> dict:
        history = SqlExecutionHistory(
            sql_text=data["sql_text"],
            sql_hash=data["sql_hash"],
            datasource_id=data.get("datasource_id"),
            datasource_name=data.get("datasource_name"),
            status=data.get("status", "success"),
            elapsed_ms=data.get("elapsed_ms"),
            row_count=data.get("row_count"),
            truncated=data.get("truncated", False),
            error_message=data.get("error_message"),
        )
        db.add(history)
        db.commit()
        db.refresh(history)
        return self._to_dict(history)

    def list(self, db: Session, datasource_id: int | None = None, limit: int = 50) -> list[dict]:
        q = db.query(SqlExecutionHistory)
        if datasource_id is not None:
            q = q.filter(SqlExecutionHistory.datasource_id == datasource_id)
        q = q.order_by(SqlExecutionHistory.created_at.desc()).limit(limit)
        return [self._to_dict(h) for h in q.all()]

    def get(self, history_id: int, db: Session) -> dict | None:
        h = db.query(SqlExecutionHistory).filter(SqlExecutionHistory.id == history_id).first()
        return self._to_dict(h) if h else None

    def _to_dict(self, h: SqlExecutionHistory) -> dict:
        return {
            "id": h.id,
            "sql_text": h.sql_text,
            "sql_hash": h.sql_hash,
            "datasource_id": h.datasource_id,
            "datasource_name": h.datasource_name,
            "status": h.status,
            "elapsed_ms": h.elapsed_ms,
            "row_count": h.row_count,
            "truncated": h.truncated,
            "error_message": h.error_message,
            "created_at": h.created_at.isoformat() if h.created_at else None,
        }
