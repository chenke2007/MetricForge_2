"""Metadata collection job service."""

from datetime import UTC, datetime

from ..models import DatasourceConfig, MetadataCollectionJob, get_session
from .metadata_service import collect_metadata


def serialize_collection_job(job: MetadataCollectionJob) -> dict:
    """Serialize a metadata collection job."""
    return {
        "id": job.id,
        "datasource_id": job.datasource_id,
        "datasource_name": job.datasource.name if job.datasource else None,
        "status": job.status,
        "triggered_by": job.triggered_by,
        "schema_filter": job.schema_filter,
        "started_at": str(job.started_at) if job.started_at else None,
        "finished_at": str(job.finished_at) if job.finished_at else None,
        "duration_ms": job.duration_ms,
        "tables_count": job.tables_count,
        "columns_count": job.columns_count,
        "indexes_count": job.indexes_count,
        "constraints_count": job.constraints_count,
        "error_message": job.error_message,
        "error_details": job.error_details,
    }


def _duration_ms(started_at: datetime, finished_at: datetime) -> int:
    return int((finished_at - started_at).total_seconds() * 1000)


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def run_metadata_collection_job(datasource_id: int, triggered_by: str = "web") -> dict:
    """Create and synchronously run a metadata collection job."""
    db = get_session()
    try:
        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == datasource_id).first()
        if not ds:
            raise ValueError("\u6570\u636e\u6e90\u4e0d\u5b58\u5728")

        job = MetadataCollectionJob(
            datasource_id=datasource_id,
            status="running",
            triggered_by=triggered_by,
            schema_filter=ds.schema_names,
            started_at=_utc_now(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        try:
            result = collect_metadata(datasource_id)
            finished_at = _utc_now()
            stats = result.get("stats") or {}
            errors = stats.get("errors") or []

            job.finished_at = finished_at
            job.duration_ms = _duration_ms(job.started_at, finished_at)
            job.tables_count = stats.get("tables", 0) or 0
            job.columns_count = stats.get("columns", 0) or 0
            job.indexes_count = stats.get("indexes", 0) or 0
            job.constraints_count = stats.get("constraints", 0) or 0

            if result.get("success"):
                if errors:
                    job.status = "partial_success"
                    job.error_message = f"{len(errors)} \u4e2a\u91c7\u96c6\u9519\u8bef"
                    job.error_details = "\n".join(str(error) for error in errors)
                else:
                    job.status = "success"
            else:
                job.status = "failed"
                job.error_message = result.get("error", "\u91c7\u96c6\u5931\u8d25")
        except Exception as exc:
            finished_at = _utc_now()
            job.finished_at = finished_at
            job.duration_ms = _duration_ms(job.started_at, finished_at)
            job.status = "failed"
            job.error_message = str(exc)

        db.commit()
        db.refresh(job)
        return serialize_collection_job(job)
    finally:
        db.close()
