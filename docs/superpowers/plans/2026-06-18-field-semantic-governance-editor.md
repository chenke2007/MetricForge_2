# 字段语义治理编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通字段语义缺失治理待办到字段语义维护的首版闭环，保存字段语义后自动关闭关联待办。

**Architecture:** 新增 `field-semantics` API 路由负责按字段读取和保存语义；扩展治理待办详情 API 返回字段上下文和已有语义；Web 继续使用现有 Jinja + Bootstrap Modal，在治理详情弹窗内嵌字段语义编辑器。保存语义时调用已有 `auto_resolve_ticket_on_semantic()`，确保语义和待办状态在同一用户动作中闭环。

**Tech Stack:** FastAPI、SQLAlchemy、Jinja2、Bootstrap 5、vanilla JavaScript、Pytest。

---

## 文件结构

- 修改：`tests/test_basic.py`
  - 增加字段语义 API、治理详情字段上下文、Web 控件和列表展示测试。
- 创建：`app/api/field_semantics.py`
  - 提供 `GET /api/field-semantics/columns/{column_id}` 和 `PUT /api/field-semantics/columns/{column_id}`。
- 修改：`app/main.py`
  - 注册字段语义 API 路由。
- 修改：`app/api/governance.py`
  - 治理待办详情对字段类待办返回 `field_context` 和 `field_semantic`。
- 修改：`app/services/governance_service.py`
  - 让 `auto_resolve_ticket_on_semantic()` 返回关闭数量，并在调用方可验证。
- 修改：`app/web/routes.py`
  - 字段语义列表查询时 join 字段和表，模板可显示完整路径。
- 修改：`app/web/templates/governance/list.html`
  - 在治理详情 Modal 中增加字段语义编辑器，并保存到字段语义 API。
- 修改：`app/web/templates/field_semantics/list.html`
  - 展示 `schema.table.column`、字段类型、语义摘要和治理状态。

---

## Task 1: 字段语义 API 红灯测试

**Files:**
- Modify: `tests/test_basic.py`

- [ ] **Step 1: 添加字段语义 API 测试所需 imports**

在 `tests/test_basic.py` 顶部模型 import 中补充：

```python
from app.models import (
    DatasourceConfig,
    MetricDefinition,
    MetricCaliber,
    GovernanceTicket,
    TableMetadata,
    ColumnMetadata,
    FieldSemantic,
)
```

- [ ] **Step 2: 添加保存字段语义并自动关闭待办的失败测试**

在文件末尾追加：

```python
def test_save_field_semantic_closes_related_ticket(client, db_session):
    """测试保存字段语义后自动关闭关联治理待办"""
    ds = DatasourceConfig(
        name="语义测试数据源",
        ds_type="oracle",
        host="127.0.0.1",
        port=1521,
        username="readonly",
        dialect="oracle",
    )
    db_session.add(ds)
    db_session.flush()
    table = TableMetadata(
        datasource_id=ds.id,
        schema_name="DWD",
        table_name="CONTRACT",
        table_type="TABLE",
    )
    db_session.add(table)
    db_session.flush()
    column = ColumnMetadata(
        table_id=table.id,
        column_name="STATUS",
        column_type="VARCHAR2(20)",
        nullable=True,
        comment="状态",
        column_id=1,
    )
    db_session.add(column)
    db_session.flush()
    ticket = GovernanceTicket(
        ticket_type="missing_semantic",
        title="字段语义缺失: DWD.CONTRACT.STATUS",
        description="字段 STATUS 缺少业务含义解释",
        source="auto_detect",
        related_object_type="column",
        related_object_id=column.id,
        priority="medium",
        status="open",
    )
    db_session.add(ticket)
    db_session.commit()

    resp = client.put(
        f"/api/field-semantics/columns/{column.id}",
        params={
            "business_alias": "合同状态",
            "meaning": "表示合同当前生命周期状态",
            "unit": "",
            "enum_values": '{"A":"有效","I":"无效"}',
            "data_quality_note": "历史数据存在空值",
            "governed_by": "治理专员",
        },
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["message"] == "字段语义已保存"
    assert data["closed_tickets"] == 1

    db_session.expire_all()
    semantic = db_session.query(FieldSemantic).filter(FieldSemantic.column_id == column.id).one()
    assert semantic.business_alias == "合同状态"
    assert semantic.meaning == "表示合同当前生命周期状态"
    assert semantic.enum_values == '{"A":"有效","I":"无效"}'
    assert semantic.data_quality_note == "历史数据存在空值"
    assert semantic.is_governed is True
    assert semantic.governed_by == "治理专员"
    assert semantic.governed_at is not None

    closed_ticket = db_session.query(GovernanceTicket).filter(GovernanceTicket.id == ticket.id).one()
    assert closed_ticket.status == "resolved"
    assert closed_ticket.resolution == "字段语义已治理"
    assert closed_ticket.assignee == "治理专员"
```

