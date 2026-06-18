"""Governance ticket business logic."""

import logging
from datetime import datetime

from ..models import GovernanceTicket, get_session

logger = logging.getLogger(__name__)


def auto_resolve_ticket_on_semantic(column_id: int, governed_by: str = None) -> int:
    """Auto-resolve open tickets related to a governed column semantic."""
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
            ticket.resolution = "\u5b57\u6bb5\u8bed\u4e49\u5df2\u6cbb\u7406"
            ticket.resolved_at = datetime.utcnow()
            if governed_by:
                ticket.assignee = governed_by
        db.commit()
        if tickets:
            logger.info("Auto-resolved %d governance tickets (column_id=%s)", len(tickets), column_id)
        return len(tickets)
    except Exception as e:
        db.rollback()
        logger.error("Failed to auto-resolve governance tickets: %s", e)
        raise
    finally:
        db.close()


def get_open_ticket_count() -> int:
    """Return the number of open governance tickets."""
    db = get_session()
    try:
        return (
            db.query(GovernanceTicket)
            .filter(GovernanceTicket.status.in_(["open", "in_progress"]))
            .count()
        )
    finally:
        db.close()
