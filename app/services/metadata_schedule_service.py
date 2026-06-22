"""Metadata schedule configuration helpers."""

from datetime import UTC, datetime, timedelta
import re

from sqlalchemy.orm import Session

from ..models import DatasourceConfig, get_session


MIN_METADATA_SCHEDULE_INTERVAL_MINUTES = 30
DEFAULT_METADATA_SCHEDULE_INTERVAL_MINUTES = 1440
SCHEDULE_TIME_RE = re.compile(r"^\d{2}:\d{2}$")


def utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def validate_schedule(interval_minutes: int, schedule_time: str | None) -> None:
    if interval_minutes < MIN_METADATA_SCHEDULE_INTERVAL_MINUTES:
        raise ValueError("自动采集间隔至少 30 分钟")
    if schedule_time:
        if not SCHEDULE_TIME_RE.match(schedule_time):
            raise ValueError("固定执行时间格式必须为 HH:MM")
        hour, minute = [int(part) for part in schedule_time.split(":", 1)]
        if hour > 23 or minute > 59:
            raise ValueError("固定执行时间格式必须为 HH:MM")


def calculate_next_run_at(now: datetime, interval_minutes: int, schedule_time: str | None) -> datetime:
    validate_schedule(interval_minutes, schedule_time)
    if schedule_time:
        hour, minute = [int(part) for part in schedule_time.split(":", 1)]
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            candidate = candidate + timedelta(days=1)
        return candidate
    return now + timedelta(minutes=interval_minutes)


def serialize_metadata_schedule(ds: DatasourceConfig) -> dict:
    return {
        "metadata_schedule_enabled": ds.metadata_schedule_enabled,
        "metadata_schedule_interval_minutes": ds.metadata_schedule_interval_minutes,
        "metadata_schedule_time": ds.metadata_schedule_time,
        "metadata_next_run_at": str(ds.metadata_next_run_at) if ds.metadata_next_run_at else None,
        "metadata_last_scheduled_at": str(ds.metadata_last_scheduled_at) if ds.metadata_last_scheduled_at else None,
        "metadata_last_schedule_status": ds.metadata_last_schedule_status,
    }


def update_metadata_schedule(
    datasource_id: int,
    enabled: bool,
    interval_minutes: int = DEFAULT_METADATA_SCHEDULE_INTERVAL_MINUTES,
    schedule_time: str | None = None,
    db: Session | None = None,
    now: datetime | None = None,
) -> dict:
    owns_session = db is None
    db = db or get_session()
    now = now or utc_now()
    try:
        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == datasource_id).first()
        if not ds:
            raise ValueError("数据源不存在")
        schedule_time = schedule_time.strip() if schedule_time else None
        validate_schedule(interval_minutes, schedule_time)
        ds.metadata_schedule_enabled = bool(enabled)
        ds.metadata_schedule_interval_minutes = interval_minutes
        ds.metadata_schedule_time = schedule_time
        if enabled:
            ds.metadata_next_run_at = calculate_next_run_at(now, interval_minutes, schedule_time)
        if owns_session:
            db.commit()
            db.refresh(ds)
        return serialize_metadata_schedule(ds)
    except Exception:
        if owns_session:
            db.rollback()
        raise
    finally:
        if owns_session:
            db.close()
