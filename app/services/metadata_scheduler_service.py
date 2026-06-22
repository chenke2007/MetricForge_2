"""Lightweight metadata scheduler tick service."""

import logging
from datetime import datetime, timedelta

from ..models import DatasourceConfig, get_session
from .metadata_job_service import create_metadata_collection_job, execute_metadata_collection_job
from .metadata_schedule_service import MIN_METADATA_SCHEDULE_INTERVAL_MINUTES, calculate_next_run_at, utc_now

logger = logging.getLogger(__name__)


def _empty_tick_result() -> dict:
    return {"checked": 0, "created": 0, "reused_running": 0, "skipped": 0, "failed": 0, "job_ids": []}


def _advance_next_run(ds: DatasourceConfig, now: datetime) -> None:
    ds.metadata_next_run_at = calculate_next_run_at(
        now,
        ds.metadata_schedule_interval_minutes,
        ds.metadata_schedule_time,
        strict_future=True,
    )


def initialize_missing_next_run(now: datetime | None = None) -> int:
    db = get_session()
    now = now or utc_now()
    try:
        datasources = (
            db.query(DatasourceConfig)
            .filter(
                DatasourceConfig.is_active.is_(True),
                DatasourceConfig.metadata_schedule_enabled.is_(True),
                DatasourceConfig.metadata_next_run_at.is_(None),
            )
            .all()
        )
        for ds in datasources:
            _advance_next_run(ds, now)
        db.commit()
        return len(datasources)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def run_metadata_scheduler_tick(now: datetime | None = None, execute_jobs: bool = False) -> dict:
    now = now or utc_now()
    result = _empty_tick_result()
    db = get_session()
    try:
        due_datasources = (
            db.query(DatasourceConfig)
            .filter(
                DatasourceConfig.is_active.is_(True),
                DatasourceConfig.metadata_schedule_enabled.is_(True),
                DatasourceConfig.metadata_next_run_at.is_not(None),
                DatasourceConfig.metadata_next_run_at <= now,
            )
            .order_by(DatasourceConfig.metadata_next_run_at.asc())
            .all()
        )
        result["checked"] = len(due_datasources)

        for ds in due_datasources:
            try:
                if ds.metadata_schedule_interval_minutes < MIN_METADATA_SCHEDULE_INTERVAL_MINUTES:
                    ds.metadata_last_schedule_status = "skipped"
                    ds.metadata_last_scheduled_at = now
                    ds.metadata_next_run_at = now + timedelta(minutes=MIN_METADATA_SCHEDULE_INTERVAL_MINUTES)
                    result["skipped"] += 1
                    continue

                job = create_metadata_collection_job(ds.id, triggered_by="scheduler")
                if job.get("reused_running_job"):
                    ds.metadata_last_schedule_status = "reused_running"
                    result["reused_running"] += 1
                else:
                    ds.metadata_last_schedule_status = "created"
                    result["created"] += 1
                    result["job_ids"].append(job["id"])

                ds.metadata_last_scheduled_at = now
                _advance_next_run(ds, now)
            except Exception:
                logger.exception("Metadata scheduler tick failed for datasource %s", ds.id)
                ds.metadata_last_schedule_status = "failed"
                ds.metadata_last_scheduled_at = now
                ds.metadata_next_run_at = now + timedelta(minutes=MIN_METADATA_SCHEDULE_INTERVAL_MINUTES)
                result["failed"] += 1

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    if execute_jobs:
        for job_id in result["job_ids"]:
            execute_metadata_collection_job(job_id)

    return result
