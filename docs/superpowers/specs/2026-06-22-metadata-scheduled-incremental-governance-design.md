# 定期增量采集与变更治理闭环设计

## 目标

本阶段把已经稳定的手动元数据安全刷新，升级为应用内可自动触发的定期刷新，并把采集识别到的关键结构变化自动转成治理待办。

本阶段的“增量”不指 Oracle 对象级物理增量扫描，而是指：

- 定期自动执行安全刷新。
- 通过稳定 upsert 和变更摘要识别新增、下线、类型变化、注释变化。
- 只把有治理价值的变化推入治理闭环。

完成后，用户应能在数据源上启用自动采集，系统在应用运行时按配置创建采集任务，并在字段或表发生关键变化时生成治理待办。

## 背景

当前 MetricForge 已具备：

- Oracle 数据源配置和真实元数据采集。
- `MetadataCollectionJob` 记录采集任务状态、耗时、统计、错误和变更摘要。
- 表、字段、索引、约束的稳定 upsert。
- 重复采集去重和 running 任务复用。
- 字段、表、索引、约束的 active/inactive 状态。
- 采集任务详情页展示变更摘要。
- 字段语义治理编辑器，可从治理待办跳转到字段并保存语义。

当前缺口：

- 数据源没有自动采集配置。
- 应用没有定期扫描到期数据源并创建采集任务的调度服务。
- 采集识别出的字段类型变化、字段下线、表下线等变化还不会进入治理待办。
- 页面无法看到自动采集的上次调度、下次调度和调度结果。

## 范围

本阶段覆盖：

- 数据源自动采集配置字段。
- SQLite 轻量迁移补齐新增字段。
- 应用内轻量调度服务。
- 手动触发调度 tick 的 API，便于测试和后续接外部 cron。
- 采集完成后根据变更摘要生成治理待办。
- 任务记录本次生成的治理待办数量。
- 数据源详情页展示自动采集配置和调度状态。
- 采集任务详情页展示治理待办生成数量。
- 治理待办 API 和页面支持按 `source` 过滤。
- 单元测试和集成测试覆盖调度、幂等、治理待办生成和页面展示。

本阶段不覆盖：

- Celery、Redis、RQ 或分布式任务队列。
- 分布式锁。
- 多实例部署下的强一致调度。
- 秒级调度。
- cron 表达式编辑器。
- Oracle `all_objects.last_ddl_time` 对象级轻量扫描。
- 大表字段画像的增量刷新。
- 自动关闭字段下线或表下线影响待办。

## 方案选择

### 方案 A：应用内轻量调度（推荐）

在 FastAPI 应用启动后运行一个轻量后台调度循环。调度器定期扫描已启用自动采集且到期的数据源，到点后创建 `triggered_by="scheduler"` 的采集任务。采集完成后根据变更摘要生成治理待办。

优点：

- 能真正自动运行。
- 不引入新部署依赖。
- 复用现有安全刷新和 running 任务复用机制。
- 适合当前单机 SQLite/FastAPI 阶段。

缺点：

- 多进程或多实例部署时可能重复扫描。
- 只能提供轻量调度能力，不适合作为长期分布式任务系统。

### 方案 B：配置优先，不自动调度

只增加自动采集配置和变更治理待办生成服务，不启动后台调度循环。

优点：

- 风险最低。
- 实现范围小。

缺点：

- 不能满足“定期采集”的核心目标。
- 用户仍需手动触发或自行接外部调度。

### 方案 C：外部调度器优先

直接接入 APScheduler、Celery 或系统 cron，项目只提供幂等调度入口。

优点：

- 更接近生产级调度架构。
- 更容易扩展到多实例和重试队列。

缺点：

- 引入部署和运维复杂度。
- 当前项目还没有队列基础设施，容易过早复杂化。

## 推荐方案

采用方案 A：应用内轻量调度。

理由：

- 当前最需要的是让 `dwhrpt` 这类真实数据源能自动、安全、可观察地刷新。
- 现有 running 任务复用已经能挡住主要重复点击和重复调度风险。
- 变更治理闭环比复杂调度基础设施更有业务价值。
- 后续如果需要 Celery 或 cron，可以复用本阶段的 tick 服务和幂等执行服务。

## 数据模型设计

### 数据源调度配置

在 `datasource_config` 增加字段：

- `metadata_schedule_enabled: bool`
  是否启用自动元数据采集，默认 `false`。
