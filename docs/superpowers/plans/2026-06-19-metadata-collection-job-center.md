# 元数据采集任务中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立首版元数据采集任务中心，让每次元数据采集都有任务记录、状态、统计、失败原因、历史列表和详情页。

**Architecture:** 新增 `MetadataCollectionJob` 模型记录任务状态与统计；新增 `metadata_job_service` 包裹现有 `collect_metadata()`，同步执行但持久化任务结果；扩展 `/api/metadata` 提供任务创建、列表、详情接口，并让旧 `/api/metadata/collect/{datasource_id}` 走任务服务保持兼容。Web 继续使用 FastAPI + Jinja + Bootstrap，在数据源详情页展示最近任务，并新增采集任务中心和任务详情页。

**Tech Stack:** FastAPI、SQLAlchemy、Jinja2、Bootstrap 5、vanilla JavaScript、Pytest、SQLite。

---

## 文件结构

- 修改：`tests/test_basic.py`
  - 增加任务模型、任务 API、兼容旧采集接口、数据源详情页历史、任务中心页面、任务详情页测试。
- 创建：`app/models/metadata_job.py`
  - 定义 `MetadataCollectionJob`。
- 修改：`app/models/__init__.py`
  - 导出 `MetadataCollectionJob`，确保 `Base.metadata.create_all()` 创建新表。
- 创建：`app/services/metadata_job_service.py`
  - 提供 `run_metadata_collection_job(datasource_id, triggered_by="web")` 和序列化辅助函数。
- 修改：`app/api/metadata.py`
  - 新增任务 API，并让旧采集 API 调用任务服务。
- 修改：`app/web/routes.py`
  - 数据源详情页加载最近采集任务；新增 `/web/metadata/jobs` 和 `/web/metadata/jobs/{job_id}`。
- 修改：`app/web/templates/datasources/detail.html`
  - 采集按钮改为调用任务 API；新增最近采集历史区域。
- 创建：`app/web/templates/metadata/jobs.html`
  - 采集任务中心列表页。
- 创建：`app/web/templates/metadata/job_detail.html`
  - 采集任务详情页。

---

## Task 1: 任务模型红灯测试与实现

**Files:**
- Modify: `tests/test_basic.py`
- Create: `app/models/metadata_job.py`
- Modify: `app/models/__init__.py`

- [ ] **Step 1: 添加模型 import 的失败测试**

在 `tests/test_basic.py` 顶部 `from app.models import (...)` 中加入：

```python
    MetadataCollectionJob,
```

在 `test_create_app_uses_explicit_database_url()` 中增加新表断言：

```python
    assert "metadata_collection_job" in table_names
```

在 `test_create_governance_ticket()` 后追加：

```python
def test_create_metadata_collection_job(db_session):
    """测试创建元数据采集任务记录"""
    ds = DatasourceConfig(
        name="采集任务数据源",
        ds_type="oracle",
        host="127.0.0.1",
        port=1521,
        username="readonly",
        dialect="oracle",
    )
    db_session.add(ds)
    db_session.flush()

    job = MetadataCollectionJob(
        datasource_id=ds.id,
        status="running",
        triggered_by="web",
        schema_filter="DWD,DWS",
    )
    db_session.add(job)
    db_session.commit()

    saved = db_session.query(MetadataCollectionJob).first()
    assert saved is not None
    assert saved.datasource_id == ds.id
    assert saved.status == "running"
    assert saved.triggered_by == "web"
    assert saved.schema_filter == "DWD,DWS"
    assert saved.tables_count == 0
    assert saved.columns_count == 0
```

