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
        """搜索表名、表注释、字段名和字段注释"""
        if not query or not query.strip():
            return []

        pattern = f"%{query.strip()}%"

        # 1) 表名匹配
        table_name_results = db.query(TableMetadata).filter(
            TableMetadata.datasource_id == datasource_id,
            TableMetadata.is_active == True,
            TableMetadata.table_name.ilike(pattern),
        ).all()

        # 2) 表注释匹配
        table_comment_results = db.query(TableMetadata).filter(
            TableMetadata.datasource_id == datasource_id,
            TableMetadata.is_active == True,
            TableMetadata.table_comment.isnot(None),
            TableMetadata.table_comment.ilike(pattern),
        ).all()

        # 3) 字段名匹配
        col_name_results = db.query(
            ColumnMetadata, TableMetadata.schema_name, TableMetadata.table_name
        ).join(
            TableMetadata, ColumnMetadata.table_id == TableMetadata.id
        ).filter(
            TableMetadata.datasource_id == datasource_id,
            TableMetadata.is_active == True,
            ColumnMetadata.is_active == True,
            ColumnMetadata.column_name.ilike(pattern),
        ).limit(50).all()

        # 4) 字段注释匹配
        col_comment_results = db.query(
            ColumnMetadata, TableMetadata.schema_name, TableMetadata.table_name
        ).join(
            TableMetadata, ColumnMetadata.table_id == TableMetadata.id
        ).filter(
            TableMetadata.datasource_id == datasource_id,
            TableMetadata.is_active == True,
            ColumnMetadata.is_active == True,
            ColumnMetadata.comment.isnot(None),
            ColumnMetadata.comment.ilike(pattern),
        ).limit(50).all()

        seen = set()
        results = []

        for t in table_name_results:
            key = (t.id, "table_name")
            if key in seen:
                continue
            seen.add(key)
            results.append({
                "match_type": "table",
                "matched_on": "table_name",
                "schema_name": t.schema_name,
                "table_name": t.table_name,
                "table_comment": t.table_comment,
                "column_name": None,
                "table_id": t.id,
            })

        for t in table_comment_results:
            key = (t.id, "table_comment")
            if key in seen:
                continue
            seen.add(key)
            results.append({
                "match_type": "table",
                "matched_on": "table_comment",
                "schema_name": t.schema_name,
                "table_name": t.table_name,
                "table_comment": t.table_comment,
                "column_name": None,
                "table_id": t.id,
            })

        for col, schema_name, table_name in col_name_results:
            key = (col.id, "column_name")
            if key in seen:
                continue
            seen.add(key)
            results.append({
                "match_type": "column",
                "matched_on": "column_name",
                "schema_name": schema_name,
                "table_name": table_name,
                "table_comment": None,
                "column_name": col.column_name,
                "table_id": col.table_id,
            })

        for col, schema_name, table_name in col_comment_results:
            key = (col.id, "column_comment")
            if key in seen:
                continue
            seen.add(key)
            results.append({
                "match_type": "column",
                "matched_on": "column_comment",
                "schema_name": schema_name,
                "table_name": table_name,
                "table_comment": None,
                "column_name": col.column_name,
                "table_id": col.table_id,
            })

        return results
