# 元数据去重、稳定刷新与变更检测设计

## 目标

本阶段把元数据采集从“可重复执行的全量覆盖”升级为“可安全重复执行的稳定刷新”。重点解决重复采集、并发采集、字段 ID 不稳定、源端对象删除无法感知、采集变化不可见等问题。

本阶段采用“稳妥治理优先”策略：先保证已有字段语义、治理待办、后续指标引用不会因为重新采集被破坏；定期增量采集只预留模型和接口边界，不在本阶段实现完整调度器。

## 背景

当前 MetricForge 已具备：

- 数据源配置和 Oracle 真实元数据采集。
- `MetadataCollectionJob` 记录采集任务状态、耗时、统计和错误。
- 采集任务中心、任务详情页、数据源详情页触发采集。
- 字段语义治理编辑器已能从治理待办跳转到字段，并在维护语义后关闭待办。

当前采集行为存在几个关键问题：

- 表按 `datasource_id + schema_name + table_name` 查询后更新或新增，但数据库层没有唯一约束，并发场景仍可能插入重复表。
- 字段、索引、约束当前采用“先删除再插入”，字段 ID 会变化，可能导致字段语义和治理待办断链。
- 同一个数据源已有 `running` 任务时，仍可能再次创建新的采集任务。
- 源端删除的表、字段、索引、约束不会在本地明确标记为下线。
- 采集任务只记录总数，不记录新增、下线、类型变化、注释变化等变更摘要。

## 范围

本阶段覆盖：

- 数据库唯一约束，防止重复表、重复字段、重复索引、重复约束。
- 同数据源并发采集保护。
- 表、字段、索引、约束使用 upsert 刷新，避免删除重建字段。
- 元数据对象增加活跃/下线标记，记录首次采集、最近采集、下线时间。
- 采集任务增加变更摘要统计。
- 采集任务详情页展示变更摘要。
- 为未来定期增量采集预留字段和服务边界。
- 针对重复采集、字段 ID 稳定、下线标记、并发保护和变更统计增加测试。

本阶段不覆盖：

- 独立调度器、cron、APScheduler、Celery、RQ 或 Redis。
- 真正按时间自动触发的定期采集。
- 基于 Oracle `last_ddl_time` 的对象级轻量扫描。
- 对大表字段画像的增量刷新。
- 采集任务取消、暂停、重试队列。
- 多进程分布式锁。

## 方案选择

### 方案 A：最小防重复

只增加唯一约束和 running 任务拦截。

优点：

- 实现快。
- 能减少重复任务和重复表。

缺点：

- 字段仍然删除重建。
- 字段语义和治理待办仍可能断链。
- 无法感知源端删除和结构变化。

### 方案 B：治理稳定版（推荐）

在唯一约束和 running 拦截基础上，将表、字段、索引、约束改为稳定 upsert，并记录对象下线和变更摘要。

优点：

- 字段 ID 稳定，保护字段语义和治理待办。
- 重复采集变成安全操作。
- 后续指标、血缘和治理闭环有稳定元数据基础。
- 为后续定期增量采集打好数据模型基础。

缺点：

- 需要调整模型、采集服务和测试。
- 需要处理已有 SQLite 数据的兼容迁移。

### 方案 C：完整自动化版

同时实现定期调度、增量扫描、对象级采集和自动治理待办。

优点：

- 自动化闭环完整。

缺点：

- 范围过大。
- 当前刚接入真实 Oracle 采集，直接引入调度和增量策略会放大风险。
- 调度基础设施选择会影响后续部署方式。

## 推荐方案

采用方案 B：治理稳定版。

理由：

- 当前最重要的问题不是“自动跑起来”，而是“重复跑也不会破坏治理数据”。
- 字段语义治理已经上线，字段 ID 稳定性必须优先保证。
- 增量采集需要依赖对象状态、采集时间、变更摘要，本阶段正好补齐这些基础。
- 定期调度可以在下一阶段复用本阶段的安全采集服务。

## 数据模型设计

### 表元数据

`table_metadata` 增加或调整以下能力：

- 唯一约束：`datasource_id + schema_name + table_name`。
- `is_active: bool`：源端当前是否存在，默认 `true`。
- `first_collected_at: datetime | null`：首次采集时间。
- `last_collected_at: datetime | null`：最近一次采集时间。
- `dropped_at: datetime | null`：源端不再出现时的下线时间。
- 保留现有 `collected_at`，兼容已有页面；实现时可同步写入 `last_collected_at`。

下线表不物理删除。下线后保留字段、语义和治理记录，页面后续可通过 `is_active` 筛选或标识。

### 字段元数据

`column_metadata` 增加或调整以下能力：

- 唯一约束：`table_id + column_name`。
- `is_active: bool`：字段当前是否仍在源端存在，默认 `true`。
- `first_collected_at: datetime | null`。
- `last_collected_at: datetime | null`。
- `dropped_at: datetime | null`。

