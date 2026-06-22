# 定期增量采集与变更治理闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让数据源可以配置应用内定期元数据采集，并在采集发现关键结构变化后自动生成治理待办。

**Architecture:** 在现有 SQLAlchemy/FastAPI/Jinja 架构上增量扩展：数据源模型保存调度配置，轻量调度服务负责到期扫描和任务创建，变更治理服务负责把 `change_summary.samples` 转为幂等治理待办。后台循环只触发调度 tick，长耗时采集继续复用现有 `execute_metadata_collection_job()` 和 running 任务复用机制。

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy ORM, SQLite, pytest, Jinja templates, existing Oracle metadata collector.

---

## 文件结构

- 修改 `app/models/datasource.py`：增加自动元数据采集调度配置字段。
- 修改 `app/models/metadata_job.py`：增加本次自动生成治理待办数量字段。
- 修改 `app/services/schema_migration_service.py`：为旧 SQLite 库补齐数据源调度字段和任务治理计数字段。
- 新建 `app/services/metadata_schedule_service.py`：负责调度配置校验、下一次运行时间计算、配置序列化和配置更新。
- 新建 `app/services/metadata_scheduler_service.py`：负责扫描到期数据源、创建或复用采集任务、推进下次运行时间。
- 新建 `app/services/metadata_scheduler_runtime.py`：负责应用启动后的后台调度循环。
- 新建 `app/services/metadata_change_governance_service.py`：负责从采集任务变更摘要生成治理待办。
- 修改 `app/services/metadata_job_service.py`：序列化新增字段，并在采集成功/部分成功后触发变更治理待办生成。
- 修改 `app/api/datasources.py`：返回和更新自动采集配置。
- 修改 `app/api/metadata.py`：增加手动 scheduler tick API。
- 修改 `app/api/governance.py`：支持 `source` 过滤。
- 修改 `app/main.py`：启动和停止应用内调度循环。
- 修改 `app/web/routes.py`：向页面传递调度配置、治理待办 source 过滤、任务治理待办数量。
- 修改 `app/web/templates/datasources/form.html`：创建数据源时可选自动采集配置。
- 修改 `app/web/templates/datasources/detail.html`：展示和更新自动采集配置。
- 修改 `app/web/templates/metadata/job_detail.html`：展示本次生成治理待办数量和跳转链接。
- 修改 `app/web/templates/governance/list.html`：支持 source 过滤和元数据变更类型中文标签。
- 修改 `tests/test_basic.py`：补充模型、迁移、调度、治理待办、API 和页面测试。

---

### 任务 1：增加模型字段和 SQLite 轻量迁移

**文件：**
- 修改：`app/models/datasource.py`
- 修改：`app/models/metadata_job.py`
- 修改：`app/services/schema_migration_service.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：写模型字段失败测试**

在 `tests/test_basic.py` 的模型测试附近加入：

```python
def test_datasource_model_includes_metadata_schedule_fields(db_session):
    """数据源模型包含自动元数据采集调度字段。"""
    from sqlalchemy import inspect

    columns = {col["name"] for col in inspect(db_session.bind).get_columns("datasource_config")}

    assert {
        "metadata_schedule_enabled",
        "metadata_schedule_interval_minutes",
        "metadata_schedule_time",
        "metadata_next_run_at",
        "metadata_last_scheduled_at",
        "metadata_last_schedule_status",
    } <= columns


def test_metadata_job_model_includes_governance_ticket_count(db_session):
    """采集任务模型记录本次自动生成的治理待办数量。"""
    from sqlalchemy import inspect

    columns = {col["name"] for col in inspect(db_session.bind).get_columns("metadata_collection_job")}

    assert "governance_tickets_created_count" in columns
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_datasource_model_includes_metadata_schedule_fields tests/test_basic.py::test_metadata_job_model_includes_governance_ticket_count -q
```

预期：两个测试失败，因为字段尚未存在。

- [ ] **步骤 3：修改 `app/models/datasource.py`**

更新字段区，在 `is_active` 后、`created_at` 前加入：

```python
    metadata_schedule_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="是否启用自动元数据采集")
    metadata_schedule_interval_minutes: Mapped[int] = mapped_column(Integer, default=1440, nullable=False, comment="元数据自动采集间隔分钟")
    metadata_schedule_time: Mapped[str] = mapped_column(String(5), nullable=True, comment="每日固定采集时间 HH:MM")
    metadata_next_run_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="下一次自动采集时间")
    metadata_last_scheduled_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="最近一次自动调度时间")
    metadata_last_schedule_status: Mapped[str] = mapped_column(String(30), nullable=True, comment="最近一次自动调度结果")
```

- [ ] **步骤 4：修改 `app/models/metadata_job.py`**

在 `change_summary` 前加入：

```python
    governance_tickets_created_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="本次生成治理待办数量")
