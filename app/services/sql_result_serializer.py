"""SQL result serializer — 跨进程结果序列化/反序列化。

提供有界 payload 序列化，用于 worker 子进程通过原子文件传输结果。
内部使用 type-tagged dict 格式（{"t": "int", "v": 42}），不直接作为
最终 API 输出格式。父进程读取后通过 deserialize_result 还原为 JSON-safe
queryResult（Decimal→string, date/datetime→ISO string, bytes→base64 string）。

设计约束：
- MAX_RESULT_ROWS = 1000，超出截断并标记 truncated=True
- MAX_RESULT_BYTES = 10 MiB，超出抛 SerializationError（fail closed）
- 字节预算采用增量 O(n) 计算，禁止先构造无限 payload 后才检查总大小
- 构造完整 payload 后，用真实 compact JSON 大小做最终 invariant 检查
- Decimal 保留原始十进制精度，序列化前检查 is_finite()
- bytes 使用 base64 可逆编码，反序列化时 validate=True
- float NaN/Infinity fail closed
- unknown 类型 fail closed
- LOB 采用 chunked read，读取过程中递减 remaining bytes
- CLOB（read 返回 str）保持文本，不转 base64；BLOB（read 返回 bytes）保持 bytes/base64
- LOB 混合返回 str/bytes 时 fail closed
- 反序列化时严格使用 type(v) is int / bool 等，避免 bool 被当作 int
- 错误消息不得包含原始单元格内容
- 不引入 multiprocessing、adapter、DB Session 或前端逻辑
"""

import base64
import json
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from math import isfinite
from typing import Any

MAX_RESULT_ROWS = 1000
MAX_RESULT_BYTES = 10 * 1024 * 1024  # 10 MiB

# type tag 常量
_TAG_NULL = "null"
_TAG_BOOL = "bool"
_TAG_INT = "int"
_TAG_FLOAT = "float"
_TAG_DECIMAL = "decimal"
_TAG_DATE = "date"
_TAG_DATETIME = "datetime"
_TAG_BYTES = "bytes"
_TAG_STR = "str"

# tag → columnType 映射（str tag 在 columnTypes 中使用 "string"）
_TAG_TO_COLUMNTYPE = {
    _TAG_NULL: "null",
    _TAG_BOOL: "bool",
    _TAG_INT: "int",
    _TAG_FLOAT: "float",
    _TAG_DECIMAL: "decimal",
    _TAG_DATE: "date",
    _TAG_DATETIME: "datetime",
    _TAG_BYTES: "bytes",
    _TAG_STR: "string",
}

# columnTypes 合法值白名单
_VALID_COLUMNTYPES = frozenset({
    "unknown", "null", "bool", "int", "float", "decimal",
    "date", "datetime", "bytes", "string", "mixed",
})

# LOB 分块读取的 chunk 大小
_LOB_CHUNK_SIZE = 64 * 1024


class SerializationError(Exception):
    """序列化或反序列化失败：未知类型、超限、损坏 tag 等。"""


# ---------------------------------------------------------------------------
# columnTypes 归并
# ---------------------------------------------------------------------------

def merge_column_types(types: list[str]) -> str:
    """归并列类型标签为最终 columnTypes 值。

    规则：
    - null 不决定类型
    - int + decimal → decimal
    - int + float → float
    - 全 null → unknown
    - 不兼容混合 → mixed
    """
    non_null = set(t for t in types if t != _TAG_NULL)

    if not non_null:
        return "unknown"

    if "mixed" in non_null or len(non_null) > 2:
        return "mixed"

    if non_null == {_TAG_INT, _TAG_DECIMAL}:
        return "decimal"

    if non_null == {_TAG_INT, _TAG_FLOAT}:
        return "float"

    if len(non_null) == 1:
        return non_null.pop()

    return "mixed"


# ---------------------------------------------------------------------------
# 单值序列化
# ---------------------------------------------------------------------------

