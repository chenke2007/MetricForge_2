"""LLM 连接配置服务层。"""

import time
import logging
from datetime import datetime, timezone
from typing import Optional
from openai import OpenAI
from sqlalchemy.orm import Session

from ..models import LlmSetting, get_session
from ..models.ask_models import _utcnow
from .key_encryption import encrypt, decrypt, mask_api_key

logger = logging.getLogger(__name__)


class LlmSettingsService:
    """LLM 连接配置管理（CRUD + 连接测试 + 启用切换）"""

    def list(self, db: Session) -> list[dict]:
        settings = db.query(LlmSetting).order_by(LlmSetting.is_active.desc(), LlmSetting.created_at.desc()).all()
        return [self._to_response(s) for s in settings]

    def get(self, db: Session, setting_id: int) -> dict | None:
        s = db.query(LlmSetting).filter(LlmSetting.id == setting_id).first()
        return self._to_response(s) if s else None

    def create(self, db: Session, name: str, base_url: str, api_key: str, model_name: str) -> dict:
        encrypted = encrypt(api_key)
        setting = LlmSetting(
            name=name,
            base_url=base_url.rstrip("/"),
            api_key=encrypted,
            model_name=model_name,
        )
        db.add(setting)
        db.commit()
        db.refresh(setting)
        return self._to_response(setting)

    def update(self, db: Session, setting_id: int, name: str | None = None,
               base_url: str | None = None, api_key: str | None = None,
               model_name: str | None = None) -> dict | None:
        s = db.query(LlmSetting).filter(LlmSetting.id == setting_id).first()
        if not s:
            return None
        if name is not None:
            s.name = name
        if base_url is not None:
            s.base_url = base_url.rstrip("/")
        if api_key is not None and api_key.strip():
            s.api_key = encrypt(api_key)
        if model_name is not None:
            s.model_name = model_name
        db.commit()
        db.refresh(s)
        return self._to_response(s)

    def delete(self, db: Session, setting_id: int) -> bool:
        s = db.query(LlmSetting).filter(LlmSetting.id == setting_id).first()
        if not s:
            return False
        db.delete(s)
        db.commit()
        return True

    def activate(self, db: Session, setting_id: int) -> dict | None:
        """启用指定配置（将其他配置置为停用）。"""
        s = db.query(LlmSetting).filter(LlmSetting.id == setting_id).first()
        if not s:
            return None
        # Deactivate all
        db.query(LlmSetting).update({"is_active": 0})
        # Activate target
        s.is_active = 1
        db.commit()
        db.refresh(s)
        return self._to_response(s)

    def get_active(self, db: Session) -> dict | None:
        s = db.query(LlmSetting).filter(LlmSetting.is_active == 1).first()
        return self._to_response(s) if s else None

    def test_connection(self, db: Session, setting_id: int) -> dict:
        """测试 LLM 连接。返回脱敏后的结果。"""
        s = db.query(LlmSetting).filter(LlmSetting.id == setting_id).first()
        if not s:
            return {"ok": False, "model": None, "latency_ms": None, "error": "配置不存在"}

        base_url = s.base_url
        model_name = s.model_name
        api_key = decrypt(s.api_key)

        start = time.time()
        try:
            client = OpenAI(base_url=f"{base_url}/v1", api_key=api_key, timeout=30)
            response = client.chat.completions.create(
                model=model_name,
                messages=[{"role": "user", "content": "hi"}],
                max_tokens=5,
            )
            latency = int((time.time() - start) * 1000)
            s.last_tested_at = _utcnow()
            s.last_tested_ok = 1
            db.commit()
            return {"ok": True, "model": response.model, "latency_ms": latency, "error": None}
        except Exception as e:
            latency = int((time.time() - start) * 1000)
            s.last_tested_at = _utcnow()
            s.last_tested_ok = 0
            db.commit()
            error_msg = self._sanitize_error(e)
            return {"ok": False, "model": None, "latency_ms": latency, "error": error_msg}

    def _sanitize_error(self, e: Exception) -> str:
        msg = str(e).lower()
        if "connect" in msg or "connection" in msg or "dns" in msg or "refused" in msg:
            return "无法连接到服务器，请检查 Base URL"
        if "401" in msg or "403" in msg or "unauthorized" in msg or "forbidden" in msg or "auth" in msg:
            return "认证失败，请检查 API Key"
        if "404" in msg:
            return "模型不存在，请检查模型名"
        if "timeout" in msg or "timed out" in msg:
            return "连接超时，请检查网络或服务器状态"
        return f"连接测试失败（{type(e).__name__}），请检查配置"

    def _to_response(self, s: LlmSetting) -> dict:
        try:
            decrypted = decrypt(s.api_key)
            masked = mask_api_key(decrypted)
        except Exception:
            masked = "***INVALID KEY***"
        return {
            "id": s.id,
            "name": s.name,
            "base_url": s.base_url,
            "api_key_masked": masked,
            "model_name": s.model_name,
            "is_active": bool(s.is_active),
            "last_tested_at": s.last_tested_at.isoformat() if s.last_tested_at else None,
            "last_tested_ok": bool(s.last_tested_ok) if s.last_tested_ok is not None else None,
            "created_at": s.created_at.isoformat(),
            "updated_at": s.updated_at.isoformat(),
        }