字段采集时不再删除整表字段。采到的字段按 `table_id + column_name` 更新；本轮未出现但本地仍 active 的字段标记为 inactive。

字段 ID 必须稳定。字段语义 `FieldSemantic.column_id` 和治理待办 `GovernanceTicket.related_object_id` 不需要迁移。

### 索引元数据

`index_metadata` 增加：

- 唯一约束：`table_id + index_name`。
- `is_active`、`first_collected_at`、`last_collected_at`、`dropped_at`。

索引按名称 upsert，本轮未出现则标记下线。

### 约束元数据

`constraint_metadata` 增加：

- 唯一约束：`table_id + constraint_name`。
- `is_active`、`first_collected_at`、`last_collected_at`、`dropped_at`。

约束按名称 upsert，本轮未出现则标记下线。

### 采集任务

`metadata_collection_job` 增加变更摘要字段：

- `tables_added_count`
- `tables_updated_count`
- `tables_deactivated_count`
- `columns_added_count`
- `columns_updated_count`
- `columns_deactivated_count`
- `columns_type_changed_count`
- `columns_comment_changed_count`
- `indexes_added_count`
- `indexes_deactivated_count`
- `constraints_added_count`
- `constraints_deactivated_count`
- `change_summary`：JSON 文本，保存采样明细，例如前 50 条变化。

预留定期采集字段：

- `collection_mode`：`full`、`safe_refresh`、`incremental_candidate`。本阶段默认 `safe_refresh`。
- `triggered_by` 继续区分 `web`、`api`，未来可增加 `scheduler`。

## 并发控制设计

创建采集任务时，先检查同一 `datasource_id` 是否已有 `status='running'` 的任务。

如果存在：

- 不创建新任务。
- 返回已有 running 任务。
- 响应中增加 `reused_running_job: true`。
- 数据源详情页提示“已有采集任务正在执行”，继续轮询该任务。

这个机制先在应用层实现。数据库层的分布式锁不在本阶段做。对于单进程本地开发和当前 FastAPI 使用方式，应用层检查足够覆盖主要误点击和重复点击场景。

## 稳定刷新流程

### 总流程

1. 创建或复用采集任务。
2. 按数据源 `schema_names` 得到 schema 范围。
3. 对每个 schema 采集表和视图清单。
4. 对表执行 upsert。
5. 对每张 active 表采集字段、索引、约束。
6. 对字段、索引、约束执行 upsert。
7. 将本轮未出现的对象标记为 inactive。
8. 汇总新增、更新、下线、类型变化、注释变化。
9. 运行缺失字段语义检测，只对 active 字段创建待办。
10. 更新采集任务状态和变更摘要。

### 表 upsert

表自然键为：

```text
datasource_id + schema_name + table_name
```

如果表不存在：

- 创建表记录。
- `is_active=true`。
- 设置 `first_collected_at`、`last_collected_at`。
- 计入 `tables_added_count`。

如果表存在：

- 更新表类型、注释、行数估算、统计信息。
- `is_active=true`。
- 清空 `dropped_at`。
- 更新 `last_collected_at`。
- 如果属性有变化，计入 `tables_updated_count`。

本轮 schema 中未出现的 active 表：

- `is_active=false`。
- 设置 `dropped_at`。
- 计入 `tables_deactivated_count`。

### 字段 upsert

字段自然键为：

```text
table_id + column_name
```

如果字段不存在：

- 创建字段记录。
- 计入 `columns_added_count`。

如果字段存在：

- 更新类型、长度、可空性、序号、默认值、注释、主键/唯一键/外键标记。
- 保持字段 `id` 不变。
- 如果类型变化，计入 `columns_type_changed_count`。
- 如果注释变化，计入 `columns_comment_changed_count`。
- 其他属性变化计入 `columns_updated_count`。

本轮表中未出现的 active 字段：

- `is_active=false`。
- 设置 `dropped_at`。
- 计入 `columns_deactivated_count`。

字段下线不自动关闭已有字段语义待办。本阶段只在任务详情显示变化，后续治理阶段可设计“字段下线待办”。

### 索引和约束 upsert

索引和约束按名称定位。采到则更新，未采到则标记 inactive。

索引字段列表或约束字段列表变化时计入 updated，但本阶段不单独拆分为类型变化指标。

## 缺失语义检测调整

`_detect_missing_semantics()` 只扫描 active 表下的 active 字段。

下线字段不创建新的缺失语义待办。已有待办保持原状，避免系统自动关闭可能仍需人工判断的治理事项。

新增字段如果没有语义，则沿用当前逻辑自动创建 `missing_semantic` 待办。

## API 和页面设计

### 创建采集任务 API

`POST /api/metadata/jobs/{datasource_id}` 响应增加：

```json
{
  "id": 12,
  "status": "running",
  "reused_running_job": false,
  "collection_mode": "safe_refresh"
}
```

如果复用已有 running 任务：

```json
{
  "id": 11,
  "status": "running",
  "reused_running_job": true,
  "collection_mode": "safe_refresh"
}
```

