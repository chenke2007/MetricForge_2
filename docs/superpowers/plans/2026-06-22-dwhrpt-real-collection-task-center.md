# dwhrpt Real Collection Task Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable `dwhrpt` real metadata collection smoke workflow and enhance the metadata collection task center so scheduler status, collection results, failures, and governance tickets are visible and actionable.

**Architecture:** Keep the existing synchronous job service, lightweight scheduler tick, and Jinja Web UI. Add a local operations script for real Oracle smoke verification, and add page-level aggregation helpers in `app/web/routes.py` so no new persistence tables or broad API surface are needed.

**Tech Stack:** FastAPI, SQLAlchemy ORM, Jinja2 templates, pytest, SQLite test database, existing Oracle metadata collector path.

---

## File Structure

- Create `scripts/smoke_dwhrpt_metadata_collection.py`: local dry-run and real-execute smoke command for a named datasource, defaulting to `dwhrpt`.
- Modify `tests/test_basic.py`: add script dry-run tests, empty-success exit-code tests, task-center overview tests, and schedule-table rendering tests.
- Modify `app/web/routes.py`: add task-center aggregation helpers and pass overview/schedule rows to the Jinja template.
- Modify `app/web/templates/metadata/jobs.html`: render overview cards, datasource schedule rows, manual scheduler tick button, job change counters, trigger source, governance ticket count/link, and error summary.
- Modify `app/web/templates/metadata/job_detail.html`: keep existing detail page and add a clearer datasource/governance navigation affordance if the job has generated metadata-change tickets.
- Do not modify model schema or migrations in this phase.

## Task 1: Smoke Script Dry-Run Contract

**Files:**
- Create: `scripts/smoke_dwhrpt_metadata_collection.py`
- Modify: `tests/test_basic.py`

- [ ] **Step 1: Write failing tests for dry-run missing datasource and dry-run existing datasource**

Append these tests near the existing metadata scheduler tests in `tests/test_basic.py`:

```python
def test_dwhrpt_smoke_dry_run_reports_missing_datasource(monkeypatch, capsys):
    from scripts import smoke_dwhrpt_metadata_collection as smoke

    class FakeQuery:
        def filter(self, *_args):
            return self

        def first(self):
            return None

    class FakeSession:
        def query(self, _model):
            return FakeQuery()

        def close(self):
            pass

    monkeypatch.setattr(smoke, "get_session", lambda: FakeSession())

    exit_code = smoke.main(["--datasource-name", "dwhrpt"])

    captured = capsys.readouterr()
    assert exit_code == 1
    assert "dwhrpt datasource not found" in captured.out
    assert '"datasource_name": "dwhrpt"' in captured.out


def test_dwhrpt_smoke_dry_run_existing_datasource_does_not_execute(monkeypatch, capsys):
    from scripts import smoke_dwhrpt_metadata_collection as smoke

    ds = DatasourceConfig(
        id=7,
        name="dwhrpt",
        ds_type="oracle",
        host="10.10.10.10",
        port=1521,
        service_name="ORCLPDB1",
        username="readonly",
        dialect="oracle",
        schema_names="DWHRPT",
        metadata_schedule_enabled=False,
    )

    class FakeQuery:
        def filter(self, *_args):
            return self

        def first(self):
            return ds

    class FakeSession:
        committed = False

        def query(self, _model):
            return FakeQuery()

        def commit(self):
            self.committed = True

        def close(self):
            pass

    session = FakeSession()
    monkeypatch.setattr(smoke, "get_session", lambda: session)
    monkeypatch.setattr(smoke, "run_metadata_scheduler_tick", lambda execute_jobs=False: (_ for _ in ()).throw(AssertionError("should not execute")))

    exit_code = smoke.main(["--datasource-name", "dwhrpt"])

    captured = capsys.readouterr()
    assert exit_code == 0
    assert '"dry_run": true' in captured.out
    assert '"password_enc"' not in captured.out
    assert '"host": "10.10.10.10"' in captured.out
    assert session.committed is False
```

- [ ] **Step 2: Run the dry-run tests and verify they fail**

Run:

```powershell
pytest tests/test_basic.py::test_dwhrpt_smoke_dry_run_reports_missing_datasource tests/test_basic.py::test_dwhrpt_smoke_dry_run_existing_datasource_does_not_execute -q
```

Expected: both tests fail with `ModuleNotFoundError: No module named 'scripts'` or missing `smoke_dwhrpt_metadata_collection`.

- [ ] **Step 3: Add the smoke script with dry-run behavior**

Create `scripts/smoke_dwhrpt_metadata_collection.py`:

