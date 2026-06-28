from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..models import DatasourceConfig, get_session
from ..services.sql_execution_service import SqlExecutionService
from ..services.sql_schema_service import SqlSchemaService
from ..services.sql_draft_service import SqlDraftService
from ..services.sql_history_service import SqlHistoryService

router = APIRouter()
execution_service = SqlExecutionService()
schema_service = SqlSchemaService()
draft_service = SqlDraftService()
history_service = SqlHistoryService()


def get_db():
    db = get_session()
    try:
        yield db
    finally:
        db.close()


# ─── Request/Response Models ───

class ExecuteRequest(BaseModel):
    datasource_id: int
    sql: str


class CreateDraftRequest(BaseModel):
    title: str = ""
    sql_text: str
    datasource_id: int | None = None
    dialect: str = "oracle"
    description: str | None = None
    tags: str | None = None
    is_template: bool = False


class UpdateDraftRequest(BaseModel):
    title: str | None = None
    sql_text: str | None = None
    datasource_id: int | None = None
    dialect: str | None = None
    description: str | None = None
    tags: str | None = None
    is_template: bool | None = None


# ─── Execute ───

@router.post("/execute")
async def execute_sql(body: ExecuteRequest, db: Session = Depends(get_db)):
    return await execution_service.execute(
        datasource_id=body.datasource_id,
        sql=body.sql,
        db=db,
    )


# ─── Datasources (for SQL workbench) ───

@router.get("/datasources")
def list_sql_datasources(db: Session = Depends(get_db)):
    dses = db.query(DatasourceConfig).filter(
        DatasourceConfig.is_active == True
    ).order_by(DatasourceConfig.name).all()
    return [{
        "id": ds.id,
        "name": ds.name,
        "ds_type": ds.ds_type,
        "dialect": ds.dialect,
    } for ds in dses]


# ─── Schema ───

@router.get("/schema")
def get_schema(datasource_id: int = Query(...), db: Session = Depends(get_db)):
    return schema_service.get_datasource_tree(datasource_id, db)


@router.get("/tables/{table_id}/columns")
def get_table_columns(table_id: int, db: Session = Depends(get_db)):
    return schema_service.get_table_columns(table_id, db)


@router.get("/schema/search")
def search_schema(
    datasource_id: int = Query(...),
    q: str = Query(""),
    db: Session = Depends(get_db),
):
    return schema_service.search(datasource_id, q, db)


# ─── Drafts ───

@router.get("/drafts")
def list_drafts(db: Session = Depends(get_db)):
    return draft_service.list(db)


@router.post("/drafts")
def create_draft(body: CreateDraftRequest, db: Session = Depends(get_db)):
    return draft_service.create(body.model_dump(), db)


@router.get("/drafts/{draft_id}")
def get_draft(draft_id: int, db: Session = Depends(get_db)):
    result = draft_service.get(draft_id, db)
    if not result:
        raise HTTPException(404, detail="草稿不存在")
    return result


@router.put("/drafts/{draft_id}")
def update_draft(draft_id: int, body: UpdateDraftRequest, db: Session = Depends(get_db)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    result = draft_service.update(draft_id, data, db)
    if not result:
        raise HTTPException(404, detail="草稿不存在")
    return result


@router.delete("/drafts/{draft_id}")
def delete_draft(draft_id: int, db: Session = Depends(get_db)):
    if not draft_service.delete(draft_id, db):
        raise HTTPException(404, detail="草稿不存在")
    return {"ok": True}


# ─── History ───

@router.get("/history")
def list_history(
    datasource_id: int | None = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    return history_service.list(db, datasource_id=datasource_id, limit=limit)


@router.get("/history/{history_id}")
def get_history(history_id: int, db: Session = Depends(get_db)):
    result = history_service.get(history_id, db)
    if not result:
        raise HTTPException(404, detail="执行历史不存在")
    return result