```

- [ ] **步骤 5：写旧 SQLite 迁移失败测试**

在 schema migration 测试附近加入：

```python
def test_schema_migration_adds_metadata_schedule_columns_to_existing_database(tmp_path):
    """已有 SQLite 库初始化时会补齐自动采集调度字段。"""
    from sqlalchemy import create_engine, inspect, text

    from app.models import init_db, init_tables

    db_path = tmp_path / "legacy-schedule.db"
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE datasource_config (
                id INTEGER PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                ds_type VARCHAR(50) NOT NULL,
                host VARCHAR(255) NOT NULL,
                port INTEGER NOT NULL,
                username VARCHAR(100) NOT NULL,
                dialect VARCHAR(50) NOT NULL,
                is_active BOOLEAN
            )
        """))
        conn.execute(text("""
            CREATE TABLE metadata_collection_job (
                id INTEGER PRIMARY KEY,
                datasource_id INTEGER NOT NULL,
                status VARCHAR(20) NOT NULL,
                triggered_by VARCHAR(100),
                started_at DATETIME NOT NULL,
                tables_count INTEGER NOT NULL DEFAULT 0,
                columns_count INTEGER NOT NULL DEFAULT 0,
                indexes_count INTEGER NOT NULL DEFAULT 0,
                constraints_count INTEGER NOT NULL DEFAULT 0
            )
        """))
    engine.dispose()

    init_db(f"sqlite:///{db_path}")
    init_tables()

    inspector = inspect(create_engine(f"sqlite:///{db_path}"))
    datasource_columns = {col["name"] for col in inspector.get_columns("datasource_config")}
    job_columns = {col["name"] for col in inspector.get_columns("metadata_collection_job")}

    assert {
        "metadata_schedule_enabled",
        "metadata_schedule_interval_minutes",
        "metadata_schedule_time",
        "metadata_next_run_at",
        "metadata_last_scheduled_at",
        "metadata_last_schedule_status",
    } <= datasource_columns
    assert "governance_tickets_created_count" in job_columns
```

- [ ] **步骤 6：运行迁移测试确认失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_schema_migration_adds_metadata_schedule_columns_to_existing_database -q
```

预期：失败，因为迁移 helper 尚未补齐这些字段。

- [ ] **步骤 7：修改 `app/services/schema_migration_service.py`**

在 `METADATA_COLUMNS` 中增加或合并：

```python
    "datasource_config": [
        ("metadata_schedule_enabled", "BOOLEAN NOT NULL DEFAULT 0"),
        ("metadata_schedule_interval_minutes", "INTEGER NOT NULL DEFAULT 1440"),
        ("metadata_schedule_time", "VARCHAR(5)"),
        ("metadata_next_run_at", "DATETIME"),
        ("metadata_last_scheduled_at", "DATETIME"),
        ("metadata_last_schedule_status", "VARCHAR(30)"),
    ],
```

在 `"metadata_collection_job"` 列表中加入：

```python
        ("governance_tickets_created_count", "INTEGER NOT NULL DEFAULT 0"),
```

- [ ] **步骤 8：运行任务 1 测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_datasource_model_includes_metadata_schedule_fields tests/test_basic.py::test_metadata_job_model_includes_governance_ticket_count tests/test_basic.py::test_schema_migration_adds_metadata_schedule_columns_to_existing_database -q
```

预期：3 个测试通过。

- [ ] **步骤 9：提交任务 1**

```powershell
git add app/models/datasource.py app/models/metadata_job.py app/services/schema_migration_service.py tests/test_basic.py
git commit -m "feat: add metadata schedule fields"
```

---

### 任务 2：增加调度配置校验和下一次运行时间计算

**文件：**
- 新建：`app/services/metadata_schedule_service.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：写时间计算和配置校验失败测试**

在 `tests/test_basic.py` 中加入：

```python
def test_calculate_next_metadata_run_at_uses_interval():
    """未配置固定时间时，下一次运行时间按间隔推进。"""
    from datetime import datetime

    from app.services.metadata_schedule_service import calculate_next_run_at

    now = datetime(2026, 6, 22, 10, 0, 0)

    assert calculate_next_run_at(now, 90, None) == datetime(2026, 6, 22, 11, 30, 0)


def test_calculate_next_metadata_run_at_uses_daily_time():
    """配置固定时间时，优先计算下一个每日固定执行点。"""
    from datetime import datetime

    from app.services.metadata_schedule_service import calculate_next_run_at

    morning = datetime(2026, 6, 22, 1, 0, 0)
    afternoon = datetime(2026, 6, 22, 15, 0, 0)

    assert calculate_next_run_at(morning, 1440, "02:30") == datetime(2026, 6, 22, 2, 30, 0)
    assert calculate_next_run_at(afternoon, 1440, "02:30") == datetime(2026, 6, 23, 2, 30, 0)


def test_update_metadata_schedule_validates_min_interval_and_time(db_session):
    """自动采集配置会校验最小间隔和 HH:MM 时间格式。"""
    import pytest

    from app.models import DatasourceConfig
    from app.services.metadata_schedule_service import update_metadata_schedule

    ds = DatasourceConfig(
        name="schedule validation",
        ds_type="oracle",
        host="127.0.0.1",
        port=1521,
        username="readonly",
        dialect="oracle",
    )
    db_session.add(ds)
    db_session.commit()

    with pytest.raises(ValueError, match="至少 30 分钟"):
        update_metadata_schedule(ds.id, True, 10, None, db=db_session)

    with pytest.raises(ValueError, match="HH:MM"):
        update_metadata_schedule(ds.id, True, 60, "25:99", db=db_session)
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_calculate_next_metadata_run_at_uses_interval tests/test_basic.py::test_calculate_next_metadata_run_at_uses_daily_time tests/test_basic.py::test_update_metadata_schedule_validates_min_interval_and_time -q
```

预期：失败，因为服务文件尚不存在。

- [ ] **步骤 3：创建 `app/services/metadata_schedule_service.py`**

写入：

```python
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
```

- [ ] **步骤 4：运行任务 2 测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_calculate_next_metadata_run_at_uses_interval tests/test_basic.py::test_calculate_next_metadata_run_at_uses_daily_time tests/test_basic.py::test_update_metadata_schedule_validates_min_interval_and_time -q
```

预期：3 个测试通过。

- [ ] **步骤 5：提交任务 2**

```powershell
git add app/services/metadata_schedule_service.py tests/test_basic.py
git commit -m "feat: add metadata schedule helpers"
```

---

### 任务 3：增加调度 tick 服务

**文件：**
- 新建：`app/services/metadata_scheduler_service.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：写调度扫描失败测试**

在 `tests/test_basic.py` 中加入：

```python
def test_metadata_scheduler_tick_creates_due_scheduler_job(app, monkeypatch):
    """到期数据源会创建 scheduler 触发的采集任务并推进下次运行时间。"""
    from datetime import datetime, timedelta

    from app.models import DatasourceConfig, get_session
    from app.services import metadata_scheduler_service

    now = datetime(2026, 6, 22, 10, 0, 0)
    created = []

    def fake_create_job(datasource_id, triggered_by="web"):
        created.append((datasource_id, triggered_by))
        return {"id": 101, "datasource_id": datasource_id, "status": "running", "reused_running_job": False}

    monkeypatch.setattr(metadata_scheduler_service, "create_metadata_collection_job", fake_create_job)

    db = get_session()
    try:
        due = DatasourceConfig(
            name="due scheduler",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
            metadata_schedule_enabled=True,
            metadata_schedule_interval_minutes=60,
            metadata_next_run_at=now - timedelta(minutes=1),
        )
        db.add(due)
        db.commit()
        due_id = due.id
    finally:
        db.close()

    result = metadata_scheduler_service.run_metadata_scheduler_tick(now=now)

    assert result["checked"] >= 1
    assert result["created"] == 1
    assert created == [(due_id, "scheduler")]

    db = get_session()
    try:
        saved = db.query(DatasourceConfig).filter(DatasourceConfig.id == due_id).one()
        assert saved.metadata_last_schedule_status == "created"
        assert saved.metadata_last_scheduled_at == now
        assert saved.metadata_next_run_at == now + timedelta(minutes=60)
    finally:
        db.close()


def test_metadata_scheduler_tick_reuses_running_job(app, monkeypatch):
    """已有 running 任务时调度复用任务，不重复创建采集。"""
    from datetime import datetime, timedelta

    from app.models import DatasourceConfig, get_session
    from app.services import metadata_scheduler_service

    now = datetime(2026, 6, 22, 10, 0, 0)

    def fake_create_job(datasource_id, triggered_by="web"):
        return {"id": 202, "datasource_id": datasource_id, "status": "running", "reused_running_job": True}

    monkeypatch.setattr(metadata_scheduler_service, "create_metadata_collection_job", fake_create_job)

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="reuse scheduler",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
            metadata_schedule_enabled=True,
            metadata_schedule_interval_minutes=60,
            metadata_next_run_at=now - timedelta(minutes=1),
        )
        db.add(ds)
        db.commit()
        ds_id = ds.id
    finally:
        db.close()

    result = metadata_scheduler_service.run_metadata_scheduler_tick(now=now)

    assert result["reused_running"] == 1
    assert result["created"] == 0

    db = get_session()
    try:
        saved = db.query(DatasourceConfig).filter(DatasourceConfig.id == ds_id).one()
        assert saved.metadata_last_schedule_status == "reused_running"
        assert saved.metadata_next_run_at == now + timedelta(minutes=60)
    finally:
        db.close()


def test_metadata_scheduler_tick_skips_not_due_datasources(app, monkeypatch):
    """未到期或未启用自动采集的数据源不会创建任务。"""
    from datetime import datetime, timedelta

    from app.models import DatasourceConfig, get_session
    from app.services import metadata_scheduler_service

    now = datetime(2026, 6, 22, 10, 0, 0)
    created = []
    monkeypatch.setattr(
        metadata_scheduler_service,
        "create_metadata_collection_job",
        lambda datasource_id, triggered_by="web": created.append(datasource_id),
    )

    db = get_session()
    try:
        db.add(DatasourceConfig(
            name="future scheduler",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
            metadata_schedule_enabled=True,
            metadata_schedule_interval_minutes=60,
            metadata_next_run_at=now + timedelta(minutes=10),
        ))
        db.add(DatasourceConfig(
            name="disabled scheduler",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
            metadata_schedule_enabled=False,
            metadata_schedule_interval_minutes=60,
            metadata_next_run_at=now - timedelta(minutes=1),
        ))
        db.commit()
    finally:
        db.close()

    result = metadata_scheduler_service.run_metadata_scheduler_tick(now=now)

    assert result["created"] == 0
    assert created == []
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_metadata_scheduler_tick_creates_due_scheduler_job tests/test_basic.py::test_metadata_scheduler_tick_reuses_running_job tests/test_basic.py::test_metadata_scheduler_tick_skips_not_due_datasources -q
```

预期：失败，因为调度服务文件尚不存在。

- [ ] **步骤 3：创建 `app/services/metadata_scheduler_service.py`**

写入：

```python
"""Lightweight metadata scheduler tick service."""

import logging
from datetime import datetime, timedelta

from ..models import DatasourceConfig, get_session
from .metadata_job_service import create_metadata_collection_job, execute_metadata_collection_job
from .metadata_schedule_service import calculate_next_run_at, utc_now

logger = logging.getLogger(__name__)


def _empty_tick_result() -> dict:
    return {"checked": 0, "created": 0, "reused_running": 0, "skipped": 0, "failed": 0, "job_ids": []}


def _advance_next_run(ds: DatasourceConfig, now: datetime) -> None:
    ds.metadata_next_run_at = calculate_next_run_at(
        now,
        ds.metadata_schedule_interval_minutes,
        ds.metadata_schedule_time,
    )


def initialize_missing_next_run(now: datetime | None = None) -> int:
    """Initialize next_run_at for enabled schedules that do not have one yet."""
    now = now or utc_now()
    db = get_session()
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
    finally:
        db.close()


def run_metadata_scheduler_tick(now: datetime | None = None, execute_jobs: bool = False) -> dict:
    """Scan due datasource schedules and create metadata collection jobs."""
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
            if ds.metadata_schedule_interval_minutes < 30:
                ds.metadata_last_schedule_status = "skipped"
                ds.metadata_last_scheduled_at = now
                result["skipped"] += 1
                continue
            try:
                job = create_metadata_collection_job(ds.id, triggered_by="scheduler")
                ds.metadata_last_scheduled_at = now
                if job.get("reused_running_job"):
                    ds.metadata_last_schedule_status = "reused_running"
                    result["reused_running"] += 1
                else:
                    ds.metadata_last_schedule_status = "created"
                    result["created"] += 1
                    result["job_ids"].append(job["id"])
                _advance_next_run(ds, now)
            except Exception as exc:
                logger.exception("Metadata scheduler failed for datasource %s", ds.id)
                ds.metadata_last_schedule_status = "failed"
                ds.metadata_last_scheduled_at = now
                ds.metadata_next_run_at = now + timedelta(minutes=30)
                result["failed"] += 1
        db.commit()
    finally:
        db.close()

    if execute_jobs:
        for job_id in result["job_ids"]:
            execute_metadata_collection_job(job_id)
    return result
```

- [ ] **步骤 4：运行任务 3 测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_metadata_scheduler_tick_creates_due_scheduler_job tests/test_basic.py::test_metadata_scheduler_tick_reuses_running_job tests/test_basic.py::test_metadata_scheduler_tick_skips_not_due_datasources -q
```

预期：3 个测试通过。

- [ ] **步骤 5：提交任务 3**

```powershell
git add app/services/metadata_scheduler_service.py tests/test_basic.py
git commit -m "feat: add metadata scheduler tick"
```

---

### 任务 4：根据变更摘要生成治理待办

**文件：**
- 新建：`app/services/metadata_change_governance_service.py`
- 修改：`app/services/metadata_job_service.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：写治理待办生成失败测试**

在 `tests/test_basic.py` 中加入：

```python
def test_generate_metadata_change_tickets_creates_column_type_ticket(db_session):
    """字段类型变化会生成高优先级治理待办。"""
    import json

    from app.models import DatasourceConfig, TableMetadata, ColumnMetadata, MetadataCollectionJob, GovernanceTicket
    from app.services.metadata_change_governance_service import generate_governance_tickets_for_job

    ds = DatasourceConfig(name="change ds", ds_type="oracle", host="127.0.0.1", port=1521, username="u", dialect="oracle")
    db_session.add(ds)
    db_session.flush()
    table = TableMetadata(datasource_id=ds.id, schema_name="DWHRPT", table_name="T_ORDER")
    db_session.add(table)
    db_session.flush()
    column = ColumnMetadata(table_id=table.id, column_name="ORDER_ID", column_type="VARCHAR2(30)")
    db_session.add(column)
    db_session.flush()
    job = MetadataCollectionJob(
        datasource_id=ds.id,
        status="success",
        triggered_by="scheduler",
        change_summary=json.dumps({"samples": [{"kind": "column_type_changed", "path": "DWHRPT.T_ORDER.ORDER_ID"}]}, ensure_ascii=False),
    )
    db_session.add(job)
    db_session.commit()

    result = generate_governance_tickets_for_job(job.id, db=db_session)

    assert result["created"] == 1
    ticket = db_session.query(GovernanceTicket).one()
    assert ticket.ticket_type == "metadata_column_type_changed"
    assert ticket.source == "metadata_change_detected"
    assert ticket.related_object_type == "column"
    assert ticket.related_object_id == column.id
    assert ticket.priority == "high"


def test_generate_metadata_change_tickets_is_idempotent_for_open_tickets(db_session):
    """同对象同类型 open 待办存在时不会重复生成。"""
    import json

    from app.models import DatasourceConfig, TableMetadata, ColumnMetadata, MetadataCollectionJob, GovernanceTicket
    from app.services.metadata_change_governance_service import generate_governance_tickets_for_job

    ds = DatasourceConfig(name="idem ds", ds_type="oracle", host="127.0.0.1", port=1521, username="u", dialect="oracle")
    db_session.add(ds)
    db_session.flush()
    table = TableMetadata(datasource_id=ds.id, schema_name="DWHRPT", table_name="T_ORDER")
    db_session.add(table)
    db_session.flush()
    column = ColumnMetadata(table_id=table.id, column_name="OLD_CODE", column_type="VARCHAR2(20)", is_active=False)
    db_session.add(column)
    db_session.flush()
    existing = GovernanceTicket(
        ticket_type="metadata_column_deactivated",
        title="字段下线确认：DWHRPT.T_ORDER.OLD_CODE",
        source="metadata_change_detected",
        related_object_type="column",
        related_object_id=column.id,
        status="open",
    )
    job = MetadataCollectionJob(
        datasource_id=ds.id,
        status="success",
        triggered_by="scheduler",
        change_summary=json.dumps({"samples": [{"kind": "column_deactivated", "path": "DWHRPT.T_ORDER.OLD_CODE"}]}, ensure_ascii=False),
    )
    db_session.add_all([existing, job])
    db_session.commit()

    result = generate_governance_tickets_for_job(job.id, db=db_session)

    assert result["created"] == 0
    assert result["skipped_existing"] == 1
    assert db_session.query(GovernanceTicket).count() == 1


def test_generate_metadata_change_tickets_creates_table_deactivated_ticket(db_session):
    """表下线会生成表级治理待办。"""
    import json

    from app.models import DatasourceConfig, TableMetadata, MetadataCollectionJob, GovernanceTicket
    from app.services.metadata_change_governance_service import generate_governance_tickets_for_job

    ds = DatasourceConfig(name="table change ds", ds_type="oracle", host="127.0.0.1", port=1521, username="u", dialect="oracle")
    db_session.add(ds)
    db_session.flush()
    table = TableMetadata(datasource_id=ds.id, schema_name="DWHRPT", table_name="T_OLD", is_active=False)
    db_session.add(table)
    db_session.flush()
    job = MetadataCollectionJob(
        datasource_id=ds.id,
        status="success",
        triggered_by="scheduler",
        change_summary=json.dumps({"samples": [{"kind": "table_deactivated", "path": "DWHRPT.T_OLD"}]}, ensure_ascii=False),
    )
    db_session.add(job)
    db_session.commit()

    result = generate_governance_tickets_for_job(job.id, db=db_session)

    assert result["created"] == 1
    ticket = db_session.query(GovernanceTicket).one()
    assert ticket.ticket_type == "metadata_table_deactivated"
    assert ticket.related_object_type == "table"
    assert ticket.related_object_id == table.id
    assert ticket.priority == "high"
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_generate_metadata_change_tickets_creates_column_type_ticket tests/test_basic.py::test_generate_metadata_change_tickets_is_idempotent_for_open_tickets tests/test_basic.py::test_generate_metadata_change_tickets_creates_table_deactivated_ticket -q
```

预期：失败，因为服务文件尚不存在。

- [ ] **步骤 3：创建 `app/services/metadata_change_governance_service.py`**

写入：

```python
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
        "label": "表下线确认",
    },
    "column_deactivated": {
        "ticket_type": "metadata_column_deactivated",
        "object_type": "column",
        "priority": "high",
        "label": "字段下线确认",
    },
    "column_type_changed": {
        "ticket_type": "metadata_column_type_changed",
        "object_type": "column",
        "priority": "high",
        "label": "字段类型变化确认",
    },
    "column_comment_changed": {
        "ticket_type": "metadata_column_comment_changed",
        "object_type": "column",
        "priority": "medium",
        "label": "字段注释变化确认",
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


def _find_table(db: Session, datasource_id: int, path: str):
    parts = path.split(".")
    if len(parts) != 2:
        return None
    schema, table_name = parts
    return (
        db.query(TableMetadata)
        .filter(
            TableMetadata.datasource_id == datasource_id,
            TableMetadata.schema_name == schema,
            TableMetadata.table_name == table_name,
        )
        .first()
    )


def _find_column(db: Session, datasource_id: int, path: str):
    parts = path.split(".")
    if len(parts) != 3:
        return None
    schema, table_name, column_name = parts
    table = (
        db.query(TableMetadata)
        .filter(
            TableMetadata.datasource_id == datasource_id,
            TableMetadata.schema_name == schema,
            TableMetadata.table_name == table_name,
        )
        .first()
    )
    if not table:
        return None
    return (
        db.query(ColumnMetadata)
        .filter(ColumnMetadata.table_id == table.id, ColumnMetadata.column_name == column_name)
        .first()
    )


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
        f"数据源：{datasource_name}\n"
        f"采集任务：#{job.id}\n"
        f"变更类型：{label}\n"
        f"对象路径：{path}\n\n"
        "建议检查相关指标、SQL、报表、字段语义和下游使用影响。"
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
            ticket = GovernanceTicket(
                ticket_type=rule["ticket_type"],
                title=f"{rule['label']}：{path}",
                description=_description(job, rule["label"], path),
                source="metadata_change_detected",
                related_object_type=rule["object_type"],
                related_object_id=target.id,
                priority=rule["priority"],
                status="open",
            )
            db.add(ticket)
            result["created"] += 1
        job.governance_tickets_created_count = result["created"]
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
```

- [ ] **步骤 4：运行治理服务测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_generate_metadata_change_tickets_creates_column_type_ticket tests/test_basic.py::test_generate_metadata_change_tickets_is_idempotent_for_open_tickets tests/test_basic.py::test_generate_metadata_change_tickets_creates_table_deactivated_ticket -q
```

预期：3 个测试通过。

- [ ] **步骤 5：写采集任务集成失败测试**

加入：

```python
def test_execute_metadata_collection_job_records_governance_ticket_count(app, monkeypatch):
    """采集任务完成后会生成治理待办并回写数量。"""
    import json

    from app.models import DatasourceConfig, MetadataCollectionJob, get_session
    from app.services import metadata_job_service

    def fake_collect_metadata(datasource_id, schemas=None):
        return {
            "success": True,
            "stats": {
                "tables": 1,
                "columns": 1,
                "indexes": 0,
                "constraints": 0,
                "errors": [],
                "changes": {
                    "tables_added": 0,
                    "tables_updated": 0,
                    "tables_deactivated": 0,
                    "columns_added": 0,
                    "columns_updated": 0,
                    "columns_deactivated": 0,
                    "columns_type_changed": 1,
                    "columns_comment_changed": 0,
                    "indexes_added": 0,
                    "indexes_deactivated": 0,
                    "constraints_added": 0,
                    "constraints_deactivated": 0,
                    "samples": [{"kind": "column_type_changed", "path": "DWHRPT.T_ORDER.ORDER_ID"}],
                },
            },
        }

    monkeypatch.setattr(metadata_job_service, "collect_metadata", fake_collect_metadata)

    db = get_session()
    try:
        ds = DatasourceConfig(name="job governance ds", ds_type="oracle", host="127.0.0.1", port=1521, username="u", dialect="oracle")
        db.add(ds)
        db.flush()
        job = MetadataCollectionJob(datasource_id=ds.id, status="running", triggered_by="scheduler")
        db.add(job)
        db.commit()
        job_id = job.id
    finally:
        db.close()

    monkeypatch.setattr(
        metadata_job_service,
        "generate_governance_tickets_for_job",
        lambda job_id, db=None: {"created": 2, "skipped_existing": 0, "skipped_missing_object": 0, "skipped_unsupported": 0},
    )

    result = metadata_job_service.execute_metadata_collection_job(job_id)

    assert result["status"] == "success"
    assert result["governance_tickets_created_count"] == 2
    assert json.loads(result["change_summary"])["columns_type_changed"] == 1
```

- [ ] **步骤 6：修改 `app/services/metadata_job_service.py`**

更新导入：

```python
from .metadata_change_governance_service import generate_governance_tickets_for_job
```

在 `serialize_collection_job()` 返回值加入：

```python
        "governance_tickets_created_count": job.governance_tickets_created_count,
```

在 `execute_metadata_collection_job()` 中，设置任务状态后、`db.commit()` 前加入：

```python
            if job.status in ("success", "partial_success"):
                try:
                    ticket_result = generate_governance_tickets_for_job(job.id, db=db)
                    job.governance_tickets_created_count = ticket_result.get("created", 0) or 0
                except Exception as governance_exc:
                    logger.exception("Metadata governance ticket generation failed for job %s", job.id)
                    details = job.error_details or ""
                    suffix = f"治理待办生成失败: {governance_exc}"
                    job.error_details = f"{details}\n{suffix}".strip()
```

- [ ] **步骤 7：运行任务 4 全部测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_generate_metadata_change_tickets_creates_column_type_ticket tests/test_basic.py::test_generate_metadata_change_tickets_is_idempotent_for_open_tickets tests/test_basic.py::test_generate_metadata_change_tickets_creates_table_deactivated_ticket tests/test_basic.py::test_execute_metadata_collection_job_records_governance_ticket_count -q
```

预期：4 个测试通过。

- [ ] **步骤 8：提交任务 4**

```powershell
git add app/services/metadata_change_governance_service.py app/services/metadata_job_service.py tests/test_basic.py
git commit -m "feat: create governance tickets from metadata changes"
```

---

### 任务 5：增加 API 支持

**文件：**
- 修改：`app/api/datasources.py`
- 修改：`app/api/metadata.py`
- 修改：`app/api/governance.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：写 API 失败测试**

加入：

```python
def test_datasource_api_updates_metadata_schedule(client, db_session):
    """数据源 API 支持更新自动采集配置。"""
    from app.models import DatasourceConfig

    ds = DatasourceConfig(name="api schedule", ds_type="oracle", host="127.0.0.1", port=1521, username="u", dialect="oracle")
    db_session.add(ds)
    db_session.commit()

    resp = client.put(f"/api/datasources/{ds.id}/metadata-schedule?enabled=true&interval_minutes=60&schedule_time=02:00")

    assert resp.status_code == 200
    data = resp.json()
    assert data["metadata_schedule_enabled"] is True
    assert data["metadata_schedule_interval_minutes"] == 60
    assert data["metadata_schedule_time"] == "02:00"
    assert data["metadata_next_run_at"] is not None


def test_metadata_scheduler_tick_api_returns_scan_counts(client, monkeypatch):
    """手动 scheduler tick API 返回扫描统计。"""
    from app.api import metadata as metadata_api

    monkeypatch.setattr(
        metadata_api,
        "run_metadata_scheduler_tick",
        lambda execute_jobs=False: {"checked": 1, "created": 1, "reused_running": 0, "skipped": 0, "failed": 0, "job_ids": [1]},
    )

    resp = client.post("/api/metadata/scheduler/tick")

    assert resp.status_code == 200
    assert resp.json()["created"] == 1


def test_governance_api_filters_by_source(client, db_session):
    """治理待办 API 支持按 source 过滤。"""
    from app.models import GovernanceTicket

    db_session.add(GovernanceTicket(ticket_type="metadata_table_deactivated", title="metadata", source="metadata_change_detected"))
    db_session.add(GovernanceTicket(ticket_type="missing_semantic", title="semantic", source="auto_detect"))
    db_session.commit()

    resp = client.get("/api/governance/?source=metadata_change_detected")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["source"] == "metadata_change_detected"
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_datasource_api_updates_metadata_schedule tests/test_basic.py::test_metadata_scheduler_tick_api_returns_scan_counts tests/test_basic.py::test_governance_api_filters_by_source -q
```

预期：失败，因为 API 尚未实现。

- [ ] **步骤 3：修改 `app/api/datasources.py`**

添加导入：

```python
from ..services.metadata_schedule_service import serialize_metadata_schedule, update_metadata_schedule
```

在 `list_datasources()` 和 `get_datasource()` 返回 dict 中合并：

```python
            **serialize_metadata_schedule(ds),
```

在 `create_datasource()` 参数列表增加：

```python
    metadata_schedule_enabled: bool = Query(False, description="是否启用自动元数据采集"),
    metadata_schedule_interval_minutes: int = Query(1440, description="自动采集间隔分钟"),
    metadata_schedule_time: str = Query(None, description="每日固定采集时间 HH:MM"),
```

创建 `DatasourceConfig` 时设置：

```python
        metadata_schedule_enabled=metadata_schedule_enabled,
        metadata_schedule_interval_minutes=metadata_schedule_interval_minutes,
        metadata_schedule_time=metadata_schedule_time,
```

`db.refresh(ds)` 后，如果启用，调用：

```python
    if metadata_schedule_enabled:
        update_metadata_schedule(
            ds.id,
            metadata_schedule_enabled,
            metadata_schedule_interval_minutes,
            metadata_schedule_time,
            db=db,
        )
        db.commit()
        db.refresh(ds)
```

新增 endpoint：

```python
@router.put("/{ds_id}/metadata-schedule")
def update_datasource_metadata_schedule(
    ds_id: int,
    enabled: bool = Query(..., description="是否启用自动元数据采集"),
    interval_minutes: int = Query(1440, description="自动采集间隔分钟"),
    schedule_time: str = Query(None, description="每日固定采集时间 HH:MM"),
):
    try:
        return update_metadata_schedule(ds_id, enabled, interval_minutes, schedule_time)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

- [ ] **步骤 4：修改 `app/api/metadata.py`**

添加导入：

```python
from ..services.metadata_scheduler_service import run_metadata_scheduler_tick
```

新增 endpoint，放在 `/jobs/{job_id}` 前，避免路径冲突：

```python
@router.post("/scheduler/tick")
def metadata_scheduler_tick():
    """手动执行一次元数据自动采集调度扫描。"""
    return run_metadata_scheduler_tick(execute_jobs=False)
```

- [ ] **步骤 5：修改 `app/api/governance.py`**

在 `list_tickets()` 参数中增加：

```python
    source: str = Query(None, description="按来源筛选"),
```

过滤条件中加入：

```python
    if source:
        q = q.filter(GovernanceTicket.source == source)
```

返回 dict 中确保已有：

```python
            "source": t.source,
```

- [ ] **步骤 6：运行任务 5 测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_datasource_api_updates_metadata_schedule tests/test_basic.py::test_metadata_scheduler_tick_api_returns_scan_counts tests/test_basic.py::test_governance_api_filters_by_source -q
```

预期：3 个测试通过。

- [ ] **步骤 7：提交任务 5**

```powershell
git add app/api/datasources.py app/api/metadata.py app/api/governance.py tests/test_basic.py
git commit -m "feat: expose metadata schedule APIs"
```

---

### 任务 6：增加应用内后台调度循环

**文件：**
- 新建：`app/services/metadata_scheduler_runtime.py`
- 修改：`app/main.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：写后台调度 runtime 失败测试**

加入：

```python
def test_metadata_scheduler_runtime_respects_disabled_env(monkeypatch):
    """环境变量关闭时不启动后台调度线程。"""
    from fastapi import FastAPI

    from app.services.metadata_scheduler_runtime import start_metadata_scheduler

    monkeypatch.setenv("METADATA_SCHEDULER_ENABLED", "0")
    app = FastAPI()

    started = start_metadata_scheduler(app)

    assert started is False
    assert getattr(app.state, "metadata_scheduler_thread", None) is None


def test_create_app_starts_metadata_scheduler_when_enabled(monkeypatch, tmp_path):
    """应用启动时会按配置启动轻量调度循环。"""
    from fastapi.testclient import TestClient

    from app.main import create_app

    started = {"called": False}
    stopped = {"called": False}

    def fake_start(app):
        started["called"] = True
        return True

    def fake_stop(app):
        stopped["called"] = True

    monkeypatch.setenv("METADATA_SCHEDULER_ENABLED", "1")
    monkeypatch.setattr("app.main.start_metadata_scheduler", fake_start)
    monkeypatch.setattr("app.main.stop_metadata_scheduler", fake_stop)

    db_path = tmp_path / "scheduler-start.db"
    with TestClient(create_app(database_url=f"sqlite:///{db_path}")):
        pass

    assert started["called"] is True
    assert stopped["called"] is True
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_metadata_scheduler_runtime_respects_disabled_env tests/test_basic.py::test_create_app_starts_metadata_scheduler_when_enabled -q
```

预期：失败，因为 runtime 文件和 `main.py` 启动逻辑尚不存在。

- [ ] **步骤 3：创建 `app/services/metadata_scheduler_runtime.py`**

写入：

```python
"""Background runtime for the lightweight metadata scheduler."""

import logging
import os
import threading
import time

from .metadata_scheduler_service import initialize_missing_next_run, run_metadata_scheduler_tick

logger = logging.getLogger(__name__)


def _scheduler_enabled() -> bool:
    return os.environ.get("METADATA_SCHEDULER_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}


def _tick_seconds() -> int:
    raw = os.environ.get("METADATA_SCHEDULER_TICK_SECONDS", "300")
    try:
        return max(30, int(raw))
    except ValueError:
        return 300


def _scheduler_loop(stop_event: threading.Event, tick_seconds: int) -> None:
    initialize_missing_next_run()
    while not stop_event.wait(tick_seconds):
        try:
            run_metadata_scheduler_tick(execute_jobs=True)
        except Exception:
            logger.exception("Metadata scheduler tick failed")


def start_metadata_scheduler(app) -> bool:
    if not _scheduler_enabled():
        app.state.metadata_scheduler_thread = None
        app.state.metadata_scheduler_stop_event = None
        return False
    if getattr(app.state, "metadata_scheduler_thread", None):
        return True
    stop_event = threading.Event()
    thread = threading.Thread(
        target=_scheduler_loop,
        args=(stop_event, _tick_seconds()),
        name="metadata-scheduler",
        daemon=True,
    )
    app.state.metadata_scheduler_stop_event = stop_event
    app.state.metadata_scheduler_thread = thread
    thread.start()
    return True


def stop_metadata_scheduler(app) -> None:
    stop_event = getattr(app.state, "metadata_scheduler_stop_event", None)
    thread = getattr(app.state, "metadata_scheduler_thread", None)
    if stop_event:
        stop_event.set()
    if thread and thread.is_alive():
        thread.join(timeout=2)
    app.state.metadata_scheduler_thread = None
    app.state.metadata_scheduler_stop_event = None
```

- [ ] **步骤 4：修改 `app/main.py`**

添加导入：

```python
from .services.metadata_scheduler_runtime import start_metadata_scheduler, stop_metadata_scheduler
```

在 `create_app()` 包含路由后、定义 health 前加入：

```python
    @app.on_event("startup")
    def _startup_metadata_scheduler():
        start_metadata_scheduler(app)

    @app.on_event("shutdown")
    def _shutdown_metadata_scheduler():
        stop_metadata_scheduler(app)
```

- [ ] **步骤 5：运行任务 6 测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_metadata_scheduler_runtime_respects_disabled_env tests/test_basic.py::test_create_app_starts_metadata_scheduler_when_enabled -q
```

预期：2 个测试通过。第二个测试必须使用 `TestClient` 进入应用生命周期，从而明确触发 startup 和 shutdown。

- [ ] **步骤 6：提交任务 6**

```powershell
git add app/main.py app/services/metadata_scheduler_runtime.py tests/test_basic.py
git commit -m "feat: start lightweight metadata scheduler"
```

---

### 任务 7：增加页面展示和页面过滤

**文件：**
- 修改：`app/web/routes.py`
- 修改：`app/web/templates/datasources/form.html`
- 修改：`app/web/templates/datasources/detail.html`
- 修改：`app/web/templates/metadata/job_detail.html`
- 修改：`app/web/templates/governance/list.html`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：写页面失败测试**

加入：

```python
def test_datasource_detail_page_shows_metadata_schedule(client, db_session):
    """数据源详情页展示自动采集配置和调度状态。"""
    from datetime import datetime

    from app.models import DatasourceConfig

    ds = DatasourceConfig(
        name="schedule page",
        ds_type="oracle",
        host="127.0.0.1",
        port=1521,
        username="u",
        dialect="oracle",
        metadata_schedule_enabled=True,
        metadata_schedule_interval_minutes=1440,
        metadata_schedule_time="02:00",
        metadata_next_run_at=datetime(2026, 6, 23, 2, 0, 0),
        metadata_last_schedule_status="created",
    )
    db_session.add(ds)
    db_session.commit()

    resp = client.get(f"/web/datasources/{ds.id}")

    assert resp.status_code == 200
    assert "自动采集" in resp.text
    assert "02:00" in resp.text
    assert "created" in resp.text


def test_metadata_job_detail_page_shows_governance_ticket_count(client, db_session):
    """采集任务详情页展示本次生成治理待办数量。"""
    from app.models import DatasourceConfig, MetadataCollectionJob

    ds = DatasourceConfig(name="job ticket page", ds_type="oracle", host="127.0.0.1", port=1521, username="u", dialect="oracle")
    db_session.add(ds)
    db_session.flush()
    job = MetadataCollectionJob(
        datasource_id=ds.id,
        status="success",
        triggered_by="scheduler",
        governance_tickets_created_count=3,
    )
    db_session.add(job)
    db_session.commit()

    resp = client.get(f"/web/metadata/jobs/{job.id}")

    assert resp.status_code == 200
    assert "治理待办" in resp.text
    assert "3" in resp.text
    assert "source=metadata_change_detected" in resp.text


def test_governance_page_filters_by_source(client, db_session):
    """治理待办页面支持按 source 过滤。"""
    from app.models import GovernanceTicket

    db_session.add(GovernanceTicket(ticket_type="metadata_table_deactivated", title="metadata ticket", source="metadata_change_detected"))
    db_session.add(GovernanceTicket(ticket_type="missing_semantic", title="semantic ticket", source="auto_detect"))
    db_session.commit()

    resp = client.get("/web/governance?source=metadata_change_detected")

    assert resp.status_code == 200
    assert "metadata ticket" in resp.text
    assert "semantic ticket" not in resp.text
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_datasource_detail_page_shows_metadata_schedule tests/test_basic.py::test_metadata_job_detail_page_shows_governance_ticket_count tests/test_basic.py::test_governance_page_filters_by_source -q
```

预期：失败，因为页面尚未展示这些内容。

- [ ] **步骤 3：修改 `app/web/routes.py`**

在 `governance_list()` 签名中加入：

```python
def governance_list(request: Request, status: str = None, source: str = None):
```

过滤：

```python
        if source:
            q = q.filter(GovernanceTicket.source == source)
```

模板参数加入：

```python
                "current_source": source,
```

- [ ] **步骤 4：修改 `app/web/templates/datasources/form.html`**

在 schema 输入后加入：

```html
            <div class="col-md-4">
                <label class="form-label">自动采集</label>
                <select name="metadata_schedule_enabled" class="form-select">
                    <option value="false" selected>不启用</option>
                    <option value="true">启用</option>
                </select>
            </div>
            <div class="col-md-4">
                <label class="form-label">采集间隔分钟</label>
                <input type="number" name="metadata_schedule_interval_minutes" class="form-control" value="1440" min="30">
            </div>
            <div class="col-md-4">
                <label class="form-label">每日固定时间</label>
                <input type="time" name="metadata_schedule_time" class="form-control">
            </div>
```

- [ ] **步骤 5：修改 `app/web/templates/datasources/detail.html`**

在基本信息卡片下方增加：

```html
        <div class="card shadow-sm mt-3">
            <div class="card-header bg-white"><span class="fw-bold">自动采集</span></div>
            <div class="card-body small">
                <dl class="row mb-3">
                    <dt class="col-sm-4">状态</dt>
                    <dd class="col-sm-8">{{ '已启用' if ds.metadata_schedule_enabled else '未启用' }}</dd>
                    <dt class="col-sm-4">频率</dt>
                    <dd class="col-sm-8">每 {{ ds.metadata_schedule_interval_minutes }} 分钟</dd>
                    <dt class="col-sm-4">固定时间</dt>
                    <dd class="col-sm-8">{{ ds.metadata_schedule_time or '按间隔执行' }}</dd>
                    <dt class="col-sm-4">上次调度</dt>
                    <dd class="col-sm-8">{{ ds.metadata_last_scheduled_at.strftime('%Y-%m-%d %H:%M') if ds.metadata_last_scheduled_at else '-' }}</dd>
                    <dt class="col-sm-4">下次调度</dt>
                    <dd class="col-sm-8">{{ ds.metadata_next_run_at.strftime('%Y-%m-%d %H:%M') if ds.metadata_next_run_at else '-' }}</dd>
                    <dt class="col-sm-4">最近状态</dt>
                    <dd class="col-sm-8">{{ ds.metadata_last_schedule_status or '-' }}</dd>
                </dl>
                <form id="scheduleForm" class="row g-2">
                    <div class="col-md-3">
                        <select name="enabled" class="form-select form-select-sm">
                            <option value="true" {% if ds.metadata_schedule_enabled %}selected{% endif %}>启用</option>
                            <option value="false" {% if not ds.metadata_schedule_enabled %}selected{% endif %}>禁用</option>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <input type="number" name="interval_minutes" class="form-control form-control-sm" min="30" value="{{ ds.metadata_schedule_interval_minutes }}">
                    </div>
                    <div class="col-md-3">
                        <input type="time" name="schedule_time" class="form-control form-control-sm" value="{{ ds.metadata_schedule_time or '' }}">
                    </div>
                    <div class="col-md-3">
                        <button type="submit" class="btn btn-sm btn-outline-primary w-100">保存自动采集</button>
                    </div>
                    <div class="col-12"><span id="scheduleResult"></span></div>
                </form>
            </div>
        </div>
```

在 scripts 中加入：

```javascript
document.getElementById('scheduleForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const fd = new FormData(this);
    const params = new URLSearchParams(fd);
    const resultEl = document.getElementById('scheduleResult');
    const resp = await fetch('/api/datasources/{{ ds.id }}/metadata-schedule?' + params.toString(), { method: 'PUT' });
    if (resp.ok) {
        resultEl.innerHTML = '<span class="text-success">已保存</span>';
        window.setTimeout(() => window.location.reload(), 600);
    } else {
        const err = await resp.json();
        resultEl.innerHTML = '<span class="text-danger">' + (err.detail || '保存失败') + '</span>';
    }
});
```

- [ ] **步骤 6：修改 `app/web/templates/metadata/job_detail.html`**

在任务基本统计区域加入：

```html
        <div class="card shadow-sm mt-3">
            <div class="card-header bg-white"><span class="fw-bold">治理待办</span></div>
            <div class="card-body small">
                <div>本次自动生成治理待办：<strong>{{ job.governance_tickets_created_count }}</strong> 个</div>
                {% if job.governance_tickets_created_count %}
                <a href="/web/governance?source=metadata_change_detected" class="btn btn-sm btn-outline-primary mt-2">查看元数据变更待办</a>
                {% endif %}
            </div>
        </div>
```

- [ ] **步骤 7：修改 `app/web/templates/governance/list.html`**

在过滤区增加 source 过滤：

```html
        <select class="form-select form-select-sm" onchange="window.location.href='?source='+this.value">
            <option value="" {% if not current_source %}selected{% endif %}>全部来源</option>
            <option value="metadata_change_detected" {% if current_source == 'metadata_change_detected' %}selected{% endif %}>元数据变更</option>
            <option value="auto_detect" {% if current_source == 'auto_detect' %}selected{% endif %}>自动检测</option>
        </select>
```

把类型显示改成映射：

```jinja
{% set type_labels = {
    'metadata_table_deactivated': '表下线确认',
    'metadata_column_deactivated': '字段下线确认',
    'metadata_column_type_changed': '字段类型变化',
    'metadata_column_comment_changed': '字段注释变化',
    'missing_semantic': '缺失语义'
} %}
<span class="badge bg-info">{{ type_labels.get(t.ticket_type, t.ticket_type) }}</span>
```

- [ ] **步骤 8：运行任务 7 测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_datasource_detail_page_shows_metadata_schedule tests/test_basic.py::test_metadata_job_detail_page_shows_governance_ticket_count tests/test_basic.py::test_governance_page_filters_by_source -q
```

预期：3 个测试通过。

- [ ] **步骤 9：提交任务 7**

```powershell
git add app/web/routes.py app/web/templates/datasources/form.html app/web/templates/datasources/detail.html app/web/templates/metadata/job_detail.html app/web/templates/governance/list.html tests/test_basic.py
git commit -m "feat: show metadata schedule governance UI"
```

---

### 任务 8：最终集成验证

**文件：**
- 修改：`docs/superpowers/plans/2026-06-22-metadata-scheduled-incremental-governance.md`（仅勾选执行进度时）

- [ ] **步骤 1：运行调度和治理聚焦测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_datasource_model_includes_metadata_schedule_fields tests/test_basic.py::test_metadata_job_model_includes_governance_ticket_count tests/test_basic.py::test_metadata_scheduler_tick_creates_due_scheduler_job tests/test_basic.py::test_generate_metadata_change_tickets_creates_column_type_ticket tests/test_basic.py::test_execute_metadata_collection_job_records_governance_ticket_count tests/test_basic.py::test_datasource_api_updates_metadata_schedule tests/test_basic.py::test_datasource_detail_page_shows_metadata_schedule -q
```

预期：全部通过。

- [ ] **步骤 2：运行全量测试**

运行：

```powershell
python -m pytest tests/ -q
```

预期：全部通过。当前基线是 73 个测试，新增测试后数量会增加。

- [ ] **步骤 3：运行编译检查**

运行：

```powershell
python -m compileall app -q
```

预期：退出码为 0。

- [ ] **步骤 4：可选真实 `dwhrpt` 调度烟测**

只有在本机 `D:/projects/MetricForge/data/metricforge.db` 中仍有 `dwhrpt` 数据源且用户允许真实连接 Oracle 时执行。

运行：

```powershell
@'
from datetime import datetime, timedelta
import json, logging
from app.models import DatasourceConfig, init_db, init_tables, get_session
from app.services.metadata_scheduler_service import run_metadata_scheduler_tick

logging.disable(logging.CRITICAL)
init_db('sqlite:///D:/projects/MetricForge/data/metricforge.db')
init_tables()

db = get_session()
try:
    ds = db.query(DatasourceConfig).filter(DatasourceConfig.name == 'dwhrpt').first()
    if not ds:
        raise SystemExit('dwhrpt datasource not found')
    ds.metadata_schedule_enabled = True
    ds.metadata_schedule_interval_minutes = 1440
    ds.metadata_schedule_time = None
    ds.metadata_next_run_at = datetime.utcnow() - timedelta(minutes=1)
    db.commit()
finally:
    db.close()

print(json.dumps(run_metadata_scheduler_tick(execute_jobs=True), ensure_ascii=False, indent=2, default=str))
'@ | python -
```

预期：

- `created` 或 `reused_running` 为 1。
- 如果创建新任务，任务最终为 `success` 或 `partial_success`。
- 重复刷新不会让表、字段、索引、约束数量膨胀。
- 如果没有结构变化，`governance_tickets_created_count` 应为 0。

- [ ] **步骤 5：检查 git 状态和提交历史**

运行：

```powershell
git status --short --branch
git log --oneline --decorate --max-count=12
```

预期：

- 工作区干净，或只剩用户已有未跟踪文件。
- 最近提交包含本阶段任务提交。

- [ ] **步骤 6：完成分支收尾**

进入 `superpowers:verification-before-completion`，确认测试输出后，再进入 `superpowers:finishing-a-development-branch`。

---

## 自检

- spec 中的数据源调度配置由任务 1、2、5、7 覆盖。
- 应用内轻量调度由任务 3、6 覆盖。
- 手动 scheduler tick API 由任务 5 覆盖。
- 变更治理待办生成由任务 4 覆盖。
- 任务治理待办数量由任务 1、4、7 覆盖。
- 页面可见性由任务 7 覆盖。
- 真实 `dwhrpt` 烟测由任务 8 覆盖。
- 本计划没有要求实现 Celery、Redis、分布式锁、cron 表达式或 Oracle `last_ddl_time` 深度增量扫描。
