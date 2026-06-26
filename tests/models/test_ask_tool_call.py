"""Test AskMessageToolCall model."""

from app.models import AskSession, AskMessage, AskMessageToolCall


def test_ask_message_tool_call_creation(db_session):
    # Create parent session and message first to satisfy FK constraints
    session = AskSession(title="test", model_name="gpt")
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)

    msg = AskMessage(session_id=session.id, role="assistant", content="answer", status="completed")
    db_session.add(msg)
    db_session.commit()
    db_session.refresh(msg)

    tc = AskMessageToolCall(
        message_id=msg.id,
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
