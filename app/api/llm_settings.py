"""LLM 连接配置 API 路由。"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..models import get_session
from ..services.llm_settings_service import LlmSettingsService

router = APIRouter()
service = LlmSettingsService()


class CreateLlmSettingRequest(BaseModel):
    name: str
    base_url: str
    api_key: str
    model_name: str


class UpdateLlmSettingRequest(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model_name: str | None = None


def get_db():
    db = get_session()
    try:
        yield db
    finally:
        db.close()


@router.get("")
def list_settings(db=Depends(get_db)):
    return service.list(db)


@router.post("", status_code=201)
def create_setting(body: CreateLlmSettingRequest, db=Depends(get_db)):
    return service.create(db, name=body.name, base_url=body.base_url,
                          api_key=body.api_key, model_name=body.model_name)


@router.get("/{setting_id}")
def get_setting(setting_id: int, db=Depends(get_db)):
    result = service.get(db, setting_id)
    if not result:
        raise HTTPException(404, detail="LLM 配置不存在")
    return result


@router.put("/{setting_id}")
def update_setting(setting_id: int, body: UpdateLlmSettingRequest, db=Depends(get_db)):
    result = service.update(db, setting_id, name=body.name, base_url=body.base_url,
                            api_key=body.api_key, model_name=body.model_name)
    if not result:
        raise HTTPException(404, detail="LLM 配置不存在")
    return result


@router.delete("/{setting_id}")
def delete_setting(setting_id: int, db=Depends(get_db)):
    if not service.delete(db, setting_id):
        raise HTTPException(404, detail="LLM 配置不存在")
    return {"ok": True}


@router.post("/{setting_id}/test")
def test_connection(setting_id: int, db=Depends(get_db)):
    return service.test_connection(db, setting_id)


@router.post("/{setting_id}/activate")
def activate_setting(setting_id: int, db=Depends(get_db)):
    result = service.activate(db, setting_id)
    if not result:
        raise HTTPException(404, detail="LLM 配置不存在")
    return result
