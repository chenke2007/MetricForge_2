# 元数据采集异步执行与安全硬化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将元数据采集从同步等待升级为轻量后台执行，并修复数据源详情页采集提示的 `innerHTML` 安全风险。

**Architecture:** 服务层拆分为创建任务、执行任务、同步兼容封装三类函数；新任务 API 使用 FastAPI `BackgroundTasks` 创建 `running` 任务后立即返回，后台按 `job_id` 更新最终状态。Web 端保持 Jinja + Bootstrap + vanilla JavaScript，点击采集后安全渲染提示并轮询任务详情接口。

**Tech Stack:** FastAPI BackgroundTasks、SQLAlchemy、Jinja2、Bootstrap 5、vanilla JavaScript、Pytest、SQLite。

---

## 文件结构

- 修改：`tests/test_basic.py`
  - 增加服务层拆分、异步 API、旧接口兼容、前端轮询与安全渲染、任务详情 running 提示测试。
- 修改：`app/services/metadata_job_service.py`
  - 新增 `create_metadata_collection_job()` 和 `execute_metadata_collection_job()`；保留 `run_metadata_collection_job()` 作为同步兼容封装。
- 修改：`app/api/metadata.py`
  - `POST /api/metadata/jobs/{datasource_id}` 改为 `BackgroundTasks` 异步调度；旧 `/collect/{datasource_id}` 保持同步。
- 修改：`app/web/templates/datasources/detail.html`
  - 采集按钮改为创建任务后轮询；提示使用 DOM / `textContent` 构建，不拼接后端错误文本到 `innerHTML`。
- 修改：`app/web/templates/metadata/job_detail.html`
  - running 任务展示“任务仍在执行”提示。

---

## Task 1: 拆分采集任务服务

**Files:**
- Modify: `tests/test_basic.py`
- Modify: `app/services/metadata_job_service.py`

- [ ] **Step 1: 添加创建任务不执行采集的红灯测试**

在 `tests/test_basic.py` 中现有采集任务服务测试附近追加：

```python
def test_create_metadata_collection_job_records_running_without_collecting(app, monkeypatch):
    """测试创建采集任务只记录 running，不执行真实采集"""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="异步创建任务数据源",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
            schema_names="DWD,DWS",
        )
        db.add(ds)
        db.commit()
        db.refresh(ds)

        def fail_if_called(datasource_id):
            raise AssertionError("create_metadata_collection_job must not collect metadata")

        monkeypatch.setattr(metadata_job_service, "collect_metadata", fail_if_called)

        job = metadata_job_service.create_metadata_collection_job(ds.id, triggered_by="pytest")

        assert job["status"] == "running"
        assert job["datasource_id"] == ds.id
        assert job["triggered_by"] == "pytest"
        assert job["schema_filter"] == "DWD,DWS"
        assert job["finished_at"] is None
        assert job["duration_ms"] is None
        assert job["tables_count"] == 0
        assert job["columns_count"] == 0

        saved = db.query(MetadataCollectionJob).filter(MetadataCollectionJob.id == job["id"]).one()
        assert saved.status == "running"
    finally:
        db.close()
```

- [ ] **Step 2: 添加执行任务成功转终态的红灯测试**

继续追加：

```python
def test_execute_metadata_collection_job_updates_running_job_to_success(app, monkeypatch):
    """测试后台执行任务会把 running 更新为 success"""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="异步执行成功数据源",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.commit()
        db.refresh(ds)
        job = MetadataCollectionJob(datasource_id=ds.id, status="running", triggered_by="pytest")
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.id
    finally:
        db.close()

    def fake_collect_metadata(datasource_id):
        assert datasource_id == ds.id
        return {
            "success": True,
            "stats": {
                "tables": 6,
                "columns": 24,
                "indexes": 2,
                "constraints": 3,
                "errors": [],
            },
        }

    monkeypatch.setattr(metadata_job_service, "collect_metadata", fake_collect_metadata)

    result = metadata_job_service.execute_metadata_collection_job(job_id)

    assert result["status"] == "success"
    assert result["tables_count"] == 6
    assert result["columns_count"] == 24
    assert result["duration_ms"] is not None

    db = get_session()
    try:
        saved = db.query(MetadataCollectionJob).filter(MetadataCollectionJob.id == job_id).one()
        assert saved.status == "success"
        assert saved.finished_at is not None
    finally:
        db.close()
```

