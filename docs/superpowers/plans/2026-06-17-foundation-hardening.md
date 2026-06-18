# 基础整固实施计划

> **给 agentic workers：** REQUIRED SUB-SKILL: 使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项实施本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 修正 MetricForge 的基础工程问题，让依赖声明、应用配置和测试数据库隔离更可靠。

**架构：** `app.main.create_app()` 接收可选 `database_url`，优先使用调用方显式传入的数据库 URL，其次读取现有配置，最后回退到当前 SQLite 默认值。测试 fixture 为 FastAPI 应用传入临时 SQLite 数据库，避免污染 `data/metricforge.db`。

**技术栈：** Python 3.12、FastAPI、SQLAlchemy 2.0、Pytest、SQLite、oracledb。

---

## 文件结构

- 修改：`requirements.txt`
  - 责任：声明项目运行所需依赖，Oracle 驱动应与代码中的 `import oracledb` 保持一致。
- 修改：`app/main.py`
  - 责任：创建 FastAPI 应用、初始化数据库、注册路由。
- 修改：`tests/conftest.py`
  - 责任：提供测试数据库和 FastAPI 测试客户端 fixture。
- 修改：`tests/test_basic.py`
  - 责任：补充应用工厂数据库 URL 覆盖行为的测试。
- 删除：`=8.3.0`
  - 责任：移除误生成的依赖安装失败日志文件。

---

### 任务 1：修正依赖声明

**文件：**
- 修改：`requirements.txt`

- [ ] **步骤 1：确认代码实际导入的 Oracle 包**

运行：

```powershell
Select-String -Path 'D:\projects\MetricForge\app\adapters\oracle.py' -Pattern 'import oracledb'
```

预期：能看到 `import oracledb`。

- [ ] **步骤 2：修改依赖声明**

将 `requirements.txt` 中这一行：

```text
cx-oracle>=8.3.0
```

替换为：

```text
oracledb>=2.0.0
```

说明：当前环境已安装 `oracledb 4.0.1`，使用 `>=2.0.0` 能覆盖 thin mode 支持，同时不锁死当前环境。

- [ ] **步骤 3：确认旧依赖已移除**

运行：

```powershell
Select-String -Path 'D:\projects\MetricForge\requirements.txt' -Pattern 'cx-oracle|cx_Oracle'
```

预期：没有输出。

- [ ] **步骤 4：确认新依赖存在**

运行：

```powershell
Select-String -Path 'D:\projects\MetricForge\requirements.txt' -Pattern '^oracledb'
```

预期：输出 `oracledb>=2.0.0`。

- [ ] **步骤 5：提交或记录**

当前目录不是 Git 仓库。运行：

```powershell
git status --short --branch
```

如果输出 `fatal: not a git repository`，跳过提交，并在最终汇报中说明无法提交。如果后续项目初始化了 Git，则提交：

```powershell
git add requirements.txt
git commit -m "chore: align oracle dependency"
```

---

### 任务 2：为应用工厂数据库 URL 覆盖写失败测试

**文件：**
- 修改：`tests/test_basic.py`

- [ ] **步骤 1：添加测试导入**

在 `tests/test_basic.py` 顶部现有导入后补充：

```python
from pathlib import Path

from sqlalchemy import inspect
```

- [ ] **步骤 2：添加失败测试**

在 `test_health_check` 前添加：

```python
def test_create_app_uses_explicit_database_url(tmp_path):
    """测试 create_app 使用显式传入的数据库 URL 初始化数据库"""
    from app.main import create_app
    from app.models import get_engine

    db_path = tmp_path / "metricforge-test.db"

    create_app(database_url=f"sqlite:///{db_path}")

    assert db_path.exists()
    table_names = inspect(get_engine()).get_table_names()
    assert "datasource_config" in table_names
    assert "metric_definition" in table_names
```

- [ ] **步骤 3：运行测试并确认失败原因正确**

运行：

```powershell
python -m pytest tests/test_basic.py::test_create_app_uses_explicit_database_url -q
```

预期：测试失败，失败原因是 `create_app()` 不接受 `database_url` 参数，例如：

```text
TypeError: create_app() got an unexpected keyword argument 'database_url'
```

如果失败原因是 `ModuleNotFoundError: No module named 'fastapi'`，先执行任务 5 的依赖安装步骤，再回到本步骤。

---

### 任务 3：实现数据库 URL 解析

**文件：**
- 修改：`app/main.py`

- [ ] **步骤 1：更新函数签名和配置解析**

将 `app/main.py` 的导入和 `create_app()` 开头改成以下结构：

```python
"""应用入口脚本"""

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from .models import init_db, init_tables

logger = logging.getLogger(__name__)
DEFAULT_DATABASE_URL = "sqlite:///./data/metricforge.db"


def _resolve_database_url(database_url: str | None = None, config_path: str | None = None) -> str:
    """解析数据库 URL：显式参数 > 配置文件/环境变量 > 默认 SQLite。"""
    if database_url:
        return database_url

    try:
        from .config.loader import get_config, reload_config

        if config_path:
            cfg = reload_config(config_path)
            configured_url = cfg.get("database", {}).get("url")
        else:
            configured_url = get_config("database.url")
        if configured_url:
            return configured_url
    except Exception as exc:
        logger.warning("加载数据库配置失败，使用默认 SQLite: %s", exc)

    return DEFAULT_DATABASE_URL


def create_app(config_path: str | None = None, database_url: str | None = None) -> FastAPI:
    """应用工厂函数"""
    app = FastAPI(title="MetricForge", version="0.1.0")

    resolved_database_url = _resolve_database_url(database_url=database_url, config_path=config_path)
    init_db(resolved_database_url)
    init_tables()
```

