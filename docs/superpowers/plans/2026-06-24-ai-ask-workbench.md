# AI 问数工作台 MVP 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build AI 问数对话工作台 MVP with LLM connection management + conversational Q&A over the data warehouse, using local LLM via OpenAI-compatible API.

**Architecture:** Add `llm_settings`, `ask_sessions`, `ask_messages` tables and backend services. Frontend adds two new pages under `/app/llm-settings` and `/app/ask`. LLM calls use OpenAI-compatible streaming API. API Key encrypted with `cryptography.fernet`. Schema context retrieved via keyword matching from existing metadata (no vector RAG yet).

**Tech Stack:** FastAPI, SQLAlchemy, cryptography, openai, React 18, TypeScript, Ant Design 5, TanStack Query 5, Zustand, react-markdown, remark-gfm, prism-react-renderer

## Global Constraints

- Do NOT modify `app/web/` or any Jinja2 templates
- Do NOT modify existing API routes or their response shapes
- Do NOT commit `DESIGN-vercel.md` or `reports/`
- API Key must be encrypted with `cryptography.fernet`, never returned plaintext
- API Key in responses must be masked: `sk-****{last4}`
- SSE errors and connection test errors must be sanitized (no raw API error leakage)
- Phase 2 MVP does NOT execute generated SQL
- Phase 2 MVP does NOT include vector RAG
- Phase 2 MVP uses SSE, not WebSocket

---

## File Structure

```
app/
├── api/
│   ├── llm_settings.py          # 新增: LLM 配置 CRUD + 连接测试 + 启用切换
│   └── ask.py                   # 新增: 问数会话管理 + 消息 + SSE 流
├── services/
│   ├── key_encryption.py        # 新增: API Key 加密/解密工具
│   ├── llm_settings_service.py  # 新增: LLM 配置服务层
│   ├── schema_context_service.py # 新增: Schema 上下文检索
│   └── ask_service.py           # 新增: 问数编排 + SSE 流式输出
├── models/
│   └── ask_models.py            # 新增: llm_settings, ask_sessions, ask_messages 模型
├── main.py                      # 修改: 注册新 router

frontend/src/
├── api/
│   ├── llmSettings.ts           # 新增: LLM 配置 TanStack Query hooks
│   └── askSessions.ts           # 新增: 问数会话 hooks
├── pages/
│   ├── LlmSettingsPage.tsx      # 新增: LLM 配置管理页面
│   └── AskWorkbenchPage.tsx     # 新增: AI 问数工作台页面
├── components/
│   ├── LlmSettingCard.tsx       # 新增: LLM 配置卡片
│   ├── LlmSettingFormModal.tsx  # 新增: 新增/编辑弹窗
│   ├── SessionList.tsx          # 新增: 对话历史列表
│   ├── MessageThread.tsx        # 新增: 消息流容器
│   ├── UserMessage.tsx          # 新增: 用户消息气泡
│   ├── AssistantMessage.tsx     # 新增: 助手消息气泡
│   ├── StreamingMessage.tsx     # 新增: 流式消息渲染
│   ├── MarkdownRenderer.tsx     # 新增: Markdown 渲染
│   ├── SqlCodeBlock.tsx         # 新增: SQL 代码块语法高亮
│   └── AskInput.tsx             # 新增: 底部输入区
├── stores/
│   └── askStore.ts              # 新增: Zustand store（当前 session、streaming 状态）
├── App.tsx                      # 修改: 新增 LLM 配置和问数路由
└── components/Layout.tsx        # 修改: 新增菜单项
```

---

### Task 1: Backend Models + Encryption + Schema Migration

**Files:**
- Create: `app/models/ask_models.py`
- Create: `app/services/key_encryption.py`
- Modify: `app/models/__init__.py`
- Modify: `app/services/schema_migration_service.py`
- Test: `tests/test_ask_models.py`

**Interfaces:**
- Produces: `LlmSetting` model (table `llm_settings`)
- Produces: `AskSession` model (table `ask_sessions`)
- Produces: `AskMessage` model (table `ask_messages`)
- Produces: `KeyEncryption.encrypt(plaintext) → (ciphertext, salt)`
- Produces: `KeyEncryption.decrypt(ciphertext, salt) → plaintext`
- Consumes: `Base` from `app.models.base`
- Consumes: `ensure_sqlite_schema(engine)` from `app.services.schema_migration_service`

- [ ] **Step 1: Create `app/services/key_encryption.py`**

```python
"""API Key 加密/解密工具，使用 cryptography.fernet 对称加密。"""

import os
import base64
import hashlib
from cryptography.fernet import Fernet


_ENC_KEY_ENV = "METRICFORGE_ENC_KEY"


def _derive_fernet_key(master_key: str) -> bytes:
    """将任意字符串主密钥派生为 Fernet 所需的 32 字节 URL-safe base64 密钥。"""
    raw = hashlib.sha256(master_key.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(raw)


def _get_master_key() -> str:
    key = os.environ.get(_ENC_KEY_ENV)
    if not key:
        raise RuntimeError(
            f"环境变量 {_ENC_KEY_ENV} 未设置，无法进行加密操作。"
        )
    return key


def encrypt(plaintext: str) -> str:
    """加密明文，返回 Fernet token 字符串。"""
    f = Fernet(_derive_fernet_key(_get_master_key()))
    return f.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt(ciphertext: str) -> str:
    """解密密文，返回明文字符串。"""
    f = Fernet(_derive_fernet_key(_get_master_key()))
    return f.decrypt(ciphertext.encode("utf-8")).decode("utf-8")


def mask_api_key(api_key: str) -> str:
    """脱敏 API Key：仅显示前缀和后4位。"""
    if len(api_key) <= 8:
        return api_key[:3] + "****" + api_key[-4:] if len(api_key) > 4 else "****"
    return api_key[:3] + "****" + api_key[-4:]
```

- [ ] **Step 2: Write encryption tests**

Create `tests/test_key_encryption.py`:

```python
"""Test key encryption and masking."""

import os
import pytest
from app.services.key_encryption import encrypt, decrypt, mask_api_key


@pytest.fixture(autouse=True)
def _set_enc_key(monkeypatch):
    monkeypatch.setenv("METRICFORGE_ENC_KEY", "test-master-key-0123456789")


def test_encrypt_decrypt_roundtrip():
    plain = "sk-test-key-value-12345"
    cipher = encrypt(plain)
    assert cipher != plain
    assert decrypt(cipher) == plain


def test_encrypt_different_each_time():
    plain = "sk-test-key"
    c1 = encrypt(plain)
    c2 = encrypt(plain)
    assert c1 != c2  # Fernet salts each encryption


def test_mask_api_key_typical():
    assert mask_api_key("sk-VaZuwZGRVwOSBjgLcM2WEHnwIm6swCgOkydtp2L6uEMLaz2y") == "sk-****Laz2y"


def test_mask_api_key_short():
    assert mask_api_key("sk-abc") == "****"


def test_encrypt_no_key_raises(monkeypatch):
    monkeypatch.delenv("METRICFORGE_ENC_KEY", raising=False)
    with pytest.raises(RuntimeError, match="METRICFORGE_ENC_KEY"):
        encrypt("test")
```

- [ ] **Step 3: Run encryption tests and verify they fail initially**

```powershell
cd d:\projects\MetricForge
$env:PYTHONPATH='.'
$env:METRICFORGE_ENC_KEY='test-key'
pytest tests/test_key_encryption.py -v
```

Expected: Since the file doesn't exist yet, pytest will fail with import error.

- [ ] **Step 4: Create `app/models/ask_models.py`**

```python
"""Ask-related SQLAlchemy models: LLM settings, sessions, messages."""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, CheckConstraint
from .base import Base


def _utcnow():
    return datetime.now(timezone.utc)


class LlmSetting(Base):
    """LLM 连接配置（API Key 加密存储）"""
    __tablename__ = "llm_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    base_url = Column(String(500), nullable=False)
    api_key = Column(String(500), nullable=False)  # Fernet 加密密文
    model_name = Column(String(100), nullable=False)
    is_active = Column(Integer, nullable=False, default=0)
    last_tested_at = Column(DateTime, nullable=True)
    last_tested_ok = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)


class AskSession(Base):
    """AI 问数会话"""
    __tablename__ = "ask_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=False, default="新对话")
    llm_setting_id = Column(Integer, ForeignKey("llm_settings.id"), nullable=True)
    model_name = Column(String(100), nullable=False)
    message_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)


class AskMessage(Base):
    """AI 问数对话消息"""
    __tablename__ = "ask_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("ask_sessions.id"), nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False, default="")
    status = Column(String(20), nullable=False, default="completed")
    error_message = Column(Text, nullable=True)
    tokens_prompt = Column(Integer, nullable=True)
    tokens_completion = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)

    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant', 'system')", name="ck_message_role"),
        CheckConstraint("status IN ('pending', 'streaming', 'completed', 'failed')", name="ck_message_status"),
    )
```

