"""元数据采集和查询业务逻辑"""

import logging
from datetime import datetime

from ..collectors.oracle_collector import OracleMetadataCollector
from ..models import (
    ColumnMetadata,
    ConstraintMetadata,
    FieldSemantic,
    GovernanceTicket,
    IndexMetadata,
    TableMetadata,
    get_session,
)
from .datasource_service import get_adapter_for_datasource

logger = logging.getLogger(__name__)


def _empty_change_stats() -> dict:
    return {
        "tables_added": 0,
        "tables_updated": 0,
        "tables_deactivated": 0,
        "columns_added": 0,
        "columns_updated": 0,
        "columns_deactivated": 0,
        "columns_type_changed": 0,
        "columns_comment_changed": 0,
        "indexes_added": 0,
        "indexes_deactivated": 0,
        "constraints_added": 0,
        "constraints_deactivated": 0,
        "samples": [],
    }


def _add_change_sample(changes: dict, kind: str, path: str) -> None:
    if len(changes["samples"]) >= 50:
        return
    changes["samples"].append({"kind": kind, "path": path})


def _touch_active(record, now: datetime) -> None:
    if getattr(record, "first_collected_at", None) is None:
        record.first_collected_at = now
    record.last_collected_at = now
    if hasattr(record, "collected_at"):
        record.collected_at = now
    record.is_active = True
    record.dropped_at = None


def _upsert_table(db, ds_id: int, schema: str, table_info, now: datetime, changes: dict):
    table = (
        db.query(TableMetadata)
        .filter(
            TableMetadata.datasource_id == ds_id,
            TableMetadata.schema_name == schema,
            TableMetadata.table_name == table_info.table_name,
        )
        .first()
    )
    if table is None:
        table = TableMetadata(datasource_id=ds_id, schema_name=schema, table_name=table_info.table_name)
        db.add(table)
        changes["tables_added"] += 1
        _add_change_sample(changes, "table_added", f"{schema}.{table_info.table_name}")
    elif (
        table.table_comment != table_info.table_comment
        or table.table_type != table_info.table_type
        or table.row_count_est != table_info.row_count_est
        or table.last_analyzed_at != table_info.last_analyzed_at
        or table.avg_row_len != table_info.avg_row_len
        or table.num_blocks != table_info.num_blocks
    ):
        changes["tables_updated"] += 1
        _add_change_sample(changes, "table_updated", f"{schema}.{table_info.table_name}")

    table.table_type = table_info.table_type
    table.table_comment = table_info.table_comment
    table.row_count_est = table_info.row_count_est
    table.last_analyzed_at = table_info.last_analyzed_at
    table.avg_row_len = table_info.avg_row_len
    table.num_blocks = table_info.num_blocks
    _touch_active(table, now)
    db.flush()
    return table


def _deactivate_missing_tables(db, ds_id: int, schema: str, seen_table_names: set[str], now: datetime, changes: dict) -> None:
    active_tables = (
        db.query(TableMetadata)
        .filter(
            TableMetadata.datasource_id == ds_id,
            TableMetadata.schema_name == schema,
            TableMetadata.is_active.is_(True),
        )
        .all()
    )
    for table in active_tables:
        if table.table_name in seen_table_names:
            continue
        table.is_active = False
        table.dropped_at = now
        changes["tables_deactivated"] += 1
        _add_change_sample(changes, "table_deactivated", f"{schema}.{table.table_name}")
        for column in table.columns:
            if not column.is_active:
                continue
            column.is_active = False
            column.dropped_at = now
            changes["columns_deactivated"] += 1
            _add_change_sample(changes, "column_deactivated", f"{schema}.{table.table_name}.{column.column_name}")
        for index in table.indexes:
            if not index.is_active:
                continue
            index.is_active = False
            index.dropped_at = now
            changes["indexes_deactivated"] += 1
            _add_change_sample(changes, "index_deactivated", f"{schema}.{table.table_name}.{index.index_name}")
        for constraint in table.constraints:
            if not constraint.is_active:
                continue
            constraint.is_active = False
            constraint.dropped_at = now
            changes["constraints_deactivated"] += 1
            _add_change_sample(changes, "constraint_deactivated", f"{schema}.{table.table_name}.{constraint.constraint_name}")


def _mark_missing_inactive(
    existing_by_name: dict,
    seen_names: set[str],
    now: datetime,
    changes: dict,
    counter: str,
    kind: str,
    prefix: str,
) -> None:
    for name, record in existing_by_name.items():
        if name in seen_names or not record.is_active:
            continue
        record.is_active = False
        record.dropped_at = now
        changes[counter] += 1
        _add_change_sample(changes, kind, f"{prefix}.{name}")


