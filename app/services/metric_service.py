"""指标治理业务逻辑"""

import csv
import json
import logging
from io import StringIO
from pathlib import Path

from ..models import MetricCaliber, MetricDefinition, get_session

logger = logging.getLogger(__name__)


def import_metrics_from_csv(content: str, delimiter: str = ",") -> dict:
    """从 CSV 内容导入指标定义

    Args:
        content: CSV 文本内容
        delimiter: 分隔符

    Returns:
        导入统计 {total, success, errors}
    """
    db = get_session()
    result = {"total": 0, "success": 0, "errors": []}

    try:
        reader = csv.DictReader(StringIO(content), delimiter=delimiter)
        for row_num, row in enumerate(reader, start=2):
            result["total"] += 1
            try:
                metric_code = row.get("metric_code") or row.get("指标编码", "").strip()
                if not metric_code:
                    result["errors"].append(f"第 {row_num} 行: 缺少指标编码")
                    continue

                metric_name = row.get("metric_name") or row.get("指标名称", "").strip()
                if not metric_name:
                    result["errors"].append(f"第 {row_num} 行: 缺少指标名称")
                    continue

                # 检查重复
                exists = db.query(MetricDefinition).filter(
                    MetricDefinition.metric_code == metric_code
                ).first()
                if exists:
                    result["errors"].append(f"第 {row_num} 行: 指标编码 '{metric_code}' 已存在")
                    continue

                metric = MetricDefinition(
                    metric_code=metric_code,
                    metric_name=metric_name,
                    metric_name_en=row.get("metric_name_en") or row.get("英文名称", ""),
                    business_aliases=row.get("business_aliases") or row.get("业务别名", ""),
                    category=row.get("category") or row.get("分类", ""),
                    definition=row.get("definition") or row.get("业务定义", ""),
                    formula=row.get("formula") or row.get("计算公式", ""),
                    source_table=row.get("source_table") or row.get("来源表", ""),
                    owner=row.get("owner") or row.get("负责人", ""),
                    default_time_grain=row.get("default_time_grain") or row.get("默认时间粒度", ""),
                    default_time_caliber=row.get("default_time_caliber") or row.get("默认口径", ""),
                )
                db.add(metric)
                db.flush()

                # 口径映射
                calibers_str = row.get("calibers") or row.get("口径", "")
                if calibers_str:
                    try:
                        calibers = json.loads(calibers_str)
                        for c in calibers:
                            caliber = MetricCaliber(
                                metric_id=metric.id,
                                caliber_name=c.get("name", ""),
                                caliber_rule=c.get("rule", ""),
                                filter_template=c.get("filter_template", ""),
                                is_default=c.get("is_default", False),
                            )
                            db.add(caliber)
                    except json.JSONDecodeError:
                        pass

                result["success"] += 1

            except Exception as e:
                result["errors"].append(f"第 {row_num} 行: {e}")

        db.commit()
        logger.info("指标导入完成: %d/%d 成功", result["success"], result["total"])

    except Exception as e:
        db.rollback()
        logger.error("指标导入失败: %s", e)
        result["errors"].append(f"整体导入错误: {e}")
    finally:
        db.close()

    return result


def import_metrics_from_file(file_path: str) -> dict:
    """从文件导入指标"""
    path = Path(file_path)
    if not path.exists():
        return {"total": 0, "success": 0, "errors": [f"文件不存在: {file_path}"]}

    content = path.read_text(encoding="utf-8-sig")

    if path.suffix.lower() == ".csv":
        return import_metrics_from_csv(content)
    elif path.suffix.lower() in (".xlsx", ".xls"):
        return {"total": 0, "success": 0, "errors": ["Excel 导入暂未实现，请先转换为 CSV"]}
    else:
        return import_metrics_from_csv(content, delimiter="\t")