```python
"""Local smoke command for real dwhrpt metadata collection verification."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from typing import Any

from app.models import DatasourceConfig, MetadataCollectionJob, get_session
from app.services.metadata_schedule_service import utc_now
from app.services.metadata_scheduler_service import run_metadata_scheduler_tick


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


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
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

        _json_print({"success": False, "error": "execute mode is added in Task 2"})
        return 2
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the dry-run tests and verify they pass**

Run:

```powershell
pytest tests/test_basic.py::test_dwhrpt_smoke_dry_run_reports_missing_datasource tests/test_basic.py::test_dwhrpt_smoke_dry_run_existing_datasource_does_not_execute -q
```

Expected: `2 passed`.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add scripts/smoke_dwhrpt_metadata_collection.py tests/test_basic.py
git commit -m "test: define dwhrpt smoke dry run contract"
```

## Task 2: Smoke Script Execute Mode and Empty-Success Guard

**Files:**
- Modify: `scripts/smoke_dwhrpt_metadata_collection.py`
- Modify: `tests/test_basic.py`

- [ ] **Step 1: Write failing tests for execute mode result codes**

Append these tests to `tests/test_basic.py`:

```python
def test_dwhrpt_smoke_execute_returns_empty_success_exit_code(monkeypatch, capsys):
    from scripts import smoke_dwhrpt_metadata_collection as smoke

    ds = DatasourceConfig(
        id=8,
        name="dwhrpt",
        ds_type="oracle",
        host="10.10.10.10",
        port=1521,
        username="readonly",
        dialect="oracle",
        schema_names="DWHRPT",
        metadata_schedule_enabled=False,
        metadata_schedule_interval_minutes=1440,
    )
    job = MetadataCollectionJob(
        id=99,
        datasource_id=8,
        status="success",
        triggered_by="scheduler",
        tables_count=0,
        columns_count=0,
        indexes_count=0,
        constraints_count=0,
        governance_tickets_created_count=0,
    )

    class FakeJobQuery:
        def filter(self, *_args):
            return self

        def order_by(self, *_args):
            return self

        def first(self):
            return job

    class FakeDatasourceQuery:
        def filter(self, *_args):
            return self

        def first(self):
            return ds

    class FakeSession:
        def query(self, model):
            if model is DatasourceConfig:
                return FakeDatasourceQuery()
            return FakeJobQuery()

        def commit(self):
            pass

        def refresh(self, _item):
            pass

        def close(self):
            pass

    monkeypatch.setattr(smoke, "get_session", lambda: FakeSession())
    monkeypatch.setattr(smoke, "run_metadata_scheduler_tick", lambda execute_jobs=True: {"checked": 1, "created": 1, "reused_running": 0, "skipped": 0, "failed": 0, "job_ids": [99]})

    exit_code = smoke.main(["--datasource-name", "dwhrpt", "--execute"])

    captured = capsys.readouterr()
    assert exit_code == 4
    assert '"status": "success"' in captured.out
    assert '"tables_count": 0' in captured.out
    assert "empty metadata collection success" in captured.out


def test_dwhrpt_smoke_execute_failed_job_returns_two(monkeypatch, capsys):
    from scripts import smoke_dwhrpt_metadata_collection as smoke

    ds = DatasourceConfig(
        id=9,
        name="dwhrpt",
        ds_type="oracle",
        host="10.10.10.10",
        port=1521,
        username="readonly",
        dialect="oracle",
        schema_names="DWHRPT",
        metadata_schedule_enabled=True,
        metadata_schedule_interval_minutes=1440,
    )
    job = MetadataCollectionJob(
        id=100,
        datasource_id=9,
        status="failed",
        triggered_by="scheduler",
        tables_count=0,
        columns_count=0,
        error_message="ORA-01017 invalid username/password",
        error_details="ORA-01017 invalid username/password",
    )

    class FakeJobQuery:
        def filter(self, *_args):
            return self

        def order_by(self, *_args):
            return self

        def first(self):
            return job

    class FakeDatasourceQuery:
        def filter(self, *_args):
            return self

        def first(self):
            return ds

    class FakeSession:
        def query(self, model):
            if model is DatasourceConfig:
                return FakeDatasourceQuery()
            return FakeJobQuery()

        def commit(self):
            pass

        def refresh(self, _item):
            pass

        def close(self):
            pass

    monkeypatch.setattr(smoke, "get_session", lambda: FakeSession())
    monkeypatch.setattr(smoke, "run_metadata_scheduler_tick", lambda execute_jobs=True: {"checked": 1, "created": 1, "reused_running": 0, "skipped": 0, "failed": 0, "job_ids": [100]})

    exit_code = smoke.main(["--datasource-name", "dwhrpt", "--execute"])

    captured = capsys.readouterr()
    assert exit_code == 2
    assert "ORA-01017" in captured.out
```

