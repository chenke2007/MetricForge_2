# 元数据采集与治理闭环 UI 实施计划

> **给 agentic workers：** REQUIRED SUB-SKILL: 使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项实施本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 打通首版 Web 治理闭环：从数据源触发元数据采集，并在治理待办中完成分配和状态流转。

**架构：** 复用现有 FastAPI API、SQLAlchemy 模型和 Jinja 模板，不新增前端框架。数据源详情页通过 JavaScript 调用采集 API；治理待办详情 Modal 增加分配和状态操作表单。

**技术栈：** FastAPI、Jinja2、Bootstrap 5、SQLAlchemy、Pytest。

---

## 文件结构

- 修改：`tests/test_basic.py`
  - 增加 Web UI 行为回归测试。
- 修改：`app/web/templates/datasources/detail.html`
  - 增加“采集元数据”按钮、结果区域和调用采集 API 的脚本。
- 修改：`app/web/templates/metadata/list.html`
  - 增加空状态下的数据源采集入口。
- 修改：`app/web/templates/governance/list.html`
  - 在详情 Modal 中增加分配负责人、状态流转、解决说明控件和提交脚本。

---

### 任务 1：补失败测试

**文件：**
- 修改：`tests/test_basic.py`

- [ ] 添加 `test_datasource_detail_has_metadata_collection_controls`
  - 创建数据源。
  - GET `/web/datasources/{id}`。
  - 断言包含 `采集元数据`、`collectMetadata`、`collectionResult`。

- [ ] 添加 `test_metadata_empty_state_links_to_datasources`
  - GET `/web/metadata`。
  - 断言包含 `去数据源采集` 和 `/web/datasources`。

- [ ] 添加 `test_governance_modal_has_action_controls`
  - 创建治理待办。
  - GET `/web/governance`。
  - 断言包含 `ticketAssignee`、`ticketStatus`、`ticketResolution`、`saveTicketAction`。

- [ ] 运行：

```powershell
python -m pytest tests/test_basic.py::test_datasource_detail_has_metadata_collection_controls tests/test_basic.py::test_metadata_empty_state_links_to_datasources tests/test_basic.py::test_governance_modal_has_action_controls -q
```

预期：3 个测试失败，分别缺少对应 UI 控件。

---

### 任务 2：实现数据源详情页采集入口

**文件：**
- 修改：`app/web/templates/datasources/detail.html`

- [ ] 在页面右上操作区增加按钮：

```html
<button id="collectMetadataBtn" class="btn btn-primary btn-sm" data-ds-id="{{ ds.id }}">
    <i class="bi bi-cloud-download"></i> 采集元数据
</button>
```

- [ ] 增加结果区域：

```html
<div id="collectionResult" class="mt-2 small"></div>
```

- [ ] 增加脚本函数 `collectMetadata()`：
  - POST `/api/metadata/collect/{dsId}`。
  - loading 时禁用按钮。
  - 成功显示 stats。
  - 失败显示错误摘要。
  - 成功后延迟刷新页面。

- [ ] 运行任务 1 中的数据源详情页测试，预期通过。

---

### 任务 3：实现元数据空状态入口

**文件：**
- 修改：`app/web/templates/metadata/list.html`

- [ ] 空状态中增加按钮：

```html
<a href="/web/datasources" class="btn btn-primary btn-sm">去数据源采集</a>
```

- [ ] 运行任务 1 中的元数据空状态测试，预期通过。

---

### 任务 4：实现治理待办操作 UI

**文件：**
- 修改：`app/web/templates/governance/list.html`

- [ ] 在 Modal 详情中追加操作区，包含：
  - `id="ticketAssignee"` 输入框。
  - `id="ticketStatus"` 状态下拉。
  - `id="ticketResolution"` 解决说明 textarea。
  - `id="saveTicketAction"` 保存按钮。
  - `id="ticketActionResult"` 结果区域。

- [ ] `showTicket(id)` 保存当前待办 ID 到全局变量，并填充操作控件当前值。

- [ ] 新增 `saveTicketAction()`：
  - 如果负责人非空，PUT `/api/governance/{id}/assign?assignee=...`。
  - PUT `/api/governance/{id}/status?status=...&resolution=...`。
  - 成功后保留当前 URL 查询参数刷新页面。
  - 失败时显示错误摘要。

- [ ] 运行任务 1 中的治理 Modal 测试，预期通过。

---

### 任务 5：全量验证和浏览器验收

- [ ] 运行：

```powershell
python -m pytest tests/ -q
```

预期：全部通过。

- [ ] 重启 `uvicorn` 服务。

- [ ] 浏览器验收：
  - `/web/datasources/{id}` 存在“采集元数据”按钮。
  - 点击采集按钮后，连接失败时展示错误。
  - `/web/metadata` 空状态有“去数据源采集”入口。
  - `/web/governance` 点击待办标题后 Modal 有操作控件。
  - 分配负责人和更新状态后刷新列表，状态变化可见。

- [ ] 清理浏览器验收产生的临时测试数据。

---

### 任务 6：提交和推送

- [ ] 查看状态：

```powershell
git status -sb
```

- [ ] 提交：

```powershell
git add tests/test_basic.py app/web/templates/datasources/detail.html app/web/templates/metadata/list.html app/web/templates/governance/list.html docs/superpowers/specs/2026-06-18-metadata-governance-loop-ui-design.md docs/superpowers/plans/2026-06-18-metadata-governance-loop-ui.md
git commit -m "feat: add metadata governance loop UI"
```

- [ ] 推送：

```powershell
git push
```