保留后续路由导入、`include_router`、`/health` 和 `/` 逻辑不变。

- [ ] **步骤 2：检查未使用导入**

如果 `Path` 在 `app/main.py` 中没有使用，删除：

```python
from pathlib import Path
```

- [ ] **步骤 3：运行单个测试确认变绿**

运行：

```powershell
python -m pytest tests/test_basic.py::test_create_app_uses_explicit_database_url -q
```

预期：

```text
1 passed
```

---

### 任务 4：隔离 FastAPI 测试数据库

**文件：**
- 修改：`tests/conftest.py`

- [ ] **步骤 1：修改 app fixture**

将 `tests/conftest.py` 中的 `app` fixture 替换为：

```python
@pytest.fixture
def app(tmp_path):
    """测试用 FastAPI 应用，使用临时 SQLite 数据库"""
    from app.main import create_app

    db_path = tmp_path / "metricforge-api-test.db"
    return create_app(database_url=f"sqlite:///{db_path}")
```

- [ ] **步骤 2：运行已有 API/Web 测试**

运行：

```powershell
python -m pytest tests/test_basic.py::test_health_check tests/test_basic.py::test_list_datasources_empty tests/test_basic.py::test_create_datasource_api tests/test_basic.py::test_create_metric_api tests/test_basic.py::test_dashboard_page tests/test_basic.py::test_metric_page tests/test_basic.py::test_governance_page -q
```

预期：这些测试通过。若出现依赖缺失，执行任务 5 后重试。

- [ ] **步骤 3：确认开发数据库没有被测试改写**

运行：

```powershell
Get-Item 'D:\projects\MetricForge\data\metricforge.db' | Select-Object FullName, Length, LastWriteTime
```

记录当前输出。然后再次运行：

```powershell
python -m pytest tests/test_basic.py::test_create_datasource_api -q
```

再运行：

```powershell
Get-Item 'D:\projects\MetricForge\data\metricforge.db' | Select-Object FullName, Length, LastWriteTime
```

预期：第二次文件信息不应因这条测试发生变化。

---

### 任务 5：安装缺失运行依赖并验证测试

**文件：**
- 不修改代码文件。

- [ ] **步骤 1：安装依赖**

运行：

```powershell
python -m pip install -r requirements.txt
```

预期：安装成功，不再尝试构建 `cx_Oracle`。

- [ ] **步骤 2：确认关键依赖可导入**

运行：

```powershell
@'
mods = ["fastapi", "uvicorn", "jinja2", "sqlalchemy", "oracledb"]
for name in mods:
    mod = __import__(name)
    print(f"{name}: {getattr(mod, '__version__', 'installed')}")
'@ | python -
```

预期：五个模块都输出版本或 `installed`，没有 `ModuleNotFoundError`。

- [ ] **步骤 3：运行完整测试**

运行：

```powershell
python -m pytest tests/ -q
```

预期：

```text
11 passed
```

如果测试数量不同，以实际新增测试后的总数为准，但必须是 0 failed、0 error。

---

### 任务 6：删除误生成文件

**文件：**
- 删除：`=8.3.0`

- [ ] **步骤 1：确认文件内容是安装失败日志**

运行：

```powershell
Get-Content -Encoding UTF8 -LiteralPath 'D:\projects\MetricForge\=8.3.0' -TotalCount 5
```

预期：能看到 `Collecting cx-oracle` 或 pip 错误日志。

- [ ] **步骤 2：删除文件**

使用补丁删除文件：

```text
*** Begin Patch
*** Delete File: D:\projects\MetricForge\=8.3.0
*** End Patch
```

- [ ] **步骤 3：确认文件不存在**

运行：

```powershell
Test-Path 'D:\projects\MetricForge\=8.3.0'
```

预期：

```text
False
```

---

### 任务 7：最终验证与汇报

**文件：**
- 不修改代码文件。

- [ ] **步骤 1：运行完整测试**

运行：

```powershell
python -m pytest tests/ -q
```

预期：所有测试通过，输出中没有 failure 或 error。

- [ ] **步骤 2：确认依赖声明一致**

运行：

```powershell
Select-String -Path 'D:\projects\MetricForge\requirements.txt' -Pattern '^oracledb|cx-oracle|cx_Oracle'
```

预期：只看到 `oracledb>=2.0.0`。

- [ ] **步骤 3：确认非 Git 状态**

运行：

```powershell
git status --short --branch
```

预期：当前环境仍可能输出：

```text
fatal: not a git repository (or any of the parent directories): .git
```

若是该输出，最终汇报中说明无法提供 Git diff 或 commit。

- [ ] **步骤 4：最终汇报**

汇报内容必须包含：

- 修改了哪些文件。
- 删除了哪个误生成文件。
- 测试命令和实际结果。
- 如果依赖安装或测试无法完成，说明阻塞原因和原始错误摘要。

