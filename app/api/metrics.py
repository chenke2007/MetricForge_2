"""指标治理 API"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..models import MetricDefinition, MetricCaliber, get_session

router = APIRouter()


def get_db():
    db = get_session()
    try:
        yield db
    finally:
        db.close()


@router.get("/")
def list_metrics(
    category: str = Query(None, description="按分类筛选"),
    status: str = Query(None, description="按状态筛选"),
    search: str = Query(None, description="按名称或编码搜索"),
    db: Session = Depends(get_db),
):
    """列出指标定义"""
    q = db.query(MetricDefinition)
    if category:
        q = q.filter(MetricDefinition.category == category)
    if status:
        q = q.filter(MetricDefinition.status == status)
    if search:
        q = q.filter(
            (MetricDefinition.metric_code.like(f"%{search}%"))
            | (MetricDefinition.metric_name.like(f"%{search}%"))
        )
    metrics = q.order_by(MetricDefinition.category, MetricDefinition.metric_code).all()
    return [
        {
            "id": m.id,
            "metric_code": m.metric_code,
            "metric_name": m.metric_name,
            "category": m.category,
            "definition": m.definition,
            "formula": m.formula,
            "owner": m.owner,
            "status": m.status,
            "version": m.version,
            "is_active": m.is_active,
            "source_table": m.source_table,
            "created_at": str(m.created_at),
        }
        for m in metrics
    ]


@router.get("/{metric_id}")
def get_metric(metric_id: int, db: Session = Depends(get_db)):
    """获取指标详情（含口径）"""
    m = db.query(MetricDefinition).filter(MetricDefinition.id == metric_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="指标不存在")

    calibers = db.query(MetricCaliber).filter(MetricCaliber.metric_id == metric_id).all()

    return {
        "id": m.id,
        "metric_code": m.metric_code,
        "metric_name": m.metric_name,
        "metric_name_en": m.metric_name_en,
        "business_aliases": m.business_aliases,
        "category": m.category,
        "definition": m.definition,
        "formula": m.formula,
        "involved_fields": m.involved_fields,
        "applicable_dimensions": m.applicable_dimensions,
        "default_time_grain": m.default_time_grain,
        "default_time_caliber": m.default_time_caliber,
        "data_source_id": m.data_source_id,
        "source_table": m.source_table,
        "owner": m.owner,
        "version": m.version,
        "status": m.status,
        "is_active": m.is_active,
        "created_at": str(m.created_at),
        "updated_at": str(m.updated_at),
        "calibers": [
            {
                "id": c.id,
                "caliber_name": c.caliber_name,
                "caliber_rule": c.caliber_rule,
                "filter_template": c.filter_template,
                "is_default": c.is_default,
            }
            for c in calibers
        ],
    }


@router.post("/")
def create_metric(
    metric_code: str = Query(..., description="指标编码"),
    metric_name: str = Query(..., description="指标名称"),
    category: str = Query(None, description="指标分类"),
    definition: str = Query(None, description="业务定义"),
    formula: str = Query(None, description="计算公式"),
    owner: str = Query(None, description="负责人"),
    source_table: str = Query(None, description="来源表"),
    db: Session = Depends(get_db),
):
    """创建指标"""
    # 检查编码唯一性
    exists = db.query(MetricDefinition).filter(MetricDefinition.metric_code == metric_code).first()
    if exists:
        raise HTTPException(status_code=400, detail=f"指标编码 '{metric_code}' 已存在")

    m = MetricDefinition(
        metric_code=metric_code,
        metric_name=metric_name,
        category=category,
        definition=definition,
        formula=formula,
        owner=owner,
        source_table=source_table,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return {"id": m.id, "metric_code": m.metric_code, "message": "指标创建成功"}


@router.put("/{metric_id}/status")
def update_metric_status(
    metric_id: int,
    status: str = Query(..., description="新状态: draft/pending_review/approved/published/deprecated"),
    db: Session = Depends(get_db),
):
    """更新指标状态"""
    m = db.query(MetricDefinition).filter(MetricDefinition.id == metric_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="指标不存在")
    valid_statuses = {"draft", "pending_review", "approved", "published", "deprecated"}
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"无效状态。可选: {', '.join(valid_statuses)}")
    m.status = status
    db.commit()
    return {"message": f"指标状态已更新为 {status}"}


@router.get("/categories/list")
def list_categories(db: Session = Depends(get_db)):
    """列出所有指标分类"""
    results = db.query(MetricDefinition.category).distinct().order_by(MetricDefinition.category).all()
    return [r[0] for r in results if r[0]]
