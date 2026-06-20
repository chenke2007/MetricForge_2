# 元数据去重与变更检测 Implementation Plan

> **给执行 agent：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐步执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪进度。

**目标：** 让元数据采集可以安全重复执行：保留元数据对象身份、防止重复运行任务、把源端缺失对象标记为下线，并记录结构变更摘要。

**架构：** 扩展现有 SQLAlchemy 模型，加入活跃状态、采集时间和变更统计字段；增加 SQLite 兼容的轻量迁移 helper；再把采集逻辑重构为确定性的 upsert helper。继续沿用当前 FastAPI + BackgroundTasks 流程，在任务创建时复用 running 任务，并在任务详情页展示变更摘要。

**技术栈：** Python 3.12、FastAPI、SQLAlchemy ORM、SQLite、pytest、Jinja 模板、现有 Oracle collector。

---

## 文件结构

- 修改 `app/models/metadata.py`：为表、字段、索引、约束增加活跃状态字段、采集时间字段和唯一索引。
- 修改 `app/models/metadata_job.py`：增加变更统计字段、`change_summary` 和 `collection_mode`。
- 新建 `app/services/schema_migration_service.py`：为已有 SQLite 数据库提供幂等轻量 schema 升级。
- 修改 `app/models/base.py`：在 `Base.metadata.create_all()` 后调用 schema 迁移 helper。
- 修改 `app/services/metadata_job_service.py`：复用 running 任务，并序列化新增任务字段。
- 修改 `app/services/metadata_service.py`：用稳定 upsert 和下线 helper 替换删除重建逻辑。
- 修改 `app/api/metadata.py`：复用已有 running 任务时不重复注册后台执行。
- 修改 `app/web/routes.py`：解析变更摘要供任务详情页渲染。
- 修改 `app/web/templates/metadata/job_detail.html`：渲染变更摘要统计和采样明细。
- 修改 `tests/test_basic.py`：补充模型字段、running 任务复用、字段 ID 稳定、下线标记和变更摘要展示的回归测试。

---

### 任务 1：增加模型字段和唯一索引

**文件：**
- 修改：`app/models/metadata.py`
- 修改：`app/models/metadata_job.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：先写模型字段和索引的失败测试**

Add these tests near the existing model tests in `tests/test_basic.py`:

```python
def test_metadata_models_include_active_state_and_unique_indexes(db_session):
    """元数据模型具备稳定刷新所需字段和唯一索引。"""
    from sqlalchemy import inspect

    inspector = inspect(db_session.bind)

    table_columns = {col["name"] for col in inspector.get_columns("table_metadata")}
    column_columns = {col["name"] for col in inspector.get_columns("column_metadata")}
    index_columns = {col["name"] for col in inspector.get_columns("index_metadata")}
    constraint_columns = {col["name"] for col in inspector.get_columns("constraint_metadata")}

    for columns in (table_columns, column_columns, index_columns, constraint_columns):
        assert {"is_active", "first_collected_at", "last_collected_at", "dropped_at"} <= columns

    table_indexes = inspector.get_indexes("table_metadata")
    column_indexes = inspector.get_indexes("column_metadata")
    index_indexes = inspector.get_indexes("index_metadata")
    constraint_indexes = inspector.get_indexes("constraint_metadata")

    assert any(i["name"] == "ux_table_metadata_identity" and i["unique"] for i in table_indexes)
    assert any(i["name"] == "ux_column_metadata_identity" and i["unique"] for i in column_indexes)
    assert any(i["name"] == "ux_index_metadata_identity" and i["unique"] for i in index_indexes)
    assert any(i["name"] == "ux_constraint_metadata_identity" and i["unique"] for i in constraint_indexes)


def test_metadata_job_model_includes_change_summary_fields(db_session):
    """采集任务模型记录安全刷新模式和变更统计。"""
    from sqlalchemy import inspect

    columns = {col["name"] for col in inspect(db_session.bind).get_columns("metadata_collection_job")}

    assert {
        "collection_mode",
        "reused_running_job",
        "tables_added_count",
        "tables_updated_count",
        "tables_deactivated_count",
        "columns_added_count",
        "columns_updated_count",
        "columns_deactivated_count",
        "columns_type_changed_count",
        "columns_comment_changed_count",
        "indexes_added_count",
        "indexes_deactivated_count",
        "constraints_added_count",
        "constraints_deactivated_count",
        "change_summary",
    } <= columns
```

- [ ] **步骤 2：运行测试，确认先失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_metadata_models_include_active_state_and_unique_indexes tests/test_basic.py::test_metadata_job_model_includes_change_summary_fields -q
```

预期：两个测试失败，因为新字段和唯一索引还不存在。

- [ ] **步骤 3：在 `app/models/metadata.py` 增加字段和索引**

更新导入：

```python
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
```

给 `TableMetadata` 增加 `__table_args__` 和字段：

```python
    __table_args__ = (
        Index("ux_table_metadata_identity", "datasource_id", "schema_name", "table_name", unique=True),
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, comment="源端是否仍存在")
    first_collected_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="首次采集时间")
    last_collected_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="最近采集时间")
    dropped_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="源端下线时间")
```

给 `ColumnMetadata` 增加 `__table_args__` 和字段：

```python
    __table_args__ = (
        Index("ux_column_metadata_identity", "table_id", "column_name", unique=True),
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, comment="源端是否仍存在")
    first_collected_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="首次采集时间")
    last_collected_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="最近采集时间")
    dropped_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="源端下线时间")
```

给 `IndexMetadata` 增加 `__table_args__` 和字段：

```python
    __table_args__ = (
        Index("ux_index_metadata_identity", "table_id", "index_name", unique=True),
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, comment="源端是否仍存在")
    first_collected_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="首次采集时间")
    last_collected_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="最近采集时间")
    dropped_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="源端下线时间")
```

给 `ConstraintMetadata` 增加 `__table_args__` 和字段：

```python
    __table_args__ = (
        Index("ux_constraint_metadata_identity", "table_id", "constraint_name", unique=True),
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, comment="源端是否仍存在")
    first_collected_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="首次采集时间")
    last_collected_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="最近采集时间")
    dropped_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="源端下线时间")
```