- [ ] **Step 5: Update `app/models/__init__.py`**

Add imports for the three new models:

```python
from .ask_models import LlmSetting, AskSession, AskMessage
```

Add to `__all__`:
```python
    "LlmSetting",
    "AskSession",
    "AskMessage",
```

- [ ] **Step 6: Update `app/services/schema_migration_service.py`**

Add migration entries for new tables. Add to the `METADATA_COLUMNS` dict:

```python
    "llm_settings": [
        ("api_key", "VARCHAR(500) NOT NULL DEFAULT ''"),
    ],
    "ask_messages": [
        ("error_message", "TEXT"),
        ("tokens_prompt", "INTEGER"),
        ("tokens_completion", "INTEGER"),
    ],
```

- [ ] **Step 7: Run tests to verify models and encryption work**

```powershell
cd d:\projects\MetricForge
$env:METRICFORGE_ENC_KEY='test-key'
pytest tests/test_key_encryption.py -v
```

Expected: All 4 tests pass.

- [ ] **Step 8: Commit Task 1**

```powershell
git add app/models/ask_models.py app/services/key_encryption.py app/models/__init__.py app/services/schema_migration_service.py tests/test_key_encryption.py
git commit -m "feat: add LLM settings and ask session/message models with key encryption"
```

---

### Task 2: LLM Settings Backend (Service + API)

**Files:**
- Create: `app/services/llm_settings_service.py`
- Create: `app/api/llm_settings.py`
- Create: `tests/test_llm_settings_api.py`
- Modify: `app/main.py`

**Interfaces:**
- Consumes: `LlmSetting` model, `get_session()`
- Consumes: `KeyEncryption.encrypt/decrypt/mask_api_key` from Task 1
- Consumes: `create_app()` from `app.main`
- Produces: `LlmSettingsService` class with CRUD + test_connection + activate
- Produces: `router` at `/api/llm-settings` registered in `app/main.py`

- [ ] **Step 1: Create `app/services/llm_settings_service.py`**

```python
"""LLM 连接配置服务层。"""

import time
import logging
from datetime import datetime, timezone
from typing import Optional
from openai import OpenAI
from sqlalchemy.orm import Session

from ..models import LlmSetting, get_session
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

    def get_active(self, db: Session) -> LlmSetting | None:
        return db.query(LlmSetting).filter(LlmSetting.is_active == 1).first()

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
        return f"连接测试失败（{type(e).__name__}）"

    def _to_response(self, s: LlmSetting) -> dict:
        return {
            "id": s.id,
            "name": s.name,
            "base_url": s.base_url,
            "api_key_masked": mask_api_key(decrypt(s.api_key)),
            "model_name": s.model_name,
            "is_active": bool(s.is_active),
            "last_tested_at": s.last_tested_at.isoformat() if s.last_tested_at else None,
            "last_tested_ok": bool(s.last_tested_ok) if s.last_tested_ok is not None else None,
            "created_at": s.created_at.isoformat(),
            "updated_at": s.updated_at.isoformat(),
        }
```

- [ ] **Step 2: Create `app/api/llm_settings.py`**

```python
"""LLM 连接配置 API 路由。"""

from fastapi import APIRouter, HTTPException
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
```

- [ ] **Step 3: Register router in `app/main.py`**

Add after existing API router imports (around line 61):

```python
    from .api.llm_settings import router as llm_settings_router
```

Add after existing API router registrations (after line 69):

```python
    app.include_router(llm_settings_router, prefix="/api/llm-settings", tags=["LLM 配置"])
```

- [ ] **Step 4: Write API tests**

Create `tests/test_llm_settings_api.py`:

```python
"""Test LLM settings CRUD API."""

import os
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")

from app.main import create_app


@pytest.fixture
def client():
    app = create_app(database_url="sqlite:///./data/test_llm_settings.db")
    with TestClient(app) as c:
        yield c


def test_list_empty(client):
    resp = client.get("/api/llm-settings")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_setting(client):
    resp = client.post("/api/llm-settings", json={
        "name": "DeepSeek V4",
        "base_url": "http://test.example.com:8080",
        "api_key": "sk-test-key-1234567890",
        "model_name": "DeepSeek-V4-Flash",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "DeepSeek V4"
    assert data["model_name"] == "DeepSeek-V4-Flash"
    assert "sk-****7890" in data["api_key_masked"]
    assert data["is_active"] is False
    assert "api_key" not in data  # never return plaintext


def test_get_setting(client):
    resp = client.post("/api/llm-settings", json={
        "name": "Qwen",
        "base_url": "http://localhost:8000",
        "api_key": "sk-qwen-key-demo",
        "model_name": "qwen2.5",
    })
    sid = resp.json()["id"]

    resp = client.get(f"/api/llm-settings/{sid}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Qwen"


def test_get_setting_not_found(client):
    resp = client.get("/api/llm-settings/999")
    assert resp.status_code == 404


def test_update_setting(client):
    resp = client.post("/api/llm-settings", json={
        "name": "Old",
        "base_url": "http://old.com",
        "api_key": "sk-old-key",
        "model_name": "old-model",
    })
    sid = resp.json()["id"]

    resp = client.put(f"/api/llm-settings/{sid}", json={"name": "New Name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"
    # API key unchanged when not provided
    assert "sk-****" in resp.json()["api_key_masked"]


def test_activate_only_one(client):
    """激活一个配置时，其他配置应自动停用。"""
    resp1 = client.post("/api/llm-settings", json={
        "name": "A", "base_url": "http://a.com", "api_key": "sk-a", "model_name": "a"
    })
    id1 = resp1.json()["id"]
    resp2 = client.post("/api/llm-settings", json={
        "name": "B", "base_url": "http://b.com", "api_key": "sk-b", "model_name": "b"
    })
    id2 = resp2.json()["id"]

    client.post(f"/api/llm-settings/{id1}/activate")
    resp = client.get("/api/llm-settings")
    items = resp.json()
    active = [i for i in items if i["is_active"]]
    assert len(active) == 1
    assert active[0]["id"] == id1

    client.post(f"/api/llm-settings/{id2}/activate")
    resp = client.get("/api/llm-settings")
    items = resp.json()
    active = [i for i in items if i["is_active"]]
    assert len(active) == 1
    assert active[0]["id"] == id2


def test_delete_setting(client):
    resp = client.post("/api/llm-settings", json={
        "name": "Temp", "base_url": "http://t.com", "api_key": "sk-t", "model_name": "t"
    })
    sid = resp.json()["id"]
    resp = client.delete(f"/api/llm-settings/{sid}")
    assert resp.status_code == 200
    resp = client.get(f"/api/llm-settings/{sid}")
    assert resp.status_code == 404
```

- [ ] **Step 5: Run tests**

```powershell
cd d:\projects\MetricForge
$env:PYTHONPATH='.'
$env:METRICFORGE_ENC_KEY='test-master-key-0123456789'
pytest tests/test_llm_settings_api.py -v
```

Expected: All 6 tests pass (test_connection requires a real LLM endpoint, skip in unit tests).

- [ ] **Step 6: Commit Task 2**

```powershell
git add app/services/llm_settings_service.py app/api/llm_settings.py app/main.py tests/test_llm_settings_api.py
git commit -m "feat: add LLM settings management backend (CRUD + activate + connection test)"
```

---

### Task 3: Schema Context Service

**Files:**
- Create: `app/services/schema_context_service.py`
- Create: `tests/test_schema_context.py`

**Interfaces:**
- Consumes: `TableMetadata`, `ColumnMetadata`, `FieldSemantic`, `MetricDefinition` models
- Consumes: `get_session()` from `app.models`
- Produces: `SchemaContextService.build_context(query: str) → str` — returns a system prompt fragment

- [ ] **Step 1: Create `app/services/schema_context_service.py`**

