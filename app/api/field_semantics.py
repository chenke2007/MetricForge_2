"""Field semantic API."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..models import ColumnMetadata, FieldSemantic, get_session
from ..services.governance_service import auto_resolve_ticket_on_semantic

router = APIRouter()


def get_db():
    db = get_session()
    try:
        yield db
    finally:
        db.close()


def _serialize_column(column: ColumnMetadata) -> dict:
    return {
        "id": column.id,
        "schema_name": column.table.schema_name,
        "table_name": column.table.table_name,
        "column_name": column.column_name,
        "column_type": column.column_type,
        "nullable": column.nullable,
        "comment": column.comment,
        "is_primary_key": column.is_primary_key,
        "is_foreign_key": column.is_foreign_key,
        "enum_samples": column.enum_samples,
    }


def _serialize_semantic(semantic: FieldSemantic | None) -> dict | None:
    if not semantic:
        return None
    return {
        "id": semantic.id,
        "business_alias": semantic.business_alias,
        "meaning": semantic.meaning,
        "unit": semantic.unit,
        "enum_values": semantic.enum_values,
        "data_quality_note": semantic.data_quality_note,
        "is_governed": semantic.is_governed,
        "governed_by": semantic.governed_by,
        "governed_at": str(semantic.governed_at) if semantic.governed_at else None,
    }


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


@router.get("/columns/{column_id}")
def get_column_semantic(column_id: int, db: Session = Depends(get_db)):
    """Return column context and existing semantic metadata."""
    column = db.query(ColumnMetadata).filter(ColumnMetadata.id == column_id).first()
    if not column:
        raise HTTPException(status_code=404, detail="\u5b57\u6bb5\u4e0d\u5b58\u5728")
    return {
        "column": _serialize_column(column),
        "semantic": _serialize_semantic(column.semantic),
    }


@router.put("/columns/{column_id}")
def save_column_semantic(
    column_id: int,
    business_alias: str = Query(..., description="\u4e1a\u52a1\u522b\u540d"),
    meaning: str = Query(..., description="\u5b57\u6bb5\u542b\u4e49"),
    unit: str = Query(None, description="\u5355\u4f4d"),
    enum_values: str = Query(None, description="\u679a\u4e3e\u503c\u89e3\u91ca"),
    data_quality_note: str = Query(None, description="\u6570\u636e\u8d28\u91cf\u8bf4\u660e"),
    governed_by: str = Query(None, description="\u6cbb\u7406\u8d1f\u8d23\u4eba"),
    db: Session = Depends(get_db),
):
    """Create or update a field semantic, then auto-close related tickets."""
    if not business_alias.strip():
        raise HTTPException(status_code=400, detail="\u4e1a\u52a1\u522b\u540d\u4e0d\u80fd\u4e3a\u7a7a")
    if not meaning.strip():
        raise HTTPException(status_code=400, detail="\u5b57\u6bb5\u542b\u4e49\u4e0d\u80fd\u4e3a\u7a7a")

    column = db.query(ColumnMetadata).filter(ColumnMetadata.id == column_id).first()
    if not column:
        raise HTTPException(status_code=404, detail="\u5b57\u6bb5\u4e0d\u5b58\u5728")

    try:
        semantic = column.semantic
        if not semantic:
            semantic = FieldSemantic(column_id=column.id)
            db.add(semantic)

        semantic.business_alias = business_alias.strip()
        semantic.meaning = meaning.strip()
        semantic.unit = _blank_to_none(unit)
        semantic.enum_values = _blank_to_none(enum_values)
        semantic.data_quality_note = _blank_to_none(data_quality_note)
        semantic.is_governed = True
        semantic.governed_by = _blank_to_none(governed_by)
        semantic.governed_at = datetime.utcnow()

        db.flush()
        closed_count = auto_resolve_ticket_on_semantic(column_id, semantic.governed_by, db=db)
        semantic_id = semantic.id
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "message": "\u5b57\u6bb5\u8bed\u4e49\u5df2\u4fdd\u5b58",
        "semantic_id": semantic_id,
        "closed_tickets": closed_count,
    }