- [ ] **Step 3: 添加执行任务失败和缺失任务红灯测试**

继续追加：

```python
def test_execute_metadata_collection_job_records_failure_when_datasource_missing(app):
    """测试后台执行时数据源已删除会把任务标记失败"""
    db = get_session()
    try:
        ds = DatasourceConfig(
            name="异步执行缺失数据源",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.commit()
        db.refresh(ds)
        job = MetadataCollectionJob(datasource_id=ds.id, status="running", triggered_by="pytest")
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.id
        db.delete(ds)
        db.commit()
    finally:
        db.close()

    from app.services import metadata_job_service

    result = metadata_job_service.execute_metadata_collection_job(job_id)

    assert result["status"] == "failed"
    assert "数据源不存在" in result["error_message"]


def test_execute_metadata_collection_job_returns_none_for_missing_job(app):
    """测试后台执行不存在的任务时安全返回 None"""
    from app.services import metadata_job_service

    assert metadata_job_service.execute_metadata_collection_job(999999) is None
```

- [ ] **Step 4: 运行服务层红灯测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_create_metadata_collection_job_records_running_without_collecting tests/test_basic.py::test_execute_metadata_collection_job_updates_running_job_to_success tests/test_basic.py::test_execute_metadata_collection_job_records_failure_when_datasource_missing tests/test_basic.py::test_execute_metadata_collection_job_returns_none_for_missing_job -q
```

Expected:

```text
failed
```

失败原因应包含 `AttributeError`，因为服务层新函数尚未实现。

- [ ] **Step 5: 拆分任务服务实现**

修改 `app/services/metadata_job_service.py`，保留现有 import 和 `serialize_collection_job()`，将采集执行逻辑整理为以下结构：

```python
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


def create_metadata_collection_job(datasource_id: int, triggered_by: str = "web") -> dict:
    """Create a running metadata collection job without executing collection."""
    db = get_session()
    try:
        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == datasource_id).first()
        if not ds:
            raise ValueError("数据源不存在")

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
        return serialize_collection_job(job)
    finally:
        db.close()


def _mark_job_failed(job: MetadataCollectionJob, message: str) -> None:
    finished_at = _utc_now()
    job.finished_at = finished_at
    job.duration_ms = _duration_ms(job.started_at, finished_at)
    job.status = "failed"
    job.error_message = message


def execute_metadata_collection_job(job_id: int) -> dict | None:
    """Execute a previously-created metadata collection job."""
    db = get_session()
    try:
        job = db.query(MetadataCollectionJob).filter(MetadataCollectionJob.id == job_id).first()
        if not job:
            logger.warning("metadata collection job %s does not exist", job_id)
            return None

        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == job.datasource_id).first()
        if not ds:
            _mark_job_failed(job, "数据源不存在")
            db.commit()
            db.refresh(job)
            return serialize_collection_job(job)

        try:
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
                    job.error_message = f"{len(errors)} 个采集错误"
                    job.error_details = "\n".join(str(error) for error in errors)
                else:
                    job.status = "success"
                    job.error_message = None
                    job.error_details = None
            else:
                job.status = "failed"
                job.error_message = result.get("error", "采集失败")
        except Exception as exc:
            logger.exception("metadata collection job %s failed", job_id)
            _mark_job_failed(job, str(exc))

        db.commit()
        db.refresh(job)
        return serialize_collection_job(job)
    finally:
        db.close()