```python
"""轻量级 Schema 上下文检索服务。

通过关键词匹配从现有元数据、字段语义、指标口径中检索上下文。
暂不引入向量 RAG。
"""

import re
import logging
from typing import Optional
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import (
    TableMetadata,
    ColumnMetadata,
    FieldSemantic,
    MetricDefinition,
    get_session,
)

logger = logging.getLogger(__name__)

# 默认忽略的 Schema
_IGNORE_SCHEMAS = {"INFORMATION_SCHEMA", "SYS", "SYSTEM", "DBA"}

# Token 预算：system prompt 不超过模型 context 的 60%
# 按 ~4 chars/token 估算
_MAX_SYSTEM_CHARS = 4000  # 约 1000 tokens，足够 MVP 使用


class SchemaContextService:
    """从现有元数据中构建 Schema 上下文"""

    def build_context(self, query: str, db: Optional[Session] = None) -> str:
        """根据用户查询构建 Schema Context 文本。"""
        close_db = False
        if db is None:
            db = get_session()
            close_db = True
        try:
            keywords = self._extract_keywords(query)
            parts = []

            # 1. 匹配表名
            tables_text = self._find_tables(keywords, db)
            if tables_text:
                parts.append(tables_text)

            # 2. 匹配字段语义
            semantics_text = self._find_field_semantics(keywords, db)
            if semantics_text:
                parts.append(semantics_text)

            # 3. 匹配指标口径
            metrics_text = self._find_metrics(keywords, db)
            if metrics_text:
                parts.append(metrics_text)

            if not parts:
                return ""

            combined = "\n\n".join(parts)
            # Token 预算截断
            if len(combined) > _MAX_SYSTEM_CHARS:
                combined = combined[:_MAX_SYSTEM_CHARS] + "\n\n（上下文过长，已截断）"
            return combined
        finally:
            if close_db:
                db.close()

    def _extract_keywords(self, query: str) -> list[str]:
        """从查询中提取关键词（中文 + 英文术语）。"""
        # 移除标点，分割中文和英文词
        text = re.sub(r"[，。！？、；：""''（）【】《》\-\+\=\.\,\;\:\!\?\(\)\[\]\{\}]", " ", query)
        words = text.split()
        # 过滤单字和无意义词
        keywords = [w for w in words if len(w) > 1 and w.lower() not in {"什么", "怎么", "如何", "哪些", "哪个", "where", "how", "what", "list", "show", "give", "find", "get", "all", "the"}]
        return keywords

    def _find_tables(self, keywords: list[str], db: Session) -> Optional[str]:
        """模糊匹配表名。"""
        if not keywords:
            return None
        filters = []
        for kw in keywords:
            filters.append(TableMetadata.table_name.ilike(f"%{kw}%"))
            filters.append(TableMetadata.table_comment.ilike(f"%{kw}%"))
        tables = (
            db.query(TableMetadata)
            .filter(or_(*filters))
            .filter(TableMetadata.schema_name.notin_(_IGNORE_SCHEMAS))
            .limit(10)
            .all()
        )
        if not tables:
            return None

        lines = ["### 数据表结构"]
        for t in tables:
            comment = f"（{t.table_comment}）" if t.table_comment else ""
            lines.append(f"- **{t.schema_name}.{t.table_name}** {comment}")
            # 获取该表的字段
            cols = (
                db.query(ColumnMetadata)
                .filter(ColumnMetadata.table_id == t.id)
                .filter(ColumnMetadata.is_active == True)
                .order_by(ColumnMetadata.column_id)
                .limit(20)
                .all()
            )
            for c in cols:
                col_comment = f" — {c.comment}" if c.comment else ""
                pk = " 🔑" if c.is_primary_key else ""
                lines.append(f"  - `{c.column_name}` {c.column_type}{pk}{col_comment}")
        return "\n".join(lines)

    def _find_field_semantics(self, keywords: list[str], db: Session) -> Optional[str]:
        """匹配字段语义（业务术语）。"""
        if not keywords:
            return None
        filters = []
        for kw in keywords:
            filters.append(FieldSemantic.business_term.ilike(f"%{kw}%"))
            filters.append(FieldSemantic.logical_name.ilike(f"%{kw}%"))
            filters.append(FieldSemantic.definition.ilike(f"%{kw}%"))
        semantics = (
            db.query(FieldSemantic)
            .filter(or_(*filters))
            .limit(10)
            .all()
        )
        if not semantics:
            return None
        lines = ["### 业务字段语义"]
        for s in semantics:
            lines.append(f"- **{s.business_term}**（{s.logical_name}）")
            if s.definition:
                lines.append(f"  - 定义: {s.definition[:200]}")
            if s.caliber:
                lines.append(f"  - 口径: {s.caliber[:200]}")
        return "\n".join(lines)

    def _find_metrics(self, keywords: list[str], db: Session) -> Optional[str]:
        """匹配指标口径。"""
        if not keywords:
            return None
        filters = []
        for kw in keywords:
            filters.append(MetricDefinition.metric_name.ilike(f"%{kw}%"))
            filters.append(MetricDefinition.metric_code.ilike(f"%{kw}%"))
            filters.append(MetricDefinition.definition.ilike(f"%{kw}%"))
        metrics = (
            db.query(MetricDefinition)
            .filter(or_(*filters))
            .limit(10)
            .all()
        )
        if not metrics:
            return None
        lines = ["### 指标口径"]
        for m in metrics:
            lines.append(f"- **{m.metric_name}**（{m.metric_code}）")
            if m.definition:
                lines.append(f"  - 定义: {m.definition[:200]}")
        return "\n".join(lines)
```

- [ ] **Step 2: Write tests for schema context service**

Create `tests/test_schema_context.py`:

```python
"""Test schema context service."""

import os
import pytest

os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key")

from app.services.schema_context_service import SchemaContextService


def test_extract_keywords():
    svc = SchemaContextService()
    result = svc._extract_keywords("本月合同到期的租赁物有哪些？")
    assert "合同" in result
    assert "租赁" in result
    assert "到期" in result
    # Stop words filtered
    assert "哪些" not in result


def test_extract_keywords_english():
    svc = SchemaContextService()
    result = svc._extract_keywords("Show me contracts expiring this month")
    # "show" and "me" are stop words
    assert "contracts" in result or "expiring" in result or "month" in result


def test_extract_keywords_empty():
    svc = SchemaContextService()
    result = svc._extract_keywords("什么")
    assert result == []


def test_build_context_no_keywords_returns_empty():
    svc = SchemaContextService()
    result = svc.build_context("什么")
    assert result == ""


def test_build_context_no_match_returns_empty():
    svc = SchemaContextService()
    result = svc.build_context("xyznonexistent12345xyz")
    assert result == ""
```

- [ ] **Step 3: Run schema context tests**

```powershell
cd d:\projects\MetricForge
$env:PYTHONPATH='.'
$env:METRICFORGE_ENC_KEY='test-master-key'
pytest tests/test_schema_context.py -v
```

Expected: Tests pass (keyword extraction logic is pure Python, no DB needed).

- [ ] **Step 4: Commit Task 3**

```powershell
git add app/services/schema_context_service.py tests/test_schema_context.py
git commit -m "feat: add lightweight schema context service for AI ask"
```

---

### Task 4: Ask Service + API + SSE Streaming

**Files:**
- Create: `app/services/ask_service.py`
- Create: `app/api/ask.py`
- Create: `tests/test_ask_api.py`
- Modify: `app/main.py`

**Interfaces:**
- Consumes: `AskSession`, `AskMessage`, `LlmSetting` models
- Consumes: `LlmSettingsService.get_active()` from Task 2
- Consumes: `SchemaContextService.build_context()` from Task 3
- Consumes: `KeyEncryption.decrypt()` from Task 1
- Produces: `AskService` with CRUD + streaming
- Produces: SSE streaming endpoint at `GET /api/ask/sessions/{id}/stream`

- [ ] **Step 1: Create `app/services/ask_service.py`**

