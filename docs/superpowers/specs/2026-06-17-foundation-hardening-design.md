# 基础整固设计

## 目标

通过一组最小范围的基础修复，让 MetricForge 更容易安装、测试和运行。

## 范围

本次变更只覆盖四项内容：

- 修正 Oracle 依赖声明，将过时的 `cx-oracle` 替换为代码实际使用的 `oracledb`。
- 让应用启动时使用显式传入的数据库 URL 或配置中的数据库 URL，而不是始终硬编码 `sqlite:///./data/metricforge.db`。
- 隔离 FastAPI 测试数据库，避免测试读写开发用的 SQLite 数据库。
- 删除根目录下误生成的 `=8.3.0` 文件，该文件内容是一次依赖安装失败日志。

本次变更不修改业务流程、页面交互、API 形态、密码加密逻辑或元数据采集行为。

## 架构

`app.main.create_app()` 将支持可选参数 `database_url`。应用启动时按以下优先级确定数据库 URL：

1. 显式传入的 `database_url` 参数。
2. 通过现有配置模块或环境变量加载到的数据库 URL。
3. 当前已有的 SQLite 默认值：`sqlite:///./data/metricforge.db`。

测试会调用 `create_app(database_url=...)`，并传入临时 SQLite 数据库。这样既能保持应用路由测试接近真实运行方式，又能避免测试污染 `data/metricforge.db`。

## 组件

- `requirements.txt`：声明代码实际导入的 Oracle 驱动。
- `app/main.py`：解析数据库配置，并用解析后的数据库 URL 初始化数据库。
- `tests/conftest.py`：为 FastAPI 应用 fixture 提供隔离的测试数据库 URL。
- `tests/test_basic.py` 或新的聚焦测试文件：验证应用工厂能接受显式数据库 URL，并在指定数据库中创建应用表。
- `=8.3.0`：删除这个误生成的安装日志文件。

## 数据流

正常启动时，`create_app()` 解析数据库 URL，然后依次调用 `init_db()` 和 `init_tables()`。测试运行时，fixture 传入临时数据库 URL，使当前应用实例的数据库会话指向测试数据库。

## 错误处理

如果配置加载失败，应用启动会继续使用现有 SQLite 默认值。这能保持当前本地运行行为不变，也避免在本轮基础整固中把配置文件问题扩大成启动失败。

## 测试

实现阶段将使用 TDD：

1. 先添加一个失败测试，证明 `create_app(database_url=...)` 应当初始化调用方指定的 SQLite 数据库。
2. 更新 `create_app()`，让该测试通过。
3. 更新测试 fixture，使用临时数据库 URL。
4. 运行 `python -m pytest tests/ -q`。

当前 Python 环境缺少 `fastapi` 和 `uvicorn`；最终验证可能需要先安装依赖。依赖安装属于实施计划内容，不在本设计文档中展开。