- [ ] **Step 2: Run execute-mode tests and verify they fail**

Run:

```powershell
pytest tests/test_basic.py::test_dwhrpt_smoke_execute_returns_empty_success_exit_code tests/test_basic.py::test_dwhrpt_smoke_execute_failed_job_returns_two -q
```

Expected: tests fail because execute mode still returns the Task 1 placeholder error.

- [ ] **Step 3: Implement execute mode**

Replace the execute branch in `scripts/smoke_dwhrpt_metadata_collection.py` with this code and add the helper functions above `main`:

```python
def _latest_job_for_tick(db, ds_id: int, job_ids: list[int]) -> MetadataCollectionJob | None:
    query = db.query(MetadataCollectionJob).filter(MetadataCollectionJob.datasource_id == ds_id)
    if job_ids:
        query = query.filter(MetadataCollectionJob.id.in_(job_ids))
    return query.order_by(MetadataCollectionJob.started_at.desc()).first()


def _job_summary(job: MetadataCollectionJob | None) -> dict[str, Any] | None:
    if not job:
        return None
    error_detail_lines = []
    if job.error_details:
        error_detail_lines = str(job.error_details).splitlines()[:20]
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
        "error_message": job.error_message,
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
```

Use this body for `if args.execute:` inside `main`:

```python
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
        exit_code, diagnostic = _exit_code_for_job(job)
        _json_print(
            {
                "success": exit_code == 0,
                "dry_run": False,
                "diagnostic": diagnostic,
                "executed_at": datetime.utcnow().isoformat(timespec="seconds"),
                "datasource": _safe_datasource_summary(ds),
                "scheduler_result": scheduler_result,
                "job": _job_summary(job),
            }
        )
        return exit_code
```

- [ ] **Step 4: Run execute-mode tests and verify they pass**

Run:

```powershell
pytest tests/test_basic.py::test_dwhrpt_smoke_execute_returns_empty_success_exit_code tests/test_basic.py::test_dwhrpt_smoke_execute_failed_job_returns_two -q
```

Expected: `2 passed`.

- [ ] **Step 5: Run dry-run and execute-mode smoke unit tests together**

Run:

```powershell
pytest tests/test_basic.py::test_dwhrpt_smoke_dry_run_reports_missing_datasource tests/test_basic.py::test_dwhrpt_smoke_dry_run_existing_datasource_does_not_execute tests/test_basic.py::test_dwhrpt_smoke_execute_returns_empty_success_exit_code tests/test_basic.py::test_dwhrpt_smoke_execute_failed_job_returns_two -q
```

Expected: `4 passed`.

- [ ] **Step 6: Commit Task 2**

Run:

```powershell
git add scripts/smoke_dwhrpt_metadata_collection.py tests/test_basic.py
git commit -m "feat: add dwhrpt smoke execute guard"
```

## Task 3: Task Center Overview Aggregation

**Files:**
- Modify: `app/web/routes.py`
- Modify: `tests/test_basic.py`

- [ ] **Step 1: Write failing tests for task-center overview and schedule rows**

Append this test to `tests/test_basic.py`:

```python
def test_metadata_jobs_page_shows_overview_and_schedule_rows(client):
    from datetime import datetime, timedelta

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="dwhrpt",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
            schema_names="DWHRPT",
            metadata_schedule_enabled=True,
            metadata_schedule_interval_minutes=60,
            metadata_schedule_time="02:30",
            metadata_next_run_at=datetime(2026, 6, 22, 2, 30, 0),
            metadata_last_scheduled_at=datetime(2026, 6, 21, 2, 30, 0),
            metadata_last_schedule_status="created",
        )
        db.add(ds)
        db.flush()
        job = MetadataCollectionJob(
            datasource_id=ds.id,
            status="partial_success",
            triggered_by="scheduler",
            started_at=datetime.utcnow() - timedelta(hours=1),
            finished_at=datetime.utcnow(),
            tables_count=12,
            columns_count=120,
            tables_added_count=1,
            columns_type_changed_count=2,
            governance_tickets_created_count=3,
            error_message="1 个采集错误",
        )
        db.add(job)
        db.add(
            GovernanceTicket(
                ticket_type="metadata_column_type_changed",
                title="字段类型变化",
                source="metadata_change_detected",
                status="open",
            )
        )
        db.commit()
    finally:
        db.close()

    resp = client.get("/web/metadata/jobs")

    assert resp.status_code == 200
    assert "任务概览" in resp.text
    assert "启用自动采集" in resp.text
    assert "数据源调度状态" in resp.text
    assert "dwhrpt" in resp.text
    assert "02:30" in resp.text
    assert "created" in resp.text
    assert "partial_success" in resp.text
    assert "1 个采集错误" in resp.text
    assert "source=metadata_change_detected" in resp.text
```

