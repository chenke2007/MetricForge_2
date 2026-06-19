"""元数据查询 API"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..services.metadata_job_service import (
    run_metadata_collection_job,
    serialize_collection_job,
)

logger = logging.getLogger(__name__)

from ..models import (
    ColumnMetadata,
    ConstraintMetadata,
    IndexMetadata,
    MetadataCollectionJob,
    TableMetadata,
    get_session,
)

router = APIRouter()


def get_db():
    db = get_session()
    try:
        yield db
    finally:
        db.close()


@router.get("/tables")
def list_tables(
    datasource_id: int = Query(None, description="按数据源筛选"),
    schema_name: str = Query(None, description="按 Schema 筛选"),
    search: str = Query(None, description="按表名搜索"),
    db: Session = Depends(get_db),
):
    """列出表元数据"""
    q = db.query(TableMetadata)
    if datasource_id:
        q = q.filter(TableMetadata.datasource_id == datasource_id)
    if schema_name:
        q = q.filter(TableMetadata.schema_name == schema_name)
    if search:
        q = q.filter(TableMetadata.table_name.like(f"%{search}%"))
    tables = q.order_by(TableMetadata.schema_name, TableMetadata.table_name).all()
    return [
        {
            "id": t.id,
            "datasource_id": t.datasource_id,
            "schema_name": t.schema_name,
            "table_name": t.table_name,
            "table_comment": t.table_comment,
            "table_type": t.table_type,
            "row_count_est": t.row_count_est,
            "is_sensitive": t.is_sensitive,
        }
        for t in tables
    ]


@router.get("/tables/{table_id}")
def get_table(table_id: int, db: Session = Depends(get_db)):
    """获取表详情（含字段、索引、约束）"""
    table = db.query(TableMetadata).filter(TableMetadata.id == table_id).first()
    if not table:
        raise HTTPException(status_code=404, detail="表不存在")

    columns = db.query(ColumnMetadata).filter(ColumnMetadata.table_id == table_id).order_by(ColumnMetadata.column_id).all()
    indexes = db.query(IndexMetadata).filter(IndexMetadata.table_id == table_id).all()
    constraints = db.query(ConstraintMetadata).filter(ConstraintMetadata.table_id == table_id).all()

    return {
        "table": {
            "id": table.id,
            "schema_name": table.schema_name,
            "table_name": table.table_name,
            "table_comment": table.table_comment,
            "table_type": table.table_type,
            "row_count_est": table.row_count_est,
            "is_sensitive": table.is_sensitive,
        },
        "columns": [
            {
                "id": c.id,
                "column_name": c.column_name,
                "column_type": c.column_type,
                "nullable": c.nullable,
                "comment": c.comment,
                "is_primary_key": c.is_primary_key,
                "is_foreign_key": c.is_foreign_key,
                "distinct_count": c.distinct_count,
                "null_rate": c.null_rate,
                "enum_samples": c.enum_samples,
                "is_sensitive": c.is_sensitive,
            }
            for c in columns
        ],
        "indexes": [
            {
                "index_name": idx.index_name,
                "index_type": idx.index_type,
                "column_names": idx.column_names,
            }
            for idx in indexes
        ],
        "constraints": [
            {
                "constraint_name": con.constraint_name,
                "constraint_type": con.constraint_type,
                "column_names": con.column_names,
                "ref_table": con.ref_table,
                "ref_columns": con.ref_columns,
            }
            for con in constraints
        ],
    }


@router.get("/schemas")
def list_schemas(datasource_id: int = Query(None), db: Session = Depends(get_db)):
    """列出所有 Schema"""
    q = db.query(TableMetadata.schema_name).distinct()
    if datasource_id:
        q = q.filter(TableMetadata.datasource_id == datasource_id)
    results = q.order_by(TableMetadata.schema_name).all()
    return [r[0] for r in results if r[0]]


@router.post("/collect/{datasource_id}")
def trigger_collection(
    datasource_id: int,
    db: Session = Depends(get_db),
):
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