- [ ] **步骤 4：在 `app/models/metadata_job.py` 增加任务字段**

在 `error_message` 前增加字段：

```python
    collection_mode: Mapped[str] = mapped_column(String(30), nullable=False, default="safe_refresh", comment="采集模式")
    reused_running_job: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否复用运行中任务")
    tables_added_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="新增表数量")
    tables_updated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="更新表数量")
    tables_deactivated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="下线表数量")
    columns_added_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="新增字段数量")
    columns_updated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="更新字段数量")
    columns_deactivated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="下线字段数量")
    columns_type_changed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="字段类型变化数量")
    columns_comment_changed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="字段注释变化数量")
    indexes_added_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="新增索引数量")
    indexes_deactivated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="下线索引数量")
    constraints_added_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="新增约束数量")
    constraints_deactivated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="下线约束数量")
    change_summary: Mapped[str] = mapped_column(Text, nullable=True, comment="变更摘要 JSON")
```

同时导入 `Boolean`：

```python
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
```

- [ ] **步骤 5：运行测试，确认模型任务通过**

运行：

```powershell
python -m pytest tests/test_basic.py::test_metadata_models_include_active_state_and_unique_indexes tests/test_basic.py::test_metadata_job_model_includes_change_summary_fields -q
```

预期：`2 passed`。

- [ ] **步骤 6：提交**

```powershell
git add app/models/metadata.py app/models/metadata_job.py tests/test_basic.py
git commit -m "feat: add metadata refresh identity fields"
```

---

### 任务 2：增加轻量 schema 迁移

**文件：**
- 新建：`app/services/schema_migration_service.py`
- 修改：`app/models/base.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：先写迁移失败测试**

Add tests:

```python
def test_init_tables_adds_metadata_refresh_columns_to_existing_database(tmp_path):
    """已有 SQLite 库初始化时会补齐稳定刷新字段。"""
    from sqlalchemy import create_engine, inspect, text

    from app.models import init_db, init_tables

    db_path = tmp_path / "legacy.db"
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE table_metadata (
                id INTEGER PRIMARY KEY,
                datasource_id INTEGER NOT NULL,
                schema_name VARCHAR(100) NOT NULL,
                table_name VARCHAR(200) NOT NULL,
                table_comment TEXT,
                table_type VARCHAR(50),
                row_count_est INTEGER,
                last_analyzed_at DATETIME,
                avg_row_len INTEGER,
                num_blocks INTEGER,
                is_sensitive BOOLEAN,
                collected_at DATETIME
            )
        """))
    engine.dispose()

    init_db(f"sqlite:///{db_path}")
    init_tables()

    columns = {col["name"] for col in inspect(create_engine(f"sqlite:///{db_path}")).get_columns("table_metadata")}
    assert {"is_active", "first_collected_at", "last_collected_at", "dropped_at"} <= columns


def test_schema_migration_creates_unique_indexes_on_existing_database(tmp_path):
    """已有 SQLite 库初始化时会创建自然键唯一索引。"""
    from sqlalchemy import create_engine, inspect, text

    from app.models import init_db, init_tables

    db_path = tmp_path / "legacy-index.db"
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE column_metadata (
                id INTEGER PRIMARY KEY,
                table_id INTEGER NOT NULL,
                column_name VARCHAR(200) NOT NULL,
                column_type VARCHAR(100) NOT NULL
            )
        """))
    engine.dispose()

    init_db(f"sqlite:///{db_path}")
    init_tables()

    indexes = inspect(create_engine(f"sqlite:///{db_path}")).get_indexes("column_metadata")
    assert any(i["name"] == "ux_column_metadata_identity" and i["unique"] for i in indexes)
```

- [ ] **步骤 2：运行测试，确认先失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_init_tables_adds_metadata_refresh_columns_to_existing_database tests/test_basic.py::test_schema_migration_creates_unique_indexes_on_existing_database -q
```

预期：失败，因为当前 `init_tables()` 只执行 `create_all()`。

- [ ] **步骤 3：创建迁移 helper**

创建 `app/services/schema_migration_service.py`：

```python
"""Lightweight schema migrations for local SQLite databases."""

from sqlalchemy import inspect, text


METADATA_COLUMNS = {
    "table_metadata": [
        ("is_active", "BOOLEAN NOT NULL DEFAULT 1"),
        ("first_collected_at", "DATETIME"),
        ("last_collected_at", "DATETIME"),
        ("dropped_at", "DATETIME"),
    ],
    "column_metadata": [
        ("is_active", "BOOLEAN NOT NULL DEFAULT 1"),
        ("first_collected_at", "DATETIME"),
        ("last_collected_at", "DATETIME"),
        ("dropped_at", "DATETIME"),
    ],
    "index_metadata": [
        ("is_active", "BOOLEAN NOT NULL DEFAULT 1"),
        ("first_collected_at", "DATETIME"),
        ("last_collected_at", "DATETIME"),
        ("dropped_at", "DATETIME"),
    ],
    "constraint_metadata": [
        ("is_active", "BOOLEAN NOT NULL DEFAULT 1"),
        ("first_collected_at", "DATETIME"),
        ("last_collected_at", "DATETIME"),
        ("dropped_at", "DATETIME"),
    ],
    "metadata_collection_job": [
        ("collection_mode", "VARCHAR(30) NOT NULL DEFAULT 'safe_refresh'"),
        ("reused_running_job", "BOOLEAN NOT NULL DEFAULT 0"),
        ("tables_added_count", "INTEGER NOT NULL DEFAULT 0"),
        ("tables_updated_count", "INTEGER NOT NULL DEFAULT 0"),
        ("tables_deactivated_count", "INTEGER NOT NULL DEFAULT 0"),
        ("columns_added_count", "INTEGER NOT NULL DEFAULT 0"),
        ("columns_updated_count", "INTEGER NOT NULL DEFAULT 0"),
        ("columns_deactivated_count", "INTEGER NOT NULL DEFAULT 0"),
        ("columns_type_changed_count", "INTEGER NOT NULL DEFAULT 0"),
        ("columns_comment_changed_count", "INTEGER NOT NULL DEFAULT 0"),
        ("indexes_added_count", "INTEGER NOT NULL DEFAULT 0"),
        ("indexes_deactivated_count", "INTEGER NOT NULL DEFAULT 0"),
        ("constraints_added_count", "INTEGER NOT NULL DEFAULT 0"),
        ("constraints_deactivated_count", "INTEGER NOT NULL DEFAULT 0"),
        ("change_summary", "TEXT"),
    ],
}


UNIQUE_INDEXES = {
    "ux_table_metadata_identity": ("table_metadata", ["datasource_id", "schema_name", "table_name"]),
    "ux_column_metadata_identity": ("column_metadata", ["table_id", "column_name"]),
    "ux_index_metadata_identity": ("index_metadata", ["table_id", "index_name"]),
    "ux_constraint_metadata_identity": ("constraint_metadata", ["table_id", "constraint_name"]),
}


def ensure_sqlite_schema(engine) -> None:
    """Add columns and indexes missing from existing SQLite databases."""
    if engine.dialect.name != "sqlite":
        return

    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table_name, columns in METADATA_COLUMNS.items():
            if table_name not in table_names:
                continue
            existing_columns = {col["name"] for col in inspector.get_columns(table_name)}
            for column_name, ddl in columns:
                if column_name not in existing_columns:
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"))

        inspector = inspect(engine)
        for index_name, (table_name, column_names) in UNIQUE_INDEXES.items():
            if table_name not in table_names:
                continue
            existing_indexes = {idx["name"] for idx in inspector.get_indexes(table_name)}
            existing_columns = {col["name"] for col in inspector.get_columns(table_name)}
            if index_name in existing_indexes:
                continue
            if not set(column_names).issubset(existing_columns):
                continue
            joined = ", ".join(column_names)
            conn.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON {table_name} ({joined})"))
```

