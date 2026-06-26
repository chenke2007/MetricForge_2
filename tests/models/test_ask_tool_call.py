"""Test AskMessageToolCall model."""

from app.models import AskMessageToolCall


def test_ask_message_tool_call_creation(db_session):
    tc = AskMessageToolCall(
        message_id=1,
        tool_name="datasource_stats",
        arguments='{}',
        result='{"total": 3}',
        status="success",
    )
    db_session.add(tc)
    db_session.commit()
    db_session.refresh(tc)
    assert tc.id is not None
    assert tc.to_dict()["tool_name"] == "datasource_stats"
