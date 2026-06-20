"""Lightweight schema migrations for local SQLite databases."""

from sqlalchemy import inspect, text


METADATA_COLUMNS = {
    "table_metadata": [
        ("is_active", "BOOLEAN NOT NULL DEFAULT 1"),
        ("first_collected_at", "DATETIME"),
        ("last_collected_at", "DATETIME"),
        ("dropped_at", "DATETIME"),
    ],
    "column_metadata": [
        ("is_active", "BOOLEAN NOT NULL DEFAULT 1"),
        ("first_collected_at", "DATETIME"),
        ("last_collected_at", "DATETIME"),
        ("dropped_at", "DATETIME"),
    ],
    "index_metadata": [
        ("is_active", "BOOLEAN NOT NULL DEFAULT 1"),
        ("first_collected_at", "DATETIME"),
        ("last_collected_at", "DATETIME"),
        ("dropped_at", "DATETIME"),
    ],
    "constraint_metadata": [
        ("is_active", "BOOLEAN NOT NULL DEFAULT 1"),
        ("first_collected_at", "DATETIME"),
        ("last_collected_at", "DATETIME"),
        ("dropped_at", "DATETIME"),
    ],
    "metadata_collection_job": [
        ("collection_mode", "VARCHAR(30) NOT NULL DEFAULT 'safe_refresh'"),
        ("reused_running_job", "BOOLEAN NOT NULL DEFAULT 0"),
        ("tables_added_count", "INTEGER NOT NULL DEFAULT 0"),
        ("tables_updated_count", "INTEGER NOT NULL DEFAULT 0"),
        ("tables_deactivated_count", "INTEGER NOT NULL DEFAULT 0"),
        ("columns_added_count", "INTEGER NOT NULL DEFAULT 0"),
        ("columns_updated_count", "INTEGER NOT NULL DEFAULT 0"),
        ("columns_deactivated_count", "INTEGER NOT NULL DEFAULT 0"),
        ("columns_type_changed_count", "INTEGER NOT NULL DEFAULT 0"),
        ("columns_comment_changed_count", "INTEGER NOT NULL DEFAULT 0"),
        ("indexes_added_count", "INTEGER NOT NULL DEFAULT 0"),
        ("indexes_deactivated_count", "INTEGER NOT NULL DEFAULT 0"),
        ("constraints_added_count", "INTEGER NOT NULL DEFAULT 0"),
        ("constraints_deactivated_count", "INTEGER NOT NULL DEFAULT 0"),
        ("change_summary", "TEXT"),
    ],
}


UNIQUE_INDEXES = {
    "ux_table_metadata_identity": ("table_metadata", ["datasource_id", "schema_name", "table_name"]),
    "ux_column_metadata_identity": ("column_metadata", ["table_id", "column_name"]),
    "ux_index_metadata_identity": ("index_metadata", ["table_id", "index_name"]),
    "ux_constraint_metadata_identity": ("constraint_metadata", ["table_id", "constraint_name"]),
}


def ensure_sqlite_schema(engine) -> None:
    """Add columns and indexes missing from existing SQLite databases."""
    if engine.dialect.name != "sqlite":
        return

    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table_name, columns in METADATA_COLUMNS.items():
            if table_name not in table_names:
                continue
            existing_columns = {col["name"] for col in inspector.get_columns(table_name)}
            for column_name, ddl in columns:
                if column_name not in existing_columns:
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"))

        inspector = inspect(engine)
        for index_name, (table_name, column_names) in UNIQUE_INDEXES.items():
            if table_name not in table_names:
                continue
            existing_indexes = {idx["name"] for idx in inspector.get_indexes(table_name)}
            existing_columns = {col["name"] for col in inspector.get_columns(table_name)}
            if index_name in existing_indexes:
                continue
            if not set(column_names).issubset(existing_columns):
                continue
            joined = ", ".join(column_names)
            conn.execute(text(f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON {table_name} ({joined})"))