- [ ] **Step 2: Run the page test and verify it fails**

Run:

```powershell
pytest tests/test_basic.py::test_metadata_jobs_page_shows_overview_and_schedule_rows -q
```

Expected: fail because the page does not render overview and datasource schedule rows.

- [ ] **Step 3: Add aggregation helpers in `app/web/routes.py`**

Add imports:

```python
from datetime import timedelta
from sqlalchemy import func
```

Add these helpers below `_parse_change_summary`:

```python
def _metadata_job_overview(db) -> dict:
    from app.services.metadata_schedule_service import utc_now

    now = utc_now()
    since = now - timedelta(hours=24)
    enabled_datasources = (
        db.query(DatasourceConfig)
        .filter(DatasourceConfig.is_active.is_(True), DatasourceConfig.metadata_schedule_enabled.is_(True))
        .count()
    )
    running_jobs = db.query(MetadataCollectionJob).filter(MetadataCollectionJob.status == "running").count()
    success_24h = (
        db.query(MetadataCollectionJob)
        .filter(MetadataCollectionJob.started_at >= since, MetadataCollectionJob.status == "success")
        .count()
    )
    issue_24h = (
        db.query(MetadataCollectionJob)
        .filter(
            MetadataCollectionJob.started_at >= since,
            MetadataCollectionJob.status.in_(["failed", "partial_success"]),
        )
        .count()
    )
    open_change_tickets = (
        db.query(GovernanceTicket)
        .filter(
            GovernanceTicket.source == "metadata_change_detected",
            GovernanceTicket.status.in_(["open", "in_progress"]),
        )
        .count()
    )
    return {
        "enabled_datasources": enabled_datasources,
        "running_jobs": running_jobs,
        "success_24h": success_24h,
        "issue_24h": issue_24h,
        "open_change_tickets": open_change_tickets,
    }


def _metadata_schedule_rows(db) -> list[dict]:
    datasources = (
        db.query(DatasourceConfig)
        .filter(DatasourceConfig.is_active.is_(True), DatasourceConfig.metadata_schedule_enabled.is_(True))
        .order_by(DatasourceConfig.name)
        .all()
    )
    rows = []
    for ds in datasources:
        latest_job = (
            db.query(MetadataCollectionJob)
            .filter(MetadataCollectionJob.datasource_id == ds.id)
            .order_by(MetadataCollectionJob.started_at.desc())
            .first()
        )
        rows.append(
            {
                "datasource": ds,
                "latest_job": latest_job,
                "latest_error": latest_job.error_message if latest_job else None,
            }
        )
    return rows
```

Update `metadata_jobs()` to pass the helpers:

```python
        overview = _metadata_job_overview(db)
        schedule_rows = _metadata_schedule_rows(db)
        return templates.TemplateResponse(
            request,
            "metadata/jobs.html",
            {
                "request": request,
                "jobs": jobs,
                "datasources": datasources,
                "current_datasource_id": datasource_id_value,
                "current_status": status_value,
                "overview": overview,
                "schedule_rows": schedule_rows,
            },
        )
```

- [ ] **Step 4: Run the page test and verify the route no longer errors**

Run:

```powershell
pytest tests/test_basic.py::test_metadata_jobs_page_shows_overview_and_schedule_rows -q
```

Expected: still fail on missing text from the template, not on Python errors.

- [ ] **Step 5: Commit route aggregation**

Run:

```powershell
git add app/web/routes.py tests/test_basic.py
git commit -m "feat: aggregate metadata job center status"
```

## Task 4: Task Center Template Enhancements

**Files:**
- Modify: `app/web/templates/metadata/jobs.html`
- Modify: `tests/test_basic.py`

- [ ] **Step 1: Render overview cards, schedule rows, and enhanced job columns**

Replace `app/web/templates/metadata/jobs.html` with this template:

```html
{% extends "base.html" %}
{% block title %}采集任务中心{% endblock %}

{% block content %}
<div class="page-header d-flex justify-content-between align-items-center">
    <div>
        <h4 class="mb-1"><i class="bi bi-clock-history me-2"></i>采集任务中心</h4>
        <p class="text-muted small mb-0">查看元数据采集任务状态、调度结果、变更摘要和失败原因</p>
    </div>
    <div class="d-flex gap-2">
        <button type="button" class="btn btn-sm btn-outline-primary" onclick="runSchedulerTick()">
            <i class="bi bi-arrow-repeat me-1"></i>执行一次调度扫描
        </button>
        <a href="/web/datasources" class="btn btn-sm btn-primary"><i class="bi bi-plug me-1"></i>去数据源采集</a>
    </div>
</div>

<div id="schedulerTickResult" class="small mb-3"></div>

<div class="card shadow-sm mb-3">
    <div class="card-header bg-white"><span class="fw-bold">任务概览</span></div>
    <div class="card-body">
        <div class="row text-center g-3">
            <div class="col-6 col-md">
                <div class="stat-number">{{ overview.enabled_datasources }}</div>
                <div class="stat-label">启用自动采集</div>
            </div>
            <div class="col-6 col-md">
                <div class="stat-number">{{ overview.running_jobs }}</div>
                <div class="stat-label">运行中任务</div>
            </div>
            <div class="col-6 col-md">
                <div class="stat-number">{{ overview.success_24h }}</div>
                <div class="stat-label">24小时成功</div>
            </div>
            <div class="col-6 col-md">
                <div class="stat-number">{{ overview.issue_24h }}</div>
                <div class="stat-label">24小时异常</div>
            </div>
            <div class="col-6 col-md">
                <div class="stat-number">{{ overview.open_change_tickets }}</div>
                <div class="stat-label">变更治理待办</div>
            </div>
        </div>
    </div>
</div>

<div class="card shadow-sm mb-3">
    <div class="card-header bg-white d-flex justify-content-between align-items-center">
        <span class="fw-bold">数据源调度状态</span>
        <span class="text-muted small">仅展示已启用自动采集的数据源</span>
    </div>
    <div class="card-body p-0">
        {% if schedule_rows %}
        <table class="table table-hover mb-0 small align-middle">
            <thead class="table-light">
                <tr>
                    <th>数据源</th>
                    <th>间隔/固定时间</th>
                    <th>下次运行</th>
                    <th>最近调度</th>
                    <th>调度状态</th>
                    <th>最近任务</th>
                    <th>最近失败原因</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody>
                {% for row in schedule_rows %}
                {% set ds = row.datasource %}
                {% set latest_job = row.latest_job %}
                <tr>
                    <td><a href="/web/datasources/{{ ds.id }}" class="fw-bold text-decoration-none">{{ ds.name }}</a></td>
                    <td>{{ ds.metadata_schedule_interval_minutes }} 分钟{% if ds.metadata_schedule_time %} / {{ ds.metadata_schedule_time }}{% endif %}</td>
                    <td>{{ ds.metadata_next_run_at.strftime('%Y-%m-%d %H:%M') if ds.metadata_next_run_at else '-' }}</td>
                    <td>{{ ds.metadata_last_scheduled_at.strftime('%Y-%m-%d %H:%M') if ds.metadata_last_scheduled_at else '-' }}</td>
                    <td>{{ ds.metadata_last_schedule_status or '-' }}</td>
                    <td>
                        {% if latest_job %}
                        <a href="/web/metadata/jobs/{{ latest_job.id }}" class="text-decoration-none">#{{ latest_job.id }} {{ latest_job.status }}</a>
                        {% else %}
                        -
                        {% endif %}
                    </td>
                    <td class="text-muted">{{ row.latest_error or '-' }}</td>
                    <td>
                        <div class="btn-group btn-group-sm">
                            <button type="button" class="btn btn-outline-primary" onclick="createCollectionJob({{ ds.id }})" title="立即采集">
                                <i class="bi bi-play-fill"></i>
                            </button>
                            <a href="/web/datasources/{{ ds.id }}" class="btn btn-outline-secondary" title="查看数据源"><i class="bi bi-database"></i></a>
                        </div>
                    </td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
        {% else %}
        <div class="text-center py-4 text-muted">
            <p class="mb-2">暂无启用自动采集的数据源</p>
            <a href="/web/datasources" class="btn btn-sm btn-outline-primary">去数据源详情启用</a>
        </div>
        {% endif %}
    </div>
</div>

<div class="card shadow-sm mb-3">
    <div class="card-body">
        <form method="get" action="/web/metadata/jobs" class="row g-2 align-items-end">
            <div class="col-md-5">
                <label class="form-label small">数据源</label>
                <select name="datasource_id" class="form-select form-select-sm">
                    <option value="">全部数据源</option>
                    {% for ds in datasources %}
                    <option value="{{ ds.id }}" {% if current_datasource_id == ds.id %}selected{% endif %}>{{ ds.name }}</option>
                    {% endfor %}
                </select>
            </div>
            <div class="col-md-4">
                <label class="form-label small">状态</label>
                <select name="status" class="form-select form-select-sm">
                    <option value="">全部状态</option>
                    <option value="running" {% if current_status == 'running' %}selected{% endif %}>running</option>
                    <option value="success" {% if current_status == 'success' %}selected{% endif %}>success</option>
                    <option value="partial_success" {% if current_status == 'partial_success' %}selected{% endif %}>partial_success</option>
                    <option value="failed" {% if current_status == 'failed' %}selected{% endif %}>failed</option>
                </select>
            </div>
            <div class="col-md-3">
                <button class="btn btn-outline-primary btn-sm w-100" type="submit"><i class="bi bi-funnel me-1"></i>筛选</button>
            </div>
        </form>
    </div>
</div>

<div class="card shadow-sm">
    <div class="card-body p-0">
        {% if jobs %}
        <table class="table table-hover mb-0 small align-middle">
            <thead class="table-light">
                <tr>
                    <th>ID</th>
                    <th>数据源</th>
                    <th>状态</th>
                    <th>触发</th>
                    <th>开始时间</th>
                    <th>表/字段</th>
                    <th>变更</th>
                    <th>治理待办</th>
                    <th>错误</th>
                    <th>详情</th>
                </tr>
            </thead>
            <tbody>
                {% for job in jobs %}
                {% set change_count = job.tables_added_count + job.tables_deactivated_count + job.columns_added_count + job.columns_deactivated_count + job.columns_type_changed_count + job.columns_comment_changed_count %}
                <tr>
                    <td>#{{ job.id }}</td>
                    <td>{{ job.datasource.name if job.datasource else '数据源 #' ~ job.datasource_id }}</td>
                    <td><span class="badge bg-{{ 'success' if job.status == 'success' else 'warning' if job.status == 'partial_success' else 'danger' if job.status == 'failed' else 'secondary' }}">{{ job.status }}</span></td>
                    <td>{{ job.triggered_by or '-' }}</td>
                    <td>{{ job.started_at.strftime('%Y-%m-%d %H:%M') if job.started_at else '-' }}</td>
                    <td>{{ job.tables_count }} / {{ job.columns_count }}</td>
                    <td>{{ change_count }}</td>
                    <td>
                        {% if job.governance_tickets_created_count %}
                        <a href="/web/governance?source=metadata_change_detected">{{ job.governance_tickets_created_count }}</a>
                        {% else %}
                        0
                        {% endif %}
                    </td>
                    <td class="text-muted">{{ job.error_message or '-' }}</td>
                    <td><a href="/web/metadata/jobs/{{ job.id }}" class="btn btn-sm btn-outline-primary" title="查看详情"><i class="bi bi-eye"></i></a></td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
        {% else %}
        <div class="text-center py-5 text-muted">
            <i class="bi bi-clock-history fs-1 d-block mb-3"></i>
            <p>暂无采集任务</p>
            <a href="/web/datasources" class="btn btn-primary btn-sm"><i class="bi bi-plug me-1"></i>去数据源采集</a>
        </div>
        {% endif %}
    </div>
</div>

<script>
async function runSchedulerTick() {
    const resultEl = document.getElementById('schedulerTickResult');
    resultEl.className = 'alert alert-info small mb-3';
    resultEl.textContent = '正在执行调度扫描...';
    try {
        const resp = await fetch('/api/metadata/scheduler/tick', { method: 'POST' });
        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.detail || '调度扫描失败');
        }
        resultEl.className = 'alert alert-success small mb-3';
        resultEl.textContent = `调度扫描完成：检查 ${data.checked} 个，创建 ${data.created} 个，复用 ${data.reused_running} 个，失败 ${data.failed} 个`;
    } catch (err) {
        resultEl.className = 'alert alert-danger small mb-3';
        resultEl.textContent = err.message || '调度扫描失败';
    }
}

async function createCollectionJob(datasourceId) {
    const resultEl = document.getElementById('schedulerTickResult');
    resultEl.className = 'alert alert-info small mb-3';
    resultEl.textContent = '正在创建采集任务...';
    try {
        const resp = await fetch(`/api/metadata/jobs/${datasourceId}`, { method: 'POST' });
        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.detail || '创建采集任务失败');
        }
        resultEl.className = 'alert alert-success small mb-3';
        resultEl.innerHTML = `采集任务已创建：<a href="/web/metadata/jobs/${data.id}">#${data.id}</a>`;
    } catch (err) {
        resultEl.className = 'alert alert-danger small mb-3';
        resultEl.textContent = err.message || '创建采集任务失败';
    }
}
</script>
{% endblock %}
```

- [ ] **Step 2: Run the task-center page test**

Run:

```powershell
pytest tests/test_basic.py::test_metadata_jobs_page_shows_overview_and_schedule_rows -q
```

Expected: `1 passed`.

- [ ] **Step 3: Run related page tests**

Run:

```powershell
pytest tests/test_basic.py::test_metadata_scheduler_tick_api_returns_scan_counts tests/test_basic.py::test_datasource_detail_page_shows_metadata_schedule tests/test_basic.py::test_metadata_job_detail_page_shows_governance_ticket_count tests/test_basic.py::test_governance_page_filters_by_source tests/test_basic.py::test_metadata_jobs_page_shows_overview_and_schedule_rows -q
```

Expected: `5 passed`.

- [ ] **Step 4: Commit Task 4**

Run:

```powershell
git add app/web/templates/metadata/jobs.html tests/test_basic.py
git commit -m "feat: enhance metadata job center page"
```

## Task 5: Job Detail Governance Navigation Polish

**Files:**
- Modify: `app/web/templates/metadata/job_detail.html`
- Modify: `tests/test_basic.py`

- [ ] **Step 1: Tighten job-detail test around navigation text**

Update `test_metadata_job_detail_page_shows_governance_ticket_count` in `tests/test_basic.py` so the final assertions are:

```python
    assert resp.status_code == 200
    assert "治理待办" in resp.text
    assert "3" in resp.text
    assert "查看元数据变更待办" in resp.text
    assert "source=metadata_change_detected" in resp.text
    assert f"/web/datasources/{ds_id}" in resp.text