def _upsert_columns(db, table, column_infos, now: datetime, changes: dict) -> int:
    seen = set()
    count = 0
    existing = {col.column_name: col for col in db.query(ColumnMetadata).filter(ColumnMetadata.table_id == table.id).all()}

    for col_info in column_infos:
        seen.add(col_info.column_name)
        count += 1
        column = existing.get(col_info.column_name)
        path = f"{table.schema_name}.{table.table_name}.{col_info.column_name}"
        if column is None:
            column = ColumnMetadata(table_id=table.id, column_name=col_info.column_name, column_type=col_info.column_type)
            db.add(column)
            changes["columns_added"] += 1
            _add_change_sample(changes, "column_added", path)
        else:
            type_changed = column.column_type != col_info.column_type
            comment_changed = (column.comment or "") != (col_info.comment or "")
            base_changed = any(
                (
                    column.data_length != col_info.data_length,
                    column.nullable != col_info.nullable,
                    column.column_id != col_info.column_id,
                    column.default_value != col_info.default_value,
                    column.is_primary_key != col_info.is_primary_key,
                    column.is_unique_key != col_info.is_unique_key,
                    column.is_foreign_key != col_info.is_foreign_key,
                )
            )
            if type_changed:
                changes["columns_type_changed"] += 1
                _add_change_sample(changes, "column_type_changed", path)
            if comment_changed:
                changes["columns_comment_changed"] += 1
                _add_change_sample(changes, "column_comment_changed", path)
            if base_changed or type_changed or comment_changed:
                changes["columns_updated"] += 1

        column.column_type = col_info.column_type
        column.data_length = col_info.data_length
        column.nullable = col_info.nullable
        column.column_id = col_info.column_id
        column.default_value = col_info.default_value
        column.comment = col_info.comment
        column.is_primary_key = col_info.is_primary_key
        column.is_unique_key = col_info.is_unique_key
        column.is_foreign_key = col_info.is_foreign_key
        _touch_active(column, now)

    for column_name, column in existing.items():
        if column_name in seen or not column.is_active:
            continue
        column.is_active = False
        column.dropped_at = now
        changes["columns_deactivated"] += 1
        _add_change_sample(changes, "column_deactivated", f"{table.schema_name}.{table.table_name}.{column_name}")

    return count


def _upsert_indexes(db, table, index_infos, now: datetime, changes: dict) -> int:
    existing = {idx.index_name: idx for idx in db.query(IndexMetadata).filter(IndexMetadata.table_id == table.id).all()}
    seen = set()
    for idx_info in index_infos:
        seen.add(idx_info.index_name)
        index = existing.get(idx_info.index_name)
        if index is None:
            index = IndexMetadata(table_id=table.id, index_name=idx_info.index_name)
            db.add(index)
            changes["indexes_added"] += 1
            _add_change_sample(changes, "index_added", f"{table.schema_name}.{table.table_name}.{idx_info.index_name}")
        index.index_type = idx_info.index_type
        index.column_names = idx_info.column_names
        _touch_active(index, now)
    _mark_missing_inactive(
        existing,
        seen,
        now,
        changes,
        "indexes_deactivated",
        "index_deactivated",
        f"{table.schema_name}.{table.table_name}",
    )
    return len(index_infos)


def _upsert_constraints(db, table, constraint_infos, now: datetime, changes: dict) -> int:
    existing = {
        con.constraint_name: con
        for con in db.query(ConstraintMetadata).filter(ConstraintMetadata.table_id == table.id).all()
    }
    seen = set()
    for con_info in constraint_infos:
        seen.add(con_info.constraint_name)
        constraint = existing.get(con_info.constraint_name)
        if constraint is None:
            constraint = ConstraintMetadata(table_id=table.id, constraint_name=con_info.constraint_name)
            db.add(constraint)
            changes["constraints_added"] += 1
            _add_change_sample(changes, "constraint_added", f"{table.schema_name}.{table.table_name}.{con_info.constraint_name}")
        constraint.constraint_type = con_info.constraint_type
        constraint.column_names = con_info.column_names
        constraint.ref_table = con_info.ref_table
        constraint.ref_columns = con_info.ref_columns
        _touch_active(constraint, now)
    _mark_missing_inactive(
        existing,
        seen,
        now,
        changes,
        "constraints_deactivated",
        "constraint_deactivated",
        f"{table.schema_name}.{table.table_name}",
    )
    return len(constraint_infos)


