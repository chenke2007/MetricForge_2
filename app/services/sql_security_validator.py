import hashlib
import re
from dataclasses import dataclass


@dataclass
class ValidationResult:
    is_valid: bool
    sanitized_sql: str | None = None
    error_code: str | None = None
    error_message: str | None = None


class SqlSecurityValidator:
    """纯函数安全校验器，仅 SELECT/WITH 语句可通过。"""

    MAX_RESULT_ROWS = 1000

    BLOCKED_DML_KEYWORDS = [
        "DROP", "ALTER", "CREATE", "INSERT", "UPDATE", "DELETE",
        "TRUNCATE", "REPLACE", "MERGE", "GRANT", "REVOKE",
        "EXEC", "EXECUTE", "CALL", "LOCK", "UNLOCK", "PURGE", "RENAME",
    ]

    BLOCKED_PLSQL_KEYWORDS = [
        "BEGIN", "DECLARE", "EXCEPTION", "LOOP", "CURSOR",
        "FUNCTION", "PROCEDURE", "PACKAGE",
    ]

    # 出现在 WITH 后的 DML 关键字（WITH 只读保护）
    WITH_DML_KEYWORDS = ["INSERT", "UPDATE", "DELETE", "MERGE"]

    def validate(self, sql: str) -> ValidationResult:
        """安全校验主入口"""
        # 1. 空检查
        if not sql or not sql.strip():
            return ValidationResult(False, error_code="EMPTY_SQL", error_message="SQL 语句为空")

        # 2. 脱去注释
        sanitized = self._strip_comments(sql)
        stripped = sanitized.strip()

        # 3. DDL/DML 关键字检查（优先于 readonly 检查）
        is_blocked, kw = self._check_blocked_keywords(stripped, self.BLOCKED_DML_KEYWORDS)
        if is_blocked:
            return ValidationResult(False, error_code="BLOCKED_KEYWORD", error_message=f"禁止使用的关键字: {kw}")

        # 4. PL/SQL 检查（优先于 multi-statement 检查）
        is_blocked, kw = self._check_blocked_keywords(stripped, self.BLOCKED_PLSQL_KEYWORDS)
        if is_blocked:
            return ValidationResult(False, error_code="BLOCKED_PLSQL", error_message=f"不支持 PL/SQL 语句: {kw}")

        # 5. 只读前缀检查
        if not self._check_readonly(stripped):
            return ValidationResult(False, error_code="NOT_READONLY", error_message="仅允许 SELECT 和 WITH 查询语句")

        # 6. 多语句检查
        if self._check_multi_statement(stripped):
            return ValidationResult(False, error_code="MULTI_STATEMENT", error_message="不支持多条语句执行")

        return ValidationResult(True, sanitized_sql=stripped)

    def _strip_comments(self, sql: str) -> str:
        """脱去 SQL 中的注释"""
        result = []
        i = 0
        in_string = False
        string_char = None
        while i < len(sql):
            ch = sql[i]
            # 跟踪字符串状态
            if ch in ("'", '"') and not in_string:
                in_string = True
                string_char = ch
                result.append(ch)
                i += 1
                continue
            if ch == string_char and in_string:
                # 处理转义引号
                if i + 1 < len(sql) and sql[i + 1] == string_char:
                    result.append(ch)
                    result.append(ch)
                    i += 2
                    continue
                in_string = False
                string_char = None
                result.append(ch)
                i += 1
                continue

            if not in_string:
                # 块注释 /* ... */
                if ch == '/' and i + 1 < len(sql) and sql[i + 1] == '*':
                    i += 2
                    while i + 1 < len(sql):
                        if sql[i] == '*' and sql[i + 1] == '/':
                            i += 2
                            break
                        i += 1
                    else:
                        # 未闭合注释 -- 继续到末尾
                        break
                    continue

                # 单行注释 --
                if ch == '-' and i + 1 < len(sql) and sql[i + 1] == '-':
                    i += 2
                    while i < len(sql) and sql[i] not in '\n\r':
                        i += 1
                    continue

            result.append(ch)
            i += 1

        return ''.join(result)

    def _check_multi_statement(self, sql: str) -> bool:
        """检查是否多条语句"""
        count = 0
        in_string = False
        string_char = None
        for i, ch in enumerate(sql):
            if ch in ("'", '"') and not in_string:
                in_string = True
                string_char = ch
                continue
            if ch == string_char and in_string:
                if i + 1 < len(sql) and sql[i + 1] == string_char:
                    continue  # 转义引号
                in_string = False
                string_char = None
                continue
            if not in_string and ch == ';':
                # 分号后有非空白内容 → 多条语句
                rest = sql[i + 1:].strip()
                if rest:
                    return True
        return False

    def _check_readonly(self, sql: str) -> bool:
        """检查是否只读查询"""
        upper = sql.upper().strip()
        # 去除末尾分号
        if upper.endswith(';'):
            upper = upper[:-1].strip()

        # SELECT 开头 — 合法
        if upper.startswith('SELECT'):
            return True

        # WITH 开头 — 进一步检查
        if upper.startswith('WITH'):
            rest = upper[4:]  # 跳过 WITH
            for kw in self.WITH_DML_KEYWORDS:
                if re.search(r'\b' + kw + r'\b', rest):
                    return False
            return True

        return False

    def _check_blocked_keywords(self, sql: str, keywords: list[str]) -> tuple:
        """检查是否有禁止关键字"""
        upper = sql.upper()
        for kw in keywords:
            if re.search(r'\b' + kw + r'\b', upper):
                return True, kw
        return False, ""

    def apply_row_limit(self, sql: str) -> str:
        """Oracle 适配：外层 SELECT * 包裹 + ROWNUM 限制"""
        cleaned = sql.rstrip('; \t\n\r')
        return f"SELECT * FROM ({cleaned}) WHERE ROWNUM <= {self.MAX_RESULT_ROWS}"

    @staticmethod
    def compute_sql_hash(sql: str) -> str:
        """计算 SQL 的 SHA256 摘要"""
        return hashlib.sha256(sql.strip().encode('utf-8')).hexdigest()