```

Store `ds_id` before closing the session:

```python
        ds_id = ds.id
```

- [ ] **Step 2: Run the job-detail test and verify it fails on datasource link if absent**

Run:

```powershell
pytest tests/test_basic.py::test_metadata_job_detail_page_shows_governance_ticket_count -q
```

Expected: fail if the detail page lacks the datasource detail link with the current readable text.

- [ ] **Step 3: Add datasource navigation to the job-detail template**

In `app/web/templates/metadata/job_detail.html`, replace the datasource `<dd>` in the task information block with:

```html
<dd class="col-sm-9">
    {% if job.datasource %}
    <a href="/web/datasources/{{ job.datasource.id }}" class="text-decoration-none">{{ job.datasource.name }}</a>
    {% else %}
    数据源 #{{ job.datasource_id }}
    {% endif %}
</dd>
```

Ensure the governance link text reads:

```html
<a href="/web/governance?source=metadata_change_detected" class="btn btn-sm btn-outline-primary mt-2">查看元数据变更待办</a>
```

- [ ] **Step 4: Run the job-detail test and verify it passes**

Run:

```powershell
pytest tests/test_basic.py::test_metadata_job_detail_page_shows_governance_ticket_count -q
```

Expected: `1 passed`.

- [ ] **Step 5: Commit Task 5**

Run:

```powershell
git add app/web/templates/metadata/job_detail.html tests/test_basic.py
git commit -m "feat: link collection jobs to governance context"
```

## Task 6: Real dwhrpt Smoke Verification and Final Regression

**Files:**
- Modify only if real smoke exposes a bug in existing collection code:
  - `app/services/metadata_service.py`
  - `app/collectors/oracle_collector.py`
  - `app/adapters/oracle.py`

- [ ] **Step 1: Run fast automated regression before real Oracle smoke**

Run:

```powershell
pytest -q
```

Expected: all tests pass.

- [ ] **Step 2: Run dry-run against local configured database**

Run:

```powershell
python scripts/smoke_dwhrpt_metadata_collection.py --datasource-name dwhrpt
```

Expected when `dwhrpt` exists: exit code `0`, JSON includes `"dry_run": true`, datasource connection metadata, and no password field.

Expected when `dwhrpt` does not exist in the local app database: exit code `1`, JSON includes `dwhrpt datasource not found`. If this happens, stop and confirm the app is pointing at the same database where the datasource was created.

- [ ] **Step 3: Run real smoke with execute mode**

Run:

```powershell
python scripts/smoke_dwhrpt_metadata_collection.py --datasource-name dwhrpt --execute
```

Expected success path: exit code `0`, JSON has `"success": true`, scheduler result with at least one created or reused job, job status `success`, and `tables_count > 0`, `columns_count > 0`.

Expected diagnostic paths:

- Exit code `2`: failed job, inspect `job.error_message` and `job.error_details_preview`.
- Exit code `3`: partial success, inspect failed schema/object details.
- Exit code `4`: job reported success but collected zero tables or zero columns; treat as a bug and fix before completion.

- [ ] **Step 4: If exit code is 4, write a failing regression test before fixing**

Add this test to `tests/test_basic.py` if the smoke exposes an empty-success bug in `execute_metadata_collection_job`:

```python
def test_execute_metadata_collection_job_marks_empty_success_as_failed(app, monkeypatch):
    from app.services import metadata_job_service

    def fake_collect_metadata(datasource_id, schemas=None):
        return {
            "success": True,
            "stats": {
                "tables": 0,
                "columns": 0,
                "indexes": 0,
                "constraints": 0,
                "errors": [],
                "changes": {},
            },
        }

    monkeypatch.setattr(metadata_job_service, "collect_metadata", fake_collect_metadata)

    db = get_session()
    try:
        ds = DatasourceConfig(name="empty success ds", ds_type="oracle", host="127.0.0.1", port=1521, username="u", dialect="oracle")
        db.add(ds)
        db.flush()
        job = MetadataCollectionJob(datasource_id=ds.id, status="running", triggered_by="scheduler")
        db.add(job)
        db.commit()
        job_id = job.id
    finally:
        db.close()

    result = metadata_job_service.execute_metadata_collection_job(job_id)

    assert result["status"] == "failed"
    assert "未采集到表或字段" in result["error_message"]
