# dwhrpt 真实采集联调与采集任务中心增强设计

## 背景

MetricForge 已经具备元数据采集任务、重复 running 任务复用、增量变更摘要、定期调度 tick、治理待办自动生成，以及基础采集任务中心页面。下一步需要把这些能力用本机已配置的 `dwhrpt` Oracle 数据源真实跑通，并把调度与采集状态集中呈现在“采集任务中心”。

当前风险是：页面或 API 显示成功并不等于真实 Oracle 元数据已经采集成功。必须明确区分：

- 调度扫描成功。
- 采集任务创建成功。
- Oracle 连接与 SQL 元数据查询成功。
- 表、字段、索引、约束实际落库成功。
- 第二次采集能正确识别增量变更。
- 结构变化能生成治理待办。

本阶段目标是把这些状态做成可验证、可诊断、可操作的闭环。

## 目标

1. 对 `dwhrpt` 数据源执行真实采集烟测，确认不会再出现“点击采集后直接 success 但没有实际采集”的情况。
2. 让采集任务中心展示调度视角：哪些数据源启用了自动采集、下一次采集时间、最近调度结果、最近采集任务、失败原因。
3. 在任务中心提供安全的手动操作：手动 scheduler tick、对单个数据源创建采集任务、对失败或最近任务重跑。
4. 把采集结果和治理闭环连起来：任务列表展示本次生成治理待办数量，任务详情能跳转到元数据变更待办。
5. 保留失败诊断信息：真实连接失败、Oracle SQL 失败、权限不足、采集部分失败，都应显示明确状态和错误明细。

## 非目标

- 不在本阶段实现复杂分布式任务队列。
- 不引入新的数据库调度框架或外部 scheduler。
- 不改造 Oracle 采集器的整体 SQL 策略，除非真实联调暴露出阻断性 bug。
- 不新增长期审计表；先复用 `MetadataCollectionJob`、`DatasourceConfig`、`GovernanceTicket`。
- 不在文档或日志中暴露数据库密码、连接串密钥或个人凭据。

## 设计方案

采用“真实联调优先 + 任务中心增强”的方案。

先写一个可重复执行的本地 smoke 脚本或测试命令，对名称为 `dwhrpt` 的数据源做最小真实闭环：

1. 查询 `DatasourceConfig.name == "dwhrpt"`。
2. 校验数据源存在、启用、必要连接字段存在。
3. 可选启用自动采集配置并设置 `metadata_next_run_at <= now`。
4. 调用 `run_metadata_scheduler_tick(execute_jobs=True)`。
5. 查询本次创建或复用的 `MetadataCollectionJob`。
6. 输出任务状态、表/字段/索引/约束数量、错误摘要、变更摘要、治理待办数量。

如果真实采集失败，smoke 输出必须保留失败状态，不允许把失败包装成 success。失败信息进入任务的 `error_message` / `error_details`。

联调通过或问题明确后，再增强采集任务中心页面。

## 采集任务中心增强

### 顶部概览

在 `/web/metadata/jobs` 增加一组紧凑状态指标：

- 启用自动采集的数据源数。
- 当前 running 任务数。
- 最近 24 小时成功任务数。
- 最近 24 小时失败或 partial_success 任务数。
- 元数据变更待办 open/in_progress 数。

这些指标直接从现有表查询，不新增持久化字段。

### 数据源调度表

在任务中心顶部或任务列表上方增加“数据源调度状态”区域，展示每个启用自动采集的数据源：

- 数据源名称。
- 自动采集是否启用。
- 采集间隔与每日固定时间。
- `metadata_next_run_at`。
- `metadata_last_scheduled_at`。
- `metadata_last_schedule_status`。
- 最近一条采集任务状态。
- 最近失败原因摘要。
- 操作按钮：立即采集、查看任务、查看数据源。

如果没有启用自动采集的数据源，显示一个轻量空状态，引导去数据源详情页启用。

### 任务列表增强

现有任务列表增加字段：

- 触发来源 `triggered_by`。
- 本次变更摘要计数：表新增/下线、字段新增/下线/类型变化/注释变化。
- 本次生成治理待办数量 `governance_tickets_created_count`。
- 若有治理待办数量，提供 `/web/governance?source=metadata_change_detected` 链接。
- 错误摘要保留一行显示，详情页显示完整 `error_details`。

### 手动调度与重跑

新增页面按钮和 API 使用方式：

- “执行一次调度扫描”：调用 `POST /api/metadata/scheduler/tick`，只扫描并创建任务，不直接执行长耗时任务。
- “立即采集”：沿用 `POST /api/metadata/jobs/{datasource_id}`，创建后台采集任务。
- “查看任务详情”：跳转 `/web/metadata/jobs/{job_id}`。

对于“立即执行并采集”的真实 smoke，不放在普通 UI 的默认按钮里，避免用户误触长耗时 Oracle 采集。真实 smoke 作为本地运维/开发命令执行。

## API 与服务边界