```python
"""AI 问数编排服务。"""

import json
import logging
from datetime import datetime, timezone
from typing import AsyncGenerator, Optional

from openai import OpenAI
from sqlalchemy.orm import Session

from ..models import AskSession, AskMessage, get_session
from .llm_settings_service import LlmSettingsService
from .schema_context_service import SchemaContextService
from .key_encryption import decrypt as decrypt_key

logger = logging.getLogger(__name__)


class AskService:
    """AI 问数会话与消息服务"""

    def __init__(self):
        self._llm_settings_service = LlmSettingsService()
        self._schema_context = SchemaContextService()

    # ---- Session CRUD ----

    def list_sessions(self, db: Session) -> list[dict]:
        sessions = db.query(AskSession).order_by(AskSession.updated_at.desc()).limit(50).all()
        return [self._session_to_dict(s) for s in sessions]

    def create_session(self, db: Session, title: str = "新对话", llm_setting_id: Optional[int] = None) -> dict:
        # Determine LLM setting
        if llm_setting_id:
            setting = self._llm_settings_service.get(db, llm_setting_id)
            if not setting:
                raise ValueError("LLM 配置不存在")
            model_name = setting["model_name"]
        else:
            active = self._llm_settings_service.get_active(db)
            if not active:
                raise ValueError("没有已启用的 LLM 配置，请先在 LLM 连接管理中启用一个模型")
            model_name = active.model_name
            llm_setting_id = active.id

        session = AskSession(
            title=title,
            llm_setting_id=llm_setting_id,
            model_name=model_name,
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return self._session_to_dict(session)

    def get_session(self, db: Session, session_id: int) -> Optional[dict]:
        s = db.query(AskSession).filter(AskSession.id == session_id).first()
        if not s:
            return None
        messages = (
            db.query(AskMessage)
            .filter(AskMessage.session_id == session_id)
            .order_by(AskMessage.created_at)
            .all()
        )
        result = self._session_to_dict(s)
        result["messages"] = [self._message_to_dict(m) for m in messages]
        return result

    def update_session(self, db: Session, session_id: int, title: str) -> Optional[dict]:
        s = db.query(AskSession).filter(AskSession.id == session_id).first()
        if not s:
            return None
        s.title = title
        db.commit()
        db.refresh(s)
        return self._session_to_dict(s)

    def delete_session(self, db: Session, session_id: int) -> bool:
        s = db.query(AskSession).filter(AskSession.id == session_id).first()
        if not s:
            return False
        # Delete all messages in session
        db.query(AskMessage).filter(AskMessage.session_id == session_id).delete()
        db.delete(s)
        db.commit()
        return True

    # ---- Messages ----

    def create_message(self, db: Session, session_id: int, content: str) -> dict:
        """创建用户消息 + assistant 占位消息。"""
        s = db.query(AskSession).filter(AskSession.id == session_id).first()
        if not s:
            raise ValueError("会话不存在")

        user_msg = AskMessage(
            session_id=session_id,
            role="user",
            content=content,
            status="completed",
        )
        db.add(user_msg)
        db.flush()

        assistant_msg = AskMessage(
            session_id=session_id,
            role="assistant",
            content="",
            status="pending",
        )
        db.add(assistant_msg)
        db.flush()

        s.message_count = db.query(AskMessage).filter(AskMessage.session_id == session_id).count()
        s.updated_at = datetime.now(timezone.utc)
        db.commit()

        return {
            "user_message": self._message_to_dict(user_msg),
            "assistant_message": self._message_to_dict(assistant_msg),
        }

    def get_messages(self, db: Session, session_id: int) -> list[dict]:
        messages = (
            db.query(AskMessage)
            .filter(AskMessage.session_id == session_id)
            .order_by(AskMessage.created_at)
            .all()
        )
        return [self._message_to_dict(m) for m in messages]

    # ---- SSE Streaming ----

    async def stream_response(self, db: Session, session_id: int, after_message_id: int) -> AsyncGenerator[str, None]:
        """SSE 流式生成 assistant 回复。

        逐 token 产出生成结果，通过 async generator 返回 SSE 格式事件。
        """
        s = db.query(AskSession).filter(AskSession.id == session_id).first()
        if not s:
            yield self._sse_event("error", {"message_id": after_message_id, "error": "会话不存在"})
            return

        # Update assistant message to streaming
        assistant_msg = db.query(AskMessage).filter(AskMessage.id == after_message_id).first()
        if not assistant_msg or assistant_msg.role != "assistant":
            yield self._sse_event("error", {"message_id": after_message_id, "error": "消息不存在"})
            return

        assistant_msg.status = "streaming"
        db.commit()

        # Get active LLM setting
        active = self._llm_settings_service.get_active(db)
        if not active:
            assistant_msg.status = "failed"
            assistant_msg.error_message = "没有已启用的 LLM 配置"
            db.commit()
            yield self._sse_event("error", {"message_id": after_message_id, "error": "没有已启用的 LLM 配置，请先在 LLM 连接管理中启用一个模型"})
            return

        # Build messages for LLM API
        api_key = decrypt_key(active.api_key)
        client = OpenAI(base_url=f"{active.base_url}/v1", api_key=api_key, timeout=120)

        # Build system prompt with schema context
        schema_context = self._schema_context.build_context("", db)
        system_message = {
            "role": "system",
            "content": "你是 MetricForge 数据分析助手。\n"
                       "你是一个融资租赁数据平台的 SQL 分析助手。"
                       "请基于数据仓库中的表和字段回答用户问题。\n"
                       "回答中可以通过 SQL 代码块展示查询逻辑，但不要直接执行任何 SQL。\n"
                       "使用中文回答。\n\n"
                       f"{schema_context}" if schema_context else ""
        }

        # Collect conversation history
        history = (
            db.query(AskMessage)
            .filter(AskMessage.session_id == session_id)
            .filter(AskMessage.id <= after_message_id)
            .filter(AskMessage.status == "completed")
            .order_by(AskMessage.created_at)
            .all()
        )

        openai_messages = [system_message]
        for m in history:
            if m.id == after_message_id:
                continue  # skip the assistant placeholder
            openai_messages.append({"role": m.role, "content": m.content})

        yield self._sse_event("meta", {
            "message_id": after_message_id,
            "model": active.model_name,
            "started_at": datetime.now(timezone.utc).isoformat(),
        })

        # Call OpenAI-compatible API
        accumulated = ""
        tokens_prompt = None
        tokens_completion = None

        try:
            stream = client.chat.completions.create(
                model=active.model_name,
                messages=openai_messages,
                stream=True,
                stream_options={"include_usage": True},
            )

            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                    delta = chunk.choices[0].delta.content
                    accumulated += delta
                    yield self._sse_event("token", {"delta": delta})

                if chunk.usage:
                    tokens_prompt = chunk.usage.prompt_tokens
                    tokens_completion = chunk.usage.completion_tokens

            # Success - save accumulated content
            assistant_msg.content = accumulated
            assistant_msg.status = "completed"
            if tokens_prompt:
                assistant_msg.tokens_prompt = tokens_prompt
            if tokens_completion:
                assistant_msg.tokens_completion = tokens_completion
            db.commit()

            yield self._sse_event("done", {
                "message_id": after_message_id,
                "tokens_prompt": tokens_prompt,
                "tokens_completion": tokens_completion,
            })

        except Exception as e:
            logger.exception("LLM 流式调用失败")
            error_msg = self._sanitize_llm_error(e)
            assistant_msg.status = "failed"
            assistant_msg.error_message = error_msg
            if accumulated:
                assistant_msg.content = accumulated
            db.commit()
            yield self._sse_event("error", {"message_id": after_message_id, "error": error_msg})

    def _sanitize_llm_error(self, e: Exception) -> str:
        msg = str(e).lower()
        if "connect" in msg or "refused" in msg:
            return "无法连接到 LLM 服务，请检查 LLM 配置"
        if "401" in msg or "auth" in msg:
            return "LLM 认证失败"
        if "timeout" in msg:
            return "LLM 响应超时，请稍后重试"
        if "rate" in msg or "quota" in msg:
            return "LLM 请求频率过高，请稍后重试"
        return f"LLM 调用失败（{type(e).__name__}）"

    @staticmethod
    def _sse_event(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    @staticmethod
    def _session_to_dict(s: AskSession) -> dict:
        return {
            "id": s.id,
            "title": s.title,
            "llm_setting_id": s.llm_setting_id,
            "model_name": s.model_name,
            "message_count": s.message_count,
            "created_at": s.created_at.isoformat(),
            "updated_at": s.updated_at.isoformat(),
        }

    @staticmethod
    def _message_to_dict(m: AskMessage) -> dict:
        return {
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
```

- [ ] **Step 2: Create `app/api/ask.py`**

```python
"""AI 问数 API 路由（含 SSE 流式输出）。"""

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..models import get_session
from ..services.ask_service import AskService

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
    db = get_session()
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
    return service.get_messages(db, session_id)


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
```

- [ ] **Step 3: Register ask router in `app/main.py`**

Add after `llm_settings` import:
```python
    from .api.ask import router as ask_router
```

Add after llm_settings registration:
```python
    app.include_router(ask_router, prefix="/api/ask", tags=["AI 问数"])
```

- [ ] **Step 4: Write API tests for ask endpoints**

Create `tests/test_ask_api.py`:

```python
"""Test AI ask API endpoints (session CRUD, message creation, SSE)."""

import os
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")

from app.main import create_app


@pytest.fixture
def client():
    app = create_app(database_url="sqlite:///./data/test_ask_api.db")
    with TestClient(app) as c:
        yield c


def test_create_session(client):
    resp = client.post("/api/ask/sessions", json={})
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "新对话"
    assert data["id"] > 0


def test_list_sessions_empty(client):
    resp = client.get("/api/ask/sessions")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_create_and_get_session(client):
    resp = client.post("/api/ask/sessions", json={"title": "测试会话"})
    sid = resp.json()["id"]

    resp = client.get(f"/api/ask/sessions/{sid}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "测试会话"
    assert "messages" in resp.json()


def test_get_session_not_found(client):
    resp = client.get("/api/ask/sessions/999")
    assert resp.status_code == 404


def test_update_session(client):
    resp = client.post("/api/ask/sessions", json={})
    sid = resp.json()["id"]
    resp = client.put(f"/api/ask/sessions/{sid}", json={"title": "新标题"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "新标题"


def test_delete_session(client):
    resp = client.post("/api/ask/sessions", json={})
    sid = resp.json()["id"]
    resp = client.delete(f"/api/ask/sessions/{sid}")
    assert resp.status_code == 200
    resp = client.get(f"/api/ask/sessions/{sid}")
    assert resp.status_code == 404


def test_create_message(client):
    resp = client.post("/api/ask/sessions", json={})
    sid = resp.json()["id"]

    resp = client.post(f"/api/ask/sessions/{sid}/messages", json={"content": "你好"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["user_message"]["role"] == "user"
    assert data["user_message"]["content"] == "你好"
    assert data["assistant_message"]["role"] == "assistant"
    assert data["assistant_message"]["status"] == "pending"


def test_get_messages(client):
    resp = client.post("/api/ask/sessions", json={})
    sid = resp.json()["id"]
    client.post(f"/api/ask/sessions/{sid}/messages", json={"content": "Q1"})
    client.post(f"/api/ask/sessions/{sid}/messages", json={"content": "Q2"})

    resp = client.get(f"/api/ask/sessions/{sid}/messages")
    assert resp.status_code == 200
    messages = resp.json()
    assert len(messages) == 4  # Q1 + assistant1 + Q2 + assistant2
    assert messages[0]["content"] == "Q1"
    assert messages[2]["content"] == "Q2"


def test_create_message_no_session(client):
    resp = client.post("/api/ask/sessions/999/messages", json={"content": "test"})
    assert resp.status_code == 400  # ValueError caught as 400
```

- [ ] **Step 5: Run ask API tests**

```powershell
cd d:\projects\MetricForge
$env:PYTHONPATH='.'
$env:METRICFORGE_ENC_KEY='test-master-key-0123456789'
pytest tests/test_ask_api.py -v
```

Expected: All tests pass.

- [ ] **Step 6: Commit Task 4**

```powershell
git add app/services/ask_service.py app/api/ask.py app/main.py tests/test_ask_api.py
git commit -m "feat: add AI ask session/message API with SSE streaming"
```

---

### Task 5: Frontend LLM Settings Page

**Files:**
- Create: `frontend/src/api/llmSettings.ts`
- Create: `frontend/src/pages/LlmSettingsPage.tsx`
- Create: `frontend/src/components/LlmSettingCard.tsx`
- Create: `frontend/src/components/LlmSettingFormModal.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `apiFetch` from existing `frontend/src/api/client.ts`
- Consumes: `Layout` component export `menuItems` pattern
- Produces: `useLlmSettings` hook for LLM settings list
- Produces: LlmSettingsPage at `/llm-settings`
- Produces: Menu item "LLM 配置" in sidebar

- [ ] **Step 1: Create `frontend/src/api/llmSettings.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface LlmSetting {
  id: number
  name: string
  base_url: string
  api_key_masked: string
  model_name: string
  is_active: boolean
  last_tested_at: string | null
  last_tested_ok: boolean | null
  created_at: string
  updated_at: string
}

export interface CreateLlmSettingData {
  name: string
  base_url: string
  api_key: string
  model_name: string
}

export interface UpdateLlmSettingData {
  name?: string
  base_url?: string
  api_key?: string
  model_name?: string
}

export interface TestConnectionResult {
  ok: boolean
  model: string | null
  latency_ms: number | null
  error: string | null
}

export function useLlmSettings() {
  return useQuery<LlmSetting[]>({
    queryKey: ['llmSettings'],
    queryFn: () => apiFetch<LlmSetting[]>('/llm-settings'),
  })
}

export function useLlmSetting(id: number) {
  return useQuery<LlmSetting>({
    queryKey: ['llmSettings', id],
    queryFn: () => apiFetch<LlmSetting>(`/llm-settings/${id}`),
    enabled: !!id,
  })
}

export function useCreateLlmSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateLlmSettingData) =>
      apiFetch<LlmSetting>('/llm-settings', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['llmSettings'] }),
  })
}

export function useUpdateLlmSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateLlmSettingData }) =>
      apiFetch<LlmSetting>(`/llm-settings/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['llmSettings'] }),
  })
}

export function useDeleteLlmSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ ok: boolean }>(`/llm-settings/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['llmSettings'] }),
  })
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<TestConnectionResult>(`/llm-settings/${id}/test`, { method: 'POST' }),
  })
}

