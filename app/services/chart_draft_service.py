import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.chart_draft import ChartDraft
from app.models.datasource import DatasourceConfig


class ChartDraftService:
    """图表草稿 CRUD 服务"""

    def create(self, data: dict, db: Session) -> dict:
        title = data.get("title", "").strip()
        if not title:
            now = datetime.now(timezone.utc)
            title = f"未命名图表_{now.strftime('%m%d')}"

        chart_config = data["chart_config"]
        if isinstance(chart_config, dict):
            chart_config = json.dumps(chart_config, ensure_ascii=False)

        draft = ChartDraft(
            title=title,
            sql_text=data["sql_text"],
            datasource_id=data.get("datasource_id"),
            chart_config=chart_config,
        )
        db.add(draft)
        db.commit()
        db.refresh(draft)
        return self._to_dict(draft, db)

    def list(self, db: Session) -> list[dict]:
        drafts = db.query(ChartDraft).order_by(ChartDraft.updated_at.desc()).all()
        return [self._to_dict(d, db) for d in drafts]

    def get(self, draft_id: int, db: Session) -> dict | None:
        draft = db.query(ChartDraft).filter(ChartDraft.id == draft_id).first()
        return self._to_dict(draft, db) if draft else None

    def update(self, draft_id: int, data: dict, db: Session) -> dict | None:
        draft = db.query(ChartDraft).filter(ChartDraft.id == draft_id).first()
        if not draft:
            return None

        if "title" in data:
            draft.title = data["title"].strip() or draft.title
        if "sql_text" in data:
            draft.sql_text = data["sql_text"]
        if "datasource_id" in data:
            draft.datasource_id = data["datasource_id"]
        if "chart_config" in data:
            chart_config = data["chart_config"]
            if isinstance(chart_config, dict):
                chart_config = json.dumps(chart_config, ensure_ascii=False)
            draft.chart_config = chart_config

        draft.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(draft)
        return self._to_dict(draft, db)

    def delete(self, draft_id: int, db: Session) -> bool:
        draft = db.query(ChartDraft).filter(ChartDraft.id == draft_id).first()
        if not draft:
            return False
        db.delete(draft)
        db.commit()
        return True

    def _to_dict(self, draft: ChartDraft, db: Session) -> dict:
        available = False
        if draft.datasource_id is not None:
            available = (
                db.query(DatasourceConfig)
                .filter(DatasourceConfig.id == draft.datasource_id)
                .first()
                is not None
            )
        return {
            "id": draft.id,
            "title": draft.title,
            "sql_text": draft.sql_text,
            "datasource_id": draft.datasource_id,
            "chart_config": json.loads(draft.chart_config),
            "datasource_available": available,
            "created_at": draft.created_at.isoformat() if draft.created_at else None,
            "updated_at": draft.updated_at.isoformat() if draft.updated_at else None,
        }
