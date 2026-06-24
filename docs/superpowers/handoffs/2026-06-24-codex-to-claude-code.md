# Codex 到 Claude Code 正式交接文档

**交接日期:** 2026-06-24
**项目:** MetricForge
**当前仓库:** `D:\projects\MetricForge`
**GitHub:** `https://github.com/chenke2007/MetricForge_2.git`
**当前分支:** `main`
**最新已推送提交:** `a498883 merge: dwhrpt real collection task center`

## 1. 接手原则

Claude Code 接手后应继续使用 superpowers 流程，不要直接跳进实现。

推荐启动顺序：

1. 使用 `superpowers:using-superpowers` 确认可用技能。
2. 阅读本交接文档。
3. 阅读最近的设计与计划文档：
   - `docs/superpowers/specs/2026-06-22-dwhrpt-real-collection-task-center-design.md`
   - `docs/superpowers/plans/2026-06-22-dwhrpt-real-collection-task-center.md`
   - `docs/superpowers/specs/2026-06-24-modern-frontend-evolution-design.md`
4. 对新功能先用 `superpowers:brainstorming`。
5. 对多步骤实现先用 `superpowers:writing-plans`。
6. 对已有计划执行用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development`。
7. 对 bug 或异常用 `superpowers:systematic-debugging`。
8. 完成前用 `superpowers:verification-before-completion`。

## 2. 当前 Git 状态

`main` 已合并并推送到 GitHub：

- `a498883 merge: dwhrpt real collection task center`
- 远端 `origin/main` 已同步。

本地仍有未跟踪文件，默认不要提交：

- `DESIGN-vercel.md`
- `reports/`

这些文件不是当前功能交付的一部分。Claude Code 接手时应先运行：

```powershell
git status --short
git log --oneline --decorate -5
```

确认未跟踪文件仍未被误纳入提交。

## 3. 已完成的主要能力

### 3.1 dwhrpt 真实元数据采集 smoke

新增脚本：

```text
scripts/smoke_dwhrpt_metadata_collection.py
```

能力：

- 支持 dry-run。
- 支持真实 `--execute`。
- 支持 `--schema` 临时覆盖本次采集范围。
- 不导入 `app.main`，避免触发全局 app 初始化副作用。
- 默认 SQLite 父目录不存在时会自动创建。
- 对失败详情做敏感信息脱敏。
- `job_ids=[]` 时不会捞历史 job 冒充本次结果。
- execute 后恢复 datasource 原有 schedule/schema 配置。
- 退出码约定：
  - `0`: 真实成功，且表/字段数量非零。
  - `1`: 数据源不存在。
  - `2`: 失败或未产生本次 job。
  - `3`: `partial_success`。
  - `4`: 空成功，即 success 但表或字段为 0。

真实验证命令：

```powershell
$env:METRICFORGE_DB_URL='sqlite:///D:/projects/MetricForge/data/metricforge.db'
python scripts/smoke_dwhrpt_metadata_collection.py --datasource-name dwhrpt --execute
```

真实验证结果：

- datasource: `dwhrpt`
- job id: `7`
- status: `success`
- tables: `681`
- columns: `12012`
- indexes: `205`
- constraints: `13`
- exit code: `0`

这证明当前点击或调度采集不再是“秒 success 但没有真实采集”。

### 3.2 采集任务中心增强

改动文件：

- `app/web/routes.py`
- `app/web/templates/metadata/jobs.html`
- `tests/test_basic.py`

新增/增强能力：

- `/web/metadata/jobs` 顶部任务概览：
  - 启用自动采集的数据源数。
  - running 任务数。
  - 最近 24 小时成功任务数。
  - 最近 24 小时失败/部分成功任务数。
  - 元数据变更治理待办数。
- 数据源调度状态表：
  - 自动采集状态。
  - 间隔/固定时间。
  - 下次运行时间。
  - 最近调度状态。
  - 最近采集任务。
  - 最近错误摘要。
- 操作：
  - 执行一次调度扫描。
  - 对单个数据源立即创建采集任务。
  - 跳转数据源详情。
  - 跳转采集任务详情。
- 任务列表增强：
  - `triggered_by`
  - 表/字段数量
  - 结构变更数量
  - 治理待办数量与跳转
  - 错误摘要

### 3.3 采集任务详情页增强

改动文件：

- `app/web/templates/metadata/job_detail.html`
- `tests/test_basic.py`

能力：

- 采集任务详情页的数据源名称可跳转到 `/web/datasources/{id}`。
- 当 `governance_tickets_created_count > 0` 时显示“查看元数据变更待办”。
- 当治理待办数量为 0 时不显示治理跳转按钮。

## 4. 已执行验证

合并到 `main` 后执行：

```powershell
$env:PYTHONPATH='.'
pytest -q
```

结果：

```text
120 passed, 23 warnings
```

warnings 主要来自：

- `datetime.utcnow()` deprecation。
- FastAPI/Starlette TestClient 的 httpx deprecation。

这些 warning 是非阻塞项，但后续可以作为技术债清理。

## 5. 关键文件索引

### 采集与调度

- `scripts/smoke_dwhrpt_metadata_collection.py`
- `app/services/metadata_scheduler_service.py`
- `app/services/metadata_scheduler_runtime.py`
- `app/services/metadata_job_service.py`
- `app/services/metadata_service.py`

### Web UI

- `app/web/routes.py`
- `app/web/templates/metadata/jobs.html`
- `app/web/templates/metadata/job_detail.html`
- `app/web/templates/datasources/detail.html`
- `app/web/templates/governance/list.html`

### 测试

- `tests/test_basic.py`
- `tests/conftest.py`

### 设计与计划

- `docs/superpowers/specs/2026-06-22-dwhrpt-real-collection-task-center-design.md`
- `docs/superpowers/plans/2026-06-22-dwhrpt-real-collection-task-center.md`
- `docs/superpowers/specs/2026-06-24-modern-frontend-evolution-design.md`

## 6. 当前 UI 架构判断

MetricForge 当前 Web UI 是：

```text
FastAPI + Jinja2 + Bootstrap 5 + 原生 JavaScript
```

这套架构适合：

- 数据源管理。
- 治理待办 CRUD。
- 元数据任务中心。
- 简单后台配置页面。

不适合作为未来核心智能交互层：

- AI 问数对话。
- SQL 编辑器。
- 查询结果分析。
- 可视化报表搭建。
- 拖拽布局。
- 流式输出。
- 实时任务状态。
- 复杂前端状态管理。

现代前端演进设计见：

```text
docs/superpowers/specs/2026-06-24-modern-frontend-evolution-design.md
```

## 7. 推荐下一步

我建议 Claude Code 接手后的下一阶段先不要推倒 Jinja，而是走渐进式路线：

1. 保留现有 Jinja 后台作为“治理与配置后台”。
2. 新建现代前端工作台作为“智能数据工作台”。
3. 优先实现高交互模块：
   - AI 问数对话。
   - SQL 开发工作台。
   - 查询结果图表。
   - 报表生成与预览。
4. 再逐步迁移高价值治理页面。

推荐下一份 spec：

```text
docs/superpowers/specs/YYYY-MM-DD-ai-query-workbench-design.md
```

或者先写实施计划：

```text
docs/superpowers/plans/YYYY-MM-DD-modern-frontend-foundation.md
```

## 8. Claude Code 可直接使用的接手提示词

```text
请使用 superpowers 相关 skill 继续开发 MetricForge。

