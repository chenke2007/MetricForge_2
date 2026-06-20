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
        }

        for schema in schemas:
            try:
                tables = collector.collect_tables(schema)
                schema_stats = {
                    "tables": len(tables),
                    "columns": 0,
                    "indexes": 0,
                    "constraints": 0,
                }

                for table_info in tables:
                    # 先检查表是否已存在
                    existing = (
                        db.query(TableMetadata)
                        .filter(
                            TableMetadata.datasource_id == ds_id,
                            TableMetadata.schema_name == schema,
                            TableMetadata.table_name == table_info.table_name,
                        )
                        .first()
                    )

                    if existing:
                        table = existing
                        # 更新统计信息
                        table.row_count_est = table_info.row_count_est
                        table.table_comment = table_info.table_comment
                        table.last_analyzed_at = table_info.last_analyzed_at
                        table.avg_row_len = table_info.avg_row_len
                        table.num_blocks = table_info.num_blocks
                    else:
                        table = TableMetadata(
                            datasource_id=ds_id,
                            schema_name=schema,
                            table_name=table_info.table_name,
                            table_type=table_info.table_type,
                            table_comment=table_info.table_comment,
                            row_count_est=table_info.row_count_est,
                            last_analyzed_at=table_info.last_analyzed_at,
                            avg_row_len=table_info.avg_row_len,
                            num_blocks=table_info.num_blocks,
                        )
                        db.add(table)
                    db.flush()

                    # 字段
                    columns = collector.collect_columns(schema, table_info.table_name)
                    schema_stats["columns"] += len(columns)

                    db.query(ColumnMetadata).filter(ColumnMetadata.table_id == table.id).delete()
                    for col_info in columns:
                        col = ColumnMetadata(
                            table_id=table.id,
                            column_name=col_info.column_name,
                            column_type=col_info.column_type,
                            data_length=col_info.data_length,
                            nullable=col_info.nullable,
                            column_id=col_info.column_id,
                            default_value=col_info.default_value,
                            comment=col_info.comment,
                            is_primary_key=col_info.is_primary_key,
                            is_unique_key=col_info.is_unique_key,
                            is_foreign_key=col_info.is_foreign_key,
                        )
                        db.add(col)

                    # 索引
                    indexes = collector.collect_indexes(schema, table_info.table_name)
                    schema_stats["indexes"] += len(indexes)
                    db.query(IndexMetadata).filter(IndexMetadata.table_id == table.id).delete()
                    for idx_info in indexes:
                        idx = IndexMetadata(
                            table_id=table.id,
                            index_name=idx_info.index_name,
                            index_type=idx_info.index_type,
                            column_names=idx_info.column_names,
                        )
                        db.add(idx)

                    # 约束
                    constraints = collector.collect_constraints(schema, table_info.table_name)
                    schema_stats["constraints"] += len(constraints)
                    db.query(ConstraintMetadata).filter(ConstraintMetadata.table_id == table.id).delete()
                    for con_info in constraints:
                        con = ConstraintMetadata(
                            table_id=table.id,
                            constraint_name=con_info.constraint_name,
                            constraint_type=con_info.constraint_type,
                            column_names=con_info.column_names,
                            ref_table=con_info.ref_table,
                            ref_columns=con_info.ref_columns,
                        )
                        db.add(con)

                    # 标记采集时间
                    table.collected_at = datetime.utcnow()

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
