from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..models import get_session
from ..services.chart_draft_service import ChartDraftService

router = APIRouter()
draft_service = ChartDraftService()


def get_db():
    db = get_session()
    try:
        yield db
    finally:
        db.close()


class ChartConfig(BaseModel):
    chartType: str
    xColumn: str | None = None
    yColumn: str | None = None


class CreateChartDraftRequest(BaseModel):
    title: str = ""
    sql_text: str = Field(..., min_length=1)
    datasource_id: int | None = None
    chart_config: ChartConfig


class UpdateChartDraftRequest(BaseModel):
    title: str | None = None
    sql_text: str | None = Field(None, min_length=1)
    datasource_id: int | None = None
    chart_config: ChartConfig | None = None


@router.get("/chart-drafts")
def list_chart_drafts(db: Session = Depends(get_db)):
    return draft_service.list(db)


@router.post("/chart-drafts")
def create_chart_draft(body: CreateChartDraftRequest, db: Session = Depends(get_db)):
    return draft_service.create(body.model_dump(), db)


@router.get("/chart-drafts/{draft_id}")
def get_chart_draft(draft_id: int, db: Session = Depends(get_db)):
    result = draft_service.get(draft_id, db)
    if not result:
        raise HTTPException(404, detail="图表草稿不存在")
    return result


@router.put("/chart-drafts/{draft_id}")
def update_chart_draft(
    draft_id: int,
    body: UpdateChartDraftRequest,
    db: Session = Depends(get_db),
):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    result = draft_service.update(draft_id, data, db)
    if not result:
        raise HTTPException(404, detail="图表草稿不存在")
    return result


@router.delete("/chart-drafts/{draft_id}")
def delete_chart_draft(draft_id: int, db: Session = Depends(get_db)):
    if not draft_service.delete(draft_id, db):
        raise HTTPException(404, detail="图表草稿不存在")
    return {"ok": True}
