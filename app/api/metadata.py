"""元数据查询 API"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..services.metadata_service import collect_metadata

logger = logging.getLogger(__name__)

from ..models import (
    ColumnMetadata,
    ConstraintMetadata,
    IndexMetadata,
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
    """触发元数据采集"""
    try:
        result = collect_metadata(datasource_id)
        if result.get("success"):
            return {"message": "元数据采集完成", "stats": result["stats"]}
        else:
            raise HTTPException(status_code=500, detail=result.get("error", "采集失败"))
    except Exception as e:
        logger.exception("元数据采集异常")
        raise HTTPException(status_code=500, detail=str(e))