### 采集任务详情 API

任务详情返回新增的变更统计字段和 `change_summary`。

`change_summary` 作为 JSON 文本存储，API 层解析失败时返回原始字符串并记录日志，不阻断任务详情展示。

### 页面展示

采集任务详情页增加“变更摘要”区域：

- 表：新增、更新、下线。
- 字段：新增、更新、下线、类型变化、注释变化。
- 索引：新增、下线。
- 约束：新增、下线。
- 如果有采样明细，展示前若干条对象路径，例如 `DWHRPT.T_ORDER.ORDER_ID`。

数据源详情页重复点击采集时，如果复用 running 任务，提示“已有采集任务正在执行”，并继续跳转或轮询该任务。

## 定期增量采集预留

本阶段不实现定时器，但模型和服务为下一阶段保留边界：

- `collection_mode` 预留 `incremental_candidate`。
- `triggered_by` 预留 `scheduler`。
- 采集服务接受 `mode` 参数，当前只实际支持 `safe_refresh`。
- 变更摘要结构可被未来调度器复用。

下一阶段可以基于这些基础实现：

- 数据源配置采集周期。
- 调度器定时创建任务。
- 轻量扫描 Oracle `all_objects.last_ddl_time`，只深采可能变化的对象。
- 根据变更自动生成治理待办，例如字段类型变化待确认、表下线待确认。

## 数据迁移策略

当前项目主要使用 SQLite 本地库，并通过 SQLAlchemy `create_all()` 创建表。实现时需要兼容已有数据库：

1. 新增字段时使用轻量迁移函数检查列是否存在，不存在则 `ALTER TABLE ADD COLUMN`。
2. 新增唯一索引前先检查重复数据。
3. 如果已有重复表，保留最新 `collected_at` 的记录，其余重复记录不自动删除；实现阶段先通过测试覆盖新写入不重复。
4. SQLite 不支持复杂在线约束修改时，采用唯一索引代替表约束。

唯一索引建议：

```text
ux_table_metadata_identity(datasource_id, schema_name, table_name)
ux_column_metadata_identity(table_id, column_name)
ux_index_metadata_identity(table_id, index_name)
ux_constraint_metadata_identity(table_id, constraint_name)
```

## 错误处理

- 并发任务复用不是错误，返回 `running`。
- upsert 时发生唯一约束冲突，任务标记为 `failed`，错误写入 `error_message`。
- 单个 schema 失败时沿用当前 `partial_success` 语义。
- 如果所有请求 schema 都失败，任务标记为 `failed`。
- 变更摘要写入失败不应掩盖采集失败原因；优先保留采集错误。

## 测试计划

模型和迁移测试：

- 新字段存在。
- 唯一索引存在。
- 重复自然键不会新增重复记录。

任务服务测试：

- 同数据源已有 running 任务时，创建接口复用已有任务。
- 不同数据源可以分别创建 running 任务。
- 复用 running 任务时不会调用采集执行函数。

采集服务测试：

- 重复采集同一张表不会新增第二条 `TableMetadata`。
- 重复采集同一字段不会改变 `ColumnMetadata.id`。
- 字段类型变化会更新字段并计入 `columns_type_changed_count`。
- 字段注释变化会更新字段并计入 `columns_comment_changed_count`。
- 本轮缺失字段会标记 inactive，不物理删除。
- 下线字段保留已有 `FieldSemantic`。
- 缺失语义检测只为 active 字段创建待办。

API 和页面测试：

- 创建任务 API 返回 `reused_running_job`。
- 任务详情 API 返回变更统计。
- 任务详情页展示变更摘要。
- 数据源详情页对复用 running 任务显示合适提示。

回归测试：

- 真实 Oracle 表和字段采集路径不回退。
- 现有任务中心、字段语义编辑器、治理待办测试继续通过。

## 风险和缓解

字段 ID 稳定后，旧的删除重建逻辑会变复杂。缓解方式是先抽出小型 upsert helper，让表、字段、索引、约束分别测试。

SQLite 迁移能力有限。缓解方式是使用兼容性强的 `ALTER TABLE ADD COLUMN` 和唯一索引，并在实现阶段先处理本地开发库。

下线对象是否应出现在列表页可能影响用户体验。本阶段只建立数据状态，页面默认仍可先展示 active 对象；下线对象详情展示可在后续单独优化。

定期增量采集不在本阶段完成，用户仍需要手动触发刷新。缓解方式是在 spec 和页面文案里明确这是下一阶段能力。

## 验收标准

- 重复点击采集同一数据源时，不会创建多个并发 running 任务。
- 重复采集同一 schema 后，表和字段不会重复插入。
- 字段 ID 在重复采集后保持稳定。
- 源端缺失字段被标记 inactive，而不是物理删除。
- 已有字段语义不会因为重复采集丢失。
- 任务详情能看到变更摘要统计。
- 所有现有测试和新增测试通过。
