VALID_CHART_TYPES = {"bar", "line", "pie", "table", "metric-card", "combo"}


class AiAskResponseNormalizer:
    @staticmethod
    def normalize(raw: dict) -> dict:
        if not isinstance(raw, dict):
            return raw

        normalized = dict(raw)

        # Fill optional/warning-level arrays only
        if isinstance(normalized.get("sqlPlan"), dict):
            plan = normalized["sqlPlan"]
            plan.setdefault("assumptions", [])
            plan.setdefault("safetyWarnings", [])

        if isinstance(normalized.get("narrative"), dict):
            narrative = normalized["narrative"]
            # keyFindings is required; do NOT default it here. Let validator catch the missing field.
            narrative.setdefault("risks", [])
            narrative.setdefault("nextQuestions", [])

        # Fix invalid chartType
        if isinstance(normalized.get("chartSuggestions"), list):
            for spec in normalized["chartSuggestions"]:
                if isinstance(spec, dict) and spec.get("chartType") not in VALID_CHART_TYPES:
                    spec["chartType"] = "bar"

        # Convert numeric strings to numbers in resultSummary
        if isinstance(normalized.get("resultSummary"), dict):
            rs = normalized["resultSummary"]
            for key in ("rowCount", "durationMs"):
                if isinstance(rs.get(key), str):
                    try:
                        rs[key] = int(rs[key])
                    except ValueError:
                        pass

        return normalized