```

Run:

```powershell
pytest tests/test_basic.py::test_execute_metadata_collection_job_marks_empty_success_as_failed -q
```

Expected before fix: fail because the job is still marked success.

- [ ] **Step 5: Fix empty-success service behavior only if Step 4 was needed**

In `app/services/metadata_job_service.py`, after counts are assigned and before `if result.get("success")`, add:

```python
            empty_success = (job.tables_count == 0 or job.columns_count == 0) and not errors

            if result.get("success") and empty_success:
                job.status = "failed"
                job.error_message = "元数据采集未采集到表或字段"
            elif result.get("success"):
                if errors:
                    job.status = "partial_success"
                    job.error_message = f"{len(errors)} 个采集错误"
                    job.error_details = "\n".join(str(error) for error in errors)
                else:
                    job.status = "success"
            else:
                job.status = "failed"
                job.error_message = result.get("error", "采集失败")
```

Remove the previous `if result.get("success"):` block so the status assignment is not duplicated.

Run:

```powershell
pytest tests/test_basic.py::test_execute_metadata_collection_job_marks_empty_success_as_failed -q
```

Expected: `1 passed`.

- [ ] **Step 6: Re-run real smoke after any bug fix**

Run:

```powershell
python scripts/smoke_dwhrpt_metadata_collection.py --datasource-name dwhrpt --execute
```

Expected: exit code `0`, or a non-zero code with a truthful Oracle/permission/schema diagnostic. Do not call this complete with exit code `4`.

- [ ] **Step 7: Run full regression**

Run:

```powershell
pytest -q
```

Expected: all tests pass.

- [ ] **Step 8: Inspect final diff**

Run:

```powershell
git status --short
git diff --check
git diff --stat
```

Expected: only intended files are modified, no whitespace errors.

- [ ] **Step 9: Commit final fixes**

If Task 6 changed code or tests, run:

```powershell
git add app/services/metadata_service.py app/collectors/oracle_collector.py app/adapters/oracle.py app/services/metadata_job_service.py tests/test_basic.py
git commit -m "fix: harden real metadata collection verification"
```

If Task 6 only produced verification output and no files changed, do not create an empty commit.

## Self-Review

- Spec coverage: the plan covers `dwhrpt` dry-run and execute smoke, explicit non-zero exit codes for failed/partial/empty success, scheduler tick execution, datasource schedule visibility, job list trigger/change/governance/error fields, job detail governance navigation, and real verification commands.
- No new distributed queue, scheduler framework, audit table, or secret logging is introduced.
- Reused APIs and services: `run_metadata_scheduler_tick`, `MetadataCollectionJob`, `DatasourceConfig`, and existing metadata job APIs remain the integration points.
- Placeholder scan passed after removing marker words from the plan text itself.
- Type consistency: all tests and script snippets use existing model names and current service functions.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-22-dwhrpt-real-collection-task-center.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