def run_metadata_collection_job(datasource_id: int, triggered_by: str = "web") -> dict:
    """Create and synchronously run a metadata collection job."""
    job = create_metadata_collection_job(datasource_id, triggered_by=triggered_by)
    result = execute_metadata_collection_job(job["id"])
    if result is None:
        raise ValueError("采集任务不存在")
    return result
```

- [ ] **Step 6: 运行服务层测试确认转绿**

Run:

```powershell
python -m pytest tests/test_basic.py::test_create_metadata_collection_job_records_running_without_collecting tests/test_basic.py::test_execute_metadata_collection_job_updates_running_job_to_success tests/test_basic.py::test_execute_metadata_collection_job_records_failure_when_datasource_missing tests/test_basic.py::test_execute_metadata_collection_job_returns_none_for_missing_job tests/test_basic.py::test_run_metadata_collection_job_records_success tests/test_basic.py::test_run_metadata_collection_job_records_partial_success tests/test_basic.py::test_run_metadata_collection_job_records_failure -q
```

Expected:

```text
7 passed
```

- [ ] **Step 7: 提交服务层拆分**

Run:

```powershell
git add tests/test_basic.py app/services/metadata_job_service.py
git commit -m "feat: split metadata collection job execution"
```

---

## Task 2: 采集任务 API 改为后台执行

**Files:**
- Modify: `tests/test_basic.py`
- Modify: `app/api/metadata.py`

- [ ] **Step 1: 添加新任务 API 立即返回 running 的红灯测试**

修改现有 `test_create_metadata_collection_job_api` 或追加新测试：

```python
def test_create_metadata_collection_job_api_returns_running_and_schedules_background(client, monkeypatch):
    """测试新任务 API 创建 running 任务并注册后台执行"""
    from app.api import metadata as metadata_api

    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "异步 API 数据源",
            "host": "127.0.0.1",
            "port": 1521,
            "username": "readonly",
            "ds_type": "oracle",
        },
    )
    ds_id = create_resp.json()["id"]
    scheduled = []

    def fake_create_metadata_collection_job(datasource_id, triggered_by="web"):
        return {
            "id": 123,
            "datasource_id": datasource_id,
            "datasource_name": "异步 API 数据源",
            "status": "running",
            "tables_count": 0,
            "columns_count": 0,
            "indexes_count": 0,
            "constraints_count": 0,
            "duration_ms": None,
            "error_message": None,
            "error_details": None,
            "started_at": "2026-06-19 16:10:00",
            "finished_at": None,
            "triggered_by": triggered_by,
            "schema_filter": None,
        }

    class FakeBackgroundTasks:
        def add_task(self, func, *args, **kwargs):
            scheduled.append((func, args, kwargs))

    monkeypatch.setattr(metadata_api, "create_metadata_collection_job", fake_create_metadata_collection_job)

    resp = metadata_api.create_collection_job(ds_id, background_tasks=FakeBackgroundTasks())

    assert resp["id"] == 123
    assert resp["status"] == "running"
    assert len(scheduled) == 1
    assert scheduled[0][0] == metadata_api.execute_metadata_collection_job
    assert scheduled[0][1] == (123,)
