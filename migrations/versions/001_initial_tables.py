"""Alembic 迁移脚本 — 初始创建所有表"""

revision = "001"
down_revision = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    # 数据源配置
    op.create_table(
        "datasource_config",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("ds_type", sa.String(50), nullable=False),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("service_name", sa.String(100), nullable=True),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("password_enc", sa.String(500), nullable=True),
        sa.Column("dialect", sa.String(50), nullable=False, server_default="oracle"),
        sa.Column("schema_names", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    # 表元数据
    op.create_table(
        "table_metadata",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("datasource_id", sa.Integer(), nullable=False),
        sa.Column("schema_name", sa.String(100), nullable=False),
        sa.Column("table_name", sa.String(200), nullable=False),
        sa.Column("table_comment", sa.Text(), nullable=True),
        sa.Column("table_type", sa.String(50), nullable=False, server_default="TABLE"),
        sa.Column("row_count_est", sa.Integer(), nullable=True),
        sa.Column("last_analyzed_at", sa.DateTime(), nullable=True),
        sa.Column("avg_row_len", sa.Integer(), nullable=True),
        sa.Column("num_blocks", sa.Integer(), nullable=True),
        sa.Column("is_sensitive", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("collected_at", sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["datasource_id"], ["datasource_config.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # 字段元数据
    op.create_table(
        "column_metadata",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("table_id", sa.Integer(), nullable=False),
        sa.Column("column_name", sa.String(200), nullable=False),
        sa.Column("column_type", sa.String(100), nullable=False),
        sa.Column("data_length", sa.Integer(), nullable=True),
        sa.Column("nullable", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("column_id", sa.Integer(), nullable=True),
        sa.Column("default_value", sa.String(500), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("is_primary_key", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("is_unique_key", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("is_foreign_key", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("distinct_count", sa.Integer(), nullable=True),
        sa.Column("null_rate", sa.Float(), nullable=True),
        sa.Column("enum_samples", sa.Text(), nullable=True),
        sa.Column("is_sensitive", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("collected_at", sa.DateTime(), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["table_id"], ["table_metadata.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # 索引元数据
    op.create_table(
        "index_metadata",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("table_id", sa.Integer(), nullable=False),
        sa.Column("index_name", sa.String(200), nullable=False),
        sa.Column("index_type", sa.String(50), nullable=True),
        sa.Column("column_names", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["table_id"], ["table_metadata.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # 约束元数据
    op.create_table(
        "constraint_metadata",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("table_id", sa.Integer(), nullable=False),
        sa.Column("constraint_name", sa.String(200), nullable=False),
        sa.Column("constraint_type", sa.String(10), nullable=False),
        sa.Column("column_names", sa.Text(), nullable=True),
        sa.Column("ref_table", sa.String(200), nullable=True),
        sa.Column("ref_columns", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["table_id"], ["table_metadata.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # 指标定义
    op.create_table(
        "metric_definition",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("metric_code", sa.String(100), nullable=False),
        sa.Column("metric_name", sa.String(200), nullable=False),
        sa.Column("metric_name_en", sa.String(200), nullable=True),
        sa.Column("business_aliases", sa.Text(), nullable=True),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column("definition", sa.Text(), nullable=True),
        sa.Column("formula", sa.Text(), nullable=True),
        sa.Column("involved_fields", sa.Text(), nullable=True),
        sa.Column("applicable_dimensions", sa.Text(), nullable=True),
        sa.Column("default_time_grain", sa.String(50), nullable=True),
        sa.Column("default_time_caliber", sa.String(100), nullable=True),
        sa.Column("data_source_id", sa.Integer(), nullable=True),
        sa.Column("source_table", sa.String(200), nullable=True),
        sa.Column("owner", sa.String(100), nullable=True),
        sa.Column("version", sa.String(20), nullable=False, server_default="1.0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("metric_code"),
    )

    # 指标口径
    op.create_table(
        "metric_caliber",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("metric_id", sa.Integer(), nullable=False),
        sa.Column("caliber_name", sa.String(100), nullable=False),
        sa.Column("caliber_rule", sa.Text(), nullable=True),
        sa.Column("filter_template", sa.Text(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["metric_id"], ["metric_definition.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # 字段语义
    op.create_table(
        "field_semantic",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("column_id", sa.Integer(), nullable=False),
        sa.Column("business_alias", sa.String(200), nullable=True),
        sa.Column("meaning", sa.Text(), nullable=True),
        sa.Column("unit", sa.String(100), nullable=True),
        sa.Column("enum_values", sa.Text(), nullable=True),
        sa.Column("data_quality_note", sa.Text(), nullable=True),
        sa.Column("is_governed", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("governed_by", sa.String(100), nullable=True),
        sa.Column("governed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["column_id"], ["column_metadata.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("column_id"),
    )

    # 表关系
    op.create_table(
        "table_relation",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("datasource_id", sa.Integer(), nullable=False),
        sa.Column("fact_table_id", sa.Integer(), nullable=False),
        sa.Column("dim_table_id", sa.Integer(), nullable=False),
        sa.Column("relation_type", sa.String(20), nullable=False, server_default="FK"),
        sa.Column("join_condition", sa.Text(), nullable=True),
        sa.Column("join_type", sa.String(20), nullable=False, server_default="LEFT"),
        sa.Column("cardinality", sa.String(20), nullable=False, server_default="N:1"),
        sa.Column("confidence", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["datasource_id"], ["datasource_config.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["fact_table_id"], ["table_metadata.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["dim_table_id"], ["table_metadata.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # 治理待办
    op.create_table(
        "governance_ticket",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ticket_type", sa.String(50), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source", sa.String(50), nullable=False, server_default="manual_import"),
        sa.Column("related_object_type", sa.String(50), nullable=True),
        sa.Column("related_object_id", sa.Integer(), nullable=True),
        sa.Column("user_question", sa.Text(), nullable=True),
        sa.Column("priority", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("assignee", sa.String(100), nullable=True),
        sa.Column("resolution", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade():
    op.drop_table("governance_ticket")
    op.drop_table("table_relation")
    op.drop_table("field_semantic")
    op.drop_table("metric_caliber")
    op.drop_table("metric_definition")
    op.drop_table("constraint_metadata")
    op.drop_table("index_metadata")
    op.drop_table("column_metadata")
    op.drop_table("table_metadata")
    op.drop_table("datasource_config")