- [ ] **步骤 4：在 create_all 后调用迁移**

修改 `app/models/base.py`：

```python
def init_tables():
    """创建所有表（基于 Base 的元数据），并补齐轻量迁移。"""
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    from app.services.schema_migration_service import ensure_sqlite_schema

    ensure_sqlite_schema(engine)
```

- [ ] **步骤 5：运行迁移测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_init_tables_adds_metadata_refresh_columns_to_existing_database tests/test_basic.py::test_schema_migration_creates_unique_indexes_on_existing_database -q
```

预期：`2 passed`。

- [ ] **步骤 6：提交**

```powershell
git add app/models/base.py app/services/schema_migration_service.py tests/test_basic.py
git commit -m "feat: migrate metadata refresh schema"
```

---

### 任务 3：序列化任务变更字段并复用 running 任务

**文件：**
- 修改：`app/services/metadata_job_service.py`
- 修改：`app/api/metadata.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：先写失败测试**

Add tests:

```python
def test_create_metadata_collection_job_reuses_running_job(app):
    """同一数据源已有 running 任务时复用已有任务。"""
    db = get_session()
    try:
        ds = DatasourceConfig(
            name="reuse running datasource",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.flush()
        running = MetadataCollectionJob(
            datasource_id=ds.id,
            status="running",
            triggered_by="pytest",
            schema_filter="DWHRPT",
        )
        db.add(running)
        db.commit()
        db.refresh(running)

        from app.services.metadata_job_service import create_metadata_collection_job

        job = create_metadata_collection_job(ds.id, triggered_by="web")

        assert job["id"] == running.id
        assert job["status"] == "running"
        assert job["reused_running_job"] is True
    finally:
        db.close()


def test_create_collection_job_api_does_not_schedule_reused_running_job(client, monkeypatch):
    """API 复用 running 任务时不重复注册后台任务。"""
    from app.api import metadata as metadata_api

    scheduled = []

    def fake_create_metadata_collection_job(datasource_id, triggered_by="web"):
        return {
            "id": 55,
            "datasource_id": datasource_id,
            "status": "running",
            "reused_running_job": True,
            "collection_mode": "safe_refresh",
        }

    class FakeBackgroundTasks:
        def add_task(self, func, *args, **kwargs):
            scheduled.append((func, args, kwargs))

    monkeypatch.setattr(metadata_api, "create_metadata_collection_job", fake_create_metadata_collection_job)

    resp = metadata_api.create_collection_job(1, background_tasks=FakeBackgroundTasks())

    assert resp["id"] == 55
    assert scheduled == []
```

- [ ] **步骤 2：运行测试，确认先失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_create_metadata_collection_job_reuses_running_job tests/test_basic.py::test_create_collection_job_api_does_not_schedule_reused_running_job -q
```

预期：失败，因为 running 任务尚未复用，API 仍会总是注册后台执行。

- [ ] **步骤 3：更新序列化函数**

In `serialize_collection_job()`, add:

```python
        "collection_mode": job.collection_mode,
        "reused_running_job": job.reused_running_job,
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
```

- [ ] **步骤 4：复用 running 任务**

Modify `create_metadata_collection_job()`:

```python
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
            collection_mode="safe_refresh",
            reused_running_job=False,
            started_at=_utc_now(),
        )
```

- [ ] **步骤 5：避免重复后台调度**

修改 `app/api/metadata.py` 中的 `create_collection_job()`：

```python
        job = create_metadata_collection_job(datasource_id)
        if not job.get("reused_running_job"):
            background_tasks.add_task(execute_metadata_collection_job, job["id"])
        return job
```

- [ ] **步骤 6：运行测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_create_metadata_collection_job_reuses_running_job tests/test_basic.py::test_create_collection_job_api_does_not_schedule_reused_running_job tests/test_basic.py::test_create_metadata_collection_job_api_returns_running_and_schedules_background -q
```

预期：`3 passed`。

- [ ] **步骤 7：提交**

```powershell
git add app/services/metadata_job_service.py app/api/metadata.py tests/test_basic.py
git commit -m "feat: reuse running metadata jobs"
```

---

### 任务 4：增加变更摘要 helper 和任务统计映射