```

- [ ] **Step 2: 添加旧接口仍同步返回终态的回归测试**

如果现有 `test_legacy_metadata_collect_api_uses_job_service` 已存在，确认断言保留 `status == "success"`；如果没有，追加：

```python
def test_legacy_metadata_collect_api_still_uses_synchronous_job_service(client, monkeypatch):
    """测试旧采集接口仍等待同步任务完成"""
    from app.api import metadata as metadata_api

    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "异步后旧接口数据源",
            "host": "127.0.0.1",
            "port": 1521,
            "username": "readonly",
            "ds_type": "oracle",
        },
    )
    ds_id = create_resp.json()["id"]

    monkeypatch.setattr(
        metadata_api,
        "run_metadata_collection_job",
        lambda datasource_id, triggered_by="web": {
            "id": 456,
            "datasource_id": datasource_id,
            "status": "success",
            "tables_count": 5,
            "columns_count": 20,
            "indexes_count": 1,
            "constraints_count": 2,
            "duration_ms": 80,
            "error_message": None,
            "error_details": None,
        },
    )

    resp = client.post(f"/api/metadata/collect/{ds_id}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "元数据采集完成"
    assert data["job"]["status"] == "success"
    assert data["stats"]["tables"] == 5
```

- [ ] **Step 3: 运行 API 红灯测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_create_metadata_collection_job_api_returns_running_and_schedules_background tests/test_basic.py::test_legacy_metadata_collect_api_still_uses_synchronous_job_service -q
```

Expected:

```text
failed
```

新测试应因 `create_collection_job()` 还不接受 `background_tasks` 或未调用 `create_metadata_collection_job()` 失败。

- [ ] **Step 4: 修改 API import**

在 `app/api/metadata.py` 顶部 import 调整为：

```python
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from ..services.metadata_job_service import (
    create_metadata_collection_job,
    execute_metadata_collection_job,
    run_metadata_collection_job,
    serialize_collection_job,
)
```

- [ ] **Step 5: 修改新任务 API 为后台调度**

将 `create_collection_job()` 替换为：

```python
@router.post("/jobs/{datasource_id}")
def create_collection_job(datasource_id: int, background_tasks: BackgroundTasks):
    """创建元数据采集任务并在后台执行"""
    try:
        job = create_metadata_collection_job(datasource_id)
        background_tasks.add_task(execute_metadata_collection_job, job["id"])
        return job
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("创建采集任务异常")
        raise HTTPException(status_code=500, detail=str(e))
```

保留旧 `trigger_collection()` 中对 `run_metadata_collection_job()` 的调用，不改成后台任务。

- [ ] **Step 6: 调整旧新任务 API 测试语义**

找到现有 `test_create_metadata_collection_job_api`，把 monkeypatch 目标从 `run_metadata_collection_job` 改为 `create_metadata_collection_job`，并把断言改为新 API 的立即返回语义：

```python
def test_create_metadata_collection_job_api(client, monkeypatch):
    """测试通过 API 创建采集任务并立即返回 running"""
    from app.api import metadata as metadata_api

    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "API 采集任务数据源",
            "host": "127.0.0.1",
            "port": 1521,
            "username": "readonly",
            "ds_type": "oracle",
        },
    )
    ds_id = create_resp.json()["id"]

    monkeypatch.setattr(
        metadata_api,
        "create_metadata_collection_job",
        lambda datasource_id, triggered_by="web": {
            "id": 99,
            "datasource_id": datasource_id,
            "datasource_name": "API 采集任务数据源",
            "status": "running",
            "tables_count": 0,
            "columns_count": 0,
            "indexes_count": 0,
            "constraints_count": 0,
            "duration_ms": None,
            "error_message": None,
            "error_details": None,
            "started_at": "2026-06-19 10:00:00",
            "finished_at": None,
            "triggered_by": triggered_by,
            "schema_filter": None,
        },
    )

    monkeypatch.setattr(metadata_api, "execute_metadata_collection_job", lambda job_id: None)

    resp = client.post(f"/api/metadata/jobs/{ds_id}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == 99
    assert data["status"] == "running"
    assert data["tables_count"] == 0
    assert data["columns_count"] == 0
```

- [ ] **Step 7: 运行 API 测试确认转绿**

Run:

```powershell
python -m pytest tests/test_basic.py::test_create_metadata_collection_job_api_returns_running_and_schedules_background tests/test_basic.py::test_create_metadata_collection_job_api tests/test_basic.py::test_legacy_metadata_collect_api_uses_job_service tests/test_basic.py::test_legacy_metadata_collect_api_still_uses_synchronous_job_service tests/test_basic.py::test_list_and_get_metadata_collection_jobs_api -q
```

Expected:

```text
5 passed
```

- [ ] **Step 8: 提交 API 异步化**

Run:

```powershell
git add tests/test_basic.py app/api/metadata.py
git commit -m "feat: run metadata collection jobs in background"
```

---

## Task 3: 数据源详情页安全渲染和轮询

**Files:**
- Modify: `tests/test_basic.py`
- Modify: `app/web/templates/datasources/detail.html`

- [ ] **Step 1: 添加前端轮询和安全渲染红灯测试**

扩展现有 `test_datasource_detail_shows_collection_jobs`，或追加：

```python
def test_datasource_detail_uses_safe_polling_collection_ui(client):
    """测试数据源详情页使用轮询和安全 DOM 渲染采集状态"""
    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "安全轮询数据源",
            "host": "127.0.0.1",
            "port": 1521,
            "username": "readonly",
            "ds_type": "oracle",
        },
    )
    ds_id = create_resp.json()["id"]

    resp = client.get(f"/web/datasources/{ds_id}")

    assert resp.status_code == 200
    assert "pollCollectionJob" in resp.text
    assert "setStatusMessage" in resp.text
    assert "MAX_COLLECTION_POLLS" in resp.text
    assert "POLL_INTERVAL_MS" in resp.text
    assert "fetch('/api/metadata/jobs/' + jobId)" in resp.text
    assert "data.status === 'running'" in resp.text
    assert "任务仍在执行，可前往任务中心查看" in resp.text
    assert "+ (data.error_message" not in resp.text
    assert "+ (data.detail" not in resp.text
```

- [ ] **Step 2: 运行前端红灯测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_datasource_detail_uses_safe_polling_collection_ui -q
```

Expected:

```text
failed
```

失败原因应为模板尚未包含 `pollCollectionJob` 或安全渲染 helper。

- [ ] **Step 3: 替换数据源详情页采集脚本**

在 `app/web/templates/datasources/detail.html` 的 `{% block scripts %}` 中，保留测试连接逻辑，替换采集相关 JS 为：

```html
<script>
const POLL_INTERVAL_MS = 2000;
const MAX_COLLECTION_POLLS = 150;

document.getElementById('collectMetadataBtn')?.addEventListener('click', collectMetadata);

function setStatusMessage(target, tone, iconClass, textParts, linkHref) {
    target.replaceChildren();
    const span = document.createElement('span');
    span.className = tone;

    const icon = document.createElement('i');
    icon.className = iconClass;
    span.appendChild(icon);
    span.appendChild(document.createTextNode(' ' + textParts.join('')));

    if (linkHref) {
        span.appendChild(document.createTextNode(' '));
        const link = document.createElement('a');
        link.href = linkHref;
        link.className = 'ms-1';
        link.textContent = '查看任务';
        span.appendChild(link);
    }

    target.appendChild(span);
}

function formatJobSummary(data) {
    return [
        data.tables_count || 0,
        ' 张表，',
        data.columns_count || 0,
        ' 个字段'
    ];
}

function showCollectionFinalState(resultEl, data) {
    if (data.status === 'success') {
        setStatusMessage(
            resultEl,
            'text-success fw-bold',
            'bi bi-check-circle-fill',
            ['采集完成：', ...formatJobSummary(data), '，', data.error_message || '无错误'],
            '/web/metadata/jobs/' + data.id
        );
        window.setTimeout(() => window.location.reload(), 1200);
        return true;
    }

    if (data.status === 'partial_success') {
        setStatusMessage(
            resultEl,
            'text-warning fw-bold',
            'bi bi-exclamation-triangle-fill',
            ['部分成功：', ...formatJobSummary(data), '，', data.error_message || '存在部分采集错误'],
            '/web/metadata/jobs/' + data.id
        );
        window.setTimeout(() => window.location.reload(), 1200);
        return true;
    }

    if (data.status === 'failed') {
        setStatusMessage(
            resultEl,
            'text-danger',
            'bi bi-x-circle-fill',
            ['采集失败：', data.error_message || '未知错误'],
            '/web/metadata/jobs/' + data.id
        );
        return true;
    }

    return false;
}

async function pollCollectionJob(jobId, resultEl, btn, pollCount = 0) {
    if (pollCount >= MAX_COLLECTION_POLLS) {
        setStatusMessage(
            resultEl,
            'text-muted',
            'bi bi-hourglass-split',
            ['任务仍在执行，可前往任务中心查看'],
            '/web/metadata/jobs/' + jobId
        );
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-download"></i> 采集元数据';
        return;
    }

    try {
        const resp = await fetch('/api/metadata/jobs/' + jobId);
        const data = await resp.json();
        if (!resp.ok) {
            setStatusMessage(resultEl, 'text-danger', 'bi bi-x-circle-fill', ['查询任务失败：', data.detail || '未知错误']);
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-cloud-download"></i> 采集元数据';
            return;
        }

        if (showCollectionFinalState(resultEl, data)) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-cloud-download"></i> 采集元数据';
            return;
        }

        setStatusMessage(
            resultEl,
            'text-muted',
            'bi bi-hourglass-split',
            ['采集任务正在后台执行...'],
            '/web/metadata/jobs/' + jobId
        );
        window.setTimeout(() => pollCollectionJob(jobId, resultEl, btn, pollCount + 1), POLL_INTERVAL_MS);
    } catch (err) {
        setStatusMessage(resultEl, 'text-danger', 'bi bi-x-circle-fill', ['请求失败: ', err.message], '/web/metadata/jobs/' + jobId);
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-download"></i> 采集元数据';
    }
}

