import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.chart_draft import ChartDraft


class ChartDraftService:
    """图表草稿 CRUD 服务"""

    def create(self, data: dict, db: Session) -> dict:
        title = data.get("title", "").strip()
        if not title:
            now = datetime.now(timezone.utc)
            title = f"未命名图表_{now.strftime('%m%d')}"
        draft = ChartDraft(
            title=title,
            sql_text=data["sql_text"],
            datasource_id=data.get("datasource_id"),
            chart_config=json.dumps(data["chart_config"]),
        )
        db.add(draft)
        db.commit()
        db.refresh(draft)
        return self._to_dict(draft)

    def _to_dict(self, draft: ChartDraft) -> dict:
        return {
            "id": draft.id,
            "title": draft.title,
            "sql_text": draft.sql_text,
            "datasource_id": draft.datasource_id,
            "chart_config": json.loads(draft.chart_config) if draft.chart_config else {},
            "created_at": draft.created_at.isoformat() if draft.created_at else None,
            "updated_at": draft.updated_at.isoformat() if draft.updated_at else None,
        }