**文件：**
- 修改：`app/services/metadata_service.py`
- 修改：`app/services/metadata_job_service.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：先写任务统计映射失败测试**

Add:

```python
def test_execute_metadata_collection_job_records_change_counts(app, monkeypatch):
    """任务执行完成后写入变更统计和摘要。"""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="change stats datasource",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.flush()
        job_record = MetadataCollectionJob(datasource_id=ds.id, status="running", triggered_by="pytest")
        db.add(job_record)
        db.commit()
        db.refresh(job_record)

        def fake_collect_metadata(datasource_id):
            return {
                "success": True,
                "stats": {
                    "schemas": 1,
                    "tables": 1,
                    "columns": 2,
                    "indexes": 0,
                    "constraints": 0,
                    "errors": [],
                    "changes": {
                        "tables_added": 1,
                        "tables_updated": 0,
                        "tables_deactivated": 0,
                        "columns_added": 2,
                        "columns_updated": 0,
                        "columns_deactivated": 0,
                        "columns_type_changed": 0,
                        "columns_comment_changed": 0,
                        "indexes_added": 0,
                        "indexes_deactivated": 0,
                        "constraints_added": 0,
                        "constraints_deactivated": 0,
                        "samples": [{"kind": "column_added", "path": "DWHRPT.T_ORDER.ORDER_ID"}],
                    },
                },
            }

        monkeypatch.setattr(metadata_job_service, "collect_metadata", fake_collect_metadata)

        job = metadata_job_service.execute_metadata_collection_job(job_record.id)

        assert job["tables_added_count"] == 1
        assert job["columns_added_count"] == 2
        assert "DWHRPT.T_ORDER.ORDER_ID" in job["change_summary"]
    finally:
        db.close()
```

- [ ] **步骤 2：运行测试，确认先失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_execute_metadata_collection_job_records_change_counts -q
```

预期：失败，因为变更字段尚未映射到任务记录。

- [ ] **步骤 3：在 `metadata_service.py` 增加统计工厂**

在文件靠前位置增加：

```python
def _empty_change_stats() -> dict:
    return {
        "tables_added": 0,
        "tables_updated": 0,
        "tables_deactivated": 0,
        "columns_added": 0,
        "columns_updated": 0,
        "columns_deactivated": 0,
        "columns_type_changed": 0,
        "columns_comment_changed": 0,
        "indexes_added": 0,
        "indexes_deactivated": 0,
        "constraints_added": 0,
        "constraints_deactivated": 0,
        "samples": [],
    }


def _add_change_sample(changes: dict, kind: str, path: str) -> None:
    if len(changes["samples"]) >= 50:
        return
    changes["samples"].append({"kind": kind, "path": path})
```

初始化 `stats` 时增加：

```python
            "changes": _empty_change_stats(),
```

- [ ] **步骤 4：在任务服务中映射变更统计**

导入 JSON：

```python
import json
```

在 `execute_metadata_collection_job()` 设置基础计数后增加：

```python
            changes = stats.get("changes") or {}
            job.tables_added_count = changes.get("tables_added", 0) or 0
            job.tables_updated_count = changes.get("tables_updated", 0) or 0
            job.tables_deactivated_count = changes.get("tables_deactivated", 0) or 0
            job.columns_added_count = changes.get("columns_added", 0) or 0
            job.columns_updated_count = changes.get("columns_updated", 0) or 0
            job.columns_deactivated_count = changes.get("columns_deactivated", 0) or 0
            job.columns_type_changed_count = changes.get("columns_type_changed", 0) or 0
            job.columns_comment_changed_count = changes.get("columns_comment_changed", 0) or 0
            job.indexes_added_count = changes.get("indexes_added", 0) or 0
            job.indexes_deactivated_count = changes.get("indexes_deactivated", 0) or 0
            job.constraints_added_count = changes.get("constraints_added", 0) or 0
            job.constraints_deactivated_count = changes.get("constraints_deactivated", 0) or 0
            job.change_summary = json.dumps(changes, ensure_ascii=False) if changes else None
```

- [ ] **步骤 5：运行测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_execute_metadata_collection_job_records_change_counts -q
```

预期：`1 passed`。

- [ ] **步骤 6：提交**

```powershell
git add app/services/metadata_service.py app/services/metadata_job_service.py tests/test_basic.py
git commit -m "feat: record metadata collection changes"
```

---

### 任务 5：把表和字段采集重构为稳定 upsert

**文件：**
- 修改：`app/services/metadata_service.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：先写表和字段 ID 稳定性的失败测试**

Add:

```python
def test_collect_metadata_reuses_existing_table_and_column_ids(app, monkeypatch):
    """重复采集同一字段时字段 ID 保持稳定。"""
    from app.adapters.metadata_collector import ColumnInfo, TableInfo
    from app.services import metadata_service

    class FakeAdapter:
        def close(self):
            pass

    class StableCollector:
        def __init__(self, adapter, config):
            pass

        def collect_tables(self, schema):
            return [TableInfo(schema_name=schema, table_name="T_ORDER", table_comment="订单表")]

        def collect_columns(self, schema, table):
            return [ColumnInfo(column_name="ORDER_ID", column_type="NUMBER(18,0)", comment="订单 ID", column_id=1)]

        def collect_indexes(self, schema, table):
            return []

        def collect_constraints(self, schema, table):
            return []

    monkeypatch.setattr(metadata_service, "get_adapter_for_datasource", lambda ds_id: FakeAdapter())
    monkeypatch.setattr(metadata_service, "OracleMetadataCollector", StableCollector)

    first = metadata_service.collect_metadata(1, schemas=["DWHRPT"])
    db = get_session()
    try:
        column = db.query(ColumnMetadata).one()
        first_column_id = column.id
    finally:
        db.close()

    second = metadata_service.collect_metadata(1, schemas=["DWHRPT"])
    db = get_session()
    try:
        columns = db.query(ColumnMetadata).all()
        tables = db.query(TableMetadata).all()
        assert len(tables) == 1
        assert len(columns) == 1
        assert columns[0].id == first_column_id
        assert columns[0].comment == "订单 ID"
    finally:
        db.close()

    assert first["stats"]["changes"]["columns_added"] == 1
    assert second["stats"]["changes"]["columns_added"] == 0
```