- `metadata_schedule_interval_minutes: int`
  自动采集间隔，默认 `1440`。实现层限制最小值为 `30` 分钟。
- `metadata_schedule_time: str | null`
  可选每日固定执行时间，格式 `HH:MM`。
- `metadata_next_run_at: datetime | null`
  下一次应执行调度的时间。
- `metadata_last_scheduled_at: datetime | null`
  最近一次由调度器创建或复用采集任务的时间。
- `metadata_last_schedule_status: str | null`
  最近一次调度结果，例如 `created`、`reused_running`、`skipped`、`failed`。

`DatasourceConfig.is_active` 继续作为数据源是否参与调度的总开关。只有 active 数据源才会被调度。

### 采集任务

`metadata_collection_job.triggered_by` 继续复用，调度触发时写入 `scheduler`。

在 `metadata_collection_job` 增加：

- `governance_tickets_created_count: int`
  本次采集完成后自动生成的治理待办数量，默认 `0`。

### 治理待办

`GovernanceTicket.ticket_type` 增加约定值：

- `metadata_table_deactivated`
- `metadata_column_deactivated`
- `metadata_column_type_changed`
- `metadata_column_comment_changed`

`GovernanceTicket.source` 增加约定值：

- `metadata_change_detected`

本阶段不新增独立治理待办表。幂等判断使用现有字段：

- `ticket_type`
- `related_object_type`
- `related_object_id`
- `status in ("open", "in_progress")`

## 调度规则设计

### 调度循环

应用启动后启动一个后台循环，默认每 5 分钟执行一次扫描。建议通过配置项控制：

- `METADATA_SCHEDULER_ENABLED`，默认启用。
- `METADATA_SCHEDULER_TICK_SECONDS`，默认 `300`。

每轮扫描只做“到期判断和任务创建”，不在扫描事务里执行长耗时采集。

### 到期条件

数据源满足以下条件时进入候选：

- `DatasourceConfig.is_active == true`
- `metadata_schedule_enabled == true`
- `metadata_next_run_at is not null`
- `metadata_next_run_at <= now`
- `metadata_schedule_interval_minutes >= 30`

如果启用了自动采集但 `metadata_next_run_at` 为空，服务会根据当前时间和配置初始化下一次执行时间。

### 创建任务

到点后调用：

```python
create_metadata_collection_job(datasource_id, triggered_by="scheduler")
```

如果返回 `reused_running_job=true`：

- 不创建新任务。
- `metadata_last_schedule_status = "reused_running"`。
- `metadata_last_scheduled_at = now`。
- `metadata_next_run_at` 推进到下一周期。

如果创建新任务成功：

- `metadata_last_schedule_status = "created"`。
- `metadata_last_scheduled_at = now`。
- `metadata_next_run_at` 推进到下一周期。
- 将任务交给后台执行。

如果创建失败：

- `metadata_last_schedule_status = "failed"`。
- `metadata_last_scheduled_at = now`。
- `metadata_next_run_at` 推进到 30 分钟后，作为轻量退避，避免每个 tick 都失败一次。

### 下一次执行时间

如果配置了 `metadata_schedule_time`：

- 按每日固定时间计算下一次执行。
- 如果今天的固定时间已过，则取明天同一时间。
- 如果同时配置了 interval，本阶段以固定时间优先。

如果没有配置固定时间：

- 使用 `now + metadata_schedule_interval_minutes` 推进。

### 手动 tick

新增 API：

```text
POST /api/metadata/scheduler/tick
```

返回：

```json
{
  "checked": 3,
  "created": 1,
  "reused_running": 1,
  "skipped": 1,
  "failed": 0
}
```

这个接口用于开发、测试和后续接外部 cron。它应复用同一个调度服务函数，避免 UI、API 和后台循环走不同逻辑。

## 变更治理待办生成设计

### 触发时机

在 `execute_metadata_collection_job()` 完成采集并写入任务统计后触发。

只有任务状态为 `success` 或 `partial_success` 时生成治理待办。

如果治理待办生成失败：

- 不把采集任务改成 failed。
- 记录日志。
- 在 `error_details` 中附加治理待办生成失败说明。
- 保留采集结果。

### 输入来源

治理服务读取：

- `MetadataCollectionJob.change_summary`
- 任务的变更计数字段
- `change_summary.samples`

当前 `samples` 结构示例：