export function useActivateLlmSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<LlmSetting>(`/llm-settings/${id}/activate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['llmSettings'] }),
  })
}
```

- [ ] **Step 2: Create `frontend/src/components/LlmSettingCard.tsx`**

```typescript
import React from 'react'
import { Card, Tag, Space, Button, Typography, Descriptions, Tooltip } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  EditOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  PoweroffOutlined,
} from '@ant-design/icons'
import type { LlmSetting } from '../api/llmSettings'

const { Text } = Typography

interface Props {
  setting: LlmSetting
  onTest: (id: number) => void
  onActivate: (id: number) => void
  onEdit: (setting: LlmSetting) => void
  onDelete: (id: number) => void
  testingId?: number | null
}

const LlmSettingCard: React.FC<Props> = ({ setting, onTest, onActivate, onEdit, onDelete, testingId }) => {
  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <Space>
          {setting.is_active ? (
            <Tag icon={<CheckCircleOutlined />} color="success">已启用</Tag>
          ) : (
            <Tag icon={<PoweroffOutlined />}>停用</Tag>
          )}
          <Text strong>{setting.name}</Text>
        </Space>
      }
      extra={
        <Space>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            loading={testingId === setting.id}
            onClick={() => onTest(setting.id)}
          >
            测试
          </Button>
          {!setting.is_active && (
            <Button size="small" type="primary" onClick={() => onActivate(setting.id)}>
              启用
            </Button>
          )}
          <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(setting)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(setting.id)} />
        </Space>
      }
    >
      <Descriptions size="small" column={1}>
        <Descriptions.Item label="Base URL">
          <Text code copyable>{setting.base_url}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="Model">
          <Text code>{setting.model_name}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="API Key">
          <Text code>{setting.api_key_masked}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="连接状态">
          {setting.last_tested_at ? (
            setting.last_tested_ok
              ? <Text type="success"><CheckCircleOutlined /> 上次测试成功</Text>
              : <Text type="danger"><CloseCircleOutlined /> 上次测试失败</Text>
          ) : (
            <Text type="warning">未测试</Text>
          )}
        </Descriptions.Item>
      </Descriptions>
    </Card>
  )
}

export default LlmSettingCard
```

- [ ] **Step 3: Create `frontend/src/components/LlmSettingFormModal.tsx`**

```typescript
import React, { useEffect } from 'react'
import { Modal, Form, Input, message } from 'antd'
import type { LlmSetting, CreateLlmSettingData, UpdateLlmSettingData } from '../api/llmSettings'

interface Props {
  open: boolean
  editingSetting: LlmSetting | null  // null = create mode
  onCancel: () => void
  onSubmit: (values: CreateLlmSettingData | UpdateLlmSettingData) => Promise<void>
}

const LlmSettingFormModal: React.FC<Props> = ({ open, editingSetting, onCancel, onSubmit }) => {
  const [form] = Form.useForm()
  const isEdit = !!editingSetting

  useEffect(() => {
    if (open) {
      if (editingSetting) {
        form.setFieldsValue({
          name: editingSetting.name,
          base_url: editingSetting.base_url,
          api_key: '',  // Never prefill, user must re-enter
          model_name: editingSetting.model_name,
        })
      } else {
        form.resetFields()
      }
    }
  }, [open, editingSetting, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      await onSubmit(values)
      form.resetFields()
    } catch {
      // validation failed
    }
  }

  return (
    <Modal
      title={isEdit ? '编辑 LLM 配置' : '添加 LLM 配置'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="DeepSeek V4 生产" maxLength={50} />
        </Form.Item>
        <Form.Item name="base_url" label="Base URL" rules={[{ required: true, message: '请输入 API 地址' }]}>
          <Input placeholder="http://uat-unifyapi.utflc.com:8080" />
        </Form.Item>
        <Form.Item
          name="api_key"
          label="API Key"
          rules={isEdit ? [] : [{ required: true, message: '请输入 API Key' }]}
          extra={isEdit ? '留空则不修改已有 Key' : undefined}
        >
          <Input.Password placeholder={isEdit ? '留空则不修改' : 'sk-...'} />
        </Form.Item>
        <Form.Item name="model_name" label="模型名" rules={[{ required: true, message: '请输入模型名' }]}>
          <Input placeholder="DeepSeek-V4-Flash" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default LlmSettingFormModal
```

- [ ] **Step 4: Create `frontend/src/pages/LlmSettingsPage.tsx`**

```typescript
import React, { useState } from 'react'
import { Typography, Button, Space, Spin, Alert, Empty, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import {
  useLlmSettings,
  useCreateLlmSetting,
  useUpdateLlmSetting,
  useDeleteLlmSetting,
  useTestConnection,
  useActivateLlmSetting,
} from '../api/llmSettings'
import type { LlmSetting } from '../api/llmSettings'
import LlmSettingCard from '../components/LlmSettingCard'
import LlmSettingFormModal from '../components/LlmSettingFormModal'

const LlmSettingsPage: React.FC = () => {
  const { data: settings, isLoading, error } = useLlmSettings()
  const createMutation = useCreateLlmSetting()
  const updateMutation = useUpdateLlmSetting()
  const deleteMutation = useDeleteLlmSetting()
  const testMutation = useTestConnection()
  const activateMutation = useActivateLlmSetting()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingSetting, setEditingSetting] = useState<LlmSetting | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)

  const handleTest = async (id: number) => {
    setTestingId(id)
    try {
      const result = await testMutation.mutateAsync(id)
      if (result.ok) {
        message.success(`连接成功！模型: ${result.model} (${result.latency_ms}ms)`)
      } else {
        message.error(result.error || '连接测试失败')
      }
    } catch {
      message.error('连接测试异常')
    } finally {
      setTestingId(null)
    }
  }

  const handleActivate = async (id: number) => {
    try {
      await activateMutation.mutateAsync(id)
      message.success('已启用')
    } catch {
      message.error('启用失败')
    }
  }

  const handleAdd = () => {
    setEditingSetting(null)
    setModalOpen(true)
  }

  const handleEdit = (setting: LlmSetting) => {
    setEditingSetting(setting)
    setModalOpen(true)
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id)
      message.success('已删除')
    } catch {
      message.error('删除失败')
    }
  }

  const handleSubmit = async (values: any) => {
    try {
      if (editingSetting) {
        await updateMutation.mutateAsync({ id: editingSetting.id, data: values })
        message.success('已更新')
      } else {
        await createMutation.mutateAsync(values as any)
        message.success('已创建')
      }
      setModalOpen(false)
    } catch (e: any) {
      message.error(e?.message || '操作失败')
    }
  }

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />

  if (error) {
    return (
      <Alert message="加载失败" description="无法获取 LLM 配置列表" type="error" showIcon />
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>LLM 连接管理</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加配置</Button>
      </div>

      {!settings || settings.length === 0 ? (
        <Empty description="尚未配置 LLM 连接，点击上方按钮添加" />
      ) : (
        settings.map((s) => (
          <LlmSettingCard
            key={s.id}
            setting={s}
            onTest={handleTest}
            onActivate={handleActivate}
            onEdit={handleEdit}
            onDelete={handleDelete}
            testingId={testingId}
          />
        ))
      )}

      <LlmSettingFormModal
        open={modalOpen}
        editingSetting={editingSetting}
        onCancel={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  )
}

export default LlmSettingsPage
```

- [ ] **Step 5: Update `frontend/src/components/Layout.tsx`**

Add new menu items after the "采集任务" entry:

```typescript
  {
    key: '/llm-settings',
    icon: <SettingOutlined />,
    label: 'LLM 配置',
  },
  {
    key: '/ask',
    icon: <MessageOutlined />,
    label: 'AI 问数',
  },
```

Add the corresponding icon imports at the top:
```typescript
import {
  DatabaseOutlined,
  DashboardOutlined,
  GithubOutlined,
  SettingOutlined,
  MessageOutlined,
} from '@ant-design/icons'
```

- [ ] **Step 6: Update `frontend/src/App.tsx`**

Add imports:
```typescript
import LlmSettingsPage from './pages/LlmSettingsPage'
```

Add routes:
```typescript
<Route path="/llm-settings" element={<LlmSettingsPage />} />
```

- [ ] **Step 7: Verify TypeScript build**

```powershell
cd d:\projects\MetricForge\frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit Task 5**

```powershell
git add frontend/
git commit -m "feat: add LLM settings management page with CRUD + test + activate"
```

---

### Task 6: Frontend Ask Workbench (Data Layer + Components + Page)

**Files:**
- Create: `frontend/src/stores/askStore.ts`
- Create: `frontend/src/api/askSessions.ts`
- Create: `frontend/src/components/SessionList.tsx`
- Create: `frontend/src/components/AskInput.tsx`
- Create: `frontend/src/components/MarkdownRenderer.tsx`
- Create: `frontend/src/components/SqlCodeBlock.tsx`
- Create: `frontend/src/components/UserMessage.tsx`
- Create: `frontend/src/components/AssistantMessage.tsx`
- Create: `frontend/src/components/StreamingMessage.tsx`
- Create: `frontend/src/components/MessageThread.tsx`
- Create: `frontend/src/pages/AskWorkbenchPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/package.json`

- [ ] **Step 1: Install new frontend dependencies**

```powershell
cd d:\projects\MetricForge\frontend
npm install zustand react-markdown remark-gfm react-syntax-highlighter
npm install --save-dev @types/react-syntax-highlighter
```

Update `frontend/package.json` dependencies section should now include:
```json
    "zustand": "^4.5.0",
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
    "react-syntax-highlighter": "^15.5.0"
```

- [ ] **Step 2: Create `frontend/src/stores/askStore.ts`**

```typescript
import { create } from 'zustand'

interface StreamState {
  streamingMessageId: number | null
  streamingContent: string
  isStreaming: boolean
}

interface AskStore {
  currentSessionId: number | null
  setCurrentSessionId: (id: number | null) => void
  stream: StreamState
  startStream: (messageId: number) => void
  appendToken: (delta: string) => void
  endStream: () => void
  failStream: () => void
}

export const useAskStore = create<AskStore>((set) => ({
  currentSessionId: null,
  setCurrentSessionId: (id) => set({ currentSessionId: id }),
  stream: {
    streamingMessageId: null,
    streamingContent: '',
    isStreaming: false,
  },
  startStream: (messageId) =>
    set({
      stream: { streamingMessageId: messageId, streamingContent: '', isStreaming: true },
    }),
  appendToken: (delta) =>
    set((state) => ({
      stream: {
        ...state.stream,
        streamingContent: state.stream.streamingContent + delta,
      },
    })),
  endStream: () =>
    set((state) => ({
      stream: { ...state.stream, isStreaming: false },
    })),
  failStream: () =>
    set((state) => ({
      stream: { ...state.stream, isStreaming: false },
    })),
}))
```

- [ ] **Step 3: Create `frontend/src/api/askSessions.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface AskSession {
  id: number
  title: string
  llm_setting_id: number | null
  model_name: string
  message_count: number
  created_at: string
  updated_at: string
}

export interface AskMessage {
  id: number
  session_id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  status: 'pending' | 'streaming' | 'completed' | 'failed'
  error_message: string | null
  tokens_prompt: number | null
  tokens_completion: number | null
  created_at: string
}

export interface SessionDetail extends AskSession {
  messages: AskMessage[]
}

interface CreateMessageResult {
  user_message: AskMessage
  assistant_message: AskMessage
}

// Hooks

export function useSessions() {
  return useQuery<AskSession[]>({
    queryKey: ['askSessions'],
    queryFn: () => apiFetch<AskSession[]>('/ask/sessions'),
  })
}

export function useSession(sessionId: number | null) {
  return useQuery<SessionDetail>({
    queryKey: ['askSessions', sessionId],
    queryFn: () => apiFetch<SessionDetail>(`/ask/sessions/${sessionId}`),
    enabled: !!sessionId,
  })
}

export function useCreateSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data?: { title?: string; llm_setting_id?: number }) =>
      apiFetch<AskSession>('/ask/sessions', {
        method: 'POST',
        body: JSON.stringify(data || {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['askSessions'] }),
  })
}

export function useDeleteSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: number) =>
      apiFetch<{ ok: boolean }>(`/ask/sessions/${sessionId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['askSessions'] }),
  })
}

export function useCreateMessage() {
  return useMutation({
    mutationFn: ({ sessionId, content }: { sessionId: number; content: string }) =>
      apiFetch<CreateMessageResult>(`/ask/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
  })
}
```

- [ ] **Step 4: Create `frontend/src/components/MarkdownRenderer.tsx`**

```typescript
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import SqlCodeBlock from './SqlCodeBlock'

interface Props {
  content: string
}

