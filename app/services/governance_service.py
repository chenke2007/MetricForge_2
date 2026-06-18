"""治理待办业务逻辑"""

import logging

from ..models import FieldSemantic, GovernanceTicket, get_session

logger = logging.getLogger(__name__)


def auto_resolve_ticket_on_semantic(column_id: int, governed_by: str = None):
    """当字段语义被治理后，自动关闭对应的治理待办"""
    db = get_session()
    try:
        tickets = (
            db.query(GovernanceTicket)
            .filter(
                GovernanceTicket.related_object_type == "column",
                GovernanceTicket.related_object_id == column_id,
                GovernanceTicket.status.in_(["open", "in_progress"]),
            )
            .all()
        )
        for ticket in tickets:
            ticket.status = "resolved"
            ticket.resolution = "字段语义已治理"
            from datetime import datetime
            ticket.resolved_at = datetime.utcnow()
            if governed_by:
                ticket.assignee = governed_by
        db.commit()
        if tickets:
            logger.info("自动关闭 %d 个治理待办 (column_id=%s)", len(tickets), column_id)
    except Exception as e:
        db.rollback()
        logger.error("自动关闭治理待办失败: %s", e)
    finally:
        db.close()


def get_open_ticket_count() -> int:
    """获取待处理的治理待办数量"""
    db = get_session()
    try:
        return (
            db.query(GovernanceTicket)
            .filter(GovernanceTicket.status.in_(["open", "in_progress"]))
            .count()
        )
    finally:
        db.close()
