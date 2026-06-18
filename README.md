# MetricForge

AI 智能问数与报表 SQL 开发平台 — 融资租赁行业

## 项目概述

MetricForge 是一个面向融资租赁行业的 AI 驱动的查询与报表 SQL 开发平台。其核心目标是通过元数据治理和指标标准化，让业务人员能够通过自然语言问数、分析师能够高效开发报表，解决传统 BI 项目中"指标口径不一致"和"数据找不到"的痛点。

### 核心能力

- **元数据采集** — 自动从 Oracle 19c 源库采集表结构、字段、注释、索引、约束及统计信息
- **指标治理** — 指标定义的全生命周期管理（草稿 → 审核 → 已发布 → 已废弃）
- **口径管理** — 同一指标支持多种计算口径（如"自然月"、"工作日"）
- **字段语义** — 为字段赋予业务含义，形成企业级业务术语表
- **治理待办** — 自动检测无语义字段，驱动数据治理流程
- **可扩展架构** — 适配器模式设计，未来可扩展 Hive/Spark/Doris/ClickHouse

## 技术架构

### 阶段 1（当前）

```
┌─────────────────────────────────────────────────┐
│                    Web UI                        │
│        Jinja2 + Bootstrap 5 + HTML/JS           │
├─────────────────────────────────────────────────┤
│                 REST API                         │
│              FastAPI (Python)                    │
├─────────────────────────────────────────────────┤
│   datasource  metadata   metric   governance     │
│    service    service    service    service       │
├──────────────────┬──────────────────────────────┤
│   MetadataCollector (ABC)  │  DataSourceAdapter   │
│   OracleCollector          │  OracleAdapter       │
├────────────────────────────┴──────────────────────┤
│              SQLAlchemy 2.0 ORM                   │
│           SQLite (dev) / PostgreSQL (prod)         │
└─────────────────────────────────────────────────┘
```

### 架构原则

- **适配器模式** — `DataSourceAdapter` 抽象类定义了统一的连接/查询/测试接口，每种数据库类型实现一个子类
- **分层采集** — `MetadataCollector` 抽象类定义了采集生命周期（Schema → Table → Column → Index → Constraint），与具体数据库解耦
- **全量刷新** — 元数据采集采用"先删后插"策略，保证采集结果与源库完全一致
- **自愈治理** — 采集完成后自动检测字段语义缺失，生成治理待办

## 快速开始

### 环境要求

- Python 3.12+
- Oracle Instant Client（仅连接 Oracle 时需要）

### 安装

```bash
# 克隆项目
cd MetricForge

# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
# 或 .venv\Scripts\activate  # Windows

# 安装依赖
pip install -r requirements.txt
```

### 配置

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件，按需修改配置：

```ini
# Oracle 连接密码（可选，仅连接 Oracle 时需要）
ORACLE_PASSWORD=your_password

# 密码加密密钥（可选，留空则自动生成）
METRICFORGE_ENCRYPTION_KEY=

# 数据库连接（默认 SQLite，可用于开发）
METRICFORGE_DB_URL=sqlite:///./data/metricforge.db

# 调试模式
METRICFORGE_DEBUG=true

# 日志级别
METRICFORGE_LOG_LEVEL=INFO
```

### 启动

```bash
python -m app.main
```

服务默认启动在 `http://localhost:8000`，访问入口：

| 路径 | 说明 |
|---|---|
| `/web/dashboard` | 系统仪表盘 |
| `/web/datasources` | 数据源管理 |
| `/web/metadata` | 元数据浏览 |
| `/web/metrics` | 指标管理 |
| `/web/field-semantics` | 字段语义维护 |
| `/web/governance` | 治理待办 |
| `/api/*` | REST API 接口 |
| `/health` | 健康检查 |

### 运行测试

```bash
pytest tests/ -v
```

## 配置参考

### YAML 配置文件（app/config/app_config.yaml）

```yaml
app:
  name: "MetricForge"
  version: "0.1.0"
  debug: true

database:
  url: "sqlite:///./data/metricforge.db"

metadata_collection:
  schemas:
    - "DW"
    - "DWD"
    - "DWS"
  collect_profile: false         # 阶段 2 启用
  sample_percent: 1
  profile_timeout_seconds: 300
  skip_table_rows_above: 100000000
```

### REST API 概览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET/POST/DELETE | `/api/datasources/` | 数据源 CRUD |
| GET | `/api/metadata/tables` | 表元数据列表 |
| GET | `/api/metadata/tables/{id}` | 表详情（含字段/索引/约束） |
| GET | `/api/metadata/schemas` | Schema 列表 |
| POST | `/api/metadata/collect/{ds_id}` | 触发元数据采集 |
| GET/POST | `/api/metrics/` | 指标 CRUD |
| PUT | `/api/metrics/{id}/status` | 指标状态流转 |
| GET | `/api/governance/` | 治理待办列表 |
| POST | `/api/governance/` | 创建治理待办 |
| PUT | `/api/governance/{id}/status` | 待办状态流转 |
| PUT | `/api/governance/{id}/assign` | 分配负责人 |

## 开发指南

### 项目结构

```
MetricForge/
├── app/
│   ├── main.py                    # 应用入口
│   ├── config/                    # 配置加载
│   ├── models/                    # SQLAlchemy 数据模型
│   ├── api/                       # REST API 路由
│   ├── web/                       # Web UI 路由 + 模板
│   ├── adapters/                  # 数据源适配器（抽象层）
│   ├── collectors/                # 元数据采集器
│   └── services/                  # 业务服务层
├── migrations/                    # Alembic 数据库迁移
├── tests/                         # 测试用例
└── .env.example                   # 环境变量模板
```

### 扩展新数据库类型

1. 在 `app/adapters/` 下创建新的适配器，继承 `DataSourceAdapter`：

```python
from ..adapters.base import DataSourceAdapter, QueryResult

class HiveAdapter(DataSourceAdapter):
    def connect(self): ...
    def test_connection(self) -> bool: ...
    def execute_query(self, sql, params=None) -> QueryResult: ...
    def close(self): ...
    def get_dialect(self) -> str: return "hive"
```

2. 在 `app/collectors/` 下创建对应的采集器，继承 `MetadataCollector`
3. 在 `app/services/datasource_service.py` 中添加适配器注册

### 数据模型

| 表 | 说明 | 阶段 |
|---|---|---|
| `datasource_config` | 数据源配置（含加密密码） | 1 |
| `table_metadata` | 表元数据 | 1 |
| `column_metadata` | 字段元数据 | 1 |
| `index_metadata` | 索引元数据 | 1 |
| `constraint_metadata` | 约束元数据 | 1 |
| `metric_definition` | 指标定义 | 1 |
| `metric_caliber` | 指标口径 | 1 |
| `field_semantic` | 字段语义 | 1 |
| `table_relation` | 表关系 | 2 |
| `governance_ticket` | 治理待办 | 1 |
| `history_sql_asset` | 历史 SQL 资产 | 2 |

## 许可证

MIT License
