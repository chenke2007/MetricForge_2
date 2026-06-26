"""AI 问数 API 路由（含 SSE 流式输出）。"""

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..models.base import get_session as get_db_session
from ..services.ask_service import AskService
from ..models import AskMessage, AskMessageToolCall

router = APIRouter()
service = AskService()


class CreateSessionRequest(BaseModel):
    title: str = "新对话"
    llm_setting_id: int | None = None


class UpdateSessionRequest(BaseModel):
    title: str


class CreateMessageRequest(BaseModel):
    content: str


def get_db():
    db = get_db_session()
    try:
        yield db
    finally:
        db.close()


@router.get("/sessions")
def list_sessions(db=Depends(get_db)):
    return service.list_sessions(db)


@router.post("/sessions", status_code=201)
def create_session(body: CreateSessionRequest, db=Depends(get_db)):
    try:
        return service.create_session(db, title=body.title, llm_setting_id=body.llm_setting_id)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))


@router.get("/sessions/{session_id}")
def get_session(session_id: int, db=Depends(get_db)):
    result = service.get_session(db, session_id)
    if not result:
        raise HTTPException(404, detail="会话不存在")
    return result


@router.put("/sessions/{session_id}")
def update_session(session_id: int, body: UpdateSessionRequest, db=Depends(get_db)):
    result = service.update_session(db, session_id, title=body.title)
    if not result:
        raise HTTPException(404, detail="会话不存在")
    return result


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int, db=Depends(get_db)):
    if not service.delete_session(db, session_id):
        raise HTTPException(404, detail="会话不存在")
    return {"ok": True}


@router.get("/sessions/{session_id}/messages")
def get_messages(session_id: int, db=Depends(get_db)):
    messages = (
        db.query(AskMessage)
        .filter(AskMessage.session_id == session_id)
        .order_by(AskMessage.created_at)
        .all()
    )
    result = []
    for m in messages:
        item = {
            "id": m.id,
            "session_id": m.session_id,
            "role": m.role,
            "content": m.content,
            "status": m.status,
            "error_message": m.error_message,
            "tokens_prompt": m.tokens_prompt,
            "tokens_completion": m.tokens_completion,
            "created_at": m.created_at.isoformat(),
        }
        tool_calls = (
            db.query(AskMessageToolCall)
            .filter(AskMessageToolCall.message_id == m.id)
            .order_by(AskMessageToolCall.created_at)
            .all()
        )
        item["tool_calls"] = [tc.to_dict() for tc in tool_calls]
        result.append(item)
    return result


@router.post("/sessions/{session_id}/messages", status_code=201)
def create_message(session_id: int, body: CreateMessageRequest, db=Depends(get_db)):
    try:
        return service.create_message(db, session_id, content=body.content)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))


@router.get("/sessions/{session_id}/stream")
async def stream_response(
    session_id: int,
    after: int = Query(..., description="assistant message ID to stream from"),
    db=Depends(get_db),
):
    generator = service.stream_response(db, session_id, after_message_id=after)
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
