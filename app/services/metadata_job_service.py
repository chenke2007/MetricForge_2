"""Metadata collection job service."""

import logging
from datetime import UTC, datetime

from ..models import DatasourceConfig, MetadataCollectionJob, get_session
from .metadata_service import collect_metadata

logger = logging.getLogger(__name__)


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
        "collection_mode": job.collection_mode,
        "reused_running_job": job.reused_running_job,
        "tables_count": job.tables_count,
        "columns_count": job.columns_count,
        "indexes_count": job.indexes_count,
        "constraints_count": job.constraints_count,
        "tables_added_count": job.tables_added_count,
        "tables_updated_count": job.tables_updated_count,
        "tables_deactivated_count": job.tables_deactivated_count,
        "columns_added_count": job.columns_added_count,
        "columns_updated_count": job.columns_updated_count,
        "columns_deactivated_count": job.columns_deactivated_count,
        "columns_type_changed_count": job.columns_type_changed_count,
        "columns_comment_changed_count": job.columns_comment_changed_count,
        "indexes_added_count": job.indexes_added_count,
        "indexes_deactivated_count": job.indexes_deactivated_count,
        "constraints_added_count": job.constraints_added_count,
        "constraints_deactivated_count": job.constraints_deactivated_count,
        "change_summary": job.change_summary,
        "error_message": job.error_message,
        "error_details": job.error_details,
    }


def _duration_ms(started_at: datetime, finished_at: datetime) -> int:
    return int((finished_at - started_at).total_seconds() * 1000)


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _mark_job_failed(job: MetadataCollectionJob, message: str, finished_at: datetime | None = None) -> None:
    finished_at = finished_at or _utc_now()
    job.finished_at = finished_at
    job.duration_ms = _duration_ms(job.started_at, finished_at)
    job.status = "failed"
    job.error_message = message


def _parse_schema_filter(schema_filter: str | None) -> list[str] | None:
    if not schema_filter:
        return None
    schemas = [schema.strip().upper() for schema in schema_filter.split(",") if schema.strip()]
    return schemas or None


def create_metadata_collection_job(datasource_id: int, triggered_by: str = "web") -> dict:
    """Create a running metadata collection job without executing collection."""
    db = get_session()
    try:
        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == datasource_id).first()
        if not ds:
            raise ValueError("\u6570\u636e\u6e90\u4e0d\u5b58\u5728")

        running_job = (
            db.query(MetadataCollectionJob)
            .filter(
                MetadataCollectionJob.datasource_id == datasource_id,
                MetadataCollectionJob.status == "running",
            )
            .order_by(MetadataCollectionJob.started_at.desc())
            .first()
        )
        if running_job:
            running_job.reused_running_job = True
            db.commit()
            db.refresh(running_job)
            return serialize_collection_job(running_job)

        job = MetadataCollectionJob(
            datasource_id=datasource_id,
            status="running",
            triggered_by=triggered_by,
            schema_filter=ds.schema_names,
            started_at=_utc_now(),
            collection_mode="safe_refresh",
            reused_running_job=False,
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        return serialize_collection_job(job)
    finally:
        db.close()


def execute_metadata_collection_job(job_id: int) -> dict | None:
    """Execute a running metadata collection job and update it to a terminal state."""
    db = get_session()
    try:
        job = db.query(MetadataCollectionJob).filter(MetadataCollectionJob.id == job_id).first()
        if not job:
            return None

        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == job.datasource_id).first()
        if not ds:
            _mark_job_failed(job, "\u6570\u636e\u6e90\u4e0d\u5b58\u5728")
            db.commit()
            db.refresh(job)
            return serialize_collection_job(job)

        try:
            schemas = _parse_schema_filter(job.schema_filter)
            if schemas:
                result = collect_metadata(job.datasource_id, schemas=schemas)
            else:
                result = collect_metadata(job.datasource_id)
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
            logger.exception("Metadata collection job %s failed", job_id)
            _mark_job_failed(job, str(exc))

        db.commit()
        db.refresh(job)
        return serialize_collection_job(job)
    finally:
        db.close()


def run_metadata_collection_job(datasource_id: int, triggered_by: str = "web") -> dict:
    """Create and synchronously run a metadata collection job."""
    job = create_metadata_collection_job(datasource_id, triggered_by=triggered_by)
    if job.get("reused_running_job"):
        return job
    result = execute_metadata_collection_job(job["id"])
    if result is None:
        raise ValueError("\u91c7\u96c6\u4efb\u52a1\u4e0d\u5b58\u5728")
    return result