def _build_tagged(cell: Any) -> dict:
    """构建 type-tagged dict，不做字节计算。"""
    if cell is None:
        return {"t": _TAG_NULL, "v": None}
    # bool 必须在 int 之前检查（bool 是 int 的子类）
    if isinstance(cell, bool):
        return {"t": _TAG_BOOL, "v": cell}
    if isinstance(cell, int):
        return {"t": _TAG_INT, "v": cell}
    if isinstance(cell, float):
        if not isfinite(cell):
            raise SerializationError("float NaN/Infinity not allowed")
        return {"t": _TAG_FLOAT, "v": cell}
    if isinstance(cell, Decimal):
        if not cell.is_finite():
            raise SerializationError("decimal NaN/sNaN/Infinity not allowed")
        return {"t": _TAG_DECIMAL, "v": str(cell)}
    # datetime 必须在 date 之前检查（datetime 是 date 的子类）
    if isinstance(cell, datetime):
        return {"t": _TAG_DATETIME, "v": cell.isoformat()}
    if isinstance(cell, date):
        return {"t": _TAG_DATE, "v": cell.isoformat()}
    if isinstance(cell, bytes):
        return {"t": _TAG_BYTES, "v": base64.b64encode(cell).decode("ascii")}
    if isinstance(cell, str):
        byte_len = len(cell.encode("utf-8"))
        if byte_len > MAX_RESULT_BYTES:
            raise SerializationError("cell string exceeds MAX_RESULT_BYTES")
        return {"t": _TAG_STR, "v": cell}
    raise SerializationError(f"unserializable type: {type(cell).__name__}")


def _serialize_value(cell: Any) -> tuple[dict, int]:
    """序列化单个值为 type-tagged dict。

    返回 (tagged_cell, json_byte_size)。
    json_byte_size 包含单元格 JSON 表示的实际字节数 + 1 字节
    用于单元格间的逗号分隔符，确保预算保守。
    """
    tagged = _build_tagged(cell)
    size = len(json.dumps(tagged, ensure_ascii=False).encode("utf-8")) + 1
    return tagged, size


def _deserialize_value(item: dict) -> Any:
    """反序列化 type-tagged dict 为 JSON-safe 值。

    输出：
    - null → None
    - bool → bool
    - int → int
    - float → float
    - decimal → str（原始十进制字符串）
    - date → str（ISO 8601）
    - datetime → str（ISO 8601）
    - bytes → str（base64 编码）
    - str → str

    未知或损坏的 type tag、类型不匹配、非法值均抛出 SerializationError。
    错误消息不包含原始单元格内容。
    """
    if not isinstance(item, dict):
        raise SerializationError("cell is not a dict")

    t = item.get("t")
    v = item.get("v")

    if t == _TAG_NULL:
        if v is not None:
            raise SerializationError("null tag with non-None value")
        return None

    if t == _TAG_BOOL:
        if type(v) is not bool:
            raise SerializationError("bool tag with non-bool value")
        return v

    if t == _TAG_INT:
        # type(v) is int 严格拒绝 bool（type(True) is bool, not int）
        if type(v) is not int:
            raise SerializationError("int tag with non-int value")
        return v

    if t == _TAG_FLOAT:
        if type(v) is not float:
            raise SerializationError("float tag with non-float value")
        if not isfinite(v):
            raise SerializationError("float tag with NaN/Infinity")
        return v

    if t == _TAG_DECIMAL:
        if type(v) is not str:
            raise SerializationError("decimal tag with non-str value")
        try:
            d = Decimal(v)
            if not d.is_finite():
                raise SerializationError("decimal tag with non-finite value")
        except (InvalidOperation, TypeError, ValueError):
            raise SerializationError("invalid decimal value")
        # 返回原始字符串（JSON-safe）
        return v

    if t == _TAG_DATE:
        if type(v) is not str:
            raise SerializationError("date tag with non-str value")
        try:
            date.fromisoformat(v)
        except (ValueError, TypeError):
            raise SerializationError("invalid date value")
        # 返回 ISO 字符串（JSON-safe）
        return v

    if t == _TAG_DATETIME:
        if type(v) is not str:
            raise SerializationError("datetime tag with non-str value")
        try:
            datetime.fromisoformat(v)
        except (ValueError, TypeError):
            raise SerializationError("invalid datetime value")
        # 返回 ISO 字符串（JSON-safe）
        return v

    if t == _TAG_BYTES:
        if type(v) is not str:
            raise SerializationError("bytes tag with non-str value")
        try:
            base64.b64decode(v, validate=True)
        except Exception:
            raise SerializationError("invalid base64 value")
        # 返回 base64 字符串（JSON-safe）
        return v

    if t == _TAG_STR:
        if type(v) is not str:
            raise SerializationError("str tag with non-str value")
        return v

    raise SerializationError(f"unknown type tag: {t}")


