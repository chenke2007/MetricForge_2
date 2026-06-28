from sqlalchemy.orm import Session
from app.models import DatasourceConfig, TableMetadata, ColumnMetadata


class SqlSchemaService:
    """元数据浏览服务 — 读取本地 SQLite，不连接 Oracle 业务库"""

    def get_datasource_tree(self, datasource_id: int, db: Session) -> dict:
        """按 schema 分组返回表树结构"""
        ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == datasource_id).first()
        datasource_name = ds.name if ds else ""

        tables = db.query(TableMetadata).filter(
            TableMetadata.datasource_id == datasource_id,
            TableMetadata.is_active == True,
        ).order_by(TableMetadata.schema_name, TableMetadata.table_name).all()

        schemas: dict[str, dict] = {}
        for t in tables:
            if t.schema_name not in schemas:
                schemas[t.schema_name] = {"schema_name": t.schema_name, "tables": []}
            col_count = db.query(ColumnMetadata).filter(
                ColumnMetadata.table_id == t.id,
                ColumnMetadata.is_active == True,
            ).count()
            schemas[t.schema_name]["tables"].append({
                "id": t.id,
                "name": t.table_name,
                "comment": t.table_comment,
                "column_count": col_count,
            })

        return {
            "datasource_id": datasource_id,
            "datasource_name": datasource_name,
            "schemas": list(schemas.values()),
        }

    def get_table_columns(self, table_id: int, db: Session) -> list[dict]:
        """返回指定表的所有字段详情"""
        columns = db.query(ColumnMetadata).filter(
            ColumnMetadata.table_id == table_id,
            ColumnMetadata.is_active == True,
        ).order_by(ColumnMetadata.column_id).all()

        return [{
            "id": c.id,
            "name": c.column_name,
            "type": c.column_type,
            "nullable": c.nullable,
            "comment": c.comment,
            "is_primary_key": c.is_primary_key,
            "is_foreign_key": c.is_foreign_key,
        } for c in columns]

    def search(self, datasource_id: int, query: str, db: Session) -> list[dict]:
        """搜索表名和字段名"""
        if not query or not query.strip():
            return []

        pattern = f"%{query.strip()}%"

        table_results = db.query(TableMetadata).filter(
            TableMetadata.datasource_id == datasource_id,
            TableMetadata.is_active == True,
            TableMetadata.table_name.ilike(pattern),
        ).all()

        col_results = db.query(
            ColumnMetadata, TableMetadata.schema_name, TableMetadata.table_name
        ).join(
            TableMetadata, ColumnMetadata.table_id == TableMetadata.id
        ).filter(
            TableMetadata.datasource_id == datasource_id,
            TableMetadata.is_active == True,
            ColumnMetadata.is_active == True,
            ColumnMetadata.column_name.ilike(pattern),
        ).limit(50).all()

        results = []
        for t in table_results:
            results.append({
                "match_type": "table",
                "schema_name": t.schema_name,
                "table_name": t.table_name,
                "table_comment": t.table_comment,
                "column_name": None,
                "table_id": t.id,
            })

        for col, schema_name, table_name in col_results:
            results.append({
                "match_type": "column",
                "schema_name": schema_name,
                "table_name": table_name,
                "table_comment": None,
                "column_name": col.column_name,
                "table_id": col.table_id,
            })

        return results
