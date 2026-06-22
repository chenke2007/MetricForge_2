"""Local smoke command for real dwhrpt metadata collection verification."""

from __future__ import annotations

import argparse
import json
from typing import Any

from app.models import DatasourceConfig, get_session
from app.services.metadata_scheduler_service import run_metadata_scheduler_tick


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Smoke test metadata collection for a configured datasource.")
    parser.add_argument("--datasource-name", default="dwhrpt", help="DatasourceConfig.name to smoke test.")
    parser.add_argument("--schema", action="append", default=None, help="Optional schema override. Can be repeated.")
    parser.add_argument("--execute", action="store_true", help="Run a real scheduler tick and execute created jobs.")
    return parser


def _json_print(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def _safe_datasource_summary(ds: DatasourceConfig) -> dict[str, Any]:
    return {
        "id": ds.id,
        "name": ds.name,
        "ds_type": ds.ds_type,
        "host": ds.host,
        "port": ds.port,
        "service_name": ds.service_name,
        "username": ds.username,
        "dialect": ds.dialect,
        "schema_names": ds.schema_names,
        "metadata_schedule_enabled": ds.metadata_schedule_enabled,
        "metadata_schedule_interval_minutes": ds.metadata_schedule_interval_minutes,
        "metadata_schedule_time": ds.metadata_schedule_time,
        "metadata_next_run_at": ds.metadata_next_run_at,
        "metadata_last_scheduled_at": ds.metadata_last_scheduled_at,
        "metadata_last_schedule_status": ds.metadata_last_schedule_status,
    }


def _find_datasource(db, datasource_name: str) -> DatasourceConfig | None:
    return db.query(DatasourceConfig).filter(DatasourceConfig.name == datasource_name).first()


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    db = get_session()
    try:
        ds = _find_datasource(db, args.datasource_name)
        if not ds:
            _json_print(
                {
                    "success": False,
                    "dry_run": not args.execute,
                    "datasource_name": args.datasource_name,
                    "error": f"{args.datasource_name} datasource not found",
                }
            )
            return 1

        schema_override = ",".join(schema.strip().upper() for schema in (args.schema or []) if schema.strip())
        if not args.execute:
            _json_print(
                {
                    "success": True,
                    "dry_run": True,
                    "datasource": _safe_datasource_summary(ds),
                    "schema_override": schema_override or None,
                    "planned_action": "pass --execute to enable schedule, run scheduler tick, and execute created metadata jobs",
                }
            )
            return 0

        _json_print({"success": False, "error": "execute mode is added in Task 2"})
        return 2
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
