"""模型基础测试"""

from pathlib import Path

import pytest
from sqlalchemy import inspect

from app.models import (
    DatasourceConfig,
    MetricDefinition,
    MetricCaliber,
    GovernanceTicket,
    MetadataCollectionJob,
    TableMetadata,
    ColumnMetadata,
    FieldSemantic,
    get_session,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_create_datasource(db_session):
    """测试创建数据源"""
    ds = DatasourceConfig(
        name="测试 Oracle",
        ds_type="oracle",
        host="10.0.0.1",
        port=1521,
        username="readonly",
        dialect="oracle",
        schema_names="DW,DWD",
    )
    db_session.add(ds)
    db_session.commit()

    saved = db_session.query(DatasourceConfig).first()
    assert saved is not None
    assert saved.name == "测试 Oracle"
    assert saved.ds_type == "oracle"
    assert saved.is_active is True
    assert saved.schema_names == "DW,DWD"


def test_create_metric(db_session):
    """测试创建指标"""
    metric = MetricDefinition(
        metric_code="M_AMT_INVEST",
        metric_name="投放金额",
        category="资产类",
        definition="统计期间内所有已投放项目的合同金额总和",
        formula="SUM(act_pay_amt)",
        owner="张三",
        status="draft",
    )
    db_session.add(metric)
    db_session.commit()

    saved = db_session.query(MetricDefinition).first()
    assert saved is not None
    assert saved.metric_code == "M_AMT_INVEST"
    assert saved.owner == "张三"
    assert saved.status == "draft"

    # 添加口径
    caliber = MetricCaliber(
        metric_id=saved.id,
        caliber_name="自然月",
        caliber_rule="按自然月统计，每月1日至月末最后一天",
        filter_template="TRUNC(report_date, 'MM') = :target_month",
        is_default=True,
    )
    db_session.add(caliber)
    db_session.commit()

    assert len(saved.calibers) == 1
    assert saved.calibers[0].caliber_name == "自然月"


def test_create_governance_ticket(db_session):
    """测试创建治理待办"""
    ticket = GovernanceTicket(
        ticket_type="missing_semantic",
        title="字段语义缺失: DWD_CONTRACT.STATUS",
        description="字段 STATUS 缺少业务含义解释",
        source="auto_detect",
        related_object_type="column",
        related_object_id=1,
        priority="high",
        status="open",
    )
    db_session.add(ticket)
    db_session.commit()

    saved = db_session.query(GovernanceTicket).first()
    assert saved is not None
    assert saved.ticket_type == "missing_semantic"
    assert saved.priority == "high"
    assert saved.status == "open"


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


def test_collect_metadata_counts_table_stats_and_column_attribute_updates(app, monkeypatch):
    """Repeated collection counts non-type/comment metadata changes as updates."""
    from app.adapters.metadata_collector import ColumnInfo, TableInfo
    from app.services import metadata_service

    class FakeAdapter:
        def close(self):
            pass

    class ChangingCollector:
        collect_round = 0

        def __init__(self, adapter, config):
            self.round = ChangingCollector.collect_round
            ChangingCollector.collect_round += 1

        def collect_tables(self, schema):
            if self.round == 0:
                return [
                    TableInfo(
                        schema_name=schema,
                        table_name="T_ORDER",
                        row_count_est=10,
                        avg_row_len=20,
                        num_blocks=1,
                    )
                ]
            return [
                TableInfo(
                    schema_name=schema,
                    table_name="T_ORDER",
                    row_count_est=10,
                    avg_row_len=30,
                    num_blocks=2,
                )
            ]

        def collect_columns(self, schema, table):
            if self.round == 0:
                return [
                    ColumnInfo(
                        column_name="ORDER_ID",
                        column_type="NUMBER(18,0)",
                        nullable=True,
                        column_id=1,
                        default_value=None,
                        comment="order id",
                        is_primary_key=False,
                    )
                ]
            return [
                ColumnInfo(
                    column_name="ORDER_ID",
                    column_type="NUMBER(18,0)",
                    nullable=False,
                    column_id=1,
                    default_value="0",
                    comment="order id",
                    is_primary_key=True,
                )
            ]

        def collect_indexes(self, schema, table):
            return []

        def collect_constraints(self, schema, table):
            return []

    monkeypatch.setattr(metadata_service, "get_adapter_for_datasource", lambda ds_id: FakeAdapter())
    monkeypatch.setattr(metadata_service, "OracleMetadataCollector", ChangingCollector)

    metadata_service.collect_metadata(1, schemas=["DWHRPT"])
    second = metadata_service.collect_metadata(1, schemas=["DWHRPT"])

    assert second["stats"]["changes"]["tables_updated"] == 1
    assert second["stats"]["changes"]["columns_updated"] == 1
    assert second["stats"]["changes"]["columns_type_changed"] == 0
    assert second["stats"]["changes"]["columns_comment_changed"] == 0


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


def test_create_app_uses_explicit_database_url(tmp_path):
    """测试 create_app 使用显式传入的数据库 URL 初始化数据库"""
    from app.main import create_app
    from app.models import get_engine

    db_path = tmp_path / "metricforge-test.db"

    create_app(database_url=f"sqlite:///{db_path}")

    assert db_path.exists()
    table_names = inspect(get_engine()).get_table_names()
    assert "datasource_config" in table_names
    assert "metric_definition" in table_names
    assert "metadata_collection_job" in table_names


def test_resolve_database_url_falls_back_when_config_is_invalid(tmp_path, monkeypatch):
    """测试配置文件损坏时数据库 URL 回退到默认 SQLite"""
    from app.main import DEFAULT_DATABASE_URL, _resolve_database_url

    monkeypatch.delenv("METRICFORGE_DB_URL", raising=False)
    bad_config = tmp_path / "bad-config.yaml"
    bad_config.write_text("database: [", encoding="utf-8")

    assert _resolve_database_url(config_path=str(bad_config)) == DEFAULT_DATABASE_URL


def test_health_check(client):
    """测试健康检查接口"""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["version"] == "0.1.0"


def test_list_datasources_empty(client):
    """测试空数据源列表"""
    resp = client.get("/api/datasources/")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_datasource_api(client):
    """测试通过 API 创建数据源"""
    resp = client.post("/api/datasources/?" + "name=测试&host=10.0.0.1&port=1521&username=ro&ds_type=oracle")
    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "数据源创建成功"

    # 验证列表
    resp = client.get("/api/datasources/")
    assert len(resp.json()) == 1


def test_create_metric_api(client):
    """测试通过 API 创建指标"""
    resp = client.post("/api/metrics/?" + "metric_code=M_TEST&metric_name=测试指标&category=测试&owner=Tester")
    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "指标创建成功"

    # 验证列表
    resp = client.get("/api/metrics/")
    metrics = resp.json()
    assert len(metrics) == 1
    assert metrics[0]["metric_code"] == "M_TEST"


def test_dashboard_page(client):
    """测试仪表盘页面"""
    resp = client.get("/web/dashboard")
    assert resp.status_code == 200
    assert "MetricForge" in resp.text
    assert "仪表盘" in resp.text


def test_metric_page(client):
    """测试指标管理页面"""
    resp = client.get("/web/metrics")
    assert resp.status_code == 200
    assert "指标管理" in resp.text


def test_governance_page(client):
    """测试治理待办页面"""
    resp = client.get("/web/governance")
    assert resp.status_code == 200
    assert "治理待办" in resp.text


def test_metric_form_prevents_default_submit():
    """测试新建指标表单阻止浏览器默认提交"""
    template = (PROJECT_ROOT / "app/web/templates/metrics/form.html").read_text(encoding="utf-8")

    assert "async function createMetric(e)" in template
    assert "e.preventDefault();" in template


def test_metric_status_update_refreshes_page():
    """测试指标状态更新成功后刷新页面以同步状态展示"""
    template = (PROJECT_ROOT / "app/web/templates/metrics/detail.html").read_text(encoding="utf-8")

    assert "async function updateStatus(metricId)" in template
    assert "window.location.reload();" in template


def test_governance_page_filters_by_status(client):
    """测试治理待办页面按状态筛选"""
    client.post(
        "/api/governance/",
        params={
            "ticket_type": "other",
            "title": "Open Ticket",
            "description": "open ticket",
            "priority": "medium",
        },
    )
    resolved_resp = client.post(
        "/api/governance/",
        params={
            "ticket_type": "other",
            "title": "Resolved Ticket",
            "description": "resolved ticket",
            "priority": "medium",
        },
    )
    ticket_id = resolved_resp.json()["id"]
    client.put(f"/api/governance/{ticket_id}/status", params={"status": "resolved", "resolution": "done"})

    resp = client.get("/web/governance?status=resolved")

    assert resp.status_code == 200
    assert "Resolved Ticket" in resp.text
    assert "Open Ticket" not in resp.text
    assert '<option value="resolved" selected>已解决</option>' in resp.text


def test_datasource_detail_has_metadata_collection_controls(client):
    """测试数据源详情页提供元数据采集入口"""
    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "采集测试数据源",
            "host": "127.0.0.1",
            "port": 1521,
            "username": "readonly",
            "ds_type": "oracle",
        },
    )
    ds_id = create_resp.json()["id"]

    resp = client.get(f"/web/datasources/{ds_id}")

    assert resp.status_code == 200
    assert "采集元数据" in resp.text
    assert "collectMetadata" in resp.text
    assert "collectionResult" in resp.text


