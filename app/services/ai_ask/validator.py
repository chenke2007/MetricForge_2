from typing import Any


def _is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _is_string_array(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(x, str) for x in value)


def validate_ai_ask_response(response: dict) -> dict:
    errors = []
    warnings = []

    if not isinstance(response, dict):
        errors.append({"path": "", "message": "response 必须为对象"})
        return {"valid": False, "errors": errors, "warnings": warnings}

    # Required top-level fields
    for field in ("question", "intent", "sqlPlan", "narrative", "chartSuggestions", "semanticGaps"):
        if field not in response:
            errors.append({"path": field, "message": f"{field} 缺失"})

    if errors:
        return {"valid": False, "errors": errors, "warnings": warnings}

    # question
    if not _is_non_empty_string(response.get("question")):
        errors.append({"path": "question", "message": "question 不能为空"})

    # intent
    intent = response.get("intent", {})
    if not isinstance(intent, dict):
        errors.append({"path": "intent", "message": "intent 必须为对象"})
    else:
        for key in ("metrics", "dimensions", "filters"):
            if not _is_string_array(intent.get(key)):
                errors.append({"path": f"intent.{key}", "message": f"intent.{key} 必须为 string 数组"})

    # sqlPlan
    plan = response.get("sqlPlan", {})
    if not isinstance(plan, dict):
        errors.append({"path": "sqlPlan", "message": "sqlPlan 必须为对象"})
    else:
        if not isinstance(plan.get("datasourceId"), int):
            errors.append({"path": "sqlPlan.datasourceId", "message": "datasourceId 必须为整数"})
        if not _is_non_empty_string(plan.get("datasourceName")):
            errors.append({"path": "sqlPlan.datasourceName", "message": "datasourceName 不能为空"})
        if not _is_non_empty_string(plan.get("sql")):
            errors.append({"path": "sqlPlan.sql", "message": "sql 不能为空"})
        for key in ("tables", "fields", "assumptions", "safetyWarnings"):
            if not _is_string_array(plan.get(key)):
                errors.append({"path": f"sqlPlan.{key}", "message": f"sqlPlan.{key} 必须为 string 数组"})

    # narrative
    narrative = response.get("narrative", {})
    if not isinstance(narrative, dict):
        errors.append({"path": "narrative", "message": "narrative 必须为对象"})
    else:
        if not _is_non_empty_string(narrative.get("summary")):
            errors.append({"path": "narrative.summary", "message": "narrative.summary 不能为空"})
        if not isinstance(narrative.get("keyFindings"), list):
            errors.append({"path": "narrative.keyFindings", "message": "keyFindings 必须为数组"})
        evidence = narrative.get("evidence")
        if not isinstance(evidence, list) or len(evidence) == 0:
            errors.append({"path": "narrative.evidence", "message": "narrative.evidence 必须为非空数组"})
        else:
            for i, item in enumerate(evidence):
                if not isinstance(item, dict):
                    errors.append({"path": f"narrative.evidence[{i}]", "message": "evidence 项必须为对象"})
                    continue
                if not _is_non_empty_string(item.get("claim")):
                    errors.append({"path": f"narrative.evidence[{i}].claim", "message": "claim 不能为空"})
                if not _is_string_array(item.get("fields")) or len(item.get("fields", [])) == 0:
                    errors.append({"path": f"narrative.evidence[{i}].fields", "message": "fields 必须为非空 string 数组"})
        if not isinstance(narrative.get("risks"), list):
            errors.append({"path": "narrative.risks", "message": "risks 必须为数组"})
        if not isinstance(narrative.get("nextQuestions"), list):
            errors.append({"path": "narrative.nextQuestions", "message": "nextQuestions 必须为数组"})

    # chartSuggestions
    suggestions = response.get("chartSuggestions")
    if not isinstance(suggestions, list) or len(suggestions) == 0:
        errors.append({"path": "chartSuggestions", "message": "chartSuggestions 必须为非空数组"})
    else:
        for i, spec in enumerate(suggestions):
            if not isinstance(spec, dict):
                errors.append({"path": f"chartSuggestions[{i}]", "message": "chartSuggestion 项必须为对象"})
                continue
            if not _is_non_empty_string(spec.get("title")):
                errors.append({"path": f"chartSuggestions[{i}].title", "message": "title 不能为空"})
            if not _is_string_array(spec.get("yFields")):
                errors.append({"path": f"chartSuggestions[{i}].yFields", "message": "yFields 必须为 string 数组"})

    # semanticGaps
    gaps = response.get("semanticGaps")
    if not isinstance(gaps, list):
        errors.append({"path": "semanticGaps", "message": "semanticGaps 必须为数组"})

    return {"valid": len(errors) == 0, "errors": errors, "warnings": warnings}