# ---------------------------------------------------------------------------
# LOB 分块读取
# ---------------------------------------------------------------------------

def _read_lob_within_budget(lob, remaining: int) -> str | bytes:
    """分块读取 LOB，不超过 remaining 字节预算。

    返回 str（CLOB）或 bytes（BLOB），取决于 LOB 的 read() 返回类型。
    混合返回 str/bytes 时抛出 SerializationError。
    空 LOB 返回 ""（CLOB）或 b""（BLOB），类型由首个 read() 返回值决定。
    使用 remaining+1 探测超限：如果读取的总字节数超过 remaining，
    立即抛出 SerializationError，不返回部分结果。
    """
    total = 0
    chunks = []
    result_type = None  # 'str' 或 'bytes'，由首个 chunk 决定

    while total < remaining + 1:
        to_read = min(_LOB_CHUNK_SIZE, remaining + 1 - total)
        chunk = lob.read(to_read)

        # 先识别返回值类型，再判断是否为空
        if isinstance(chunk, str):
            chunk_type = "str"
        elif isinstance(chunk, bytes):
            chunk_type = "bytes"
        else:
            raise SerializationError("LOB read returned non-str/bytes chunk")

        if result_type is None:
            result_type = chunk_type
        elif result_type != chunk_type:
            raise SerializationError("LOB returned mixed str/bytes chunks")

        # 空chunk 表示 LOB 已读完
        if not chunk:
            break

        if chunk_type == "str":
            chunk_bytes = len(chunk.encode("utf-8"))
        else:
            chunk_bytes = len(chunk)

        chunks.append(chunk)
        total += chunk_bytes
        if total > remaining:
            raise SerializationError("LOB exceeds MAX_RESULT_BYTES budget")

    if result_type == "str":
        return "".join(chunks)
    if result_type == "bytes":
        return b"".join(chunks)
    # 未读取任何数据（remaining < 0 等异常情况）
    raise SerializationError("LOB read returned no data")


# ---------------------------------------------------------------------------
# 整体序列化/反序列化
# ---------------------------------------------------------------------------

def serialize_result(columns: list[str], rows: list[list]) -> dict:
    """序列化查询结果为有界 type-tagged payload。

    返回:
        {
            "status": "success",
            "columns": [...],
            "rows": [[{"t": "int", "v": 42}, ...], ...],
            "rowCount": int,
            "truncated": bool,
            "columnTypes": ["int", "str", ...],
        }

    行数超过 MAX_RESULT_ROWS 时截断并标记 truncated=True。
    总大小超过 MAX_RESULT_BYTES 时抛出 SerializationError（fail closed），
    不返回部分结果。
    输入 rows 和 columns 不被原地修改。
    构造完整 payload 后用真实 compact JSON 大小做最终 invariant 检查。
    """
    # 计算初始 framing 字节（包含 status、columns、空 rows 的 JSON 框架）
    current_bytes = len(
        json.dumps(
            {"status": "success", "columns": columns, "rows": []},
            ensure_ascii=False,
        ).encode("utf-8")
    )
    if current_bytes > MAX_RESULT_BYTES:
        raise SerializationError("framing exceeds MAX_RESULT_BYTES")

    # 每列的类型标签收集
    column_type_tags: list[list[str]] = [[] for _ in columns]

    serialized_rows = []
    truncated = False
    row_count = 0

    for row_idx, row in enumerate(rows):
        if row_idx >= MAX_RESULT_ROWS:
            truncated = True
            break

        # 验证行宽
        if len(row) != len(columns):
            raise SerializationError(
                f"row {row_idx} has {len(row)} cells, "
                f"expected {len(columns)}"
            )

        # 行的 JSON 框架开销: [ ] 和行间逗号 = 3 字节（保守估计）
        current_bytes += 3

        serialized_row = []
        for col_idx, cell in enumerate(row):
            # LOB 检测: 有 read() 方法但不是 bytes/str
            if (
                hasattr(cell, "read")
                and callable(cell.read)
                and not isinstance(cell, (bytes, str))
            ):
                remaining = MAX_RESULT_BYTES - current_bytes
                if remaining <= 0:
                    raise SerializationError(
                        "result exceeds MAX_RESULT_BYTES"
                    )
                cell = _read_lob_within_budget(cell, remaining)

            tagged, cell_bytes = _serialize_value(cell)
            if current_bytes + cell_bytes > MAX_RESULT_BYTES:
                raise SerializationError("result exceeds MAX_RESULT_BYTES")

            serialized_row.append(tagged)
            current_bytes += cell_bytes
            column_type_tags[col_idx].append(
                _TAG_TO_COLUMNTYPE[tagged["t"]]
            )

        serialized_rows.append(serialized_row)
        row_count += 1

    column_types = [merge_column_types(tags) for tags in column_type_tags]

    payload = {
        "status": "success",
        "columns": list(columns),
        "rows": serialized_rows,
        "rowCount": row_count,
        "truncated": truncated,
        "columnTypes": column_types,
    }

    # 最终 invariant 检查：用真实 compact JSON 大小验证
    final_size = len(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        .encode("utf-8")
    )
    if final_size > MAX_RESULT_BYTES:
        raise SerializationError("payload exceeds MAX_RESULT_BYTES")

    return payload