def collect_metadata(ds_id: int, schemas: list[str] | None = None) -> dict:
    """执行元数据采集

    Args:
        ds_id: 数据源 ID
        schemas: 要采集的 schema 列表，None 表示采集所有

    Returns:
        采集结果统计
    """
    adapter = get_adapter_for_datasource(ds_id)
    if not adapter:
        return {"success": False, "error": "无法获取数据源适配器"}

    collector = OracleMetadataCollector(adapter, {})
    db = get_session()

    try:
        if not schemas:
            all_schemas = collector.collect_schemas()
            schemas = [s.name for s in all_schemas]
        else:
            schemas = [schema.strip().upper() for schema in schemas if schema and schema.strip()]

        stats = {
            "schemas": 0,
            "tables": 0,
            "columns": 0,
            "indexes": 0,
            "constraints": 0,
            "errors": [],
            "changes": _empty_change_stats(),
        }

        for schema in schemas:
            try:
                now = datetime.utcnow()
                tables = collector.collect_tables(schema)
                schema_stats = {
                    "tables": len(tables),
                    "columns": 0,
                    "indexes": 0,
                    "constraints": 0,
                }

                for table_info in tables:
                    table = _upsert_table(db, ds_id, schema, table_info, now, stats["changes"])

                    # 字段
                    columns = collector.collect_columns(schema, table_info.table_name)
                    schema_stats["columns"] += _upsert_columns(db, table, columns, now, stats["changes"])

                    # 索引
                    indexes = collector.collect_indexes(schema, table_info.table_name)
                    schema_stats["indexes"] += _upsert_indexes(db, table, indexes, now, stats["changes"])
                    # 约束
                    constraints = collector.collect_constraints(schema, table_info.table_name)
                    schema_stats["constraints"] += _upsert_constraints(db, table, constraints, now, stats["changes"])
                _deactivate_missing_tables(
                    db,
                    ds_id,
                    schema,
                    {table_info.table_name for table_info in tables},
                    now,
                    stats["changes"],
                )
                db.commit()
                stats["schemas"] += 1
                stats["tables"] += schema_stats["tables"]
                stats["columns"] += schema_stats["columns"]
                stats["indexes"] += schema_stats["indexes"]
                stats["constraints"] += schema_stats["constraints"]
                logger.info("Schema %s 采集完成: %d 表", schema, len(tables))

            except Exception as e:
                logger.error("Schema %s 采集失败: %s", schema, e)
                stats["errors"].append(f"{schema}: {e}")
                db.rollback()

        if stats["errors"] and stats["schemas"] == 0:
            error_message = "; ".join(stats["errors"])
            logger.error("元数据采集失败，所有请求 schema 均未采集到表: %s", error_message)
            return {"success": False, "error": error_message, "stats": stats}

        # 采集后治理检测
        _detect_missing_semantics(db, ds_id)

        db.commit()
        logger.info("元数据采集完成: %s", stats)
        return {"success": True, "stats": stats}

    except Exception as e:
        db.rollback()
        logger.error("元数据采集整体失败: %s", e)
        return {"success": False, "error": str(e)}
    finally:
        db.close()
        adapter.close()


def _detect_missing_semantics(db, ds_id: int):
    """检测缺少字段语义的字段，自动创建治理待办"""
    from ..models import ColumnMetadata, FieldSemantic, GovernanceTicket

    columns = (
        db.query(ColumnMetadata)
        .join(TableMetadata)
        .filter(
            TableMetadata.datasource_id == ds_id,
            TableMetadata.is_active.is_(True),
            ColumnMetadata.is_active.is_(True),
        )
        .all()
    )

    for col in columns:
        semantic = (
            db.query(FieldSemantic)
            .filter(FieldSemantic.column_id == col.id)
            .first()
        )
        if semantic:
            continue  # 已有语义

        # 检查是否已有 open 状态的待办
        existing_ticket = (
            db.query(GovernanceTicket)
            .filter(
                GovernanceTicket.related_object_type == "column",
                GovernanceTicket.related_object_id == col.id,
                GovernanceTicket.status.in_(["open", "in_progress"]),
            )
            .first()
        )
        if existing_ticket:
            continue

        title = f"字段语义缺失: {col.table.schema_name}.{col.table.table_name}.{col.column_name}"
        ticket = GovernanceTicket(
            ticket_type="missing_semantic",
            title=title,
            description=f"字段 {col.column_name} (类型: {col.column_type}) 缺少业务别名、含义或枚举值解释。注释: {col.comment or '无'}",
            source="auto_detect",
            related_object_type="column",
            related_object_id=col.id,
            priority="medium",
            status="open",
        )
        db.add(ticket)