async function collectMetadata() {
    const btn = document.getElementById('collectMetadataBtn');
    const resultEl = document.getElementById('collectionResult');
    const collectionUrl = btn.dataset.collectionUrl;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> 创建任务中...';
    resultEl.replaceChildren();

    try {
        const resp = await fetch(collectionUrl, { method: 'POST' });
        const data = await resp.json();
        if (!resp.ok) {
            setStatusMessage(resultEl, 'text-danger', 'bi bi-x-circle-fill', ['采集失败：', data.detail || '未知错误']);
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-cloud-download"></i> 采集元数据';
            return;
        }

        if (data.status === 'running') {
            setStatusMessage(
                resultEl,
                'text-muted',
                'bi bi-hourglass-split',
                ['采集任务已创建，正在后台执行...'],
                '/web/metadata/jobs/' + data.id
            );
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> 采集中...';
            window.setTimeout(() => pollCollectionJob(data.id, resultEl, btn), POLL_INTERVAL_MS);
            return;
        }

        if (!showCollectionFinalState(resultEl, data)) {
            setStatusMessage(resultEl, 'text-muted', 'bi bi-hourglass-split', ['采集任务状态：', data.status || '未知'], '/web/metadata/jobs/' + data.id);
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-cloud-download"></i> 采集元数据';
        }
    } catch (err) {
        setStatusMessage(resultEl, 'text-danger', 'bi bi-x-circle-fill', ['请求失败: ', err.message]);
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-download"></i> 采集元数据';
    }
}
```

- [ ] **Step 4: 安全硬化测试连接提示**

在同一模板中，将测试连接逻辑里的后端文本渲染从 `resultEl.innerHTML = '<span ...>' + data.message + '</span>'` 改为使用 `setStatusMessage()`：

```javascript
if (data.success) {
    setStatusMessage(resultEl, 'text-success fw-bold', 'bi bi-check-circle-fill', ['连接成功']);
} else {
    setStatusMessage(resultEl, 'text-danger', 'bi bi-x-circle-fill', [data.message || '连接失败']);
}
```

catch 分支也改为：

```javascript
setStatusMessage(resultEl, 'text-danger', 'bi bi-x-circle-fill', ['请求失败: ', err.message]);
```

- [ ] **Step 5: 运行前端测试确认转绿**

Run:

```powershell
python -m pytest tests/test_basic.py::test_datasource_detail_uses_safe_polling_collection_ui tests/test_basic.py::test_datasource_detail_shows_collection_jobs -q
```

Expected:

```text
2 passed
```

- [ ] **Step 6: 提交前端安全轮询**

Run:

```powershell
git add tests/test_basic.py app/web/templates/datasources/detail.html
git commit -m "feat: poll metadata collection jobs safely"
```

---

## Task 4: 任务详情页 running 状态提示

**Files:**
- Modify: `tests/test_basic.py`
- Modify: `app/web/templates/metadata/job_detail.html`

- [ ] **Step 1: 添加 running 详情页红灯测试**

在 `tests/test_basic.py` 中任务详情页测试附近追加：

```python
def test_metadata_job_detail_page_shows_running_hint(client):
    """测试 running 任务详情页提示任务仍在执行"""
    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "运行中任务详情数据源",
            "host": "127.0.0.1",
            "port": 1521,
            "username": "readonly",
            "ds_type": "oracle",
        },
    )
    ds_id = create_resp.json()["id"]
    db = get_session()
    try:
        job = MetadataCollectionJob(
            datasource_id=ds_id,
            status="running",
            triggered_by="pytest",
            tables_count=0,
            columns_count=0,
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.id
    finally:
        db.close()

    resp = client.get(f"/web/metadata/jobs/{job_id}")

    assert resp.status_code == 200
    assert "采集任务详情" in resp.text
    assert "running" in resp.text
    assert "任务仍在执行" in resp.text
    assert "请刷新查看最新状态" in resp.text
```

- [ ] **Step 2: 运行 running 提示红灯测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_metadata_job_detail_page_shows_running_hint -q
```

Expected:

```text
failed
```

失败原因应为页面尚未包含 running 提示文案。

- [ ] **Step 3: 添加 running 提示**

在 `app/web/templates/metadata/job_detail.html` 的 page header 后、主要卡片前加入：

```html
{% if job.status == 'running' %}
<div class="alert alert-info">
    <i class="bi bi-hourglass-split me-2"></i>任务仍在执行，请刷新查看最新状态。
</div>
{% endif %}
```

- [ ] **Step 4: 运行页面测试确认转绿**

Run:

```powershell
python -m pytest tests/test_basic.py::test_metadata_job_detail_page_shows_running_hint tests/test_basic.py::test_metadata_job_detail_page_shows_error_details -q
```

Expected:

```text
2 passed
```

- [ ] **Step 5: 提交 running 提示**

Run:

```powershell
git add tests/test_basic.py app/web/templates/metadata/job_detail.html
git commit -m "feat: show running metadata job hint"
```

---

## Task 5: 全量验证、浏览器验收和推送

**Files:**
- No production edits unless verification finds a bug.

- [ ] **Step 1: 运行本阶段相关测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_create_metadata_collection_job_records_running_without_collecting tests/test_basic.py::test_execute_metadata_collection_job_updates_running_job_to_success tests/test_basic.py::test_execute_metadata_collection_job_records_failure_when_datasource_missing tests/test_basic.py::test_execute_metadata_collection_job_returns_none_for_missing_job tests/test_basic.py::test_create_metadata_collection_job_api_returns_running_and_schedules_background tests/test_basic.py::test_legacy_metadata_collect_api_still_uses_synchronous_job_service tests/test_basic.py::test_datasource_detail_uses_safe_polling_collection_ui tests/test_basic.py::test_metadata_job_detail_page_shows_running_hint -q
```

Expected:

```text
8 passed
```

- [ ] **Step 2: 运行全量测试**

Run:

```powershell
python -m pytest tests/ -q
```

Expected:

```text
all tests passed
```

- [ ] **Step 3: 重启本地服务**

Run:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*uvicorn*' -or $_.CommandLine -like '*app.main*' } | Select-Object ProcessId,Name,CommandLine
```

停止旧 `uvicorn app.main:app --port 8000` 进程后启动：

```powershell
Start-Process 'D:\Program Files\Python312\python.exe' -ArgumentList '-m','uvicorn','app.main:app','--host','0.0.0.0','--port','8000' -WorkingDirectory 'D:\projects\MetricForge' -WindowStyle Hidden
```

健康检查：

```powershell
(Invoke-WebRequest -UseBasicParsing http://localhost:8000/health -TimeoutSec 5).StatusCode
```

Expected:

```text
200
```

- [ ] **Step 4: 准备浏览器验收数据**

使用 SQLite 创建临时数据源和 running 任务记录：

```python
import json
import sqlite3
from datetime import datetime

conn = sqlite3.connect("data/metricforge.db")
cur = conn.cursor()
cur.execute("DELETE FROM metadata_collection_job WHERE triggered_by = 'codex-async-browser-check'")
cur.execute("DELETE FROM datasource_config WHERE name = 'Codex_Async_TEMP_DS'")
cur.execute("""
INSERT INTO datasource_config (name, ds_type, host, port, username, dialect, is_active)
VALUES ('Codex_Async_TEMP_DS', 'oracle', '127.0.0.1', 1521, 'readonly', 'oracle', 1)
""")
ds_id = cur.lastrowid
now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
cur.execute("""
INSERT INTO metadata_collection_job (
    datasource_id, status, triggered_by, started_at, tables_count, columns_count,
    indexes_count, constraints_count, error_message, error_details
) VALUES (?, 'running', 'codex-async-browser-check', ?, 0, 0, 0, 0, NULL, NULL)
""", (ds_id, now))
job_id = cur.lastrowid
conn.commit()
conn.close()
print(json.dumps({"datasource_id": ds_id, "job_id": job_id}))
```

- [ ] **Step 5: 浏览器验收页面**

打开：

```text
http://localhost:8000/web/datasources/{datasource_id}
```

验收：

- 页面包含“采集历史”。
- 最近任务显示 `running`。
- 页面脚本包含安全轮询行为；点击按钮后会显示任务创建/采集中提示。
- 打开 `/web/metadata/jobs/{job_id}`，详情页显示 `采集任务详情`、数据源名、`running` 和“任务仍在执行，请刷新查看最新状态”。
- 打开 `/web/metadata/jobs?datasource_id=&status=`，任务中心不是 JSON 错误页。
- 打开 `/web/metadata/jobs?datasource_id=abc&status=running`，任务中心不是 JSON 错误页。

- [ ] **Step 6: 清理浏览器验收临时数据**

Run:

```python
import sqlite3
conn = sqlite3.connect("data/metricforge.db")
cur = conn.cursor()
cur.execute("DELETE FROM metadata_collection_job WHERE triggered_by = 'codex-async-browser-check'")
cur.execute("DELETE FROM datasource_config WHERE name = 'Codex_Async_TEMP_DS'")
conn.commit()
conn.close()
print("cleaned")
```

- [ ] **Step 7: 最终状态和推送**

Run:

```powershell
git status -sb
python -m pytest tests/ -q
git push origin main
```

Expected:

```text
tests passed
main -> main
```

---

## Self-Review Checklist

- Spec coverage:
  - 服务层创建/执行拆分：Task 1。
  - 新任务 API BackgroundTasks 异步化：Task 2。
  - 旧采集接口同步兼容：Task 2。
  - 数据源详情页轮询任务详情：Task 3。
  - 安全 DOM / `textContent` 渲染：Task 3。
  - running 任务详情提示：Task 4。
  - 全量测试、浏览器验收、推送：Task 5。
- Completeness scan:
  - 每个任务都有红灯测试、运行命令、实现步骤、转绿测试和提交命令。
- Type consistency:
  - 服务函数统一为 `create_metadata_collection_job()`、`execute_metadata_collection_job()`、`run_metadata_collection_job()`。
  - API 仍使用 `/api/metadata/jobs/{datasource_id}`、`/api/metadata/jobs/{job_id}`。
  - 状态值统一为 `running`、`success`、`partial_success`、`failed`。
  - 前端轮询使用 `POLL_INTERVAL_MS`、`MAX_COLLECTION_POLLS`、`pollCollectionJob()`、`setStatusMessage()`。