- [ ] **步骤 2：运行测试，确认先失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_collect_metadata_reuses_existing_table_and_column_ids -q
```

预期：失败，因为当前代码会删除并重新插入字段。

- [ ] **步骤 3：增加 upsert helper**

在 `metadata_service.py` 中增加 helper：

```python
def _touch_active(record, now: datetime) -> None:
    if getattr(record, "first_collected_at", None) is None:
        record.first_collected_at = now
    record.last_collected_at = now
    record.collected_at = now if hasattr(record, "collected_at") else getattr(record, "collected_at", None)
    record.is_active = True
    record.dropped_at = None


def _upsert_table(db, ds_id: int, schema: str, table_info, now: datetime, changes: dict):
    table = (
        db.query(TableMetadata)
        .filter(
            TableMetadata.datasource_id == ds_id,
            TableMetadata.schema_name == schema,
            TableMetadata.table_name == table_info.table_name,
        )
        .first()
    )
    if table is None:
        table = TableMetadata(datasource_id=ds_id, schema_name=schema, table_name=table_info.table_name)
        db.add(table)
        changes["tables_added"] += 1
        _add_change_sample(changes, "table_added", f"{schema}.{table_info.table_name}")
    elif (
        table.table_comment != table_info.table_comment
        or table.table_type != table_info.table_type
        or table.row_count_est != table_info.row_count_est
    ):
        changes["tables_updated"] += 1
        _add_change_sample(changes, "table_updated", f"{schema}.{table_info.table_name}")

    table.table_type = table_info.table_type
    table.table_comment = table_info.table_comment
    table.row_count_est = table_info.row_count_est
    table.last_analyzed_at = table_info.last_analyzed_at
    table.avg_row_len = table_info.avg_row_len
    table.num_blocks = table_info.num_blocks
    _touch_active(table, now)
    db.flush()
    return table
```

增加字段 helper：

```python
def _upsert_columns(db, table, column_infos, now: datetime, changes: dict) -> int:
    seen = set()
    count = 0
    existing = {col.column_name: col for col in db.query(ColumnMetadata).filter(ColumnMetadata.table_id == table.id).all()}

    for col_info in column_infos:
        seen.add(col_info.column_name)
        count += 1
        column = existing.get(col_info.column_name)
        path = f"{table.schema_name}.{table.table_name}.{col_info.column_name}"
        if column is None:
            column = ColumnMetadata(table_id=table.id, column_name=col_info.column_name, column_type=col_info.column_type)
            db.add(column)
            changes["columns_added"] += 1
            _add_change_sample(changes, "column_added", path)
        else:
            changed = False
            if column.column_type != col_info.column_type:
                changes["columns_type_changed"] += 1
                _add_change_sample(changes, "column_type_changed", path)
                changed = True
            if (column.comment or "") != (col_info.comment or ""):
                changes["columns_comment_changed"] += 1
                _add_change_sample(changes, "column_comment_changed", path)
                changed = True
            if changed:
                changes["columns_updated"] += 1

        column.column_type = col_info.column_type
        column.data_length = col_info.data_length
        column.nullable = col_info.nullable
        column.column_id = col_info.column_id
        column.default_value = col_info.default_value
        column.comment = col_info.comment
        column.is_primary_key = col_info.is_primary_key
        column.is_unique_key = col_info.is_unique_key
        column.is_foreign_key = col_info.is_foreign_key
        _touch_active(column, now)

    for column_name, column in existing.items():
        if column_name in seen or not column.is_active:
            continue
        column.is_active = False
        column.dropped_at = now
        changes["columns_deactivated"] += 1
        _add_change_sample(changes, "column_deactivated", f"{table.schema_name}.{table.table_name}.{column_name}")

    return count
```

- [ ] **步骤 4：在 `collect_metadata()` 中使用 helper**

在表循环内部，用下面代码替换现有表创建/更新和字段删除重建逻辑：

```python
                    table = _upsert_table(db, ds_id, schema, table_info, now, stats["changes"])

                    columns = collector.collect_columns(schema, table_info.table_name)
                    schema_stats["columns"] += _upsert_columns(db, table, columns, now, stats["changes"])
```

在每个 schema 的 try-block 开头设置 `now`：

```python
                now = datetime.utcnow()
```

- [ ] **步骤 5：运行定向测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_collect_metadata_reuses_existing_table_and_column_ids tests/test_basic.py::test_save_field_semantic_closes_related_ticket -q
```

预期：`2 passed`。

- [ ] **步骤 6：提交**

```powershell
git add app/services/metadata_service.py tests/test_basic.py
git commit -m "feat: upsert table and column metadata"
```

---

### 任务 6：下线缺失表字段并保留字段语义

**文件：**
- 修改：`app/services/metadata_service.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：先写失败测试**

Add:

```python
def test_collect_metadata_deactivates_missing_column_and_preserves_semantic(app, monkeypatch):
    """源端缺失字段会下线，但字段语义仍保留。"""
    from app.adapters.metadata_collector import ColumnInfo, TableInfo
    from app.services import metadata_service

    class FakeAdapter:
        def close(self):
            pass

    calls = {"count": 0}

    class ChangingCollector:
        def __init__(self, adapter, config):
            pass

        def collect_tables(self, schema):
            return [TableInfo(schema_name=schema, table_name="T_ORDER")]

        def collect_columns(self, schema, table):
            calls["count"] += 1
            if calls["count"] == 1:
                return [
                    ColumnInfo(column_name="ORDER_ID", column_type="NUMBER", column_id=1),
                    ColumnInfo(column_name="OLD_CODE", column_type="VARCHAR2(20)", column_id=2),
                ]
            return [ColumnInfo(column_name="ORDER_ID", column_type="NUMBER", column_id=1)]

        def collect_indexes(self, schema, table):
            return []

        def collect_constraints(self, schema, table):
            return []

    monkeypatch.setattr(metadata_service, "get_adapter_for_datasource", lambda ds_id: FakeAdapter())
    monkeypatch.setattr(metadata_service, "OracleMetadataCollector", ChangingCollector)

    metadata_service.collect_metadata(1, schemas=["DWHRPT"])
    db = get_session()
    try:
        old_col = db.query(ColumnMetadata).filter(ColumnMetadata.column_name == "OLD_CODE").one()
        db.add(FieldSemantic(column_id=old_col.id, business_alias="旧编码", business_meaning="历史字段"))
        db.commit()
        old_col_id = old_col.id
    finally:
        db.close()

    result = metadata_service.collect_metadata(1, schemas=["DWHRPT"])

    db = get_session()
    try:
        old_col = db.query(ColumnMetadata).filter(ColumnMetadata.id == old_col_id).one()
        semantic = db.query(FieldSemantic).filter(FieldSemantic.column_id == old_col_id).one()
        assert old_col.is_active is False
        assert old_col.dropped_at is not None
        assert semantic.business_alias == "旧编码"
    finally:
        db.close()

    assert result["stats"]["changes"]["columns_deactivated"] == 1
