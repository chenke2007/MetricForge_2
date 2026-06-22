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


def _parse_bool(value: object) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _payload_value(payload: dict, *keys: str) -> object:
    for key in keys:
        if key in payload:
            return payload[key]
    return None


def validate_schedule(
    enabled: object,
    interval_minutes: int | str | None,
    schedule_time: str | None,
) -> tuple[bool, int, str | None]:
    normalized_enabled = _parse_bool(enabled)
    normalized_interval = DEFAULT_METADATA_SCHEDULE_INTERVAL_MINUTES
    if interval_minutes is not None:
        normalized_interval = int(interval_minutes)
    normalized_schedule_time = schedule_time.strip() if schedule_time else None
    normalized_schedule_time = normalized_schedule_time or None

    if normalized_schedule_time:
        if not SCHEDULE_TIME_RE.match(normalized_schedule_time):
            raise ValueError("固定执行时间格式必须为 HH:MM")
        hour, minute = [int(part) for part in normalized_schedule_time.split(":", 1)]
        if hour > 23 or minute > 59:
            raise ValueError("固定执行时间格式必须为 HH:MM")

    if normalized_enabled and normalized_interval < MIN_METADATA_SCHEDULE_INTERVAL_MINUTES:
        raise ValueError("自动采集间隔至少 30 分钟")

    return normalized_enabled, normalized_interval, normalized_schedule_time


def calculate_next_run_at(now: datetime, interval_minutes: int, schedule_time: str | None = None) -> datetime:
    _, interval_minutes, schedule_time = validate_schedule(True, interval_minutes, schedule_time)
    if schedule_time:
        hour, minute = [int(part) for part in schedule_time.split(":", 1)]
        candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate < now:
            candidate = candidate + timedelta(days=1)
        return candidate
    return now + timedelta(minutes=interval_minutes)


def serialize_metadata_schedule(ds: DatasourceConfig) -> dict:
    return {
        "enabled": ds.metadata_schedule_enabled,
        "interval_minutes": ds.metadata_schedule_interval_minutes,
        "schedule_time": ds.metadata_schedule_time,
        "next_run_at": str(ds.metadata_next_run_at) if ds.metadata_next_run_at else None,
        "last_scheduled_at": str(ds.metadata_last_scheduled_at) if ds.metadata_last_scheduled_at else None,
        "last_schedule_status": ds.metadata_last_schedule_status,
    }


def update_metadata_schedule(
    datasource_id: int,
    payload: dict,
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

        enabled = _payload_value(payload, "metadata_schedule_enabled", "enabled")
        interval_minutes = _payload_value(payload, "metadata_schedule_interval_minutes", "interval_minutes")
        schedule_time = _payload_value(payload, "metadata_schedule_time", "schedule_time")
        enabled, interval_minutes, schedule_time = validate_schedule(enabled, interval_minutes, schedule_time)

        ds.metadata_schedule_enabled = enabled
        ds.metadata_schedule_interval_minutes = interval_minutes
        ds.metadata_schedule_time = schedule_time
        if enabled:
            ds.metadata_next_run_at = calculate_next_run_at(now, interval_minutes, schedule_time)
        else:
            ds.metadata_next_run_at = None
        db.flush()
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
