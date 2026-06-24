"""Local smoke command for real dwhrpt metadata collection verification."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.models import DatasourceConfig, MetadataCollectionJob, get_session
from app.services.metadata_schedule_service import utc_now
from app.services.metadata_scheduler_service import run_metadata_scheduler_tick

DEFAULT_DATABASE_URL = "sqlite:///./data/metricforge.db"
_SENSITIVE_ASSIGNMENT_RE = re.compile(r"(?i)\b(password_enc|password|pwd|token|secret)(\s*=\s*)[^\s,;&]+")
_CONNECTION_URL_RE = re.compile(r"(?i)\b(?:sqlite|oracle\+[a-z0-9_]+)://[^\s,;\"']+")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Smoke test metadata collection for a configured datasource.")
    parser.add_argument("--datasource-name", default="dwhrpt", help="DatasourceConfig.name to smoke test.")
    parser.add_argument("--schema", action="append", default=None, help="Optional schema override. Can be repeated.")
    parser.add_argument("--execute", action="store_true", help="Run a real scheduler tick and execute created jobs.")
    return parser


def _json_print(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def _safe_datasource_summary(ds: DatasourceConfig) -> dict[str, Any]:
    return {
        "id": ds.id,
        "name": ds.name,
        "ds_type": ds.ds_type,
        "host": ds.host,
        "port": ds.port,
        "service_name": ds.service_name,
        "username": ds.username,
        "dialect": ds.dialect,
        "schema_names": ds.schema_names,
        "metadata_schedule_enabled": ds.metadata_schedule_enabled,
        "metadata_schedule_interval_minutes": ds.metadata_schedule_interval_minutes,
        "metadata_schedule_time": ds.metadata_schedule_time,
        "metadata_next_run_at": ds.metadata_next_run_at,
        "metadata_last_scheduled_at": ds.metadata_last_scheduled_at,
        "metadata_last_schedule_status": ds.metadata_last_schedule_status,
    }


def _find_datasource(db, datasource_name: str) -> DatasourceConfig | None:
    return db.query(DatasourceConfig).filter(DatasourceConfig.name == datasource_name).first()


def _redact_sensitive_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    text = _SENSITIVE_ASSIGNMENT_RE.sub(lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]", text)
    return _CONNECTION_URL_RE.sub("[REDACTED]", text)


def _latest_job_for_tick(db, ds_id: int, job_ids: list[int]) -> MetadataCollectionJob | None:
    if not job_ids:
        return None
    query = db.query(MetadataCollectionJob).filter(MetadataCollectionJob.datasource_id == ds_id)
    query = query.filter(MetadataCollectionJob.id.in_(job_ids))
    return query.order_by(MetadataCollectionJob.started_at.desc()).first()


def _job_summary(job: MetadataCollectionJob | None) -> dict[str, Any] | None:
    if not job:
        return None
    error_detail_lines = []
    if job.error_details:
        error_detail_lines = [_redact_sensitive_text(line)[:300] for line in str(job.error_details).splitlines()[:10]]
    return {
        "id": job.id,
        "status": job.status,
        "triggered_by": job.triggered_by,
        "schema_filter": job.schema_filter,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "duration_ms": job.duration_ms,
        "tables_count": job.tables_count,
        "columns_count": job.columns_count,
        "indexes_count": job.indexes_count,
        "constraints_count": job.constraints_count,
        "tables_added_count": job.tables_added_count,
        "tables_deactivated_count": job.tables_deactivated_count,
        "columns_added_count": job.columns_added_count,
        "columns_deactivated_count": job.columns_deactivated_count,
        "columns_type_changed_count": job.columns_type_changed_count,
        "columns_comment_changed_count": job.columns_comment_changed_count,
        "governance_tickets_created_count": job.governance_tickets_created_count,
        "change_summary": job.change_summary,
        "error_message": _redact_sensitive_text(job.error_message),
        "error_details_preview": error_detail_lines,
    }


def _exit_code_for_job(job: MetadataCollectionJob | None) -> tuple[int, str | None]:
    if not job:
        return 2, "scheduler tick did not create or reuse a metadata collection job"
    if job.status == "failed":
        return 2, job.error_message or "metadata collection failed"
    if job.status == "partial_success":
        return 3, job.error_message or "metadata collection partially succeeded"
    if job.status == "success" and ((job.tables_count or 0) == 0 or (job.columns_count or 0) == 0):
        return 4, "empty metadata collection success"
    if job.status == "success":
        return 0, None
    return 2, f"unexpected job status: {job.status}"


def _resolve_database_url() -> str:
    env_database_url = os.environ.get("METRICFORGE_DB_URL")
    if env_database_url:
        return env_database_url

    try:
        from app.config import loader as config_loader

        configured_database_url = config_loader.get_config("database.url")
    except Exception:
        configured_database_url = None

    return configured_database_url or DEFAULT_DATABASE_URL


def _ensure_sqlite_parent_dir(database_url: str) -> None:
    if not database_url.startswith("sqlite:///") or database_url == "sqlite:///:memory:":
        return

    db_path = database_url.removeprefix("sqlite:///")
    if not db_path:
        return
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

def _initialize_database() -> None:
    from app.models import init_db, init_tables

    db_url = _resolve_database_url()
    _ensure_sqlite_parent_dir(db_url)
    init_db(db_url)
    init_tables()


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    _initialize_database()
    db = get_session()
    try:
        ds = _find_datasource(db, args.datasource_name)
        if not ds:
            _json_print(
                {
                    "success": False,
                    "dry_run": not args.execute,
                    "datasource_name": args.datasource_name,
                    "error": f"{args.datasource_name} datasource not found",
                }
            )
            return 1

        schema_override = ",".join(schema.strip().upper() for schema in (args.schema or []) if schema.strip())
        if not args.execute:
            _json_print(
                {
                    "success": True,
                    "dry_run": True,
                    "datasource": _safe_datasource_summary(ds),
                    "schema_override": schema_override or None,
                    "planned_action": "pass --execute to enable schedule, run scheduler tick, and execute created metadata jobs",
                }
            )
            return 0

        original_schedule = {
            "schema_names": ds.schema_names,
            "metadata_schedule_enabled": ds.metadata_schedule_enabled,
            "metadata_next_run_at": ds.metadata_next_run_at,
            "metadata_schedule_interval_minutes": ds.metadata_schedule_interval_minutes,
            "metadata_schedule_time": ds.metadata_schedule_time,
        }
        scheduler_result = None
        job = None
        try:
            now = utc_now()
            if schema_override:
                ds.schema_names = schema_override
            ds.metadata_schedule_enabled = True
            ds.metadata_next_run_at = now
            db.commit()
            db.refresh(ds)

            scheduler_result = run_metadata_scheduler_tick(execute_jobs=True)
            job_ids = scheduler_result.get("job_ids") or []
            job = _latest_job_for_tick(db, ds.id, job_ids)
        finally:
            for field, value in original_schedule.items():
                setattr(ds, field, value)
            db.commit()
            db.refresh(ds)

        ds = _find_datasource(db, args.datasource_name) or ds
        exit_code, diagnostic = _exit_code_for_job(job)
        _json_print(
            {
                "success": exit_code == 0,
                "dry_run": False,
                "diagnostic": _redact_sensitive_text(diagnostic),
                "executed_at": utc_now().isoformat(timespec="seconds"),
                "datasource": _safe_datasource_summary(ds),
                "scheduler_result": scheduler_result,
                "job": _job_summary(job),
            }
        )
        return exit_code
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
