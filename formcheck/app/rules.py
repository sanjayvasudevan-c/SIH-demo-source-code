"""Form check rules: the pack's formCheckRules evaluated with expr.py (the API evaluates the same rules in Node)."""
from __future__ import annotations

import math
from typing import Optional

from .config import DEFAULTS, PackRule
from .expr import evaluate, get_path, truthy, validate_expr
from .features import FIELD_LABEL


def js_round(x: float) -> int:
    """Math.round semantics (half up), so values match the Node evaluator exactly."""
    return math.floor(x + 0.5)


def _round(v: float) -> float:
    return js_round(v * 100) / 100


def validate_rules(rules: list[PackRule], norms: dict[str, float]) -> list[dict]:
    """Every var must be a feature or a norm that was sent; depth and size limits as in Node."""

    def known(p: str) -> bool:
        return p.startswith("features.") or (p.startswith("norms.") and p[6:] in norms)

    errors: list[dict] = []
    for i, r in enumerate(rules):
        errors.extend(validate_expr(r.when, known, f"rules[{i}].when"))
    return errors


def evaluate_rules(f: dict[str, Optional[float]], rules: Optional[list[PackRule]] = None, norms: Optional[dict[str, float]] = None) -> list[dict]:
    rules = DEFAULTS.formCheckRules if rules is None else rules
    norms = DEFAULTS.norms if norms is None else norms
    data = {"features": f, "norms": norms}
    out: list[dict] = []
    for r in rules:
        if not truthy(evaluate(r.when, data)):
            continue
        raw = get_path(data, r.valueVar) if r.valueVar else None
        v = raw if isinstance(raw, (int, float)) and not isinstance(raw, bool) else None
        shown = None if v is None else js_round(v * 100) if r.valueAsPercent else _round(v)
        field = r.fields[0]
        out.append({"source": "rule", "ruleId": r.id, "field": FIELD_LABEL.get(field, field), "value": shown, "message": r.message, "severity": r.severity})
    return out


def rule_hits(f: dict[str, Optional[float]], rules: Optional[list[PackRule]] = None, norms: Optional[dict[str, float]] = None) -> list[str]:
    return [w["ruleId"] for w in evaluate_rules(f, rules, norms)]