```json
[
  {"kind": "column_type_changed", "path": "DWHRPT.T_ORDER.ORDER_ID"},
  {"kind": "column_deactivated", "path": "DWHRPT.T_ORDER.OLD_CODE"}
]
```

### 变更类型映射

| sample kind | ticket_type | related_object_type | priority |
| --- | --- | --- | --- |
| `table_deactivated` | `metadata_table_deactivated` | `table` | `high` |
| `column_deactivated` | `metadata_column_deactivated` | `column` | `high` |
| `column_type_changed` | `metadata_column_type_changed` | `column` | `high` |
| `column_comment_changed` | `metadata_column_comment_changed` | `column` | `medium` |

本阶段不为索引和约束变化生成治理待办。它们仍保留在采集任务变更摘要中，后续如有需要再扩展。

### 对象定位

服务根据 sample path 回查本地元数据：

- 表路径：`schema.table`
- 字段路径：`schema.table.column`

表待办定位：

- `TableMetadata.datasource_id == job.datasource_id`
- `TableMetadata.schema_name == schema`
- `TableMetadata.table_name == table`

字段待办定位：

- 先定位表。
- 再用 `ColumnMetadata.table_id == table.id`
- `ColumnMetadata.column_name == column`

对象可能已经 inactive，但仍然需要生成下线待办，所以查询不应只查 active 对象。

如果找不到对象：

- 不创建无关联待办。
- 记录日志。
- 返回 skipped 数量供调用方诊断。

### 幂等规则

生成前检查是否已有同对象、同类型、状态为 `open` 或 `in_progress` 的待办：

- 有则跳过，不重复创建。
- 如果旧待办已 `resolved` 或 `closed`，后续再次检测到同类变化可以创建新待办。
- 同一采集任务重复调用治理服务也不会重复生成 open/in_progress 待办。

### 标题和描述

标题示例：

- `表下线确认：DWHRPT.T_OLD_ORDER`
- `字段下线确认：DWHRPT.T_ORDER.OLD_CODE`
- `字段类型变化确认：DWHRPT.T_ORDER.ORDER_ID`
- `字段注释变化确认：DWHRPT.T_ORDER.PAY_STATUS`

描述包含：

- 数据源名称。
- 采集任务 ID。
- 变更类型。
- 对象路径。
- 建议处理动作，例如检查指标、SQL、报表、字段语义和下游报表。

## API 设计

### 数据源详情

`GET /api/datasources/{id}` 返回自动采集配置：

```json
{
  "metadata_schedule_enabled": true,
  "metadata_schedule_interval_minutes": 1440,
  "metadata_schedule_time": "02:00",
  "metadata_next_run_at": "2026-06-23 02:00:00",
  "metadata_last_scheduled_at": "2026-06-22 02:00:00",
  "metadata_last_schedule_status": "created"
}
```

### 数据源创建

`POST /api/datasources/` 支持可选参数：

- `metadata_schedule_enabled`
- `metadata_schedule_interval_minutes`
- `metadata_schedule_time`

如果启用自动采集，创建时初始化 `metadata_next_run_at`。

### 更新自动采集配置

新增：

```text
PUT /api/datasources/{id}/metadata-schedule
```

参数：

- `enabled`
- `interval_minutes`
- `schedule_time`

响应返回更新后的配置。

校验规则：

- `interval_minutes >= 30`
- `schedule_time` 为空或匹配 `HH:MM`
- 禁用自动采集时保留历史调度字段，但不再参与扫描。

### 调度 tick

新增：

```text
POST /api/metadata/scheduler/tick
```

返回本轮扫描统计。

### 治理待办列表

`GET /api/governance/` 增加 `source` 过滤参数。

页面 `/web/governance` 同步支持 `source` 参数，便于从采集任务详情跳转：

```text
/web/governance?source=metadata_change_detected
```

## 页面设计

### 数据源详情页

增加“自动采集”区域，展示：

- 是否启用。
- 采集频率。
- 固定执行时间。
- 上次调度时间。
- 下次调度时间。
- 最近调度状态。

提供一个轻量配置表单或按钮入口，支持启用、禁用、调整间隔和固定时间。

### 数据源表单

创建数据源时允许填写：

- 是否启用自动采集。
- 采集间隔分钟。
- 每日固定时间。

默认不启用自动采集，避免新建数据源立即对源库产生定期负载。

