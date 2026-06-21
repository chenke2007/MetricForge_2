"""Web UI 页面路由"""

import json

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pathlib import Path
from sqlalchemy.orm import joinedload

from ..models import (
    DatasourceConfig,
    TableMetadata,
    ColumnMetadata,
    MetricDefinition,
    GovernanceTicket,
    FieldSemantic,
    MetadataCollectionJob,
    get_session,
)

router = APIRouter()

template_dir = Path(__file__).resolve().parent / "templates"
templates = Jinja2Templates(directory=str(template_dir))


@router.get("/dashboard", response_class=HTMLResponse)
def dashboard(request: Request):
    """系统概览仪表盘"""
    db = get_session()
    try:
        ds_count = db.query(DatasourceConfig).count()
        table_count = db.query(TableMetadata).count()
        metric_count = db.query(MetricDefinition).count()
        open_tickets = db.query(GovernanceTicket).filter(GovernanceTicket.status.in_(["open", "in_progress"])).count()
        field_semantic_count = db.query(FieldSemantic).count()

        # 最近采集
        latest_tables = (
            db.query(TableMetadata)
            .order_by(TableMetadata.collected_at.desc())
            .limit(5)
            .all()
        )

        # 待办近况
        recent_tickets = (
            db.query(GovernanceTicket)
            .order_by(GovernanceTicket.created_at.desc())
            .limit(5)
            .all()
        )

        return templates.TemplateResponse(
            request,
            "dashboard.html",
            {
                "request": request,
                "ds_count": ds_count,
                "table_count": table_count,
                "metric_count": metric_count,
                "open_tickets": open_tickets,
                "field_semantic_count": field_semantic_count,
                "latest_tables": latest_tables,
                "recent_tickets": recent_tickets,
            },
        )
    finally:
        db.close()


@router.get("/datasources", response_class=HTMLResponse)
def datasource_list(request: Request):
    """数据源管理页面"""
    db = get_session()
    try:
        dses = db.query(DatasourceConfig).order_by(DatasourceConfig.id).all()
        return templates.TemplateResponse(request, "datasources/list.html", {"request": request, "datasources": dses})
    finally:
        db.close()


@router.get("/datasources/new", response_class=HTMLResponse)
def datasource_new(request: Request):
    """新建数据源页面"""
    return templates.TemplateResponse(request, "datasources/form.html", {"request": request})


@router.get("/datasources/{ds_id}", response_class=HTMLResponse)
def datasource_detail(request: Request, ds_id: int):
    """数据源详情页面"""
    db = get_session()
    try:
        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == ds_id).first()
        if not ds:
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url="/web/datasources")
        tables = db.query(TableMetadata).filter(TableMetadata.datasource_id == ds_id).all()
        collection_jobs = (
            db.query(MetadataCollectionJob)
            .filter(MetadataCollectionJob.datasource_id == ds_id)
            .order_by(MetadataCollectionJob.started_at.desc())
            .limit(5)
            .all()
        )
        return templates.TemplateResponse(
            request,
            "datasources/detail.html",
            {"request": request, "ds": ds, "tables": tables, "collection_jobs": collection_jobs},
        )
    finally:
        db.close()