const MarkdownRenderer: React.FC<Props> = ({ content }) => {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const language = match ? match[1] : ''
            const codeString = String(children).replace(/\n$/, '')
            if (language === 'sql') {
              return <SqlCodeBlock code={codeString} />
            }
            if (language) {
              return (
                <pre className={className}>
                  <code {...props}>{codeString}</code>
                </pre>
              )
            }
            return <code className={className} {...props}>{children}</code>
          },
          // Security: don't render images, iframes
          img() {
            return null
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownRenderer
```

- [ ] **Step 5: Create `frontend/src/components/SqlCodeBlock.tsx`**

```typescript
import React, { useState } from 'react'
import { Button, Space, Typography, Tooltip } from 'antd'
import { CopyOutlined, CheckOutlined, CodeOutlined } from '@ant-design/icons'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

const { Text } = Typography

interface Props {
  code: string
}

const SqlCodeBlock: React.FC<Props> = ({ code }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ margin: '8px 0', borderRadius: 6, overflow: 'hidden', border: '1px solid #30363d' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px 12px',
          background: '#21262d',
        }}
      >
        <Space size={4}>
          <CodeOutlined style={{ color: '#8b949e' }} />
          <Text style={{ color: '#8b949e', fontSize: 12 }}>SQL</Text>
        </Space>
        <Tooltip title={copied ? '已复制' : '复制代码'}>
          <Button
            type="text"
            size="small"
            icon={copied ? <CheckOutlined style={{ color: '#3fb950' }} /> : <CopyOutlined style={{ color: '#8b949e' }} />}
            onClick={handleCopy}
          />
        </Tooltip>
      </div>
      <SyntaxHighlighter
        language="sql"
        style={oneDark}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: 13 }}
        showLineNumbers
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

export default SqlCodeBlock
```

- [ ] **Step 6: Create `frontend/src/components/UserMessage.tsx`**

```typescript
import React from 'react'
import { UserOutlined } from '@ant-design/icons'

interface Props {
  content: string
}

const UserMessage: React.FC<Props> = ({ content }) => {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
      <div
        style={{
          maxWidth: '70%',
          padding: '10px 16px',
          background: '#1677ff',
          color: '#fff',
          borderRadius: '12px 12px 4px 12px',
          fontSize: 14,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}
      >
        {content}
      </div>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: '#1677ff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: 8,
          flexShrink: 0,
        }}
      >
        <UserOutlined style={{ color: '#fff', fontSize: 16 }} />
      </div>
    </div>
  )
}

export default UserMessage
```

- [ ] **Step 7: Create `frontend/src/components/AssistantMessage.tsx`**

```typescript
import React from 'react'
import { RobotOutlined } from '@ant-design/icons'
import MarkdownRenderer from './MarkdownRenderer'

interface Props {
  content: string
}

const AssistantMessage: React.FC<Props> = ({ content }) => {
  return (
    <div style={{ display: 'flex', marginBottom: 16 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: '#52c41a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 8,
          flexShrink: 0,
        }}
      >
        <RobotOutlined style={{ color: '#fff', fontSize: 16 }} />
      </div>
      <div
        style={{
          maxWidth: '70%',
          padding: '10px 16px',
          background: '#f5f5f5',
          borderRadius: '12px 12px 12px 4px',
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        <MarkdownRenderer content={content} />
      </div>
    </div>
  )
}

export default AssistantMessage
```

- [ ] **Step 8: Create `frontend/src/components/StreamingMessage.tsx`**

```typescript
import React, { useEffect, useRef } from 'react'
import { RobotOutlined, LoadingOutlined } from '@ant-design/icons'
import MarkdownRenderer from './MarkdownRenderer'

interface Props {
  content: string
  isStreaming: boolean
}

const StreamingMessage: React.FC<Props> = ({ content, isStreaming }) => {
  return (
    <div style={{ display: 'flex', marginBottom: 16 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: '#52c41a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 8,
          flexShrink: 0,
        }}
      >
        <RobotOutlined style={{ color: '#fff', fontSize: 16 }} />
      </div>
      <div
        style={{
          maxWidth: '70%',
          padding: '10px 16px',
          background: '#f5f5f5',
          borderRadius: '12px 12px 12px 4px',
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        {content ? (
          <MarkdownRenderer content={content} />
        ) : (
          <span><LoadingOutlined /> 思考中...</span>
        )}
        {isStreaming && content && (
          <span style={{ display: 'inline-block', width: 8, height: 16, background: '#1677ff', marginLeft: 2, animation: 'blink 1s step-end infinite' }} />
        )}
      </div>
    </div>
  )
}

export default StreamingMessage
```

- [ ] **Step 9: Create `frontend/src/components/MessageThread.tsx`**

```typescript
import React, { useEffect, useRef } from 'react'
import { Alert, Typography, Empty } from 'antd'
import type { AskMessage } from '../api/askSessions'
import UserMessage from './UserMessage'
import AssistantMessage from './AssistantMessage'
import StreamingMessage from './StreamingMessage'

interface Props {
  messages: AskMessage[]
  streamingContent: string
  isStreaming: boolean
  error?: string | null
}

const MessageThread: React.FC<Props> = ({ messages, streamingContent, isStreaming, error }) => {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Show welcome if no messages
  if (messages.length === 0 && !isStreaming) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Typography.Title level={4} type="secondary">你好！</Typography.Title>
          <Typography.Text type="secondary">
            我是 MetricForge 数据分析助手，请问有什么可以帮助你的？
          </Typography.Text>
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
      {messages.map((msg) => {
        if (msg.role === 'user' && msg.status === 'completed') {
          return <UserMessage key={msg.id} content={msg.content} />
        }
        if (msg.role === 'assistant' && msg.status === 'completed') {
          return <AssistantMessage key={msg.id} content={msg.content} />
        }
        if (msg.role === 'assistant' && (msg.status === 'pending' || msg.status === 'streaming')) {
          return null  // Handled by StreamingMessage below
        }
        if (msg.role === 'assistant' && msg.status === 'failed') {
          return (
            <Alert
              key={msg.id}
              message="回答生成失败"
              description={msg.error_message || '请稍后重试'}
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )
        }
        return null
      })}

      {isStreaming && (
        <StreamingMessage content={streamingContent} isStreaming={isStreaming} />
      )}

      {error && (
        <Alert message="错误" description={error} type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      <div ref={bottomRef} />
    </div>
  )
}

export default MessageThread
```

- [ ] **Step 10: Create `frontend/src/components/AskInput.tsx`**

```typescript
import React, { useState } from 'react'
import { Input, Button, Space } from 'antd'
import { SendOutlined } from '@ant-design/icons'

const { TextArea } = Input

interface Props {
  onSend: (content: string) => void
  disabled: boolean
  loading: boolean
  placeholder?: string
}

const AskInput: React.FC<Props> = ({ onSend, disabled, loading, placeholder }) => {
  const [value, setValue] = useState('')

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div style={{ padding: '12px 24px', borderTop: '1px solid #f0f0f0', background: '#fff' }}>
      <Space.Compact style={{ width: '100%' }}>
        <TextArea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || '输入问题...'}
          rows={2}
          disabled={disabled}
          style={{ resize: 'none' }}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={loading}
          disabled={disabled || !value.trim()}
          style={{ height: '100%' }}
        >
          发送
        </Button>
      </Space.Compact>
    </div>
  )
}

export default AskInput
```

- [ ] **Step 11: Create `frontend/src/components/SessionList.tsx`**

```typescript
import React from 'react'
import { Menu, Button, Typography, Spin, Empty } from 'antd'
import { PlusOutlined, MessageOutlined, DeleteOutlined } from '@ant-design/icons'
import type { AskSession } from '../api/askSessions'

interface Props {
  sessions: AskSession[]
  currentSessionId: number | null
  isLoading: boolean
  onSelect: (id: number) => void
  onNew: () => void
  onDelete: (id: number) => void
}

const SessionList: React.FC<Props> = ({ sessions, currentSessionId, isLoading, onSelect, onNew, onDelete }) => {
  const items = sessions.map((s) => ({
    key: String(s.id),
    icon: <MessageOutlined />,
    label: (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {s.title}
        </span>
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={(e) => {
            e.stopPropagation()
            onDelete(s.id)
          }}
          style={{ opacity: 0.6 }}
        />
      </div>
    ),
  }))

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
        <Typography.Text strong>对话历史</Typography.Text>
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={onNew}
          style={{ float: 'right' }}
        >
          新对话
        </Button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {isLoading ? (
          <Spin style={{ display: 'block', margin: '24px auto' }} />
        ) : sessions.length === 0 ? (
          <Empty description="暂无对话" style={{ marginTop: 24 }} />
        ) : (
          <Menu
            mode="inline"
            selectedKeys={currentSessionId ? [String(currentSessionId)] : []}
            items={items}
            onClick={({ key }) => onSelect(Number(key))}
            style={{ border: 'none' }}
          />
        )}
      </div>
    </div>
  )
}

export default SessionList
```

- [ ] **Step 12: Create `frontend/src/pages/AskWorkbenchPage.tsx`**

```typescript
import React, { useEffect, useCallback, useRef } from 'react'
import { Layout as AntLayout, Typography, Tag, message, Alert, Spin } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import { useSessions, useSession, useCreateSession, useDeleteSession, useCreateMessage } from '../api/askSessions'
import { useAskStore } from '../stores/askStore'
import SessionList from '../components/SessionList'
import MessageThread from '../components/MessageThread'
import AskInput from '../components/AskInput'

const { Sider, Content } = AntLayout

const AskWorkbenchPage: React.FC = () => {
  const qc = useQueryClient()
  const { data: sessions, isLoading: sessionsLoading } = useSessions()
  const createSession = useCreateSession()
  const deleteSession = useDeleteSession()
  const createMessage = useCreateMessage()

  const currentSessionId = useAskStore((s) => s.currentSessionId)
  const setCurrentSessionId = useAskStore((s) => s.setCurrentSessionId)
  const stream = useAskStore((s) => s.stream)
  const startStream = useAskStore((s) => s.startStream)
  const appendToken = useAskStore((s) => s.appendToken)
  const endStream = useAskStore((s) => s.endStream)
  const failStream = useAskStore((s) => s.failStream)

  const { data: sessionDetail, isLoading: sessionLoading } = useSession(currentSessionId)
  const abortRef = useRef<AbortController | null>(null)

  // Auto-select first session
  useEffect(() => {
    if (!currentSessionId && sessions && sessions.length > 0) {
      setCurrentSessionId(sessions[0].id)
    }
  }, [sessions, currentSessionId, setCurrentSessionId])

  const handleNewSession = async () => {
    try {
      const session = await createSession.mutateAsync()
      setCurrentSessionId(session.id)
    } catch {
      message.error('创建会话失败')
    }
  }

  const handleDeleteSession = async (id: number) => {
    try {
      await deleteSession.mutateAsync(id)
      if (currentSessionId === id) {
        setCurrentSessionId(null)
      }
    } catch {
      message.error('删除失败')
    }
  }

  const handleSend = useCallback(async (content: string) => {
    if (!currentSessionId) return

    try {
      const result = await createMessage.mutateAsync({
        sessionId: currentSessionId,
        content,
      })
      const assistantId = result.assistant_message.id

      // Invalidate session query to refresh messages
      qc.invalidateQueries({ queryKey: ['askSessions', currentSessionId] })

      // Start SSE stream
      startStream(assistantId)
      const controller = new AbortController()
      abortRef.current = controller

      const token = Date.now().toString(36)
      const response = await fetch(
        `/api/ask/sessions/${currentSessionId}/stream?after=${assistantId}&_t=${token}`,
        { signal: controller.signal }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''  // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.delta) {
                appendToken(data.delta)
              }
            } catch {
              // ignore parse errors
            }
          }
          if (line.startsWith('event: done') || line.startsWith('event: error')) {
            // Stream ended
          }
        }
      }

      endStream()
      qc.invalidateQueries({ queryKey: ['askSessions', currentSessionId] })
      qc.invalidateQueries({ queryKey: ['askSessions'] }) // Refresh list for title
    } catch (err: any) {
      if (err.name === 'AbortError') return
      failStream()
      message.error('发送失败，请重试')
    }
  }, [currentSessionId, createMessage, qc, startStream, appendToken, endStream, failStream])

  const activeModel = sessionDetail?.model_name || ''

  return (
    <AntLayout style={{ height: 'calc(100vh - 112px)', background: '#fff' }}>
      <Sider width={280} style={{ background: '#fafafa', borderRight: '1px solid #f0f0f0' }}>
        <SessionList
          sessions={sessions || []}
          currentSessionId={currentSessionId}
          isLoading={sessionsLoading}
          onSelect={setCurrentSessionId}
          onNew={handleNewSession}
          onDelete={handleDeleteSession}
        />
      </Sider>
      <Content style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 24px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>AI 问数工作台</Typography.Title>
          {activeModel && <Tag color="blue">{activeModel}</Tag>}
        </div>

        {currentSessionId ? (
          sessionLoading ? (
            <Spin style={{ display: 'block', margin: '80px auto' }} />
          ) : (
            <>
              <MessageThread
                messages={sessionDetail?.messages || []}
                streamingContent={stream.streamingContent}
                isStreaming={stream.isStreaming}
              />
              <AskInput
                onSend={handleSend}
                disabled={stream.isStreaming}
                loading={stream.isStreaming}
              />
            </>
          )
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography.Text type="secondary">
              点击左侧"新对话"开始提问
            </Typography.Text>
          </div>
        )}
      </Content>
    </AntLayout>
  )
}