def deserialize_result(payload: dict) -> dict:
    """反序列化 type-tagged payload 为 JSON-safe queryResult。

    返回:
        {
            "columns": [...],
            "rows": [[42, "hello", ...], ...],
            "rowCount": int,
            "truncated": bool,
            "columnTypes": [...],
        }

    所有值均为 JSON-safe：
    - Decimal → 原始字符串
    - date/datetime → ISO 字符串
    - bytes → base64 字符串

    损坏或未知的 type tag、结构错误均抛出 SerializationError。
    KeyError/TypeError/ValueError 统一转为 SerializationError。
    """
    try:
        if not isinstance(payload, dict):
            raise SerializationError("payload is not a dict")

        status = payload["status"]
        if status != "success":
            raise SerializationError("unexpected status")

        columns = payload["columns"]
        if not isinstance(columns, list):
            raise SerializationError("columns is not a list")
        # 验证 columns 全为 str
        for col in columns:
            if not isinstance(col, str):
                raise SerializationError("columns contains non-string element")

        tagged_rows = payload["rows"]
        if not isinstance(tagged_rows, list):
            raise SerializationError("rows is not a list")

        row_count = payload["rowCount"]
        if type(row_count) is not int:
            raise SerializationError("rowCount is not int")
        if row_count < 0:
            raise SerializationError("rowCount is negative")

        truncated = payload["truncated"]
        if type(truncated) is not bool:
            raise SerializationError("truncated is not bool")

        column_types = payload["columnTypes"]
        if not isinstance(column_types, list):
            raise SerializationError("columnTypes is not a list")
        # 验证 columnTypes 全为 str 且属于白名单
        for ct in column_types:
            if not isinstance(ct, str):
                raise SerializationError("columnTypes contains non-string element")
            if ct not in _VALID_COLUMNTYPES:
                raise SerializationError("invalid columnType value")

        if len(column_types) != len(columns):
            raise SerializationError("columnTypes length mismatch")

        if row_count != len(tagged_rows):
            raise SerializationError("rowCount mismatch")

        rows = []
        # 同时收集每列的 type tag 用于一致性校验
        recomputed_tags: list[list[str]] = [[] for _ in columns]
        for tagged_row in tagged_rows:
            if not isinstance(tagged_row, list):
                raise SerializationError("row is not a list")
            if len(tagged_row) != len(columns):
                raise SerializationError("row width mismatch")
            row = []
            for col_idx, cell in enumerate(tagged_row):
                row.append(_deserialize_value(cell))
                recomputed_tags[col_idx].append(cell["t"])
            rows.append(row)

        # 从 tagged rows 重新计算每列真实类型，与声明的 columnTypes 比较
        recomputed_types = [
            merge_column_types(
                [_TAG_TO_COLUMNTYPE.get(t, t) for t in tags]
            )
            for tags in recomputed_tags
        ]
        if list(column_types) != recomputed_types:
            raise SerializationError("columnTypes mismatch")

        return {
            "columns": list(columns),
            "rows": rows,
            "rowCount": row_count,
            "truncated": truncated,
            "columnTypes": list(column_types),
        }

    except KeyError as exc:
        raise SerializationError(f"missing field: {exc.args[0]}")
    except TypeError as exc:
        raise SerializationError(f"type error: {exc}")
    except SerializationError:
        raise
    except ValueError as exc:
        raise SerializationError(f"value error: {exc}")