```

- [ ] **步骤 2：运行测试，确认先失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_collect_metadata_deactivates_missing_column_and_preserves_semantic -q
```

预期：失败，直到下线逻辑接入。

- [ ] **步骤 3：增加表下线 helper**

Add:

```python
def _deactivate_missing_tables(db, ds_id: int, schema: str, seen_table_names: set[str], now: datetime, changes: dict) -> None:
    active_tables = (
        db.query(TableMetadata)
        .filter(
            TableMetadata.datasource_id == ds_id,
            TableMetadata.schema_name == schema,
            TableMetadata.is_active.is_(True),
        )
        .all()
    )
    for table in active_tables:
        if table.table_name in seen_table_names:
            continue
        table.is_active = False
        table.dropped_at = now
        changes["tables_deactivated"] += 1
        _add_change_sample(changes, "table_deactivated", f"{schema}.{table.table_name}")
```

在 schema 循环末尾，所有表处理完成后、`db.commit()` 前增加：

```python
                _deactivate_missing_tables(
                    db,
                    ds_id,
                    schema,
                    {table_info.table_name for table_info in tables},
                    now,
                    stats["changes"],
                )
```

- [ ] **步骤 4：运行测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_collect_metadata_deactivates_missing_column_and_preserves_semantic -q
```

预期：`1 passed`。

- [ ] **步骤 5：提交**

```powershell
git add app/services/metadata_service.py tests/test_basic.py
git commit -m "feat: deactivate missing metadata objects"
```

---

### 任务 7：稳定 upsert 索引和约束

**文件：**
- 修改：`app/services/metadata_service.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：先写失败测试**

Add:

```python
def test_collect_metadata_upserts_indexes_and_constraints(app, monkeypatch):
    """索引和约束重复采集不会重复插入，缺失时会下线。"""
    from app.adapters.metadata_collector import ColumnInfo, ConstraintInfo, IndexInfo, TableInfo
    from app.services import metadata_service

    class FakeAdapter:
        def close(self):
            pass

    calls = {"count": 0}

    class ChangingCollector:
        def __init__(self, adapter, config):
            pass

        def collect_tables(self, schema):
            return [TableInfo(schema_name=schema, table_name="T_ORDER")]

        def collect_columns(self, schema, table):
            return [ColumnInfo(column_name="ORDER_ID", column_type="NUMBER", column_id=1)]

        def collect_indexes(self, schema, table):
            calls["count"] += 1
            if calls["count"] == 1:
                return [IndexInfo(index_name="IDX_ORDER_ID", index_type="NORMAL", column_names="ORDER_ID")]
            return []

        def collect_constraints(self, schema, table):
            if calls["count"] == 1:
                return [ConstraintInfo(constraint_name="PK_ORDER", constraint_type="P", column_names="ORDER_ID")]
            return []

    monkeypatch.setattr(metadata_service, "get_adapter_for_datasource", lambda ds_id: FakeAdapter())
    monkeypatch.setattr(metadata_service, "OracleMetadataCollector", ChangingCollector)

    first = metadata_service.collect_metadata(1, schemas=["DWHRPT"])
    second = metadata_service.collect_metadata(1, schemas=["DWHRPT"])

    db = get_session()
    try:
        indexes = db.query(IndexMetadata).all()
        constraints = db.query(ConstraintMetadata).all()
        assert len(indexes) == 1
        assert len(constraints) == 1
        assert indexes[0].is_active is False
        assert constraints[0].is_active is False
    finally:
        db.close()

    assert first["stats"]["changes"]["indexes_added"] == 1
    assert first["stats"]["changes"]["constraints_added"] == 1
    assert second["stats"]["changes"]["indexes_deactivated"] == 1
    assert second["stats"]["changes"]["constraints_deactivated"] == 1
```

- [ ] **步骤 2：运行测试，确认先失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_collect_metadata_upserts_indexes_and_constraints -q
```

预期：失败，因为当前代码会删除索引和约束后重新插入。

- [ ] **步骤 3：增加共享下线 helper**

Add:

```python
def _mark_missing_inactive(existing_by_name: dict, seen_names: set[str], now: datetime, changes: dict, counter: str, kind: str, prefix: str) -> None:
    for name, record in existing_by_name.items():
        if name in seen_names or not record.is_active:
            continue
        record.is_active = False
        record.dropped_at = now
        changes[counter] += 1
        _add_change_sample(changes, kind, f"{prefix}.{name}")
```

- [ ] **步骤 4：增加索引和约束 upsert helper**

Add:

```python
def _upsert_indexes(db, table, index_infos, now: datetime, changes: dict) -> int:
    existing = {idx.index_name: idx for idx in db.query(IndexMetadata).filter(IndexMetadata.table_id == table.id).all()}
    seen = set()
    for idx_info in index_infos:
        seen.add(idx_info.index_name)
        index = existing.get(idx_info.index_name)
        if index is None:
            index = IndexMetadata(table_id=table.id, index_name=idx_info.index_name)
            db.add(index)
            changes["indexes_added"] += 1
            _add_change_sample(changes, "index_added", f"{table.schema_name}.{table.table_name}.{idx_info.index_name}")
        index.index_type = idx_info.index_type
        index.column_names = idx_info.column_names
        _touch_active(index, now)
    _mark_missing_inactive(existing, seen, now, changes, "indexes_deactivated", "index_deactivated", f"{table.schema_name}.{table.table_name}")
    return len(index_infos)