def test_metadata_empty_state_links_to_datasources(client):
    """测试元数据空状态提供数据源采集入口"""
    resp = client.get("/web/metadata")

    assert resp.status_code == 200
    assert "去数据源采集" in resp.text
    assert "/web/datasources" in resp.text


def test_governance_modal_has_action_controls(client):
    """测试治理待办详情弹窗提供闭环操作控件"""
    client.post(
        "/api/governance/",
        params={
            "ticket_type": "other",
            "title": "治理闭环测试待办",
            "description": "用于验证治理操作控件",
            "priority": "high",
        },
    )

    resp = client.get("/web/governance")

    assert resp.status_code == 200
    assert "ticketAssignee" in resp.text
    assert "ticketStatus" in resp.text
    assert "ticketResolution" in resp.text
    assert "saveTicketAction" in resp.text


def test_save_field_semantic_closes_related_ticket(client, db_session):
    """Saving a field semantic closes the related governance ticket."""
    _ = db_session
    db = get_session()
    try:
        ds = DatasourceConfig(
            name="\u8bed\u4e49\u6d4b\u8bd5\u6570\u636e\u6e90",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.flush()
        table = TableMetadata(
            datasource_id=ds.id,
            schema_name="DWD",
            table_name="CONTRACT",
            table_type="TABLE",
        )
        db.add(table)
        db.flush()
        column = ColumnMetadata(
            table_id=table.id,
            column_name="STATUS",
            column_type="VARCHAR2(20)",
            nullable=True,
            comment="\u72b6\u6001",
            column_id=1,
        )
        db.add(column)
        db.flush()
        ticket = GovernanceTicket(
            ticket_type="missing_semantic",
            title="\u5b57\u6bb5\u8bed\u4e49\u7f3a\u5931: DWD.CONTRACT.STATUS",
            description="\u5b57\u6bb5 STATUS \u7f3a\u5c11\u4e1a\u52a1\u542b\u4e49\u89e3\u91ca",
            source="auto_detect",
            related_object_type="column",
            related_object_id=column.id,
            priority="medium",
            status="open",
        )
        db.add(ticket)
        db.commit()

        resp = client.put(
            f"/api/field-semantics/columns/{column.id}",
            params={
                "business_alias": "\u5408\u540c\u72b6\u6001",
                "meaning": "\u8868\u793a\u5408\u540c\u5f53\u524d\u751f\u547d\u5468\u671f\u72b6\u6001",
                "unit": "   ",
                "enum_values": '{"A":"\u6709\u6548","I":"\u65e0\u6548"}',
                "data_quality_note": "\u5386\u53f2\u6570\u636e\u5b58\u5728\u7a7a\u503c",
                "governed_by": "\u6cbb\u7406\u4e13\u5458",
            },
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == "\u5b57\u6bb5\u8bed\u4e49\u5df2\u4fdd\u5b58"
        assert data["closed_tickets"] == 1

        db.expire_all()
        semantic = db.query(FieldSemantic).filter(FieldSemantic.column_id == column.id).one()
        assert semantic.business_alias == "\u5408\u540c\u72b6\u6001"
        assert semantic.meaning == "\u8868\u793a\u5408\u540c\u5f53\u524d\u751f\u547d\u5468\u671f\u72b6\u6001"
        assert semantic.unit is None
        assert semantic.enum_values == '{"A":"\u6709\u6548","I":"\u65e0\u6548"}'
        assert semantic.data_quality_note == "\u5386\u53f2\u6570\u636e\u5b58\u5728\u7a7a\u503c"
        assert semantic.is_governed is True
        assert semantic.governed_by == "\u6cbb\u7406\u4e13\u5458"
        assert semantic.governed_at is not None

        closed_ticket = db.query(GovernanceTicket).filter(GovernanceTicket.id == ticket.id).one()
        assert closed_ticket.status == "resolved"
        assert closed_ticket.resolution == "\u5b57\u6bb5\u8bed\u4e49\u5df2\u6cbb\u7406"
        assert closed_ticket.assignee == "\u6cbb\u7406\u4e13\u5458"
    finally:
        db.close()


def test_save_field_semantic_only_closes_missing_semantic_ticket(client, db_session):
    """Saving a field semantic leaves non-semantic governance tickets open."""
    _ = db_session
    db = get_session()
    try:
        ds = DatasourceConfig(
            name="semantic scoped datasource",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.flush()
        table = TableMetadata(
            datasource_id=ds.id,
            schema_name="DWD",
            table_name="CONTRACT",
            table_type="TABLE",
        )
        db.add(table)
        db.flush()
        column = ColumnMetadata(
            table_id=table.id,
            column_name="STATUS",
            column_type="VARCHAR2(20)",
            nullable=True,
            comment="status",
            column_id=1,
        )
        db.add(column)
        db.flush()
        missing_semantic_ticket = GovernanceTicket(
            ticket_type="missing_semantic",
            title="Missing semantic: DWD.CONTRACT.STATUS",
            description="STATUS is missing business meaning",
            source="auto_detect",
            related_object_type="column",
            related_object_id=column.id,
            priority="medium",
            status="open",
        )
        permission_ticket = GovernanceTicket(
            ticket_type="permission_issue",
            title="Permission issue: DWD.CONTRACT.STATUS",
            description="STATUS requires permission review",
            source="manual",
            related_object_type="column",
            related_object_id=column.id,
            priority="medium",
            status="open",
        )
        db.add_all([missing_semantic_ticket, permission_ticket])
        db.commit()

        resp = client.put(
            f"/api/field-semantics/columns/{column.id}",
            params={
                "business_alias": "Contract status",
                "meaning": "Current lifecycle state of the contract",
                "governed_by": "semantic steward",
            },
        )

        assert resp.status_code == 200
        assert resp.json()["closed_tickets"] == 1

        db.expire_all()
        closed_ticket = (
            db.query(GovernanceTicket)
            .filter(GovernanceTicket.id == missing_semantic_ticket.id)
            .one()
        )
        still_open_ticket = (
            db.query(GovernanceTicket)
            .filter(GovernanceTicket.id == permission_ticket.id)
            .one()
        )
        assert closed_ticket.status == "resolved"
        assert still_open_ticket.status == "open"
    finally:
        db.close()


def test_save_field_semantic_rolls_back_when_ticket_auto_resolve_fails(app, db_session, monkeypatch):
    """Semantic save rolls back if related ticket auto-resolution fails."""
    from fastapi.testclient import TestClient

    _ = db_session
    client = TestClient(app, raise_server_exceptions=False)
    db = get_session()
    try:
        ds = DatasourceConfig(
            name="\u8bed\u4e49\u56de\u6eda\u6d4b\u8bd5\u6570\u636e\u6e90",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.flush()
        table = TableMetadata(
            datasource_id=ds.id,
            schema_name="DWD",
            table_name="CONTRACT",
            table_type="TABLE",
        )
        db.add(table)
        db.flush()
        column = ColumnMetadata(
            table_id=table.id,
            column_name="PAY_STATUS",
            column_type="VARCHAR2(20)",
            nullable=True,
            comment="\u652f\u4ed8\u72b6\u6001",
            column_id=3,
        )
        db.add(column)
        db.add(
            GovernanceTicket(
                ticket_type="missing_semantic",
                title="\u5b57\u6bb5\u8bed\u4e49\u7f3a\u5931: DWD.CONTRACT.PAY_STATUS",
                description="\u5b57\u6bb5 PAY_STATUS \u7f3a\u5c11\u4e1a\u52a1\u542b\u4e49\u89e3\u91ca",
                source="auto_detect",
                related_object_type="column",
                related_object_id=column.id,
                priority="medium",
                status="open",
            )
        )
        db.commit()

        def fail_auto_resolve(*args, **kwargs):
            raise RuntimeError("auto resolve failed")

        monkeypatch.setattr("app.api.field_semantics.auto_resolve_ticket_on_semantic", fail_auto_resolve)

        resp = client.put(
            f"/api/field-semantics/columns/{column.id}",
            params={
                "business_alias": "\u652f\u4ed8\u72b6\u6001",
                "meaning": "\u8868\u793a\u5408\u540c\u652f\u4ed8\u5904\u7406\u72b6\u6001",
            },
        )

        assert resp.status_code == 500
        db.expire_all()
        assert db.query(FieldSemantic).filter(FieldSemantic.column_id == column.id).first() is None
    finally:
        db.close()


def test_get_field_semantic_returns_column_context(client, db_session):
    """Getting a field semantic returns column context and existing semantic."""
    _ = db_session
    db = get_session()
    try:
        ds = DatasourceConfig(
            name="\u8bed\u4e49\u8be6\u60c5\u6570\u636e\u6e90",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.flush()
        table = TableMetadata(
            datasource_id=ds.id,
            schema_name="ADS",
            table_name="CUSTOMER",
            table_type="TABLE",
        )
        db.add(table)
        db.flush()
        column = ColumnMetadata(
            table_id=table.id,
            column_name="LEVEL_CODE",
            column_type="VARCHAR2(10)",
            nullable=False,
            comment="\u5ba2\u6237\u7b49\u7ea7",
            enum_samples="A,B,C",
            column_id=2,
        )
        db.add(column)
        db.flush()
        db.add(
            FieldSemantic(
                column_id=column.id,
                business_alias="\u5ba2\u6237\u7b49\u7ea7",
                meaning="\u5ba2\u6237\u5206\u5c42\u7b49\u7ea7\u7f16\u7801",
                enum_values='{"A":"\u9ad8\u4ef7\u503c"}',
                is_governed=True,
                governed_by="\u6570\u636e\u6cbb\u7406",
            )
        )
        db.commit()

        resp = client.get(f"/api/field-semantics/columns/{column.id}")

        assert resp.status_code == 200
        data = resp.json()
        assert data["column"]["schema_name"] == "ADS"
        assert data["column"]["table_name"] == "CUSTOMER"
        assert data["column"]["column_name"] == "LEVEL_CODE"
        assert data["column"]["enum_samples"] == "A,B,C"
        assert data["semantic"]["business_alias"] == "\u5ba2\u6237\u7b49\u7ea7"
        assert data["semantic"]["meaning"] == "\u5ba2\u6237\u5206\u5c42\u7b49\u7ea7\u7f16\u7801"
    finally:
        db.close()


def test_governance_detail_returns_field_context_for_column_ticket(client, db_session):
    """Column governance ticket details include field context."""
    _ = db_session
    db = get_session()
    try:
        ds = DatasourceConfig(
            name="\u5f85\u529e\u5b57\u6bb5\u6570\u636e\u6e90",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.flush()
        table = TableMetadata(
            datasource_id=ds.id,
            schema_name="DWS",
            table_name="ORDER_SUMMARY",
            table_type="TABLE",
        )
        db.add(table)
        db.flush()
        column = ColumnMetadata(
            table_id=table.id,
            column_name="PAY_STATUS",
            column_type="VARCHAR2(10)",
            nullable=True,
            comment="\u652f\u4ed8\u72b6\u6001",
            column_id=3,
        )
        db.add(column)
        db.flush()
        ticket = GovernanceTicket(
            ticket_type="missing_semantic",
            title="\u5b57\u6bb5\u8bed\u4e49\u7f3a\u5931: DWS.ORDER_SUMMARY.PAY_STATUS",
            description="\u5b57\u6bb5 PAY_STATUS \u7f3a\u5c11\u4e1a\u52a1\u542b\u4e49\u89e3\u91ca",
            source="auto_detect",
            related_object_type="column",
            related_object_id=column.id,
            priority="medium",
            status="open",
        )
        db.add(ticket)
        db.commit()

        resp = client.get(f"/api/governance/{ticket.id}")

        assert resp.status_code == 200
        data = resp.json()
        assert data["field_context"]["schema_name"] == "DWS"
        assert data["field_context"]["table_name"] == "ORDER_SUMMARY"
        assert data["field_context"]["column_name"] == "PAY_STATUS"
        assert data["field_semantic"] is None
    finally:
        db.close()


def test_governance_modal_has_field_semantic_editor_controls(client):
    """Governance ticket modal includes field semantic editor controls."""
    resp = client.get("/web/governance")

    assert resp.status_code == 200
    assert "fieldSemanticPanel" in resp.text
    assert "semanticColumnPath" in resp.text
    assert "semanticFieldContext" in resp.text
    assert "semanticBusinessAlias" in resp.text
    assert "semanticMeaning" in resp.text
    assert "semanticUnit" in resp.text
    assert "semanticEnumValues" in resp.text
    assert "semanticQualityNote" in resp.text
    assert "semanticGovernedBy" in resp.text
    assert "saveFieldSemantic" in resp.text
    assert "fieldSemanticResult" in resp.text


def test_field_semantics_page_shows_column_path(client, db_session):
    """Field semantic list shows schema.table.column and semantic details."""
    _ = db_session
    db = get_session()
    try:
        ds = DatasourceConfig(
            name="\u8bed\u4e49\u5217\u8868\u6570\u636e\u6e90",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.flush()
        table = TableMetadata(
            datasource_id=ds.id,
            schema_name="DM",
            table_name="CUSTOMER_TAG",
            table_type="TABLE",
        )
        db.add(table)
        db.flush()
        column = ColumnMetadata(
            table_id=table.id,
            column_name="TAG_CODE",
            column_type="VARCHAR2(30)",
            nullable=True,
            column_id=1,
        )
        db.add(column)
        db.flush()
        db.add(
            FieldSemantic(
                column_id=column.id,
                business_alias="\u5ba2\u6237\u6807\u7b7e",
                meaning="\u5ba2\u6237\u8fd0\u8425\u6807\u7b7e\u7f16\u7801",
                is_governed=True,
                governed_by="\u6cbb\u7406\u4e13\u5458",
            )
        )
        db.commit()

        resp = client.get("/web/field-semantics")

        assert resp.status_code == 200
        assert "DM.CUSTOMER_TAG.TAG_CODE" in resp.text
        assert "VARCHAR2(30)" in resp.text
        assert "\u5ba2\u6237\u6807\u7b7e" in resp.text
        assert "\u6cbb\u7406\u4e13\u5458" in resp.text
    finally:
        db.close()


def test_field_semantics_page_tolerates_orphan_semantic(client, db_session):
    """Field semantic list tolerates semantics whose column no longer exists."""
    _ = db_session
    db = get_session()
    try:
        db.add(
            FieldSemantic(
                column_id=999,
                business_alias="\u5b64\u513f\u8bed\u4e49",
                meaning="\u7f3a\u5931\u5b57\u6bb5\u5173\u7cfb",
                is_governed=False,
            )
        )
        db.commit()

        resp = client.get("/web/field-semantics")

        assert resp.status_code == 200
        assert "\u5b57\u6bb5 #999" in resp.text
        assert "\u5b64\u513f\u8bed\u4e49" in resp.text
    finally:
        db.close()


def test_create_metadata_collection_job_records_running_without_collecting(app, monkeypatch):
    """Creating a metadata collection job only records a running task."""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="job service create datasource",
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

        def fail_collect_metadata(datasource_id):
            raise AssertionError("create should not collect metadata")

        monkeypatch.setattr(metadata_job_service, "collect_metadata", fail_collect_metadata)

        job = metadata_job_service.create_metadata_collection_job(ds.id, triggered_by="pytest")

        assert job["status"] == "running"
        assert job["datasource_id"] == ds.id
        assert job["triggered_by"] == "pytest"
        assert job["schema_filter"] == "DWD,DWS"
        assert job["finished_at"] is None
        assert job["duration_ms"] is None
        assert job["tables_count"] == 0
        assert job["columns_count"] == 0
        assert job["indexes_count"] == 0
        assert job["constraints_count"] == 0

        saved = db.query(MetadataCollectionJob).filter(MetadataCollectionJob.id == job["id"]).one()
        assert saved.status == "running"
    finally:
        db.close()


def test_execute_metadata_collection_job_updates_running_job_to_success(app, monkeypatch):
    """Executing a running metadata collection job records success stats."""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="job service execute datasource",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.flush()
        job_record = MetadataCollectionJob(
            datasource_id=ds.id,
            status="running",
            triggered_by="pytest",
            schema_filter=ds.schema_names,
        )
        db.add(job_record)
        db.commit()
        db.refresh(ds)
        db.refresh(job_record)

        def fake_collect_metadata(datasource_id):
            assert datasource_id == ds.id
            return {
                "success": True,
                "stats": {
                    "schemas": 1,
                    "tables": 3,
                    "columns": 12,
                    "indexes": 2,
                    "constraints": 5,
                    "errors": [],
                },
            }

        monkeypatch.setattr(metadata_job_service, "collect_metadata", fake_collect_metadata)

        job = metadata_job_service.execute_metadata_collection_job(job_record.id)

        assert job["status"] == "success"
        assert job["tables_count"] == 3
        assert job["columns_count"] == 12
        assert job["indexes_count"] == 2
        assert job["constraints_count"] == 5
        assert job["finished_at"] is not None
        assert job["duration_ms"] is not None

        db.expire_all()
        saved = db.query(MetadataCollectionJob).filter(MetadataCollectionJob.id == job_record.id).one()
        assert saved.status == "success"
        assert saved.finished_at is not None
        assert saved.duration_ms is not None
    finally:
        db.close()


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


def test_execute_metadata_collection_job_records_failure_when_datasource_missing(app):
    """Executing a job fails when the datasource was deleted."""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="job service missing datasource",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.flush()
        job_record = MetadataCollectionJob(
            datasource_id=ds.id,
            status="running",
            triggered_by="pytest",
        )
        db.add(job_record)
        db.commit()
        job_id = job_record.id
        db.delete(ds)
        db.commit()

        job = metadata_job_service.execute_metadata_collection_job(job_id)

        assert job["status"] == "failed"
        assert "数据源不存在" in job["error_message"]
    finally:
        db.close()


def test_execute_metadata_collection_job_returns_none_for_missing_job(app):
    """Executing a missing metadata collection job returns None."""
    from app.services import metadata_job_service

    assert metadata_job_service.execute_metadata_collection_job(999999) is None


def test_execute_metadata_collection_job_skips_terminal_job_without_collecting(app, monkeypatch):
    """Executing a terminal job returns it unchanged without collecting again."""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="terminal job datasource",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(ds)
        db.flush()
        job_record = MetadataCollectionJob(
            datasource_id=ds.id,
            status="success",
            tables_count=3,
            columns_count=12,
            triggered_by="pytest",
        )
        db.add(job_record)
        db.commit()
        db.refresh(job_record)

        def fail_if_collected(datasource_id, schemas=None):
            raise AssertionError(f"should not collect terminal job for datasource {datasource_id}")

        monkeypatch.setattr(metadata_job_service, "collect_metadata", fail_if_collected)

        job = metadata_job_service.execute_metadata_collection_job(job_record.id)

        assert job["status"] == "success"
        assert job["tables_count"] == 3
        assert job["columns_count"] == 12
    finally:
        db.close()


def test_execute_metadata_collection_job_uses_datasource_schema_filter(app, monkeypatch):
    """Executing a job uses datasource schema_names as uppercase collect scope."""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="job service schema filter datasource",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
            schema_names="dwhrpt, DWHRPT_T",
        )
        db.add(ds)
        db.commit()
        db.refresh(ds)

        def fake_collect_metadata(datasource_id, schemas=None):
            assert datasource_id == ds.id
            assert schemas == ["DWHRPT", "DWHRPT_T"]
            return {
                "success": True,
                "stats": {
                    "schemas": 2,
                    "tables": 1,
                    "columns": 2,
                    "indexes": 0,
                    "constraints": 0,
                    "errors": [],
                },
            }

        monkeypatch.setattr(metadata_job_service, "collect_metadata", fake_collect_metadata)

        job = metadata_job_service.run_metadata_collection_job(ds.id)

        assert job["status"] == "success"
        assert job["schema_filter"] == "dwhrpt, DWHRPT_T"
        assert job["tables_count"] == 1
    finally:
        db.close()


def test_run_metadata_collection_job_returns_reused_running_without_executing(app, monkeypatch):
    """Synchronous collection returns an existing running job without executing it again."""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="sync reuse running datasource",
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

        def fail_if_executed(job_id):
            raise AssertionError(f"should not execute reused running job {job_id}")

        monkeypatch.setattr(metadata_job_service, "execute_metadata_collection_job", fail_if_executed)

        job = metadata_job_service.run_metadata_collection_job(ds.id)

        assert job["id"] == running.id
        assert job["status"] == "running"
        assert job["reused_running_job"] is True
    finally:
        db.close()


def test_run_metadata_collection_job_records_success(app, monkeypatch):
    """Metadata collection jobs record success state and stats."""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="job service success datasource",
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


def test_run_metadata_collection_job_records_partial_success(app, monkeypatch):
    """Metadata collection jobs record partial success when schema errors return."""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="job service partial datasource",
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
                    "errors": ["BAD_SCHEMA: \u6743\u9650\u4e0d\u8db3"],
                },
            },
        )

        job = metadata_job_service.run_metadata_collection_job(ds.id)

        assert job["status"] == "partial_success"
        assert job["tables_count"] == 1
        assert job["error_message"] == "1 \u4e2a\u91c7\u96c6\u9519\u8bef"
        assert "BAD_SCHEMA" in job["error_details"]
    finally:
        db.close()


def test_run_metadata_collection_job_records_failure(app, monkeypatch):
    """Metadata collection jobs record failed collection results."""
    from app.services import metadata_job_service

    db = get_session()
    try:
        ds = DatasourceConfig(
            name="job service failure datasource",
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
            lambda datasource_id: {"success": False, "error": "\u8fde\u63a5\u5931\u8d25"},
        )

        job = metadata_job_service.run_metadata_collection_job(ds.id)

        assert job["status"] == "failed"
        assert job["error_message"] == "\u8fde\u63a5\u5931\u8d25"
        assert job["tables_count"] == 0
    finally:
        db.close()


def test_collect_metadata_fails_when_all_requested_schemas_fail(app, monkeypatch):
    """采集指定 schema 全部失败时不能伪装成 success."""
    from app.services import metadata_service

    class FakeAdapter:
        def close(self):
            pass

    class FailingCollector:
        def __init__(self, adapter, config):
            pass

        def collect_tables(self, schema):
            raise RuntimeError("ORA-00904: invalid identifier")

    monkeypatch.setattr(metadata_service, "get_adapter_for_datasource", lambda ds_id: FakeAdapter())
    monkeypatch.setattr(metadata_service, "OracleMetadataCollector", FailingCollector)

    result = metadata_service.collect_metadata(1, schemas=["DWHRPT"])

    assert result["success"] is False
    assert "DWHRPT" in result["error"]
    assert "ORA-00904" in result["error"]
    assert result["stats"]["errors"] == ["DWHRPT: ORA-00904: invalid identifier"]


def test_collect_metadata_fails_when_requested_schema_column_collection_fails(app, monkeypatch):
    """字段采集失败时 schema 会回滚，任务不应被统计成成功采集。"""
    from app.adapters.metadata_collector import TableInfo
    from app.services import metadata_service

    class FakeAdapter:
        def close(self):
            pass

    class FailingCollector:
        def __init__(self, adapter, config):
            pass

        def collect_tables(self, schema):
            return [TableInfo(schema_name=schema, table_name="T_ORDER")]

        def collect_columns(self, schema, table):
            raise RuntimeError("ORA-00923: FROM keyword not found")

    monkeypatch.setattr(metadata_service, "get_adapter_for_datasource", lambda ds_id: FakeAdapter())
    monkeypatch.setattr(metadata_service, "OracleMetadataCollector", FailingCollector)

    result = metadata_service.collect_metadata(1, schemas=["DWHRPT"])

    assert result["success"] is False
    assert "ORA-00923" in result["error"]
    assert result["stats"]["schemas"] == 0
    assert result["stats"]["tables"] == 0
    assert result["stats"]["columns"] == 0


def test_oracle_collect_tables_uses_valid_table_type_source():
    """Oracle 表采集 SQL 不应引用不存在的 all_tables.table_type."""
    from app.adapters.base import QueryResult
    from app.collectors.oracle_collector import OracleMetadataCollector

    executed = []

    class FakeAdapter:
        def execute_query(self, sql, params=None):
            executed.append((sql, params))
            if "all_tab_comments" in sql:
                return QueryResult(
                    columns=["TABLE_NAME", "TABLE_TYPE", "TABLE_COMMENT"],
                    rows=[["T_ORDER", "TABLE", "订单表"], ["V_ORDER", "VIEW", "订单视图"]],
                    row_count=2,
                )
            if "num_rows" in sql:
                return QueryResult(
                    columns=["TABLE_NAME", "NUM_ROWS", "LAST_ANALYZED", "AVG_ROW_LEN", "BLOCKS"],
                    rows=[["T_ORDER", 12, None, 80, 2]],
                    row_count=1,
                )
            raise AssertionError(f"unexpected SQL: {sql}")

    collector = OracleMetadataCollector(FakeAdapter(), {})

    tables = collector.collect_tables("DWHRPT")

    table_sql = executed[0][0]
    assert "t.table_type" not in table_sql.lower()
    assert "all_tab_comments" in table_sql.lower()
    assert tables[0].table_name == "T_ORDER"
    assert tables[0].table_type == "TABLE"
    assert tables[0].row_count_est == 12
    assert tables[1].table_name == "V_ORDER"
    assert tables[1].table_type == "VIEW"


def test_oracle_collect_columns_uses_non_reserved_comment_alias():
    """Oracle 字段采集 SQL 不应使用 comment 作为列别名。"""
    from app.adapters.base import QueryResult
    from app.collectors.oracle_collector import OracleMetadataCollector

    executed = []

    class FakeAdapter:
        def execute_query(self, sql, params=None):
            executed.append((sql, params))
            if "all_tab_columns" in sql:
                return QueryResult(
                    columns=[
                        "COLUMN_NAME",
                        "COLUMN_TYPE",
                        "DATA_LENGTH",
                        "NULLABLE",
                        "COLUMN_ID",
                        "DATA_DEFAULT",
                        "COLUMN_COMMENT",
                    ],
                    rows=[["ORDER_ID", "NUMBER(18,0)", 22, "N", 1, None, "订单 ID"]],
                    row_count=1,
                )
            if "all_constraints" in sql:
                return QueryResult(columns=["COLUMN_NAME"], rows=[], row_count=0)
            raise AssertionError(f"unexpected SQL: {sql}")

    collector = OracleMetadataCollector(FakeAdapter(), {})

    columns = collector.collect_columns("DWHRPT", "T_ORDER")

    column_sql = executed[0][0].lower()
    assert "as comment" not in column_sql
    assert "as column_comment" in column_sql
    assert columns[0].column_name == "ORDER_ID"
    assert columns[0].comment == "订单 ID"


def test_oracle_collect_columns_raises_query_errors():
    """Oracle 字段采集 SQL 错误不应被吞成空字段。"""
    from app.adapters.base import QueryResult
    from app.collectors.oracle_collector import OracleMetadataCollector

    class FakeAdapter:
        def execute_query(self, sql, params=None):
            return QueryResult(columns=[], rows=[], row_count=0, error="ORA-00923: FROM keyword not found")

    collector = OracleMetadataCollector(FakeAdapter(), {})

    with pytest.raises(RuntimeError, match="ORA-00923"):
        collector.collect_columns("DWHRPT", "T_ORDER")


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


def test_create_metadata_collection_job_api(client, monkeypatch):
    """测试通过 API 创建采集任务并后台执行"""
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

    def fake_create_metadata_collection_job(datasource_id, triggered_by="web"):
        return {
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
        }

    monkeypatch.setattr(metadata_api, "create_metadata_collection_job", fake_create_metadata_collection_job)
    monkeypatch.setattr(metadata_api, "execute_metadata_collection_job", lambda job_id: None)

    resp = client.post(f"/api/metadata/jobs/{ds_id}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == 99
    assert data["status"] == "running"
    assert data["tables_count"] == 0
    assert data["columns_count"] == 0


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
    assert data["job"]["status"] == "success"
    assert data["stats"]["tables"] == 3
    assert data["stats"]["columns"] == 9


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
            "id": 102,
            "datasource_id": datasource_id,
            "status": "success",
            "tables_count": 5,
            "columns_count": 12,
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


def test_legacy_metadata_collect_api_returns_reused_running_job(client, monkeypatch):
    """Legacy collection API returns 200 when an existing running job is reused."""
    from app.api import metadata as metadata_api

    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "legacy reused running datasource",
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
            "id": 103,
            "datasource_id": datasource_id,
            "status": "running",
            "reused_running_job": True,
            "tables_count": 2,
            "columns_count": 7,
            "indexes_count": 1,
            "constraints_count": 0,
            "duration_ms": None,
            "error_message": None,
            "error_details": None,
        },
    )

    resp = client.post(f"/api/metadata/collect/{ds_id}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "元数据采集任务正在执行"
    assert data["job"]["id"] == 103
    assert data["job"]["status"] == "running"
    assert data["job"]["reused_running_job"] is True
    assert data["stats"]["tables"] == 2
    assert data["stats"]["columns"] == 7


def test_datasource_detail_shows_collection_jobs(client):
    """测试数据源详情页展示最近采集任务并使用任务 API 触发采集"""
    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "详情采集历史数据源",
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
                tables_count=5,
                columns_count=21,
                error_message="1 个采集错误",
                error_details="BAD_SCHEMA: 权限不足",
                duration_ms=321,
            )
        )
        db.commit()
    finally:
        db.close()

    resp = client.get(f"/web/datasources/{ds_id}")

    assert resp.status_code == 200
    assert "采集历史" in resp.text
    assert "partial_success" in resp.text
    assert "5" in resp.text
    assert "21" in resp.text
    assert "1 个采集错误" in resp.text
    assert f"/api/metadata/jobs/{ds_id}" in resp.text
    assert f"/api/metadata/collect/{ds_id}" not in resp.text
    assert "data.status === 'success'" in resp.text
    assert "data.status === 'partial_success'" in resp.text
    assert "data.status === 'failed'" in resp.text
    assert "text-warning" in resp.text
    assert "\u90e8\u5206\u6210\u529f" in resp.text
    assert "text-danger" in resp.text
    assert "\u91c7\u96c6\u5931\u8d25" in resp.text
    assert resp.text.count("window.setTimeout(() => window.location.reload(), 1200);") == 2


def test_datasource_detail_uses_safe_polling_collection_ui(client):
    """Datasource detail page polls collection jobs and renders backend text safely."""
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
    assert "function jobDetailHref(data)" in resp.text
    assert "'/web/metadata/jobs/' + data.id" not in resp.text
    assert "\u4efb\u52a1\u5df2\u521b\u5efa\u4f46\u672a\u8fd4\u56de\u4efb\u52a1 ID" in resp.text
    assert "data.status === 'running'" in resp.text
    assert "if (!data.id)" in resp.text
    assert "任务仍在执行，可前往任务中心查看" in resp.text
    assert "+ (data.error_message" not in resp.text
    assert "+ (data.detail" not in resp.text
    assert "+ (data.message" not in resp.text


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
        job = MetadataCollectionJob(
            datasource_id=ds_id,
            status="partial_success",
            triggered_by="pytest",
            tables_count=7,
            columns_count=30,
            error_message="1 个采集错误",
            error_details="BAD_SCHEMA: 权限不足",
        )
        db.add(job)
        other_ds = DatasourceConfig(
            name="任务中心其他数据源",
            ds_type="oracle",
            host="127.0.0.1",
            port=1521,
            username="readonly",
            dialect="oracle",
        )
        db.add(other_ds)
        db.flush()
        other_job = MetadataCollectionJob(
            datasource_id=other_ds.id,
            status="failed",
            triggered_by="pytest",
            tables_count=0,
            columns_count=0,
            error_message="连接失败",
        )
        db.add(other_job)
        db.commit()
        db.refresh(job)
        job_id = job.id
        db.refresh(other_job)
        other_job_id = other_job.id
    finally:
        db.close()

    resp = client.get("/web/metadata/jobs")

    assert resp.status_code == 200
    assert "采集任务中心" in resp.text
    assert "任务中心数据源" in resp.text
    assert "partial_success" in resp.text
    assert "1 个采集错误" in resp.text
    assert f"/web/metadata/jobs/{job_id}" in resp.text

    filtered_resp = client.get(f"/web/metadata/jobs?datasource_id={ds_id}&status=partial_success")
    assert filtered_resp.status_code == 200
    assert "任务中心数据源" in filtered_resp.text
    assert "partial_success" in filtered_resp.text
    assert f"/web/metadata/jobs/{other_job_id}" not in filtered_resp.text
    assert "连接失败" not in filtered_resp.text


def test_metadata_jobs_page_all_filters_accept_empty_values(client):
    """测试采集任务中心接受表单提交的空筛选值"""
    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "全部筛选数据源",
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
            tables_count=3,
            columns_count=12,
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.id
    finally:
        db.close()

    resp = client.get("/web/metadata/jobs?datasource_id=&status=")

    assert resp.status_code == 200
    assert "采集任务中心" in resp.text
    assert "全部筛选数据源" in resp.text
    assert "success" in resp.text
    assert f"/web/metadata/jobs/{job_id}" in resp.text


def test_metadata_jobs_page_ignores_invalid_datasource_filter(client):
    """测试采集任务中心忽略非法数据源筛选值"""
    create_resp = client.post(
        "/api/datasources/",
        params={
            "name": "非法筛选数据源",
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
            status="partial_success",
            triggered_by="pytest",
            tables_count=4,
            columns_count=16,
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.id
    finally:
        db.close()

    resp = client.get("/web/metadata/jobs?datasource_id=abc&status=partial_success")

    assert resp.status_code == 200
    assert "采集任务中心" in resp.text
    assert "非法筛选数据源" in resp.text
    assert "partial_success" in resp.text
    assert f"/web/metadata/jobs/{job_id}" in resp.text


def test_metadata_job_detail_page_shows_running_hint(client):
    """测试采集任务详情页展示运行中提示"""
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
