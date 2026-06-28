from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.sql_workbench import SqlDraft


class SqlDraftService:
    """草稿 CRUD 服务"""

    def create(self, data: dict, db: Session) -> dict:
        title = data.get("title", "").strip()
        if not title:
            now = datetime.now(timezone.utc)
            title = f"未命名查询_{now.strftime('%m%d')}"
        draft = SqlDraft(
            title=title,
            sql_text=data["sql_text"],
            datasource_id=data.get("datasource_id"),
            dialect=data.get("dialect", "oracle"),
            description=data.get("description"),
            tags=data.get("tags"),
            is_template=data.get("is_template", False),
        )
        db.add(draft)
        db.commit()
        db.refresh(draft)
        return self._to_dict(draft)

    def list(self, db: Session) -> list[dict]:
        drafts = db.query(SqlDraft).order_by(SqlDraft.updated_at.desc()).all()
        return [self._to_dict(d) for d in drafts]

    def get(self, draft_id: int, db: Session) -> dict | None:
        draft = db.query(SqlDraft).filter(SqlDraft.id == draft_id).first()
        return self._to_dict(draft) if draft else None

    def update(self, draft_id: int, data: dict, db: Session) -> dict | None:
        draft = db.query(SqlDraft).filter(SqlDraft.id == draft_id).first()
        if not draft:
            return None
        if "title" in data:
            draft.title = data["title"]
        if "sql_text" in data:
            draft.sql_text = data["sql_text"]
        if "datasource_id" in data:
            draft.datasource_id = data["datasource_id"]
        if "dialect" in data:
            draft.dialect = data["dialect"]
        if "description" in data:
            draft.description = data["description"]
        if "tags" in data:
            draft.tags = data["tags"]
        if "is_template" in data:
            draft.is_template = data["is_template"]
        draft.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(draft)
        return self._to_dict(draft)

    def delete(self, draft_id: int, db: Session) -> bool:
        draft = db.query(SqlDraft).filter(SqlDraft.id == draft_id).first()
        if not draft:
            return False
        db.delete(draft)
        db.commit()
        return True

    def _to_dict(self, draft: SqlDraft) -> dict:
        return {
            "id": draft.id,
            "title": draft.title,
            "sql_text": draft.sql_text,
            "datasource_id": draft.datasource_id,
            "dialect": draft.dialect,
            "description": draft.description,
            "tags": draft.tags,
            "is_template": draft.is_template,
            "created_at": draft.created_at.isoformat() if draft.created_at else None,
            "updated_at": draft.updated_at.isoformat() if draft.updated_at else None,
        }
