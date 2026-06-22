"""Generate governance tickets from metadata collection changes."""

import json
import logging

from sqlalchemy.orm import Session

from ..models import ColumnMetadata, GovernanceTicket, MetadataCollectionJob, TableMetadata, get_session

logger = logging.getLogger(__name__)


CHANGE_TICKET_RULES = {
    "table_deactivated": {
        "ticket_type": "metadata_table_deactivated",
        "object_type": "table",
        "priority": "high",
        "label": "Table deactivated",
    },
    "column_deactivated": {
        "ticket_type": "metadata_column_deactivated",
        "object_type": "column",
        "priority": "high",
        "label": "Column deactivated",
    },
    "column_type_changed": {
        "ticket_type": "metadata_column_type_changed",
        "object_type": "column",
        "priority": "high",
        "label": "Column type changed",
    },
    "column_comment_changed": {
        "ticket_type": "metadata_column_comment_changed",
        "object_type": "column",
        "priority": "medium",
        "label": "Column comment changed",
    },
}


def _empty_result() -> dict:
    return {"created": 0, "skipped_existing": 0, "skipped_missing_object": 0, "skipped_unsupported": 0}


def _parse_change_summary(raw_summary: str | None) -> list[dict]:
    if not raw_summary:
        return []
    try:
        parsed = json.loads(raw_summary)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, dict):
        return []
    samples = parsed.get("samples")
    return samples if isinstance(samples, list) else []


def _find_table(db: Session, datasource_id: int, path: str) -> TableMetadata | None:
    parts = path.split(".")
    if len(parts) != 2:
        return None
    schema_name, table_name = parts
    return (
        db.query(TableMetadata)
        .filter(
            TableMetadata.datasource_id == datasource_id,
            TableMetadata.schema_name == schema_name,
            TableMetadata.table_name == table_name,
        )
        .first()
    )


def _find_column(db: Session, datasource_id: int, path: str) -> ColumnMetadata | None:
    parts = path.split(".")
    if len(parts) != 3:
        return None
    schema_name, table_name, column_name = parts
    table = (
        db.query(TableMetadata)
        .filter(
            TableMetadata.datasource_id == datasource_id,
            TableMetadata.schema_name == schema_name,
            TableMetadata.table_name == table_name,
        )
        .first()
    )
    if not table:
        return None
    return db.query(ColumnMetadata).filter(ColumnMetadata.table_id == table.id, ColumnMetadata.column_name == column_name).first()


def _existing_open_ticket(db: Session, ticket_type: str, object_type: str, object_id: int) -> bool:
    return (
        db.query(GovernanceTicket)
        .filter(
            GovernanceTicket.ticket_type == ticket_type,
            GovernanceTicket.related_object_type == object_type,
            GovernanceTicket.related_object_id == object_id,
            GovernanceTicket.status.in_(["open", "in_progress"]),
        )
        .first()
        is not None
    )


def _description(job: MetadataCollectionJob, label: str, path: str) -> str:
    datasource_name = job.datasource.name if job.datasource else f"datasource #{job.datasource_id}"
    return (
        f"Datasource: {datasource_name}\n"
        f"Metadata job: {job.id}\n"
        f"Change type: {label}\n"
        f"Object path: {path}\n\n"
        "Review downstream metrics, SQL, reports, field semantics, and impact."
    )


def generate_governance_tickets_for_job(job_id: int, db: Session | None = None) -> dict:
    owns_session = db is None
    db = db or get_session()
    result = _empty_result()
    try:
        job = db.query(MetadataCollectionJob).filter(MetadataCollectionJob.id == job_id).first()
        if not job or job.status not in ("success", "partial_success"):
            return result

        for sample in _parse_change_summary(job.change_summary):
            if not isinstance(sample, dict):
                result["skipped_unsupported"] += 1
                continue

            kind = sample.get("kind")
            path = sample.get("path")
            rule = CHANGE_TICKET_RULES.get(kind)
            if not rule or not path:
                result["skipped_unsupported"] += 1
                continue

            if rule["object_type"] == "table":
                target = _find_table(db, job.datasource_id, path)
            else:
                target = _find_column(db, job.datasource_id, path)
            if not target:
                result["skipped_missing_object"] += 1
                continue

            if _existing_open_ticket(db, rule["ticket_type"], rule["object_type"], target.id):
                result["skipped_existing"] += 1
                continue

            db.add(
                GovernanceTicket(
                    ticket_type=rule["ticket_type"],
                    title=f"{rule['label']}: {path}",
                    description=_description(job, rule["label"], path),
                    source="metadata_change_detected",
                    related_object_type=rule["object_type"],
                    related_object_id=target.id,
                    priority=rule["priority"],
                    status="open",
                )
            )
            result["created"] += 1

        job.governance_tickets_created_count = result["created"]
        db.flush()
        if owns_session:
            db.commit()
        return result
    except Exception:
        if owns_session:
            db.rollback()
        logger.exception("Failed to generate metadata governance tickets for job %s", job_id)
        raise
    finally:
        if owns_session:
            db.close()