@router.get("/metadata/jobs", response_class=HTMLResponse)
def metadata_jobs(request: Request, datasource_id: str = None, status: str = None):
    """元数据采集任务中心"""
    datasource_id_value = None
    if datasource_id is not None:
        datasource_id = datasource_id.strip()
        if datasource_id.isdigit():
            datasource_id_value = int(datasource_id)

    status_value = status.strip() if status else None

    db = get_session()
    try:
        q = db.query(MetadataCollectionJob).options(joinedload(MetadataCollectionJob.datasource))
        if datasource_id_value is not None:
            q = q.filter(MetadataCollectionJob.datasource_id == datasource_id_value)
        if status_value:
            q = q.filter(MetadataCollectionJob.status == status_value)
        jobs = q.order_by(MetadataCollectionJob.started_at.desc()).limit(100).all()
        datasources = db.query(DatasourceConfig).order_by(DatasourceConfig.name).all()
        return templates.TemplateResponse(
            request,
            "metadata/jobs.html",
            {
                "request": request,
                "jobs": jobs,
                "datasources": datasources,
                "current_datasource_id": datasource_id_value,
                "current_status": status_value,
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
        change_summary = {}
        if job.change_summary:
            try:
                change_summary = json.loads(job.change_summary)
            except json.JSONDecodeError:
                change_summary = {"raw": job.change_summary, "samples": []}
        return templates.TemplateResponse(
            request,
            "metadata/job_detail.html",
            {"request": request, "job": job, "change_summary": change_summary},
        )
    finally:
        db.close()


@router.get("/metadata", response_class=HTMLResponse)
def metadata_browse(
    request: Request,
    schema_name: str = None,
    search: str = None,
):
    """元数据浏览页面"""
    db = get_session()
    try:
        q = db.query(TableMetadata)
        if schema_name:
            q = q.filter(TableMetadata.schema_name == schema_name)
        if search:
            q = q.filter(TableMetadata.table_name.like(f"%{search}%"))
        tables = q.order_by(TableMetadata.schema_name, TableMetadata.table_name).all()

        schemas = db.query(TableMetadata.schema_name).distinct().order_by(TableMetadata.schema_name).all()

        return templates.TemplateResponse(
            request,
            "metadata/list.html",
            {
                "request": request,
                "tables": tables,
                "schemas": [s[0] for s in schemas if s[0]],
                "current_schema": schema_name,
                "search": search,
            },
        )
    finally:
        db.close()


@router.get("/metadata/{table_id}", response_class=HTMLResponse)
def metadata_table_detail(request: Request, table_id: int):
    """表详情页面"""
    db = get_session()
    try:
        table = db.query(TableMetadata).filter(TableMetadata.id == table_id).first()
        if not table:
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url="/web/metadata")
        columns = db.query(ColumnMetadata).filter(ColumnMetadata.table_id == table_id).order_by(ColumnMetadata.column_id).all()
        return templates.TemplateResponse(
            request,
            "metadata/detail.html",
            {"request": request, "table": table, "columns": columns},
        )
    finally:
        db.close()


@router.get("/metrics", response_class=HTMLResponse)
def metric_list(request: Request):
    """指标管理页面"""
    db = get_session()
    try:
        metrics = db.query(MetricDefinition).order_by(MetricDefinition.category, MetricDefinition.metric_code).all()
        return templates.TemplateResponse(request, "metrics/list.html", {"request": request, "metrics": metrics})
    finally:
        db.close()


@router.get("/metrics/new", response_class=HTMLResponse)
def metric_new(request: Request):
    """新建指标页面"""
    return templates.TemplateResponse(request, "metrics/form.html", {"request": request})


@router.get("/metrics/{metric_id}", response_class=HTMLResponse)
def metric_detail(request: Request, metric_id: int):
    """指标详情页面"""
    from ..models import MetricCaliber
    db = get_session()
    try:
        m = db.query(MetricDefinition).filter(MetricDefinition.id == metric_id).first()
        if not m:
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url="/web/metrics")
        calibers = db.query(MetricCaliber).filter(MetricCaliber.metric_id == metric_id).all()
        return templates.TemplateResponse(
            request,
            "metrics/detail.html",
            {"request": request, "metric": m, "calibers": calibers},
        )
    finally:
        db.close()


@router.get("/field-semantics", response_class=HTMLResponse)
def field_semantic_list(request: Request):
    """字段语义维护页面"""
    db = get_session()
    try:
        semantics = (
            db.query(FieldSemantic)
            .options(joinedload(FieldSemantic.column).joinedload(ColumnMetadata.table))
            .order_by(FieldSemantic.id.desc())
            .limit(50)
            .all()
        )
        return templates.TemplateResponse(request, "field_semantics/list.html", {"request": request, "semantics": semantics})
    finally:
        db.close()


@router.get("/governance", response_class=HTMLResponse)
def governance_list(request: Request, status: str = None):
    """治理待办页面"""
    db = get_session()
    try:
        q = db.query(GovernanceTicket)
        if status:
            q = q.filter(GovernanceTicket.status == status)
        tickets = q.order_by(GovernanceTicket.created_at.desc()).all()
        return templates.TemplateResponse(
            request,
            "governance/list.html",
            {"request": request, "tickets": tickets, "current_status": status},
        )
    finally:
        db.close()
