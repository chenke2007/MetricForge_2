import pytest
from app.services.sql_security_validator import SqlSecurityValidator, ValidationResult


@pytest.fixture
def validator():
    return SqlSecurityValidator()


class TestEmptySql:
    def test_empty_sql(self, validator):
        result = validator.validate("")
        assert not result.is_valid
        assert result.error_code == "EMPTY_SQL"

    def test_whitespace_only(self, validator):
        result = validator.validate("   \n  \t  ")
        assert not result.is_valid
        assert result.error_code == "EMPTY_SQL"


class TestReadonlyPrefix:
    def test_select_prefix(self, validator):
        result = validator.validate("SELECT * FROM DUAL")
        assert result.is_valid
        assert result.sanitized_sql is not None

    def test_with_prefix(self, validator):
        sql = "WITH cte AS (SELECT 1 FROM DUAL) SELECT * FROM cte"
        result = validator.validate(sql)
        assert result.is_valid

    def test_with_insert_is_rejected(self, validator):
        sql = "WITH cte AS (SELECT * FROM t) INSERT INTO t2 SELECT * FROM cte"
        result = validator.validate(sql)
        assert not result.is_valid
        # INSERT is in BLOCKED_DML_KEYWORDS, caught before NOT_READONLY check
        assert result.error_code in ("NOT_READONLY", "BLOCKED_KEYWORD")

    def test_with_update_rejected(self, validator):
        sql = "WITH cte AS (SELECT * FROM t) UPDATE t2 SET x=1"
        result = validator.validate(sql)
        assert not result.is_valid
        assert result.error_code in ("NOT_READONLY", "BLOCKED_KEYWORD")

    def test_with_delete_rejected(self, validator):
        result = validator.validate("WITH cte AS (SELECT * FROM t) DELETE FROM t2")
        assert not result.is_valid
        assert result.error_code in ("NOT_READONLY", "BLOCKED_KEYWORD")

    def test_with_merge_rejected(self, validator):
        result = validator.validate("WITH cte AS (SELECT * FROM t) MERGE INTO t2 ...")
        assert not result.is_valid
        assert result.error_code in ("NOT_READONLY", "BLOCKED_KEYWORD")


class TestDdlDmlBlocked:
    def test_drop_blocked(self, validator):
        result = validator.validate("DROP TABLE t")
        assert not result.is_valid
        assert result.error_code == "BLOCKED_KEYWORD"

    def test_alter_blocked(self, validator):
        result = validator.validate("ALTER TABLE t ADD c NUMBER")
        assert not result.is_valid
        assert result.error_code == "BLOCKED_KEYWORD"

    def test_create_blocked(self, validator):
        result = validator.validate("CREATE TABLE t (id NUMBER)")
        assert not result.is_valid
        assert result.error_code == "BLOCKED_KEYWORD"

    def test_insert_blocked(self, validator):
        result = validator.validate("INSERT INTO t VALUES (1)")
        assert not result.is_valid
        assert result.error_code == "BLOCKED_KEYWORD"

    def test_update_blocked(self, validator):
        result = validator.validate("UPDATE t SET x=1")
        assert not result.is_valid
        assert result.error_code == "BLOCKED_KEYWORD"

    def test_delete_blocked(self, validator):
        result = validator.validate("DELETE FROM t")
        assert not result.is_valid
        assert result.error_code == "BLOCKED_KEYWORD"

    def test_truncate_blocked(self, validator):
        result = validator.validate("TRUNCATE TABLE t")
        assert not result.is_valid
        assert result.error_code == "BLOCKED_KEYWORD"

    def test_merge_blocked(self, validator):
        result = validator.validate("MERGE INTO t USING s ON (1=1) WHEN MATCHED THEN UPDATE")
        assert not result.is_valid
        assert result.error_code == "BLOCKED_KEYWORD"


class TestPlSqlBlocked:
    def test_begin_blocked(self, validator):
        result = validator.validate("BEGIN NULL; END;")
        assert not result.is_valid
        assert result.error_code == "BLOCKED_PLSQL"

    def test_declare_blocked(self, validator):
        result = validator.validate("DECLARE x NUMBER; BEGIN x:=1; END;")
        assert not result.is_valid
        assert result.error_code == "BLOCKED_PLSQL"


class TestMultiStatement:
    def test_multi_statement_blocked(self, validator):
        result = validator.validate("SELECT 1; SELECT 2")
        assert not result.is_valid
        assert result.error_code == "MULTI_STATEMENT"

    def test_semicolon_in_string_allowed(self, validator):
        """字符串内的分号不应被视为多语句"""
        sql = "SELECT * FROM t WHERE name = 'hello;world'"
        result = validator.validate(sql)
        assert result.is_valid


class TestCommentBypass:
    def test_block_comment_removed(self, validator):
        """注释内的危险关键字不触发"""
        sql = "SELECT /* DROP */ * FROM t"
        result = validator.validate(sql)
        assert result.is_valid

    def test_block_comment_removed_and_blocked(self, validator):
        """去掉注释后仍然是 SELECT，合法"""
        sql = "SELECT 1 /* comment */ FROM DUAL"
        result = validator.validate(sql)
        assert result.is_valid

    def test_line_comment_removed(self, validator):
        sql = "SELECT * FROM t -- DROP TABLE"
        result = validator.validate(sql)
        assert result.is_valid


class TestRowLimit:
    def test_apply_row_limit_simple(self, validator):
        wrapped = validator.apply_row_limit("SELECT * FROM t")
        assert wrapped == "SELECT * FROM (SELECT * FROM t) WHERE ROWNUM <= 1000"

    def test_apply_row_limit_with_orderby(self, validator):
        wrapped = validator.apply_row_limit("SELECT * FROM t ORDER BY id")
        assert "ROWNUM <= 1000" in wrapped
        assert wrapped.startswith("SELECT * FROM (")
        assert wrapped.endswith(") WHERE ROWNUM <= 1000")

    def test_apply_row_limit_with_cte(self, validator):
        sql = "WITH cte AS (SELECT * FROM t) SELECT * FROM cte"
        wrapped = validator.apply_row_limit(sql)
        assert wrapped.startswith("SELECT * FROM (")
        assert "WITH cte AS" in wrapped

    def test_apply_row_limit_strips_trailing_semicolon(self, validator):
        wrapped = validator.apply_row_limit("SELECT * FROM t;")
        assert not wrapped.rstrip().endswith(";")
        assert wrapped == "SELECT * FROM (SELECT * FROM t) WHERE ROWNUM <= 1000"


class TestEdgeCases:
    def test_valid_select_with_comment(self, validator):
        sql = "SELECT /*+ PARALLEL(4) */ * FROM t WHERE x = 1"
        result = validator.validate(sql)
        assert result.is_valid

    def test_valid_with_complex_cte(self, validator):
        sql = """WITH
  dept_cte AS (SELECT dept_id FROM departments WHERE status='ACTIVE'),
  emp_cte AS (SELECT emp_id, dept_id FROM employees WHERE salary > 5000)
SELECT e.emp_id, d.dept_id
FROM emp_cte e
JOIN dept_cte d ON e.dept_id = d.dept_id"""
        result = validator.validate(sql)
        assert result.is_valid

    def test_valid_subquery_in_select(self, validator):
        sql = "SELECT t.id, (SELECT MAX(s.date) FROM status s WHERE s.t_id = t.id) AS last_date FROM tasks t"
        result = validator.validate(sql)
        assert result.is_valid