优先复用现有 API：

- `POST /api/metadata/jobs/{datasource_id}`：创建采集任务并后台执行。
- `GET /api/metadata/jobs`：任务列表。
- `GET /api/metadata/jobs/{job_id}`：任务详情。
- `POST /api/metadata/scheduler/tick`：手动调度扫描。
- `PUT /api/datasources/{ds_id}/metadata-schedule`：更新自动采集配置。
- `GET /api/governance/?source=metadata_change_detected`：查看元数据变更待办。

如页面需要聚合视图，优先在 `app/web/routes.py` 做页面查询聚合；只有当聚合也需要被外部调用时，才新增 API。

## 真实 dwhrpt smoke 设计

新增一个开发/运维脚本，建议路径：

`scripts/smoke_dwhrpt_metadata_collection.py`

脚本行为：

1. 使用项目默认 DB 配置。
2. 查询 `dwhrpt` 数据源，不存在则返回非 0 并输出 `dwhrpt datasource not found`。
3. 打印数据源 ID、名称、类型、host、schema_names，但不打印密码。
4. 将该数据源设置为启用自动采集，`metadata_next_run_at` 设为当前时间。
5. 调用 `run_metadata_scheduler_tick(execute_jobs=True)`。
6. 查询本次涉及的 job，打印 JSON 摘要：
   - scheduler result。
   - job id/status/triggered_by。
   - tables/columns/indexes/constraints。
   - change counters。
   - governance_tickets_created_count。
   - error_message。
   - error_details 前若干行。
7. 如果任务状态为 `failed`，脚本退出码为 2。
8. 如果任务状态为 `partial_success`，脚本退出码为 3。
9. 如果成功但表或字段数量为 0，脚本退出码为 4，避免“空成功”。
10. 成功且有实际表/字段统计时退出码为 0。

脚本必须支持参数：

- `--datasource-name dwhrpt`，默认 `dwhrpt`。
- `--execute`，必须显式传入才执行真实采集；不传时只打印将要执行的检查。
- `--schema DWHRPT`，可选覆盖 schema filter，便于做小范围验证。

## 错误处理

- `dwhrpt` 不存在：脚本和页面提示“数据源不存在”，不创建任务。
- Oracle 连接失败：任务状态 `failed`，错误进入 `error_message`。
- 某些 schema 或对象采集失败：任务状态 `partial_success`，错误列表进入 `error_details`。
- 调度 tick 创建任务失败：数据源 `metadata_last_schedule_status = failed`，`metadata_next_run_at` 推迟 30 分钟。
- 已有 running 任务：复用 running 任务，不重复创建；页面显示 `reused_running_job`。
- 治理待办生成失败：采集任务保持 success/partial_success，错误附加到 `error_details`，不回滚元数据采集结果。

## 测试策略

### 自动化测试

新增或扩展 `tests/test_basic.py`：

- 任务中心展示调度概览。
- 任务中心展示启用自动采集的数据源状态。
- 任务列表展示 `governance_tickets_created_count` 和跳转链接。
- 手动 scheduler tick API 可从页面按钮调用。
- smoke 脚本 dry-run 在 `dwhrpt` 不存在时返回清晰错误。
- smoke 脚本 dry-run 在 `dwhrpt` 存在时不执行真实采集，只输出计划。

自动化测试不连接真实 Oracle。

### 手动/真实验证

在用户已允许真实联调的前提下，执行：

```powershell
python scripts/smoke_dwhrpt_metadata_collection.py --datasource-name dwhrpt --execute
```

如果需要限制 schema：

```powershell
python scripts/smoke_dwhrpt_metadata_collection.py --datasource-name dwhrpt --schema DWHRPT --execute
```

验收时记录：

- 命令退出码。
- scheduler result。
- job id 和 status。
- tables/columns/indexes/constraints 数量。
- 是否生成 change_summary。
- 是否生成治理待办。
- 任务中心页面能否看到同一任务。

## 验收标准

1. `dwhrpt` 真实 smoke 不会产生“空 success”。如果采集不到表/字段，必须失败并给出原因。
2. 采集任务状态与真实执行一致：success、partial_success、failed 三类可区分。
3. 重复触发时 running 任务会复用，不重复创建并发任务。
4. 调度 tick 会更新 `metadata_next_run_at` 和最近调度状态。
5. 任务中心能展示调度状态、最近任务、失败摘要、治理待办数量。
6. 任务详情能继续展示变更摘要和治理待办入口。
7. 全量测试通过，真实 smoke 结果被记录到最终说明中。

## 推进顺序

1. 写 smoke 脚本和 dry-run 测试。
2. 在本机 dry-run 验证 `dwhrpt` 是否存在。
3. 执行真实 smoke，记录失败或成功证据。
4. 若真实 smoke 暴露采集器 bug，先修采集器 bug。
5. 增强采集任务中心页面和必要 API。
6. 跑聚焦测试、全量测试、真实 smoke 复验。
7. 提交并推送。