def _upsert_constraints(db, table, constraint_infos, now: datetime, changes: dict) -> int:
    existing = {con.constraint_name: con for con in db.query(ConstraintMetadata).filter(ConstraintMetadata.table_id == table.id).all()}
    seen = set()
    for con_info in constraint_infos:
        seen.add(con_info.constraint_name)
        constraint = existing.get(con_info.constraint_name)
        if constraint is None:
            constraint = ConstraintMetadata(table_id=table.id, constraint_name=con_info.constraint_name)
            db.add(constraint)
            changes["constraints_added"] += 1
            _add_change_sample(changes, "constraint_added", f"{table.schema_name}.{table.table_name}.{con_info.constraint_name}")
        constraint.constraint_type = con_info.constraint_type
        constraint.column_names = con_info.column_names
        constraint.ref_table = con_info.ref_table
        constraint.ref_columns = con_info.ref_columns
        _touch_active(constraint, now)
    _mark_missing_inactive(existing, seen, now, changes, "constraints_deactivated", "constraint_deactivated", f"{table.schema_name}.{table.table_name}")
    return len(constraint_infos)
```

- [ ] **步骤 5：替换删除重建逻辑**

替换索引处理块：

```python
                    indexes = collector.collect_indexes(schema, table_info.table_name)
                    schema_stats["indexes"] += _upsert_indexes(db, table, indexes, now, stats["changes"])
```

替换约束处理块：

```python
                    constraints = collector.collect_constraints(schema, table_info.table_name)
                    schema_stats["constraints"] += _upsert_constraints(db, table, constraints, now, stats["changes"])
```

- [ ] **步骤 6：运行测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_collect_metadata_upserts_indexes_and_constraints -q
```

预期：`1 passed`。

- [ ] **步骤 7：提交**

```powershell
git add app/services/metadata_service.py tests/test_basic.py
git commit -m "feat: upsert index and constraint metadata"
```

---

### 任务 8：缺失语义检测只扫描 active 字段

**文件：**
- 修改：`app/services/metadata_service.py`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：先写失败测试**

Add:

```python
def test_detect_missing_semantics_ignores_inactive_columns(app):
    """缺失语义检测只为 active 字段创建待办。"""
    from app.services.metadata_service import _detect_missing_semantics

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="inactive semantic datasource",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.flush()
        table = TableMetadata(datasource_id=ds.id, schema_name="DWHRPT", table_name="T_ORDER", is_active=True)
        db.add(table)
        db.flush()
        active_col = ColumnMetadata(table_id=table.id, column_name="ORDER_ID", column_type="NUMBER", is_active=True)
        inactive_col = ColumnMetadata(table_id=table.id, column_name="OLD_CODE", column_type="VARCHAR2(20)", is_active=False)
        db.add_all([active_col, inactive_col])
        db.commit()

        _detect_missing_semantics(db, ds.id)
        db.commit()

        tickets = db.query(GovernanceTicket).order_by(GovernanceTicket.title).all()
        assert len(tickets) == 1
        assert tickets[0].related_object_id == active_col.id
    finally:
        db.close()
```

- [ ] **步骤 2：运行测试，确认先失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_detect_missing_semantics_ignores_inactive_columns -q
```

预期：失败，因为 inactive 字段仍会被扫描。

- [ ] **步骤 3：过滤 active 表和 active 字段**

修改 `_detect_missing_semantics()` 查询：

```python
    columns = (
        db.query(ColumnMetadata)
        .join(TableMetadata)
        .filter(
            TableMetadata.datasource_id == ds_id,
            TableMetadata.is_active.is_(True),
            ColumnMetadata.is_active.is_(True),
        )
        .all()
    )
```

- [ ] **步骤 4：运行测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_detect_missing_semantics_ignores_inactive_columns -q
```

预期：`1 passed`。

- [ ] **步骤 5：提交**

```powershell
git add app/services/metadata_service.py tests/test_basic.py
git commit -m "fix: detect semantics for active columns only"
```

---

### 任务 9：在 API 和任务详情页展示变更摘要

**文件：**
- 修改：`app/web/routes.py`
- 修改：`app/web/templates/metadata/job_detail.html`
- 测试：`tests/test_basic.py`

- [ ] **步骤 1：先写页面失败测试**

Add:

```python
def test_metadata_job_detail_page_shows_change_summary(client):
    """任务详情页展示变更摘要统计。"""
    import json

    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "变更摘要数据源",
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
            status="success",
            triggered_by="pytest",
            tables_count=1,
            columns_count=2,
            tables_added_count=1,
            columns_added_count=2,
            columns_type_changed_count=1,
            change_summary=json.dumps(
                {"samples": [{"kind": "column_type_changed", "path": "DWHRPT.T_ORDER.ORDER_ID"}]},
                ensure_ascii=False,
            ),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.id
    finally:
        db.close()

    resp = client.get(f"/web/metadata/jobs/{job_id}")

    assert resp.status_code == 200
    assert "变更摘要" in resp.text
    assert "新增表" in resp.text
    assert "新增字段" in resp.text
    assert "类型变化" in resp.text
    assert "DWHRPT.T_ORDER.ORDER_ID" in resp.text
```

- [ ] **步骤 2：运行测试，确认先失败**

运行：

```powershell
python -m pytest tests/test_basic.py::test_metadata_job_detail_page_shows_change_summary -q
```

预期：失败，因为模板还没有渲染变更摘要。

- [ ] **步骤 3：在路由中解析变更摘要**

在 `app/web/routes.py` 中导入 JSON：

```python
import json
```

在元数据任务详情路由中，取得 `job` 后增加：

