"""Application entry point."""

from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import loader as config_loader
from .models import init_db, init_tables
from .services.metadata_scheduler_runtime import start_metadata_scheduler, stop_metadata_scheduler


DEFAULT_DATABASE_URL = "sqlite:///./data/metricforge.db"


def _resolve_database_url(database_url: str | None = None, config_path: str | None = None) -> str:
    """Resolve the database URL from explicit input, config/env, then default."""
    if database_url:
        return database_url

    env_database_url = os.environ.get("METRICFORGE_DB_URL")
    if env_database_url:
        return env_database_url

    try:
        if config_path:
            previous_config_cache = config_loader._CONFIG_CACHE
            try:
                config = config_loader.reload_config(config_path)
                configured_database_url = config.get("database", {}).get("url")
            finally:
                config_loader._CONFIG_CACHE = previous_config_cache
        else:
            configured_database_url = config_loader.get_config("database.url")
    except Exception:
        configured_database_url = None

    return configured_database_url or DEFAULT_DATABASE_URL


def create_app(config_path: str | None = None, database_url: str | None = None) -> FastAPI:
    """Application factory."""
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        start_metadata_scheduler(app)
        try:
            yield
        finally:
            stop_metadata_scheduler(app)

    app = FastAPI(title="MetricForge", version="0.1.0", lifespan=lifespan)

    db_url = _resolve_database_url(database_url=database_url, config_path=config_path)
    init_db(db_url)
    init_tables()

    # Delay route imports so optional dependencies are not imported at module load time.
    from .api.datasources import router as datasources_router
    from .api.metadata import router as metadata_router
    from .api.metrics import router as metrics_router
    from .api.governance import router as governance_router
    from .api.field_semantics import router as field_semantics_router
    from .api.llm_settings import router as llm_settings_router
    from .web.routes import router as web_router

    app.include_router(datasources_router, prefix="/api/datasources", tags=["数据源"])
    app.include_router(metadata_router, prefix="/api/metadata", tags=["元数据"])
    app.include_router(metrics_router, prefix="/api/metrics", tags=["指标治理"])
    app.include_router(governance_router, prefix="/api/governance", tags=["治理待办"])

    app.include_router(field_semantics_router, prefix="/api/field-semantics", tags=["Field Semantics"])

    app.include_router(llm_settings_router, prefix="/api/llm-settings", tags=["LLM 配置"])

    # Register Web UI routes.
    app.include_router(web_router, prefix="/web", tags=["Web 页面"])

    # Mount modern frontend (React SPA) at /app.
    frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if frontend_dist.is_dir():
        app.mount("/app", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")

    @app.get("/health")
    def health():
        return {"status": "ok", "version": "0.1.0"}

    @app.get("/")
    def root():
        return RedirectResponse(url="/web/dashboard")

    return app


# Global app instance for uvicorn direct startup.
app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