- [ ] **Step 3: 添加获取字段语义详情的失败测试**

继续追加：

```python
def test_get_field_semantic_returns_column_context(client, db_session):
    """测试字段语义详情接口返回字段上下文和已有语义"""
    ds = DatasourceConfig(
        name="语义详情数据源",
        ds_type="oracle",
        host="127.0.0.1",
        port=1521,
        username="readonly",
        dialect="oracle",
    )
    db_session.add(ds)
    db_session.flush()
    table = TableMetadata(
        datasource_id=ds.id,
        schema_name="ADS",
        table_name="CUSTOMER",
        table_type="TABLE",
    )
    db_session.add(table)
    db_session.flush()
    column = ColumnMetadata(
        table_id=table.id,
        column_name="LEVEL_CODE",
        column_type="VARCHAR2(10)",
        nullable=False,
        comment="客户等级",
        enum_samples="A,B,C",
        column_id=2,
    )
    db_session.add(column)
    db_session.add(
        FieldSemantic(
            column_id=column.id,
            business_alias="客户等级",
            meaning="客户分层等级编码",
            enum_values='{"A":"高价值"}',
            is_governed=True,
            governed_by="数据治理",
        )
    )
    db_session.commit()

    resp = client.get(f"/api/field-semantics/columns/{column.id}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["column"]["schema_name"] == "ADS"
    assert data["column"]["table_name"] == "CUSTOMER"
    assert data["column"]["column_name"] == "LEVEL_CODE"
    assert data["column"]["enum_samples"] == "A,B,C"
    assert data["semantic"]["business_alias"] == "客户等级"
    assert data["semantic"]["meaning"] == "客户分层等级编码"
```

- [ ] **Step 4: 运行红灯测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_save_field_semantic_closes_related_ticket tests/test_basic.py::test_get_field_semantic_returns_column_context -q
```

Expected:

```text
2 failed
```

失败原因应为 `404 Not Found`，因为 `/api/field-semantics/...` 还没有注册。

---

## Task 2: 实现字段语义 API

**Files:**
- Create: `app/api/field_semantics.py`
- Modify: `app/main.py`
- Modify: `app/services/governance_service.py`

- [ ] **Step 1: 修改自动关闭服务返回关闭数量**

在 `app/services/governance_service.py` 中把 `auto_resolve_ticket_on_semantic()` 改为返回 `int`：

```python
def auto_resolve_ticket_on_semantic(column_id: int, governed_by: str = None) -> int:
    """当字段语义被治理后，自动关闭对应的治理待办"""
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
            ticket.resolution = "字段语义已治理"
            from datetime import datetime
            ticket.resolved_at = datetime.utcnow()
            if governed_by:
                ticket.assignee = governed_by
        db.commit()
        if tickets:
            logger.info("自动关闭 %d 个治理待办 (column_id=%s)", len(tickets), column_id)
        return len(tickets)
    except Exception as e:
        db.rollback()
        logger.error("自动关闭治理待办失败: %s", e)
        raise
    finally:
        db.close()
