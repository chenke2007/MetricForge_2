from enum import Enum
from typing import Any, Literal
from pydantic import BaseModel, Field


class AiAskErrorCode(str, Enum):
    LLM_NOT_CONFIGURED = "LLM_NOT_CONFIGURED"
    INVALID_RESPONSE = "INVALID_RESPONSE"
    ANALYSIS_TIMEOUT = "ANALYSIS_TIMEOUT"
    LLM_AUTH_ERROR = "LLM_AUTH_ERROR"
    LLM_CONNECTION_ERROR = "LLM_CONNECTION_ERROR"
    LLM_RATE_LIMIT = "LLM_RATE_LIMIT"
    UNKNOWN = "UNKNOWN"


class AiAskAnalyzeRequest(BaseModel):
    question: str
    datasource_id: int = Field(..., alias="datasourceId")
    datasource_name: str = Field(..., alias="datasourceName")
    selected_tables: list[str] = Field(default_factory=list, alias="selectedTables")
    message_history: list[dict[str, Any]] = Field(default_factory=list, alias="messageHistory")

    model_config = {"populate_by_name": True}


class AiAskAnalyzeSuccessResponse(BaseModel):
    ok: Literal[True] = True
    data: dict[str, Any]


class AiAskAnalyzeErrorResponse(BaseModel):
    ok: Literal[False] = False
    error_code: str = Field(..., alias="errorCode")
    error_message: str = Field(..., alias="errorMessage")
    details: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}