export default AskWorkbenchPage
```

- [ ] **Step 13: Update `frontend/src/App.tsx`**

Add import:
```typescript
import AskWorkbenchPage from './pages/AskWorkbenchPage'
```

Add route (after `/llm-settings`):
```typescript
<Route path="/ask" element={<AskWorkbenchPage />} />
```

- [ ] **Step 14: Add cursor blink animation CSS**

Add to `frontend/src/styles/global.css`:
```css
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
```

- [ ] **Step 15: Verify TypeScript + build**

```powershell
cd d:\projects\MetricForge\frontend
npx tsc --noEmit
npx vite build
```

Expected: Both succeed.

- [ ] **Step 16: Commit Task 6**

```powershell
git add frontend/
git commit -m "feat: add AI ask workbench with streaming chat, markdown rendering, and session management"
```

---

### Task 7: Integration + Verification

**Files:**
- No new files — verification only

- [ ] **Step 1: Run full backend test suite**

```powershell
cd d:\projects\MetricForge
$env:PYTHONPATH='.'
$env:METRICFORGE_ENC_KEY='test-master-key-0123456789'
pytest -q
```

Expected: All existing tests + new tests pass (123+ passed).

- [ ] **Step 2: Run frontend tests**

```powershell
cd d:\projects\MetricForge\frontend
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Run TypeScript check**

```powershell
cd d:\projects\MetricForge\frontend
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Build frontend**

```powershell
cd d:\projects\MetricForge\frontend
npx vite build
```

Expected: Build succeeds.

- [ ] **Step 5: Start FastAPI and verify all pages work**

```powershell
cd d:\projects\MetricForge
$env:PYTHONPATH='.'
$env:METRICFORGE_ENC_KEY='test-master-key'
python -m app.main
```

Verify:
- `http://localhost:8000/web/dashboard` — Jinja works
- `http://localhost:8000/app/` — React SPA works
- `http://localhost:8000/app/llm-settings` — LLM 配置页面（空状态）
- `http://localhost:8000/app/ask` — AI 问数工作台
- `curl http://localhost:8000/api/llm-settings` — 返回空列表
- `curl http://localhost:8000/api/ask/sessions` — 返回空列表

- [ ] **Step 6: Check git diff for unintended changes**

```powershell
git status --short
git diff --stat
```

Expected: Only `frontend/`, `app/`, `tests/`, `requirements.txt` changed. No changes to `app/web/` or `app/templates/`.

- [ ] **Step 7: Commit if any remaining polish**

```powershell
git add -A
git commit -m "chore: finalize AI ask workbench MVP"
```

- [ ] **Step 8: Push to GitHub (only when user confirms)**

```powershell
git push origin main
```

---

## Self-Review

1. **Spec coverage:**
   - ✅ LLM 连接管理 CRUD (Task 2)
   - ✅ API Key 加密存储 + masked 回显 (Task 1)
   - ✅ 连接测试 + 错误脱敏 (Task 2)
   - ✅ 多配置管理 + 唯一启用 (Task 2)
   - ✅ 问数会话管理 (Task 4)
   - ✅ SSE 流式输出 (Task 4)
   - ✅ 消息生命周期：pending → streaming → completed/failed (Task 4)
   - ✅ Schema Context 轻量版 (Task 3)
   - ✅ 前端 LLM 配置页面 (Task 5)
   - ✅ 前端问数工作台 (Task 6)
   - ✅ Markdown 渲染 + SQL 代码块高亮 (Task 6)
   - ✅ MVP 不执行 SQL、不引入向量 RAG、用 SSE (全计划)
   - ✅ 错误脱敏 (Task 2, 4)

2. **Placeholder scan:** All code blocks contain complete implementations. No TBD, TODO, or placeholder patterns found.

3. **Type consistency:** All TypeScript interfaces match the FastAPI response shapes. Python service method signatures are consistent across tasks. API routes use consistent path patterns.

4. **Dependency consistency:** `cryptography` already in `requirements.txt`. `openai` already installed. Frontend deps (zustand, react-markdown, remark-gfm, react-syntax-highlighter) are added in Task 6.
