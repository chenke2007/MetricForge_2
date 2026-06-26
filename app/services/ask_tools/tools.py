# app/services/ask_tools/tools.py
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import (
    ColumnMetadata,
    DatasourceConfig,
    GovernanceTicket,
    MetadataCollectionJob,
    TableMetadata,
)


_IGNORE_SCHEMAS = {"INFORMATION_SCHEMA", "SYS", "SYSTEM", "DBA"}


async def datasource_stats(db: Session, **kwargs) -> dict:
    total = db.query(DatasourceConfig).count()
    active = db.query(DatasourceConfig).filter(DatasourceConfig.is_active == True).count()
    items = [
        {
            "id": ds.id,
            "name": ds.name,
            "ds_type": ds.ds_type,
            "is_active": ds.is_active,
        }
        for ds in db.query(DatasourceConfig).order_by(DatasourceConfig.id).all()
    ]
    return {"total": total, "active": active, "items": items}


async def latest_collection_job(db: Session, datasource_id: int | None = None, **kwargs) -> dict:
    q = db.query(MetadataCollectionJob)
    if datasource_id:
        q = q.filter(MetadataCollectionJob.datasource_id == datasource_id)
    job = q.order_by(MetadataCollectionJob.started_at.desc()).first()
    if not job:
        return {"found": False, "message": "暂无采集任务"}
    return {
        "found": True,
        "id": job.id,
        "datasource_id": job.datasource_id,
        "datasource_name": job.datasource.name if job.datasource else None,
        "status": job.status,
        "started_at": str(job.started_at) if job.started_at else None,
        "finished_at": str(job.finished_at) if job.finished_at else None,
        "tables_count": job.tables_count or 0,
        "columns_count": job.columns_count or 0,
        "indexes_count": job.indexes_count or 0,
        "constraints_count": job.constraints_count or 0,
    }


async def schema_metadata_query(
    db: Session,
    keyword: str,
    schema_name: str | None = None,
    limit: int = 10,
    **kwargs,
) -> dict:
    filters = [
        TableMetadata.table_name.ilike(f"%{keyword}%"),
        TableMetadata.table_comment.ilike(f"%{keyword}%"),
    ]
    q = db.query(TableMetadata).filter(or_(*filters))
    q = q.filter(TableMetadata.schema_name.notin_(_IGNORE_SCHEMAS))
    if schema_name:
        q = q.filter(TableMetadata.schema_name == schema_name)

    tables = q.order_by(TableMetadata.schema_name, TableMetadata.table_name).limit(limit).all()

    items = []
    for t in tables:
        columns = (
            db.query(ColumnMetadata)
            .filter(ColumnMetadata.table_id == t.id)
            .order_by(ColumnMetadata.column_id)
            .limit(20)
            .all()
        )
        items.append({
            "id": t.id,
            "schema_name": t.schema_name,
            "table_name": t.table_name,
            "table_comment": t.table_comment,
            "columns": [
                {
                    "id": c.id,
                    "column_name": c.column_name,
                    "column_type": c.column_type,
                    "comment": c.comment,
                    "is_primary_key": c.is_primary_key,
                }
                for c in columns
            ],
        })
    return {"tables": items}


async def governance_ticket_stats(
    db: Session,
    status: str | None = None,
    ticket_type: str | None = None,
    **kwargs,
) -> dict:
    q = db.query(GovernanceTicket)
    if status:
        q = q.filter(GovernanceTicket.status == status)
    if ticket_type:
        q = q.filter(GovernanceTicket.ticket_type == ticket_type)
    total = q.count()

    by_status = {}
    status_rows = (
        db.query(GovernanceTicket.status, func.count(GovernanceTicket.id))
        .group_by(GovernanceTicket.status)
        .all()
    )
    for s, cnt in status_rows:
        by_status[s] = cnt

    by_type = {}
    type_rows = (
        db.query(GovernanceTicket.ticket_type, func.count(GovernanceTicket.id))
        .group_by(GovernanceTicket.ticket_type)
        .all()
    )
    for t, cnt in type_rows:
        by_type[t] = cnt

    return {"total": total, "by_status": by_status, "by_type": by_type}