- [ ] **Step 2: 运行红灯测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_create_metadata_collection_job tests/test_basic.py::test_create_app_uses_explicit_database_url -q
```

Expected:

```text
failed
```

失败原因应包含 `ImportError` 或新表不存在，因为模型尚未创建。

- [ ] **Step 3: 创建任务模型**

创建 `app/models/metadata_job.py`：

```python
"""元数据采集任务模型"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class MetadataCollectionJob(Base):
    """元数据采集任务记录"""

    __tablename__ = "metadata_collection_job"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    datasource_id: Mapped[int] = mapped_column(Integer, ForeignKey("datasource_config.id"), nullable=False, comment="数据源 ID")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running", comment="running/success/failed/partial_success")
    triggered_by: Mapped[str] = mapped_column(String(100), nullable=True, comment="触发人")
    schema_filter: Mapped[str] = mapped_column(Text, nullable=True, comment="采集 schema 范围")
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="开始时间")
    finished_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="结束时间")
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=True, comment="耗时毫秒")
    tables_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="表数量")
    columns_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="字段数量")
    indexes_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="索引数量")
    constraints_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="约束数量")
    error_message: Mapped[str] = mapped_column(Text, nullable=True, comment="错误摘要")
    error_details: Mapped[str] = mapped_column(Text, nullable=True, comment="错误详情")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")

    datasource = relationship("DatasourceConfig")

    def __repr__(self) -> str:
        return f"<MetadataCollectionJob(id={self.id}, datasource_id={self.datasource_id}, status={self.status})>"
```

- [ ] **Step 4: 导出模型**

修改 `app/models/__init__.py`：

```python
from .metadata_job import MetadataCollectionJob
```

并在 `__all__` 中加入：

```python
    "MetadataCollectionJob",
```

- [ ] **Step 5: 运行模型测试确认转绿**

Run:

```powershell
python -m pytest tests/test_basic.py::test_create_metadata_collection_job tests/test_basic.py::test_create_app_uses_explicit_database_url -q
```

Expected:

```text
2 passed
```

- [ ] **Step 6: 提交模型任务**

Run:

```powershell
git add tests/test_basic.py app/models/metadata_job.py app/models/__init__.py
git commit -m "feat: add metadata collection job model"
```

---

## Task 2: 任务服务封装采集执行

**Files:**
- Modify: `tests/test_basic.py`
- Create: `app/services/metadata_job_service.py`

- [ ] **Step 1: 添加成功任务服务红灯测试**

在 `tests/test_basic.py` 末尾追加：

```python
def test_run_metadata_collection_job_records_success(app, monkeypatch):
    """测试采集任务成功时记录状态和统计"""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="任务服务成功数据源",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.commit()
        db.refresh(ds)

        def fake_collect_metadata(datasource_id):
            assert datasource_id == ds.id
            return {
                "success": True,
                "stats": {
                    "schemas": 1,
                    "tables": 2,
                    "columns": 8,
                    "indexes": 3,
                    "constraints": 4,
                    "errors": [],
                },
            }

        monkeypatch.setattr(metadata_job_service, "collect_metadata", fake_collect_metadata)

        job = metadata_job_service.run_metadata_collection_job(ds.id, triggered_by="pytest")

        assert job["status"] == "success"
        assert job["datasource_id"] == ds.id
        assert job["tables_count"] == 2
        assert job["columns_count"] == 8
        assert job["indexes_count"] == 3
        assert job["constraints_count"] == 4
        assert job["duration_ms"] is not None

        saved = db.query(MetadataCollectionJob).filter(MetadataCollectionJob.id == job["id"]).one()
        assert saved.status == "success"
        assert saved.error_message is None
    finally:
        db.close()
```

- [ ] **Step 2: 添加部分成功和失败红灯测试**

继续追加：

```python
def test_run_metadata_collection_job_records_partial_success(app, monkeypatch):
    """测试采集返回 schema 错误时记录部分成功"""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="任务服务部分成功数据源",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.commit()
        db.refresh(ds)

        monkeypatch.setattr(
            metadata_job_service,
            "collect_metadata",
            lambda datasource_id: {
                "success": True,
                "stats": {
                    "schemas": 2,
                    "tables": 1,
                    "columns": 3,
                    "indexes": 0,
                    "constraints": 0,
                    "errors": ["BAD_SCHEMA: 权限不足"],
                },
            },
        )

        job = metadata_job_service.run_metadata_collection_job(ds.id)

        assert job["status"] == "partial_success"
        assert job["tables_count"] == 1
        assert job["error_message"] == "1 个采集错误"
        assert "BAD_SCHEMA" in job["error_details"]
    finally:
        db.close()


def test_run_metadata_collection_job_records_failure(app, monkeypatch):
    """测试采集失败时记录失败任务"""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="任务服务失败数据源",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.commit()
        db.refresh(ds)

        monkeypatch.setattr(
            metadata_job_service,
            "collect_metadata",
            lambda datasource_id: {"success": False, "error": "连接失败"},
        )

        job = metadata_job_service.run_metadata_collection_job(ds.id)

        assert job["status"] == "failed"
        assert job["error_message"] == "连接失败"
        assert job["tables_count"] == 0
    finally:
        db.close()
```

- [ ] **Step 3: 运行红灯测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_run_metadata_collection_job_records_success tests/test_basic.py::test_run_metadata_collection_job_records_partial_success tests/test_basic.py::test_run_metadata_collection_job_records_failure -q
```

Expected:

```text
failed
```

失败原因应为 `ImportError` 或 `metadata_job_service` 不存在。

- [ ] **Step 4: 创建任务服务**

创建 `app/services/metadata_job_service.py`：

```python
"""元数据采集任务服务"""

from datetime import datetime

from ..models import DatasourceConfig, MetadataCollectionJob, get_session
from .metadata_service import collect_metadata


def serialize_collection_job(job: MetadataCollectionJob) -> dict:
    """序列化采集任务"""
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


def run_metadata_collection_job(datasource_id: int, triggered_by: str = "web") -> dict:
    """创建并同步执行元数据采集任务"""
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
            started_at=datetime.utcnow(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)

        try:
            result = collect_metadata(datasource_id)
            finished_at = datetime.utcnow()
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
                    job.error_details = "\n".join(str(e) for e in errors)
                else:
                    job.status = "success"
            else:
                job.status = "failed"
                job.error_message = result.get("error", "采集失败")
        except Exception as exc:
            finished_at = datetime.utcnow()
            job.finished_at = finished_at
            job.duration_ms = _duration_ms(job.started_at, finished_at)
            job.status = "failed"
            job.error_message = str(exc)

        db.commit()
        db.refresh(job)
        return serialize_collection_job(job)
    finally:
        db.close()
```

- [ ] **Step 5: 运行任务服务测试确认转绿**

Run:

```powershell
python -m pytest tests/test_basic.py::test_run_metadata_collection_job_records_success tests/test_basic.py::test_run_metadata_collection_job_records_partial_success tests/test_basic.py::test_run_metadata_collection_job_records_failure -q
```

Expected:

```text
3 passed
```

- [ ] **Step 6: 提交任务服务**

Run:

```powershell
git add tests/test_basic.py app/services/metadata_job_service.py
git commit -m "feat: record metadata collection jobs"
```

---

## Task 3: 采集任务 API 与旧接口兼容

**Files:**
- Modify: `tests/test_basic.py`
- Modify: `app/api/metadata.py`

- [ ] **Step 1: 添加任务 API 红灯测试**

在 `tests/test_basic.py` 末尾追加：

```python
def test_create_metadata_collection_job_api(client, monkeypatch):
    """测试通过 API 创建并执行采集任务"""
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

    def fake_run_metadata_collection_job(datasource_id, triggered_by="web"):
        return {
            "id": 99,
            "datasource_id": datasource_id,
            "datasource_name": "API 采集任务数据源",
            "status": "success",
            "tables_count": 2,
            "columns_count": 6,
            "indexes_count": 1,
            "constraints_count": 1,
            "duration_ms": 120,
            "error_message": None,
            "error_details": None,
            "started_at": "2026-06-19 10:00:00",
            "finished_at": "2026-06-19 10:00:01",
            "triggered_by": triggered_by,
            "schema_filter": None,
        }

    monkeypatch.setattr(metadata_api, "run_metadata_collection_job", fake_run_metadata_collection_job)

    resp = client.post(f"/api/metadata/jobs/{ds_id}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == 99
    assert data["status"] == "success"
    assert data["tables_count"] == 2
    assert data["columns_count"] == 6
```

- [ ] **Step 2: 添加任务列表和详情 API 红灯测试**

继续追加：

```python
def test_list_and_get_metadata_collection_jobs_api(client):
    """测试采集任务列表和详情 API"""
    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "任务列表数据源",
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
            status="failed",
            triggered_by="pytest",
            tables_count=0,
            columns_count=0,
            error_message="连接失败",
            error_details="DPY-6005",
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.id
    finally:
        db.close()

    list_resp = client.get(f"/api/metadata/jobs?datasource_id={ds_id}")
    assert list_resp.status_code == 200
    jobs = list_resp.json()
    assert len(jobs) == 1
    assert jobs[0]["status"] == "failed"
    assert jobs[0]["error_message"] == "连接失败"

    detail_resp = client.get(f"/api/metadata/jobs/{job_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["id"] == job_id
    assert detail["error_details"] == "DPY-6005"
```

- [ ] **Step 3: 添加旧接口兼容红灯测试**

继续追加：

```python
def test_legacy_metadata_collect_api_uses_job_service(client, monkeypatch):
    """测试旧采集 API 保持兼容并走任务服务"""
    from app.api import metadata as metadata_api

    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "旧接口兼容数据源",
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
            "id": 101,
            "datasource_id": datasource_id,
            "status": "success",
            "tables_count": 3,
            "columns_count": 9,
            "indexes_count": 0,
            "constraints_count": 0,
            "duration_ms": 50,
            "error_message": None,
            "error_details": None,
        },
    )

    resp = client.post(f"/api/metadata/collect/{ds_id}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "元数据采集完成"
    assert data["job"]["id"] == 101
    assert data["stats"]["tables"] == 3
    assert data["stats"]["columns"] == 9
```

- [ ] **Step 4: 运行 API 红灯测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_create_metadata_collection_job_api tests/test_basic.py::test_list_and_get_metadata_collection_jobs_api tests/test_basic.py::test_legacy_metadata_collect_api_uses_job_service -q
```

Expected:

```text
failed
```

失败原因应为 `/api/metadata/jobs...` 返回 404 或旧接口未返回 `job`。

- [ ] **Step 5: 修改 metadata API**

在 `app/api/metadata.py` imports 中加入：

```python
from ..models import MetadataCollectionJob
from ..services.metadata_job_service import run_metadata_collection_job, serialize_collection_job
```

将 `trigger_collection()` 改为：

```python
@router.post("/collect/{datasource_id}")
def trigger_collection(datasource_id: int, db: Session = Depends(get_db)):
    """触发元数据采集（兼容旧接口）"""
    try:
        job = run_metadata_collection_job(datasource_id)
        if job["status"] in ("success", "partial_success"):
            return {
                "message": "元数据采集完成",
                "job": job,
                "stats": {
                    "tables": job["tables_count"],
                    "columns": job["columns_count"],
                    "indexes": job["indexes_count"],
                    "constraints": job["constraints_count"],
                    "errors": job["error_details"].splitlines() if job.get("error_details") else [],
                },
            }
        raise HTTPException(status_code=500, detail=job.get("error_message") or "采集失败")
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("元数据采集异常")
        raise HTTPException(status_code=500, detail=str(e))
```

在文件末尾增加：

```python
@router.post("/jobs/{datasource_id}")
def create_collection_job(datasource_id: int):
    """创建并同步执行元数据采集任务"""
    try:
        return run_metadata_collection_job(datasource_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("创建采集任务异常")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jobs")
def list_collection_jobs(
    datasource_id: int = Query(None, description="按数据源筛选"),
    status: str = Query(None, description="按任务状态筛选"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """列出元数据采集任务"""
    q = db.query(MetadataCollectionJob)
    if datasource_id:
        q = q.filter(MetadataCollectionJob.datasource_id == datasource_id)
    if status:
        q = q.filter(MetadataCollectionJob.status == status)
    jobs = q.order_by(MetadataCollectionJob.started_at.desc()).limit(limit).all()
    return [serialize_collection_job(job) for job in jobs]


@router.get("/jobs/{job_id}")
def get_collection_job(job_id: int, db: Session = Depends(get_db)):
    """获取元数据采集任务详情"""
    job = db.query(MetadataCollectionJob).filter(MetadataCollectionJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="采集任务不存在")
    return serialize_collection_job(job)
```

- [ ] **Step 6: 运行 API 测试确认转绿**

Run:

```powershell
python -m pytest tests/test_basic.py::test_create_metadata_collection_job_api tests/test_basic.py::test_list_and_get_metadata_collection_jobs_api tests/test_basic.py::test_legacy_metadata_collect_api_uses_job_service -q
```

Expected:

```text
3 passed
```

- [ ] **Step 7: 提交 API 任务**

Run:

```powershell
git add tests/test_basic.py app/api/metadata.py
git commit -m "feat: add metadata collection job api"
```

---

## Task 4: 数据源详情页采集历史与新任务接口

**Files:**
- Modify: `tests/test_basic.py`
- Modify: `app/web/routes.py`
- Modify: `app/web/templates/datasources/detail.html`

- [ ] **Step 1: 添加数据源详情页历史红灯测试**

在 `tests/test_basic.py` 末尾追加：

```python
def test_datasource_detail_shows_collection_jobs(client):
    """测试数据源详情页展示采集历史并调用任务 API"""
    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "详情历史数据源",
            "host": "127.0.0.1",
            "port": 1521,
            "username": "readonly",
            "ds_type": "oracle",
        },
    )
    ds_id = create_resp.json()["id"]
    db = get_session()
    try:
        db.add(
            MetadataCollectionJob(
                datasource_id=ds_id,
                status="success",
                triggered_by="pytest",
                tables_count=5,
                columns_count=20,
                duration_ms=1500,
            )
        )
        db.commit()
    finally:
        db.close()

    resp = client.get(f"/web/datasources/{ds_id}")

    assert resp.status_code == 200
    assert "采集历史" in resp.text
    assert "metadata/jobs/" in resp.text
    assert "/api/metadata/jobs/" in resp.text
    assert "success" in resp.text
    assert "5" in resp.text
    assert "20" in resp.text
```

- [ ] **Step 2: 运行红灯测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_datasource_detail_shows_collection_jobs -q
```

Expected:

```text
failed
```

失败原因应为页面没有“采集历史”或仍调用旧 `/api/metadata/collect/`。

- [ ] **Step 3: 修改 Web 路由加载最近任务**

在 `app/web/routes.py` 模型 import 中加入：

```python
    MetadataCollectionJob,
```

在 `datasource_detail()` 中 `tables = ...` 后加入：

```python
        collection_jobs = (
            db.query(MetadataCollectionJob)
            .filter(MetadataCollectionJob.datasource_id == ds_id)
            .order_by(MetadataCollectionJob.started_at.desc())
            .limit(5)
            .all()
        )
```

并把模板参数改为：

```python
            {"request": request, "ds": ds, "tables": tables, "collection_jobs": collection_jobs},
```

- [ ] **Step 4: 修改数据源详情页按钮调用新 API**

在 `app/web/templates/datasources/detail.html` 的 `collectMetadata()` 中把：

```javascript
        const resp = await fetch('/api/metadata/collect/' + dsId, { method: 'POST' });
```

改为：

```javascript
        const resp = await fetch('/api/metadata/jobs/' + dsId, { method: 'POST' });
```

将成功展示逻辑改为：

```javascript
        if (resp.ok) {
            const status = data.status || 'success';
            const statusText = status === 'partial_success' ? '部分成功' : '采集完成';
            const statusClass = status === 'partial_success' ? 'text-warning' : 'text-success';
            resultEl.innerHTML = '<span class="' + statusClass + ' fw-bold"><i class="bi bi-check-circle-fill"></i> '
                + statusText + '：'
                + (data.tables_count || 0) + ' 张表，'
                + (data.columns_count || 0) + ' 个字段'
                + (data.error_message ? '，' + data.error_message : '')
                + '</span>';
            window.setTimeout(() => window.location.reload(), 1200);
        } else {
```

- [ ] **Step 5: 在数据源详情页添加采集历史区域**

在表列表或空状态区块后、`{% endblock %}` 前加入：

```html
<div class="card shadow-sm mt-3">
    <div class="card-header bg-white d-flex justify-content-between align-items-center">
        <span class="fw-bold"><i class="bi bi-clock-history me-1"></i>采集历史</span>
        <a href="/web/metadata/jobs?datasource_id={{ ds.id }}" class="btn btn-sm btn-outline-primary">查看全部</a>
    </div>
    <div class="card-body p-0">
        {% if collection_jobs %}
        <table class="table table-hover mb-0 small">
            <thead class="table-light">
                <tr>
                    <th>状态</th>
                    <th>开始时间</th>
                    <th>耗时</th>
                    <th>表</th>
                    <th>字段</th>
                    <th>错误</th>
                    <th>详情</th>
                </tr>
            </thead>
            <tbody>
                {% for job in collection_jobs %}
                <tr>
                    <td><span class="badge bg-{{ 'success' if job.status == 'success' else 'warning' if job.status == 'partial_success' else 'danger' if job.status == 'failed' else 'secondary' }}">{{ job.status }}</span></td>
                    <td>{{ job.started_at.strftime('%Y-%m-%d %H:%M') if job.started_at else '-' }}</td>
                    <td>{{ (job.duration_ms ~ ' ms') if job.duration_ms is not none else '-' }}</td>
                    <td>{{ job.tables_count }}</td>
                    <td>{{ job.columns_count }}</td>
                    <td class="text-muted">{{ job.error_message or '-' }}</td>
                    <td><a href="/web/metadata/jobs/{{ job.id }}" class="btn btn-sm btn-outline-primary">查看</a></td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
        {% else %}
        <div class="text-center py-4 text-muted small">暂无采集任务</div>
        {% endif %}
    </div>
</div>
```

- [ ] **Step 6: 运行数据源详情测试确认转绿**

Run:

```powershell
python -m pytest tests/test_basic.py::test_datasource_detail_shows_collection_jobs -q
```

Expected:

```text
1 passed
```

- [ ] **Step 7: 提交数据源详情页任务**

Run:

```powershell
git add tests/test_basic.py app/web/routes.py app/web/templates/datasources/detail.html
git commit -m "feat: show collection history on datasource detail"
```

---

## Task 5: 采集任务中心和任务详情页

**Files:**
- Modify: `tests/test_basic.py`
- Modify: `app/web/routes.py`
- Create: `app/web/templates/metadata/jobs.html`
- Create: `app/web/templates/metadata/job_detail.html`

- [ ] **Step 1: 添加任务中心红灯测试**

在 `tests/test_basic.py` 末尾追加：

```python
def test_metadata_jobs_page_lists_collection_jobs(client):
    """测试采集任务中心展示任务列表"""
    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "任务中心数据源",
            "host": "127.0.0.1",
            "port": 1521,
            "username": "readonly",
            "ds_type": "oracle",
        },
    )
    ds_id = create_resp.json()["id"]
    db = get_session()
    try:
        db.add(
            MetadataCollectionJob(
                datasource_id=ds_id,
                status="partial_success",
                triggered_by="pytest",
                tables_count=7,
                columns_count=30,
                error_message="1 个采集错误",
                error_details="BAD_SCHEMA: 权限不足",
            )
        )
        db.commit()
    finally:
        db.close()

    resp = client.get("/web/metadata/jobs")

    assert resp.status_code == 200
    assert "采集任务中心" in resp.text
    assert "任务中心数据源" in resp.text
    assert "partial_success" in resp.text
    assert "1 个采集错误" in resp.text
```

- [ ] **Step 2: 添加任务详情红灯测试**

继续追加：

```python
def test_metadata_job_detail_page_shows_error_details(client):
    """测试采集任务详情页展示错误明细"""
    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "任务详情数据源",
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
            status="failed",
            triggered_by="pytest",
            tables_count=0,
            columns_count=0,
            error_message="连接失败",
            error_details="DPY-6005: cannot connect",
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
    assert "任务详情数据源" in resp.text
    assert "连接失败" in resp.text
    assert "DPY-6005" in resp.text
```

- [ ] **Step 3: 运行 Web 页面红灯测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_metadata_jobs_page_lists_collection_jobs tests/test_basic.py::test_metadata_job_detail_page_shows_error_details -q
```

Expected:

```text
failed
```

失败原因应为页面 404。

- [ ] **Step 4: 添加 Web 路由**

在 `app/web/routes.py` 的 `metadata_browse()` 前加入：

```python
@router.get("/metadata/jobs", response_class=HTMLResponse)
def metadata_jobs(request: Request, datasource_id: int = None, status: str = None):
    """元数据采集任务中心"""
    db = get_session()
    try:
        q = db.query(MetadataCollectionJob).options(joinedload(MetadataCollectionJob.datasource))
        if datasource_id:
            q = q.filter(MetadataCollectionJob.datasource_id == datasource_id)
        if status:
            q = q.filter(MetadataCollectionJob.status == status)
        jobs = q.order_by(MetadataCollectionJob.started_at.desc()).limit(100).all()
        datasources = db.query(DatasourceConfig).order_by(DatasourceConfig.name).all()
        return templates.TemplateResponse(
            request,
            "metadata/jobs.html",
            {
                "request": request,
                "jobs": jobs,
                "datasources": datasources,
                "current_datasource_id": datasource_id,
                "current_status": status,
            },
        )
    finally:
        db.close()


@router.get("/metadata/jobs/{job_id}", response_class=HTMLResponse)
def metadata_job_detail(request: Request, job_id: int):
    """元数据采集任务详情"""
    db = get_session()
    try:
        job = (
            db.query(MetadataCollectionJob)
            .options(joinedload(MetadataCollectionJob.datasource))
            .filter(MetadataCollectionJob.id == job_id)
            .first()
        )
        if not job:
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url="/web/metadata/jobs")
        return templates.TemplateResponse(request, "metadata/job_detail.html", {"request": request, "job": job})
    finally:
        db.close()
```

放置位置必须在 `/metadata/{table_id}` 之前，避免 `jobs` 被当成 `table_id`。

- [ ] **Step 5: 创建任务中心模板**

创建 `app/web/templates/metadata/jobs.html`：

```html
{% extends "base.html" %}
{% block title %}采集任务中心{% endblock %}

{% block content %}
<div class="page-header d-flex justify-content-between align-items-center">
    <div>
        <h4 class="mb-1"><i class="bi bi-clock-history me-2"></i>采集任务中心</h4>
        <p class="text-muted small mb-0">查看元数据采集任务状态、统计和失败原因</p>
    </div>
    <a href="/web/datasources" class="btn btn-sm btn-primary">去数据源采集</a>
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
                <button class="btn btn-outline-primary btn-sm w-100" type="submit">筛选</button>
            </div>
        </form>
    </div>
</div>

<div class="card shadow-sm">
    <div class="card-body p-0">
        {% if jobs %}
        <table class="table table-hover mb-0 small">
            <thead class="table-light">
                <tr>
                    <th>ID</th>
                    <th>数据源</th>
                    <th>状态</th>
                    <th>开始时间</th>
                    <th>耗时</th>
                    <th>表/字段</th>
                    <th>错误</th>
                    <th>详情</th>
                </tr>
            </thead>
            <tbody>
                {% for job in jobs %}
                <tr>
                    <td>#{{ job.id }}</td>
                    <td>{{ job.datasource.name if job.datasource else '数据源 #' ~ job.datasource_id }}</td>
                    <td><span class="badge bg-{{ 'success' if job.status == 'success' else 'warning' if job.status == 'partial_success' else 'danger' if job.status == 'failed' else 'secondary' }}">{{ job.status }}</span></td>
                    <td>{{ job.started_at.strftime('%Y-%m-%d %H:%M') if job.started_at else '-' }}</td>
                    <td>{{ (job.duration_ms ~ ' ms') if job.duration_ms is not none else '-' }}</td>
                    <td>{{ job.tables_count }} / {{ job.columns_count }}</td>
                    <td class="text-muted">{{ job.error_message or '-' }}</td>
                    <td><a href="/web/metadata/jobs/{{ job.id }}" class="btn btn-sm btn-outline-primary">查看</a></td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
        {% else %}
        <div class="text-center py-5 text-muted">
            <i class="bi bi-clock-history fs-1 d-block mb-3"></i>
            <p>暂无采集任务</p>
            <a href="/web/datasources" class="btn btn-primary btn-sm">去数据源采集</a>
        </div>
        {% endif %}
    </div>
</div>
{% endblock %}
```

- [ ] **Step 6: 创建任务详情模板**

创建 `app/web/templates/metadata/job_detail.html`：

```html
{% extends "base.html" %}
{% block title %}采集任务 #{{ job.id }}{% endblock %}

{% block content %}
<div class="page-header">
    <h4 class="mb-1"><i class="bi bi-clock-history me-2"></i>采集任务详情 #{{ job.id }}</h4>
    <a href="/web/metadata/jobs" class="text-decoration-none small">&larr; 返回采集任务中心</a>
</div>

<div class="row g-3">
    <div class="col-md-7">
        <div class="card shadow-sm">
            <div class="card-header bg-white"><span class="fw-bold">任务信息</span></div>
            <div class="card-body">
                <dl class="row mb-0 small">
                    <dt class="col-sm-3">数据源</dt>
                    <dd class="col-sm-9">{{ job.datasource.name if job.datasource else '数据源 #' ~ job.datasource_id }}</dd>
                    <dt class="col-sm-3">状态</dt>
                    <dd class="col-sm-9">{{ job.status }}</dd>
                    <dt class="col-sm-3">触发人</dt>
                    <dd class="col-sm-9">{{ job.triggered_by or '-' }}</dd>
                    <dt class="col-sm-3">Schema 范围</dt>
                    <dd class="col-sm-9">{{ job.schema_filter or '全部' }}</dd>
                    <dt class="col-sm-3">开始时间</dt>
                    <dd class="col-sm-9">{{ job.started_at.strftime('%Y-%m-%d %H:%M:%S') if job.started_at else '-' }}</dd>
                    <dt class="col-sm-3">结束时间</dt>
                    <dd class="col-sm-9">{{ job.finished_at.strftime('%Y-%m-%d %H:%M:%S') if job.finished_at else '-' }}</dd>
                    <dt class="col-sm-3">耗时</dt>
                    <dd class="col-sm-9">{{ (job.duration_ms ~ ' ms') if job.duration_ms is not none else '-' }}</dd>
                </dl>
            </div>
        </div>
    </div>
    <div class="col-md-5">
        <div class="card shadow-sm">
            <div class="card-header bg-white"><span class="fw-bold">采集统计</span></div>
            <div class="card-body">
                <div class="row text-center">
                    <div class="col-6 mb-3"><div class="stat-number">{{ job.tables_count }}</div><div class="stat-label">表</div></div>
                    <div class="col-6 mb-3"><div class="stat-number">{{ job.columns_count }}</div><div class="stat-label">字段</div></div>
                    <div class="col-6"><div class="stat-number">{{ job.indexes_count }}</div><div class="stat-label">索引</div></div>
                    <div class="col-6"><div class="stat-number">{{ job.constraints_count }}</div><div class="stat-label">约束</div></div>
                </div>
            </div>
        </div>
    </div>
</div>

<div class="card shadow-sm mt-3">
    <div class="card-header bg-white"><span class="fw-bold">错误信息</span></div>
    <div class="card-body">
        <p class="mb-2"><strong>摘要：</strong>{{ job.error_message or '-' }}</p>
        {% if job.error_details %}
        <pre class="bg-light border rounded p-3 small mb-0">{{ job.error_details }}</pre>
        {% else %}
        <p class="text-muted small mb-0">无错误明细</p>
        {% endif %}
    </div>
</div>
{% endblock %}
```

- [ ] **Step 7: 运行页面测试确认转绿**

Run:

```powershell
python -m pytest tests/test_basic.py::test_metadata_jobs_page_lists_collection_jobs tests/test_basic.py::test_metadata_job_detail_page_shows_error_details -q
```

Expected:

```text
2 passed
```

- [ ] **Step 8: 提交任务中心页面**

Run:

```powershell
git add tests/test_basic.py app/web/routes.py app/web/templates/metadata/jobs.html app/web/templates/metadata/job_detail.html
git commit -m "feat: add metadata collection job pages"
```

---

## Task 6: 全量验证和浏览器验收

**Files:**
- No production edits unless verification finds a bug.

- [ ] **Step 1: 运行本轮相关测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_create_metadata_collection_job tests/test_basic.py::test_run_metadata_collection_job_records_success tests/test_basic.py::test_run_metadata_collection_job_records_partial_success tests/test_basic.py::test_run_metadata_collection_job_records_failure tests/test_basic.py::test_create_metadata_collection_job_api tests/test_basic.py::test_list_and_get_metadata_collection_jobs_api tests/test_basic.py::test_legacy_metadata_collect_api_uses_job_service tests/test_basic.py::test_datasource_detail_shows_collection_jobs tests/test_basic.py::test_metadata_jobs_page_lists_collection_jobs tests/test_basic.py::test_metadata_job_detail_page_shows_error_details -q
```

Expected:

```text
10 passed
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

- [ ] **Step 4: 准备浏览器验收数据**

使用 SQLite 创建临时数据源和任务记录：

```python
import sqlite3
conn = sqlite3.connect("data/metricforge.db")
cur = conn.cursor()
cur.execute("DELETE FROM metadata_collection_job WHERE triggered_by = 'codex-browser-check'")
cur.execute("DELETE FROM datasource_config WHERE name = 'Codex_Job_TEMP_DS'")
cur.execute("""
INSERT INTO datasource_config (name, ds_type, host, port, username, dialect, is_active)
VALUES ('Codex_Job_TEMP_DS', 'oracle', '127.0.0.1', 1521, 'readonly', 'oracle', 1)
""")
ds_id = cur.lastrowid
cur.execute("""
INSERT INTO metadata_collection_job (
    datasource_id, status, triggered_by, tables_count, columns_count,
    indexes_count, constraints_count, error_message, error_details, duration_ms
) VALUES (?, 'partial_success', 'codex-browser-check', 4, 16, 2, 3, '1 个采集错误', 'BAD_SCHEMA: 权限不足', 1234)
""", (ds_id,))
job_id = cur.lastrowid
conn.commit()
print({"datasource_id": ds_id, "job_id": job_id})
```

- [ ] **Step 5: 浏览器验收**

打开：

```text
http://localhost:8000/web/datasources/{datasource_id}
```

验收：

- 页面包含“采集历史”。
- 最近任务显示 `partial_success`、`4` 张表、`16` 个字段、`1 个采集错误`。
- 点击“查看”进入 `/web/metadata/jobs/{job_id}`。
- 详情页显示 `采集任务详情`、数据源名、错误摘要和 `BAD_SCHEMA: 权限不足`。
- 打开 `/web/metadata/jobs`，任务中心显示 `Codex_Job_TEMP_DS`。

- [ ] **Step 6: 清理浏览器验收临时数据**

Run:

```python
import sqlite3
conn = sqlite3.connect("data/metricforge.db")
cur = conn.cursor()
cur.execute("DELETE FROM metadata_collection_job WHERE triggered_by = 'codex-browser-check'")
cur.execute("DELETE FROM datasource_config WHERE name = 'Codex_Job_TEMP_DS'")
conn.commit()
print("cleaned")
```

---

## Task 7: 最终提交和推送

**Files:**
- All files changed by this plan.

- [ ] **Step 1: 查看 Git 状态**

Run:

```powershell
git status -sb
```

Expected:

```text
## main...origin/main [ahead N]
```

工作区应干净，所有实施任务均已提交。

- [ ] **Step 2: 最终测试**

Run:

```powershell
python -m pytest tests/ -q
```

Expected:

```text
all tests passed
```

- [ ] **Step 3: 推送到 GitHub**

Run:

```powershell
git push
```

Expected:

```text
main -> main
```

---

## Self-Review Checklist

- Spec coverage:
  - 任务模型：Task 1。
  - 任务服务和状态判定：Task 2。
  - 任务 API 和旧接口兼容：Task 3。
  - 数据源详情页历史与新接口：Task 4。
  - 任务中心和详情页：Task 5。
  - 全量测试与浏览器验收：Task 6。
  - 推送收尾：Task 7。
- Completeness scan:
  - 所有步骤都有明确内容。
- Type consistency:
  - 模型名统一为 `MetadataCollectionJob`。
  - 表名统一为 `metadata_collection_job`。
  - API 前缀统一为 `/api/metadata/jobs`。
  - Web 路由统一为 `/web/metadata/jobs`。
  - 状态值统一为 `running`、`success`、`failed`、`partial_success`。
