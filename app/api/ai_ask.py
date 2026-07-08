from fastapi import APIRouter, Depends
from ..models.base import get_session as get_db_session
from ..schemas.ai_ask import (
    AiAskAnalyzeRequest,
    AiAskAnalyzeSuccessResponse,
    AiAskAnalyzeErrorResponse,
)
from ..services.ai_ask.llm_service import AiAskLlmService

router = APIRouter()
service = AiAskLlmService()


def get_db():
    db = get_db_session()
    try:
        yield db
    finally:
        db.close()


@router.post("/analyze", response_model=AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse)
def analyze(
    body: AiAskAnalyzeRequest, db=Depends(get_db)
) -> AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse:
    return service.analyze(body.model_dump(), db)