```

- [ ] **Step 2: 创建字段语义 API 文件**

创建 `app/api/field_semantics.py`：

```python
"""字段语义 API"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..models import ColumnMetadata, FieldSemantic, get_session
from ..services.governance_service import auto_resolve_ticket_on_semantic

router = APIRouter()


def get_db():
    db = get_session()
    try:
        yield db
    finally:
        db.close()


def _serialize_column(column: ColumnMetadata) -> dict:
    return {
        "id": column.id,
        "schema_name": column.table.schema_name,
        "table_name": column.table.table_name,
        "column_name": column.column_name,
        "column_type": column.column_type,
        "nullable": column.nullable,
        "comment": column.comment,
        "is_primary_key": column.is_primary_key,
        "is_foreign_key": column.is_foreign_key,
        "enum_samples": column.enum_samples,
    }


def _serialize_semantic(semantic: FieldSemantic | None) -> dict | None:
    if not semantic:
        return None
    return {
        "id": semantic.id,
        "business_alias": semantic.business_alias,
        "meaning": semantic.meaning,
        "unit": semantic.unit,
        "enum_values": semantic.enum_values,
        "data_quality_note": semantic.data_quality_note,
        "is_governed": semantic.is_governed,
        "governed_by": semantic.governed_by,
        "governed_at": str(semantic.governed_at) if semantic.governed_at else None,
    }


@router.get("/columns/{column_id}")
def get_column_semantic(column_id: int, db: Session = Depends(get_db)):
    """获取字段上下文和字段语义"""
    column = db.query(ColumnMetadata).filter(ColumnMetadata.id == column_id).first()
    if not column:
        raise HTTPException(status_code=404, detail="字段不存在")
    return {
        "column": _serialize_column(column),
        "semantic": _serialize_semantic(column.semantic),
    }


@router.put("/columns/{column_id}")
def save_column_semantic(
    column_id: int,
    business_alias: str = Query(..., description="业务别名"),
    meaning: str = Query(..., description="字段含义"),
    unit: str = Query(None, description="单位"),
    enum_values: str = Query(None, description="枚举值解释"),
    data_quality_note: str = Query(None, description="数据质量说明"),
    governed_by: str = Query(None, description="治理负责人"),
    db: Session = Depends(get_db),
):
    """创建或更新字段语义，并自动关闭关联治理待办"""
    if not business_alias.strip():
        raise HTTPException(status_code=400, detail="业务别名不能为空")
    if not meaning.strip():
        raise HTTPException(status_code=400, detail="字段含义不能为空")

    column = db.query(ColumnMetadata).filter(ColumnMetadata.id == column_id).first()
    if not column:
        raise HTTPException(status_code=404, detail="字段不存在")

    semantic = column.semantic
    if not semantic:
        semantic = FieldSemantic(column_id=column.id)
        db.add(semantic)

    semantic.business_alias = business_alias.strip()
    semantic.meaning = meaning.strip()
    semantic.unit = unit.strip() if unit else None
    semantic.enum_values = enum_values.strip() if enum_values else None
    semantic.data_quality_note = data_quality_note.strip() if data_quality_note else None
    semantic.is_governed = True
    semantic.governed_by = governed_by.strip() if governed_by else None
    semantic.governed_at = datetime.utcnow()

    db.commit()
    db.refresh(semantic)

    closed_count = auto_resolve_ticket_on_semantic(column_id, semantic.governed_by)
    return {
        "message": "字段语义已保存",
        "semantic_id": semantic.id,
        "closed_tickets": closed_count,
    }
```

- [ ] **Step 3: 注册字段语义 API 路由**

在 `app/main.py` 的 API imports 和 router 注册中加入：

```python
from .api.field_semantics import router as field_semantics_router
```

```python
app.include_router(field_semantics_router, prefix="/api/field-semantics", tags=["字段语义"])
```

- [ ] **Step 4: 运行 Task 1 测试确认转绿**

Run:

```powershell
python -m pytest tests/test_basic.py::test_save_field_semantic_closes_related_ticket tests/test_basic.py::test_get_field_semantic_returns_column_context -q
```

Expected:

```text
2 passed
```

---

## Task 3: 治理详情 API 返回字段上下文

**Files:**
- Modify: `tests/test_basic.py`
- Modify: `app/api/governance.py`

- [ ] **Step 1: 添加治理详情字段上下文红灯测试**

在 `tests/test_basic.py` 末尾追加：

```python
def test_governance_detail_returns_field_context_for_column_ticket(client, db_session):
    """测试字段类治理待办详情返回字段上下文"""
    ds = DatasourceConfig(
        name="待办字段数据源",
        ds_type="oracle",
        host="127.0.0.1",
        port=1521,
        username="readonly",
        dialect="oracle",
    )
    db_session.add(ds)
    db_session.flush()
    table = TableMetadata(
        datasource_id=ds.id,
        schema_name="DWS",
        table_name="ORDER_SUMMARY",
        table_type="TABLE",
    )
    db_session.add(table)
    db_session.flush()
    column = ColumnMetadata(
        table_id=table.id,
        column_name="PAY_STATUS",
        column_type="VARCHAR2(10)",
        nullable=True,
        comment="支付状态",
        column_id=3,
    )
    db_session.add(column)
    ticket = GovernanceTicket(
        ticket_type="missing_semantic",
        title="字段语义缺失: DWS.ORDER_SUMMARY.PAY_STATUS",
        description="字段 PAY_STATUS 缺少业务含义解释",
        source="auto_detect",
        related_object_type="column",
        related_object_id=column.id,
        priority="medium",
        status="open",
    )
    db_session.add(ticket)
    db_session.commit()

    resp = client.get(f"/api/governance/{ticket.id}")

    assert resp.status_code == 200
    data = resp.json()
    assert data["field_context"]["schema_name"] == "DWS"
    assert data["field_context"]["table_name"] == "ORDER_SUMMARY"
    assert data["field_context"]["column_name"] == "PAY_STATUS"
    assert data["field_semantic"] is None
```

- [ ] **Step 2: 运行红灯测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_governance_detail_returns_field_context_for_column_ticket -q
```

Expected:

```text
1 failed
```

失败原因应为响应缺少 `field_context`。

- [ ] **Step 3: 修改治理详情 API**

在 `app/api/governance.py` 中导入：

```python
from ..models import ColumnMetadata, FieldSemantic, GovernanceTicket, get_session
```

在 `get_ticket()` 返回前增加：

```python
    field_context = None
    field_semantic = None
    if t.related_object_type == "column" and t.related_object_id:
        column = db.query(ColumnMetadata).filter(ColumnMetadata.id == t.related_object_id).first()
        if column:
            field_context = {
                "id": column.id,
                "schema_name": column.table.schema_name,
                "table_name": column.table.table_name,
                "column_name": column.column_name,
                "column_type": column.column_type,
                "nullable": column.nullable,
                "comment": column.comment,
                "is_primary_key": column.is_primary_key,
                "is_foreign_key": column.is_foreign_key,
                "enum_samples": column.enum_samples,
            }
            semantic = column.semantic
            if semantic:
                field_semantic = {
                    "id": semantic.id,
                    "business_alias": semantic.business_alias,
                    "meaning": semantic.meaning,
                    "unit": semantic.unit,
                    "enum_values": semantic.enum_values,
                    "data_quality_note": semantic.data_quality_note,
                    "is_governed": semantic.is_governed,
                    "governed_by": semantic.governed_by,
                    "governed_at": str(semantic.governed_at) if semantic.governed_at else None,
                }
```

并在返回 dict 中加入：

```python
        "field_context": field_context,
        "field_semantic": field_semantic,
```

- [ ] **Step 4: 运行测试确认转绿**

Run:

```powershell
python -m pytest tests/test_basic.py::test_governance_detail_returns_field_context_for_column_ticket -q
```

Expected:

```text
1 passed
```

---

## Task 4: 治理待办 Modal 内嵌字段语义编辑器

**Files:**
- Modify: `tests/test_basic.py`
- Modify: `app/web/templates/governance/list.html`

- [ ] **Step 1: 添加 Web 控件红灯测试**

在 `tests/test_basic.py` 末尾追加：

```python
def test_governance_modal_has_field_semantic_editor_controls(client):
    """测试治理待办弹窗包含字段语义编辑器控件"""
    resp = client.get("/web/governance")

    assert resp.status_code == 200
    assert "fieldSemanticPanel" in resp.text
    assert "semanticBusinessAlias" in resp.text
    assert "semanticMeaning" in resp.text
    assert "semanticEnumValues" in resp.text
    assert "semanticQualityNote" in resp.text
    assert "semanticGovernedBy" in resp.text
    assert "saveFieldSemantic" in resp.text
```

- [ ] **Step 2: 运行红灯测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_governance_modal_has_field_semantic_editor_controls -q
```

Expected:

```text
1 failed
```

失败原因应为缺少 `fieldSemanticPanel`。

- [ ] **Step 3: 在治理 Modal 中添加字段语义面板**

在 `app/web/templates/governance/list.html` 的待办操作区后追加：

```html
                <div id="fieldSemanticPanel" class="mt-3 d-none">
                    <hr>
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <span class="fw-bold"><i class="bi bi-tags me-1"></i>字段语义治理</span>
                        <span id="semanticColumnPath" class="badge bg-light text-dark"></span>
                    </div>
                    <div id="semanticFieldContext" class="small text-muted mb-2"></div>
                    <div class="row g-2 small">
                        <div class="col-md-6">
                            <label class="form-label">业务别名 <span class="text-danger">*</span></label>
                            <input id="semanticBusinessAlias" type="text" class="form-control form-control-sm">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">治理负责人</label>
                            <input id="semanticGovernedBy" type="text" class="form-control form-control-sm">
                        </div>
                        <div class="col-12">
                            <label class="form-label">字段含义 <span class="text-danger">*</span></label>
                            <textarea id="semanticMeaning" class="form-control form-control-sm" rows="2"></textarea>
                        </div>
                        <div class="col-md-4">
                            <label class="form-label">单位</label>
                            <input id="semanticUnit" type="text" class="form-control form-control-sm">
                        </div>
                        <div class="col-md-8">
                            <label class="form-label">枚举值解释</label>
                            <textarea id="semanticEnumValues" class="form-control form-control-sm" rows="2" placeholder='{"A":"有效","I":"无效"}'></textarea>
                        </div>
                        <div class="col-12">
                            <label class="form-label">数据质量说明</label>
                            <textarea id="semanticQualityNote" class="form-control form-control-sm" rows="2"></textarea>
                        </div>
                        <div class="col-md-6">
                            <button id="saveFieldSemantic" type="button" class="btn btn-success btn-sm" onclick="saveFieldSemantic()">
                                <i class="bi bi-check2-circle"></i> 保存语义并关闭待办
                            </button>
                        </div>
                        <div class="col-md-6 text-md-end">
                            <span id="fieldSemanticResult"></span>
                        </div>
                    </div>
                </div>
```

- [ ] **Step 4: 增加 JS 状态变量**

在现有 `let currentTicketId = null;` 后增加：

```javascript
let currentSemanticColumnId = null;
```

- [ ] **Step 5: 在打开待办时重置字段语义面板**

在 `showTicket(id)` 开头重置：

```javascript
    currentSemanticColumnId = null;
    document.getElementById('fieldSemanticPanel').classList.add('d-none');
    document.getElementById('fieldSemanticResult').innerHTML = '';
```

- [ ] **Step 6: 在 showTicket 成功后填充字段语义表单**

在 `showTicket(id)` 中设置待办普通控件后追加：

```javascript
    renderFieldSemanticEditor(t);
```

新增函数：

```javascript
function renderFieldSemanticEditor(ticket) {
    const panel = document.getElementById('fieldSemanticPanel');
    if (!ticket.field_context) {
        panel.classList.add('d-none');
        currentSemanticColumnId = null;
        return;
    }

    const field = ticket.field_context;
    const semantic = ticket.field_semantic || {};
    currentSemanticColumnId = field.id;
    panel.classList.remove('d-none');

    document.getElementById('semanticColumnPath').textContent =
        `${field.schema_name}.${field.table_name}.${field.column_name}`;
    document.getElementById('semanticFieldContext').innerHTML =
        `类型：${field.column_type || '-'} · 注释：${field.comment || '-'} · 可空：${field.nullable ? 'Y' : 'N'}`
        + (field.is_primary_key ? ' · PK' : '')
        + (field.is_foreign_key ? ' · FK' : '')
        + (field.enum_samples ? ` · 样例：${field.enum_samples}` : '');

    document.getElementById('semanticBusinessAlias').value = semantic.business_alias || '';
    document.getElementById('semanticMeaning').value = semantic.meaning || '';
    document.getElementById('semanticUnit').value = semantic.unit || '';
    document.getElementById('semanticEnumValues').value = semantic.enum_values || '';
    document.getElementById('semanticQualityNote').value = semantic.data_quality_note || '';
    document.getElementById('semanticGovernedBy').value = semantic.governed_by || document.getElementById('ticketAssignee').value || '';
}
```

- [ ] **Step 7: 添加保存字段语义函数**

在脚本末尾追加：

```javascript
async function saveFieldSemantic() {
    if (!currentSemanticColumnId) {
        return;
    }

    const btn = document.getElementById('saveFieldSemantic');
    const resultEl = document.getElementById('fieldSemanticResult');
    const params = new URLSearchParams({
        business_alias: document.getElementById('semanticBusinessAlias').value.trim(),
        meaning: document.getElementById('semanticMeaning').value.trim(),
    });

    const optionalFields = [
        ['unit', 'semanticUnit'],
        ['enum_values', 'semanticEnumValues'],
        ['data_quality_note', 'semanticQualityNote'],
        ['governed_by', 'semanticGovernedBy'],
    ];
    optionalFields.forEach(([paramName, elementId]) => {
        const value = document.getElementById(elementId).value.trim();
        if (value) {
            params.set(paramName, value);
        }
    });

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> 保存中...';
    resultEl.innerHTML = '';

    try {
        const resp = await fetch(`/api/field-semantics/columns/${currentSemanticColumnId}?${params.toString()}`, { method: 'PUT' });
        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.detail || '字段语义保存失败');
        }
        resultEl.innerHTML = '<span class="text-success fw-bold"><i class="bi bi-check-circle-fill"></i> 已保存并关闭待办</span>';
        window.setTimeout(() => window.location.href = window.location.href, 700);
    } catch (err) {
        resultEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle-fill"></i> ' + err.message + '</span>';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check2-circle"></i> 保存语义并关闭待办';
    }
}
```

- [ ] **Step 8: 运行 Web 控件测试确认转绿**

Run:

```powershell
python -m pytest tests/test_basic.py::test_governance_modal_has_field_semantic_editor_controls -q
```

Expected:

```text
1 passed
```

---

## Task 5: 字段语义列表展示字段完整路径

**Files:**
- Modify: `tests/test_basic.py`
- Modify: `app/web/routes.py`
- Modify: `app/web/templates/field_semantics/list.html`

- [ ] **Step 1: 添加字段语义列表红灯测试**

在 `tests/test_basic.py` 末尾追加：

```python
def test_field_semantics_page_shows_column_path(client, db_session):
    """测试字段语义列表展示 schema.table.column"""
    ds = DatasourceConfig(
        name="语义列表数据源",
        ds_type="oracle",
        host="127.0.0.1",
        port=1521,
        username="readonly",
        dialect="oracle",
    )
    db_session.add(ds)
    db_session.flush()
    table = TableMetadata(
        datasource_id=ds.id,
        schema_name="DM",
        table_name="CUSTOMER_TAG",
        table_type="TABLE",
    )
    db_session.add(table)
    db_session.flush()
    column = ColumnMetadata(
        table_id=table.id,
        column_name="TAG_CODE",
        column_type="VARCHAR2(30)",
        nullable=True,
        column_id=1,
    )
    db_session.add(column)
    db_session.flush()
    db_session.add(
        FieldSemantic(
            column_id=column.id,
            business_alias="客户标签",
            meaning="客户运营标签编码",
            is_governed=True,
            governed_by="治理专员",
        )
    )
    db_session.commit()

    resp = client.get("/web/field-semantics")

    assert resp.status_code == 200
    assert "DM.CUSTOMER_TAG.TAG_CODE" in resp.text
    assert "VARCHAR2(30)" in resp.text
    assert "客户标签" in resp.text
    assert "治理专员" in resp.text
```

- [ ] **Step 2: 运行红灯测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_field_semantics_page_shows_column_path -q
```

Expected:

```text
1 failed
```

失败原因应为页面没有完整字段路径。

- [ ] **Step 3: 修改 Web 路由预加载字段关系**

在 `app/web/routes.py` 中导入：

```python
from sqlalchemy.orm import joinedload
```

修改 `field_semantic_list()` 查询：

```python
        semantics = (
            db.query(FieldSemantic)
            .options(joinedload(FieldSemantic.column).joinedload(ColumnMetadata.table))
            .order_by(FieldSemantic.id.desc())
            .limit(50)
            .all()
        )
```

- [ ] **Step 4: 修改字段语义列表模板**

将 `app/web/templates/field_semantics/list.html` 中表头改为：

```html
                <tr>
                    <th>字段</th>
                    <th>类型</th>
                    <th>业务别名</th>
                    <th>含义</th>
                    <th>单位</th>
                    <th>已治理</th>
                    <th>负责人</th>
                </tr>
```

将循环行改为：

```html
                <tr>
                    <td class="fw-bold">
                        {{ s.column.table.schema_name }}.{{ s.column.table.table_name }}.{{ s.column.column_name }}
                    </td>
                    <td><span class="badge bg-light text-dark">{{ s.column.column_type }}</span></td>
                    <td>{{ s.business_alias or '-' }}</td>
                    <td class="text-muted small">{{ s.meaning[:40] + '...' if s.meaning and s.meaning|length > 40 else s.meaning or '-' }}</td>
                    <td>{{ s.unit or '-' }}</td>
                    <td>{% if s.is_governed %}<span class="badge bg-success">是</span>{% else %}<span class="badge bg-warning text-dark">否</span>{% endif %}</td>
                    <td>{{ s.governed_by or '-' }}</td>
                </tr>
```

- [ ] **Step 5: 运行列表测试确认转绿**

Run:

```powershell
python -m pytest tests/test_basic.py::test_field_semantics_page_shows_column_path -q
```

Expected:

```text
1 passed
```

---

## Task 6: 全量验证和浏览器验收

**Files:**
- No production edits unless verification finds a bug.

- [ ] **Step 1: 运行本轮相关测试**

Run:

```powershell
python -m pytest tests/test_basic.py::test_save_field_semantic_closes_related_ticket tests/test_basic.py::test_get_field_semantic_returns_column_context tests/test_basic.py::test_governance_detail_returns_field_context_for_column_ticket tests/test_basic.py::test_governance_modal_has_field_semantic_editor_controls tests/test_basic.py::test_field_semantics_page_shows_column_path -q
```

Expected:

```text
5 passed
```

- [ ] **Step 2: 运行全量测试**

Run:

```powershell
python -m pytest tests/ -q
```

Expected:

```text
23 passed
```

实际通过数量若因已有测试数量变化而不同，以 `0 failed` 为准。

- [ ] **Step 3: 重启本地服务**

Run:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*uvicorn*' -or $_.CommandLine -like '*app.main*' } | Select-Object ProcessId,Name,CommandLine
```

停止旧 `uvicorn app.main:app --port 8000` 进程后启动：

```powershell
Start-Process 'D:\Program Files\Python312\python.exe' -ArgumentList '-m','uvicorn','app.main:app','--host','0.0.0.0','--port','8000' -WorkingDirectory 'D:\projects\MetricForge' -WindowStyle Hidden
```

- [ ] **Step 4: 准备浏览器验收数据**

使用 SQLite 插入临时数据：

```python
import sqlite3
conn = sqlite3.connect("data/metricforge.db")
cur = conn.cursor()
cur.execute("""
INSERT INTO datasource_config (name, ds_type, host, port, username, dialect, is_active)
VALUES ('Codex_Semantic_TEMP_DS', 'oracle', '127.0.0.1', 1521, 'readonly', 'oracle', 1)
""")
ds_id = cur.lastrowid
cur.execute("""
INSERT INTO table_metadata (datasource_id, schema_name, table_name, table_type, is_sensitive)
VALUES (?, 'COD', 'SEMANTIC_DEMO', 'TABLE', 0)
""", (ds_id,))
table_id = cur.lastrowid
cur.execute("""
INSERT INTO column_metadata (table_id, column_name, column_type, nullable, column_id, comment, is_primary_key, is_unique_key, is_foreign_key, is_sensitive)
VALUES (?, 'STATUS', 'VARCHAR2(20)', 1, 1, '状态', 0, 0, 0, 0)
""", (table_id,))
column_id = cur.lastrowid
cur.execute("""
INSERT INTO governance_ticket (ticket_type, title, description, source, related_object_type, related_object_id, priority, status)
VALUES ('missing_semantic', '字段语义缺失: COD.SEMANTIC_DEMO.STATUS', '浏览器验收临时待办', 'auto_detect', 'column', ?, 'medium', 'open')
""", (column_id,))
conn.commit()
print(column_id)
```

- [ ] **Step 5: 浏览器验收**

打开：

```text
http://localhost:8000/web/governance
```

验收：

- 点击 `字段语义缺失: COD.SEMANTIC_DEMO.STATUS`。
- Modal 展示 `字段语义治理` 面板。
- 填写：
  - 业务别名：`状态`
  - 字段含义：`表示记录当前业务状态`
  - 枚举值解释：`{"A":"有效","I":"无效"}`
  - 数据质量说明：`临时验收数据`
  - 治理负责人：`Codex`
- 点击 `保存语义并关闭待办`。
- 页面显示保存成功并刷新。
- 打开 `/web/field-semantics`，确认看到 `COD.SEMANTIC_DEMO.STATUS` 和 `状态`。

- [ ] **Step 6: 清理浏览器验收临时数据**

Run:

```python
import sqlite3
conn = sqlite3.connect("data/metricforge.db")
cur = conn.cursor()
cur.execute("""
DELETE FROM governance_ticket
WHERE description = '浏览器验收临时待办'
""")
cur.execute("""
DELETE FROM field_semantic
WHERE column_id IN (
    SELECT c.id
    FROM column_metadata c
    JOIN table_metadata t ON c.table_id = t.id
    JOIN datasource_config d ON t.datasource_id = d.id
    WHERE d.name = 'Codex_Semantic_TEMP_DS'
)
""")
cur.execute("""
DELETE FROM column_metadata
WHERE table_id IN (
    SELECT t.id
    FROM table_metadata t
    JOIN datasource_config d ON t.datasource_id = d.id
    WHERE d.name = 'Codex_Semantic_TEMP_DS'
)
""")
cur.execute("""
DELETE FROM table_metadata
WHERE datasource_id IN (
    SELECT id FROM datasource_config WHERE name = 'Codex_Semantic_TEMP_DS'
)
""")
cur.execute("DELETE FROM datasource_config WHERE name = 'Codex_Semantic_TEMP_DS'")
conn.commit()
```

---

## Task 7: 提交和推送

**Files:**
- All files changed in this plan.

- [ ] **Step 1: 查看 Git 状态**

Run:

```powershell
git status -sb
```

Expected:

```text
## main...origin/main [ahead 1]
 M app/api/governance.py
 M app/main.py
 M app/services/governance_service.py
 M app/web/routes.py
 M app/web/templates/field_semantics/list.html
 M app/web/templates/governance/list.html
 M tests/test_basic.py
?? app/api/field_semantics.py
?? docs/superpowers/plans/2026-06-18-field-semantic-governance-editor.md
```

- [ ] **Step 2: 提交实现**

Run:

```powershell
git add tests/test_basic.py app/api/field_semantics.py app/api/governance.py app/main.py app/services/governance_service.py app/web/routes.py app/web/templates/field_semantics/list.html app/web/templates/governance/list.html docs/superpowers/plans/2026-06-18-field-semantic-governance-editor.md
git commit -m "feat: add field semantic governance editor"
```

- [ ] **Step 3: 推送到 GitHub**

Run:

```powershell
git push
```

Expected:

```text
main -> main
```

---

## Self-Review Checklist

- Spec coverage:
  - 字段语义 API：Task 1、Task 2。
  - 治理详情字段上下文：Task 3。
  - 治理 Modal 内嵌编辑器：Task 4。
  - 字段语义列表完整路径：Task 5。
  - 自动关闭待办：Task 1、Task 2。
  - 浏览器验收和清理：Task 6。
- Placeholder scan:
  - 无 `TBD`、`TODO`、`实现稍后补充`。
- Type consistency:
  - API 路由统一使用 `/api/field-semantics/columns/{column_id}`。
  - Web DOM id 与测试断言一致。
  - `closed_tickets` 在 API 响应中为整数关闭数量。