当前仓库：D:\projects\MetricForge
当前分支：main
远端：https://github.com/chenke2007/MetricForge_2.git
最新已 push 提交：a498883 merge: dwhrpt real collection task center

请先阅读：
docs/superpowers/handoffs/2026-06-24-codex-to-claude-code.md
docs/superpowers/specs/2026-06-22-dwhrpt-real-collection-task-center-design.md
docs/superpowers/plans/2026-06-22-dwhrpt-real-collection-task-center.md
docs/superpowers/specs/2026-06-24-modern-frontend-evolution-design.md

已完成：
- dwhrpt 真实元数据采集 smoke。
- 采集任务中心 UI 增强。
- 采集任务详情页数据源与治理待办链接。
- 真实 smoke 成功结果：job #7，681 tables，12012 columns，205 indexes，13 constraints。
- 全量测试：120 passed。

请继续按 superpowers 流程推进。
推荐下一步：围绕“现代前端工作台”写 implementation plan，优先打通 React/TypeScript 前端骨架、FastAPI API 边界、AI 问数对话和 SQL 编辑器的第一阶段。
```

## 9. 注意事项

- 不要默认提交 `DESIGN-vercel.md` 和 `reports/`。
- 真实 `dwhrpt` 采集会访问 Oracle，执行前应确认用户允许。
- `scripts/smoke_dwhrpt_metadata_collection.py --execute` 会真实执行采集，但会恢复 datasource 原有 schedule/schema 配置。
- 后续如果要做前端迁移，应先写 plan，不要直接创建 React 项目。
- 现代前端不应一次性替换所有 Jinja 页面，应先承载高交互工作台。
