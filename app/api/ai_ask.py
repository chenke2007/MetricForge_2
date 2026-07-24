from fastapi import APIRouter, Depends
from ..models.base import get_session as get_db_session
from ..schemas.ai_ask import (
    AiAskAnalyzeRequest,
    AiAskAnalyzeSuccessResponse,
    AiAskAnalyzeErrorResponse,
    AiAskExecuteSqlRequest,
)
from ..services.ai_ask.llm_service import AiAskLlmService
from ..services.ai_ask.execution_service import execute_sql_analysis

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


@router.post("/execute-sql", response_model=AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse)
def execute_sql(
    body: AiAskExecuteSqlRequest, db=Depends(get_db)
) -> AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse:
    return execute_sql_analysis(
        db=db,
        session_id=body.session_id,
        assistant_message_id=body.assistant_message_id,
    )