```python
        change_summary = {}
        if job.change_summary:
            try:
                change_summary = json.loads(job.change_summary)
            except json.JSONDecodeError:
                change_summary = {"raw": job.change_summary, "samples": []}
        return templates.TemplateResponse(
            "metadata/job_detail.html",
            {"request": request, "job": job, "change_summary": change_summary},
        )
```

保留路由现有的 404 行为。

- [ ] **步骤 4：渲染摘要卡片**

把下面卡片加到 `app/web/templates/metadata/job_detail.html` 的采集统计区域之后：

```html
<div class="card shadow-sm mt-3">
    <div class="card-header bg-white"><span class="fw-bold">变更摘要</span></div>
    <div class="card-body">
        <div class="row text-center small">
            <div class="col-6 col-md-3 mb-3">
                <div class="stat-number">{{ job.tables_added_count }}</div>
                <div class="stat-label">新增表</div>
            </div>
            <div class="col-6 col-md-3 mb-3">
                <div class="stat-number">{{ job.tables_deactivated_count }}</div>
                <div class="stat-label">下线表</div>
            </div>
            <div class="col-6 col-md-3 mb-3">
                <div class="stat-number">{{ job.columns_added_count }}</div>
                <div class="stat-label">新增字段</div>
            </div>
            <div class="col-6 col-md-3 mb-3">
                <div class="stat-number">{{ job.columns_deactivated_count }}</div>
                <div class="stat-label">下线字段</div>
            </div>
            <div class="col-6 col-md-3">
                <div class="stat-number">{{ job.columns_type_changed_count }}</div>
                <div class="stat-label">类型变化</div>
            </div>
            <div class="col-6 col-md-3">
                <div class="stat-number">{{ job.columns_comment_changed_count }}</div>
                <div class="stat-label">注释变化</div>
            </div>
            <div class="col-6 col-md-3">
                <div class="stat-number">{{ job.indexes_deactivated_count }}</div>
                <div class="stat-label">下线索引</div>
            </div>
            <div class="col-6 col-md-3">
                <div class="stat-number">{{ job.constraints_deactivated_count }}</div>
                <div class="stat-label">下线约束</div>
            </div>
        </div>
        {% if change_summary.samples %}
        <hr>
        <ul class="small mb-0">
            {% for sample in change_summary.samples[:20] %}
            <li><code>{{ sample.kind }}</code> {{ sample.path }}</li>
            {% endfor %}
        </ul>
        {% elif change_summary.raw %}
        <pre class="bg-light border rounded p-3 small mb-0">{{ change_summary.raw }}</pre>
        {% else %}
        <p class="text-muted small mb-0">本次任务没有记录结构变化明细。</p>
        {% endif %}
    </div>
</div>
```

- [ ] **步骤 5：运行页面测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_metadata_job_detail_page_shows_change_summary -q
```

预期：`1 passed`。

- [ ] **步骤 6：提交**

```powershell
git add app/web/routes.py app/web/templates/metadata/job_detail.html tests/test_basic.py
git commit -m "feat: show metadata collection changes"
```

---

### 任务 10：最终集成验证

**文件：**
- 只修改本任务中因验证失败而必须修复的文件。
- 测试：完整测试套件。

- [ ] **步骤 1：运行元数据定向测试集**

运行：

```powershell
python -m pytest tests/test_basic.py::test_collect_metadata_reuses_existing_table_and_column_ids tests/test_basic.py::test_collect_metadata_deactivates_missing_column_and_preserves_semantic tests/test_basic.py::test_collect_metadata_upserts_indexes_and_constraints tests/test_basic.py::test_execute_metadata_collection_job_records_change_counts tests/test_basic.py::test_metadata_job_detail_page_shows_change_summary -q
```

预期：所有选中测试通过。

- [ ] **步骤 2：运行完整测试套件**

运行：

```powershell
python -m pytest tests/ -q
```

预期：所有测试通过。只要没有失败，现有 deprecation warning 可以接受。

- [ ] **步骤 3：运行编译检查**

运行：

```powershell
python -m compileall app -q
```

预期：退出码为 `0`。

- [ ] **步骤 4：可选真实 Oracle 冒烟测试**

仅在本地 `dwhrpt` 数据源可用时运行：

```powershell
@'
import json, logging
from app.models import init_db
from app.services.metadata_job_service import run_metadata_collection_job
logging.disable(logging.CRITICAL)
init_db('sqlite:///./data/metricforge.db')
job = run_metadata_collection_job(2, triggered_by='codex-safe-refresh-smoke')
print(json.dumps(job, ensure_ascii=False, indent=2, default=str))
'@ | python -
```

预期：任务状态为 `success` 或 `partial_success`，`columns_count` 大于 `0`，重复运行不会让表或字段数量倍增。

- [ ] **步骤 5：检查 git diff**

运行：

```powershell
git status --short
git diff --stat
```

预期：没有计划文件之外的意外变更。

- [ ] **步骤 6：如有必要，提交最终修复**

如果步骤 1-5 需要少量修正，提交这些修正：

```powershell
git add app tests
git commit -m "fix: stabilize metadata refresh integration"
```

如果前面任务提交后没有额外修改，不创建空提交。

---

## 自检

Spec 覆盖：

- 唯一元数据身份由任务 1 和任务 2 覆盖。
- running 任务复用由任务 3 覆盖。
- 变更计数和 JSON 摘要由任务 4 和任务 9 覆盖。
- 表和字段稳定 upsert 由任务 5 覆盖。
- 缺失对象下线和语义保留由任务 6 覆盖。
- 索引和约束 upsert 由任务 7 覆盖。
- 只扫描 active 字段的语义检测由任务 8 覆盖。
- 最终验证和可选真实 Oracle 冒烟测试由任务 10 覆盖。

范围检查：

- 本计划不实现 cron、APScheduler、Celery、Redis、分布式锁或 Oracle `last_ddl_time` 增量扫描。
- 本计划只实现已确认的“治理稳定版安全刷新”基础。

类型一致性：

- `collection_mode` 使用字符串值 `safe_refresh`。
- `reused_running_job` 同时作为模型字段和序列化 API 字段。
- 变更计数在 `stats["changes"]`、任务模型字段、序列化 key 和模板引用中使用一致的 snake_case 命名。
