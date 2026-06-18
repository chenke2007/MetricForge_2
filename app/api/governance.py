"""治理待办 API"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..models import GovernanceTicket, get_session

router = APIRouter()


def get_db():
    db = get_session()
    try:
        yield db
    finally:
        db.close()


@router.get("/")
def list_tickets(
    status: str = Query(None, description="按状态筛选: open/in_progress/resolved/closed"),
    ticket_type: str = Query(None, description="按类型筛选"),
    priority: str = Query(None, description="按优先级筛选"),
    db: Session = Depends(get_db),
):
    """列出治理待办"""
    q = db.query(GovernanceTicket)
    if status:
        q = q.filter(GovernanceTicket.status == status)
    if ticket_type:
        q = q.filter(GovernanceTicket.ticket_type == ticket_type)
    if priority:
        q = q.filter(GovernanceTicket.priority == priority)
    tickets = q.order_by(GovernanceTicket.created_at.desc()).all()
    return [
        {
            "id": t.id,
            "ticket_type": t.ticket_type,
            "title": t.title,
            "source": t.source,
            "related_object_type": t.related_object_type,
            "priority": t.priority,
            "status": t.status,
            "assignee": t.assignee,
            "created_at": str(t.created_at),
        }
        for t in tickets
    ]


@router.get("/{ticket_id}")
def get_ticket(ticket_id: int, db: Session = Depends(get_db)):
    """获取治理待办详情"""
    t = db.query(GovernanceTicket).filter(GovernanceTicket.id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="治理待办不存在")
    return {
        "id": t.id,
        "ticket_type": t.ticket_type,
        "title": t.title,
        "description": t.description,
        "source": t.source,
        "related_object_type": t.related_object_type,
        "related_object_id": t.related_object_id,
        "user_question": t.user_question,
        "priority": t.priority,
        "status": t.status,
        "assignee": t.assignee,
        "resolution": t.resolution,
        "resolved_at": str(t.resolved_at) if t.resolved_at else None,
        "created_at": str(t.created_at),
        "updated_at": str(t.updated_at),
    }


@router.post("/")
def create_ticket(
    ticket_type: str = Query(..., description="待办类型"),
    title: str = Query(..., description="待办标题"),
    description: str = Query(None, description="详细描述"),
    priority: str = Query("medium", description="优先级"),
    related_object_type: str = Query(None, description="关联对象类型"),
    related_object_id: int = Query(None, description="关联对象 ID"),
    assignee: str = Query(None, description="负责人"),
    db: Session = Depends(get_db),
):
    """创建治理待办"""
    t = GovernanceTicket(
        ticket_type=ticket_type,
        title=title,
        description=description,
        priority=priority,
        related_object_type=related_object_type,
        related_object_id=related_object_id,
        assignee=assignee,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"id": t.id, "message": "治理待办创建成功"}


@router.put("/{ticket_id}/status")
def update_ticket_status(
    ticket_id: int,
    status: str = Query(..., description="新状态: open/in_progress/resolved/closed"),
    resolution: str = Query(None, description="解决方案"),
    db: Session = Depends(get_db),
):
    """更新治理待办状态"""
    t = db.query(GovernanceTicket).filter(GovernanceTicket.id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="治理待办不存在")
    valid_statuses = {"open", "in_progress", "resolved", "closed"}
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"无效状态。可选: {', '.join(valid_statuses)}")
    t.status = status
    if status in ("resolved", "closed") and resolution:
        t.resolution = resolution
        from datetime import datetime
        t.resolved_at = datetime.utcnow()
    db.commit()
    return {"message": f"治理待办状态已更新为 {status}"}


@router.put("/{ticket_id}/assign")
def assign_ticket(
    ticket_id: int,
    assignee: str = Query(..., description="负责人"),
    db: Session = Depends(get_db),
):
    """分配治理待办负责人"""
    t = db.query(GovernanceTicket).filter(GovernanceTicket.id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="治理待办不存在")
    t.assignee = assignee
    if t.status == "open":
        t.status = "in_progress"
    db.commit()
    return {"message": f"治理待办已分配给 {assignee}"}