### 采集任务详情页

增加：

- 本次生成治理待办数量。
- 如果数量大于 0，展示跳转链接到治理待办列表。

### 治理待办列表页

支持按 source 过滤。

新增待办类型显示为中文标签：

- 表下线确认。
- 字段下线确认。
- 字段类型变化。
- 字段注释变化。

## 错误处理

- 调度器创建任务失败时，不影响应用启动和其他数据源调度。
- 单个数据源调度失败时，记录 `metadata_last_schedule_status="failed"` 并退避 30 分钟。
- 已有 running 任务时视为正常复用，不作为错误。
- 治理待办生成失败不覆盖采集任务本身的成功状态。
- `change_summary` 为空或 JSON 异常时，不生成变更治理待办，并记录诊断日志。
- sample path 无法解析或找不到对象时跳过该 sample，不阻断其他待办生成。

## 测试计划

模型和迁移测试：

- `DatasourceConfig` 包含自动采集配置字段。
- 旧 SQLite 数据库初始化时补齐调度字段。
- `MetadataCollectionJob` 包含 `governance_tickets_created_count`。

调度服务测试：

- 未启用自动采集的数据源不会被调度。
- `metadata_next_run_at` 未到的数据源不会被调度。
- 到点数据源会创建 `triggered_by="scheduler"` 的采集任务。
- 已有 running 任务时复用任务，不重复创建。
- 调度后推进 `metadata_next_run_at`。
- 创建失败时写入 `metadata_last_schedule_status="failed"` 并退避。
- 固定时间配置能正确计算下一次执行时间。
- interval 配置能正确计算下一次执行时间。

治理待办测试：

- 字段类型变化生成 `metadata_column_type_changed` 待办。
- 字段注释变化生成 `metadata_column_comment_changed` 待办。
- 字段下线生成 `metadata_column_deactivated` 待办。
- 表下线生成 `metadata_table_deactivated` 待办。
- 重复调用生成服务不会重复创建 open/in_progress 待办。
- 已 resolved 的旧待办不阻止下一次新变化创建新待办。
- 找不到对象的 sample 被跳过，不阻断其他待办。

集成测试：

- 执行采集任务后，变更摘要能生成治理待办并回写任务创建数量。
- 手动调用 scheduler tick 能创建采集任务。
- 数据源详情页展示自动采集配置和调度状态。
- 任务详情页展示治理待办生成数量。
- 治理待办页面支持 `source=metadata_change_detected` 过滤。
- 现有测试继续通过。

真实数据源烟测：

- 对 `dwhrpt` 启用较长周期的自动采集配置。
- 手动调用 scheduler tick，确认能创建或复用采集任务。
- 真实重复刷新仍保持表、字段、索引、约束数量稳定。
- 如果没有结构变化，不应生成新的变更治理待办。

## 风险和缓解

多进程部署可能重复调度。缓解方式：

- 本阶段明确只保证单进程轻量调度。
- 复用 running 任务保护降低重复执行风险。
- 后续如进入多实例部署，再引入数据库锁或外部调度器。

自动采集可能给 Oracle 带来负载。缓解方式：

- 默认不启用自动采集。
- 最小间隔限制为 30 分钟。
- 推荐生产配置为每日低峰时间。

治理待办可能过多。缓解方式：

- 本阶段只为表下线、字段下线、字段类型变化、字段注释变化生成待办。
- 使用 open/in_progress 幂等规则避免重复堆积。
- 不为索引和约束变化自动生成待办。

变更 sample 只有前 50 条。缓解方式：

- 本阶段基于 sample 生成待办，适合优先暴露重点变化。
- 如果后续需要全量变化待办，应把变化明细结构从 `change_summary` 提升为独立表。

## 验收标准

- 用户能在数据源上启用、禁用和配置定期元数据采集。
- 系统能在应用运行时自动创建到期采集任务。
- 重复调度不会让同一数据源并发跑多个采集。
- 调度状态、上次调度时间、下次调度时间在数据源详情页可见。
- 采集发现字段类型变化、字段注释变化、字段下线、表下线后，会自动生成治理待办。
- 同一对象同一类未完成待办不会重复生成。
- 采集任务详情页能看到本次生成的治理待办数量。
- 治理待办列表能筛选元数据变更待办。
- 真实 `dwhrpt` 仍能安全重复刷新。
- 所有现有测试和新增测试通过。
