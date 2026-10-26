import json
import math

import pytest

from app.config import SHARED_DIR
from app.expr import evaluate, validate_expr

CONF = json.loads((SHARED_DIR / "expr-conformance.json").read_text())
VARS = json.loads((SHARED_DIR / "expr-vars.json").read_text())


def known(p: str) -> bool:
    return p in VARS["vars"] or any(p.startswith(pre) for pre in VARS["prefixes"])


def same(a, b) -> bool:
    if isinstance(a, (int, float)) and not isinstance(a, bool) and isinstance(b, (int, float)) and not isinstance(b, bool):
        return math.isclose(a, b, abs_tol=1e-12)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return a is b or (type(a) is type(b) and a == b)


def test_at_least_60_cases():
    assert len(CONF["cases"]) >= 60


@pytest.mark.parametrize("case", CONF["cases"], ids=[c["name"] for c in CONF["cases"]])
def test_conformance(case):
    assert same(evaluate(case["expr"], case["data"]), case["expected"])


@pytest.mark.parametrize("case", CONF["invalid"], ids=[c["name"] for c in CONF["invalid"]])
def test_refuses(case):
    errors = validate_expr(case["expr"], known)
    assert any(case["error"] in e["message"] for e in errors), errors
