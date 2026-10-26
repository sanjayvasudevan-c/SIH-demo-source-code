"""A small, safe JSON-logic subset (add-on A3). Mirrors api/src/rules/expr.ts exactly; both pass
shared/expr-conformance.json.

- {"var": "a.b"} or {"var": ["a.b", default]} reads a path; missing -> None (or the default).
- No type coercion: == / != compare type and value; < <= > >= need two numbers, otherwise False.
- Arithmetic needs numbers, otherwise None; division by zero -> None. min / max need numbers, otherwise None.
- Truthy: anything except False, None, 0, "" and [].
- in: [needle, list] by strict equality; anything else -> False.
- if: [c1, v1, (c2, v2, ...), else?].
"""
from __future__ import annotations

import json
import math
from typing import Any, Callable

OPERATORS = {"var", "==", "!=", "<", "<=", ">", ">=", "and", "or", "!", "in", "if", "+", "-", "*", "/", "min", "max"}
MAX_DEPTH = 8
MAX_BYTES = 2048
ARITY = {
    "==": (2, 2), "!=": (2, 2), "<": (2, 2), "<=": (2, 2), ">": (2, 2), ">=": (2, 2), "!": (1, 1), "in": (2, 2),
    "-": (1, 2), "/": (2, 2), "and": (1, 20), "or": (1, 20), "if": (2, 21), "+": (1, 20), "*": (1, 20),
    "min": (1, 20), "max": (1, 20),
}


def is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def truthy(v: Any) -> bool:
    if v is None or v is False or v == "" or (isinstance(v, list) and len(v) == 0):
        return False
    if is_num(v) and v == 0:
        return False
    return True


def _kind(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if is_num(v):
        return "num"
    if isinstance(v, str):
        return "str"
    if isinstance(v, list):
        return "list"
    return "obj"


def strict_equal(a: Any, b: Any) -> bool:
    if _kind(a) != _kind(b):
        return False
    if isinstance(a, list):
        return len(a) == len(b) and all(strict_equal(x, y) for x, y in zip(a, b))
    return a == b


def get_path(data: dict, path: str) -> Any:
    cur: Any = data
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def evaluate(expr: Any, data: dict) -> Any:
    if isinstance(expr, list):
        return [evaluate(e, data) for e in expr]
    if not isinstance(expr, dict):
        return expr
    if len(expr) != 1:
        raise ValueError("An expression object must have exactly one operator")
    (op, raw), = expr.items()
    if op == "var":
        path, dflt = (raw[0], raw[1] if len(raw) > 1 else None) if isinstance(raw, list) else (raw, None)
        v = get_path(data, str(path))
        return dflt if v is None else v
    args = raw if isinstance(raw, list) else [raw]
    if op == "if":
        i = 0
        while i + 1 < len(args):
            if truthy(evaluate(args[i], data)):
                return evaluate(args[i + 1], data)
            i += 2
        return evaluate(args[i], data) if i < len(args) else None
    if op == "and":
        return all(truthy(evaluate(a, data)) for a in args)
    if op == "or":
        return any(truthy(evaluate(a, data)) for a in args)
    v = [evaluate(a, data) for a in args]
    if op == "==":
        return strict_equal(v[0], v[1])
    if op == "!=":
        return not strict_equal(v[0], v[1])
    if op in ("<", "<=", ">", ">="):
        if not (is_num(v[0]) and is_num(v[1])):
            return False
        return {"<": v[0] < v[1], "<=": v[0] <= v[1], ">": v[0] > v[1], ">=": v[0] >= v[1]}[op]
    if op == "!":
        return not truthy(v[0])
    if op == "in":
        return isinstance(v[1], list) and any(strict_equal(x, v[0]) for x in v[1])
    if op in ("+", "*", "-", "min", "max"):
        if not v or not all(is_num(x) for x in v):
            return None
        if op == "+":
            return sum(v)
        if op == "*":
            out = 1
            for x in v:
                out *= x
            return out
        if op == "-":
            return -v[0] if len(v) == 1 else v[0] - v[1]
        return min(v) if op == "min" else max(v)
    if op == "/":
        return v[0] / v[1] if is_num(v[0]) and is_num(v[1]) and v[1] != 0 else None
    raise ValueError(f"Unknown operator {op}")


def validate_expr(expr: Any, known_var: Callable[[str], bool], at: str = "") -> list[dict]:
    errors: list[dict] = []
    size = len(json.dumps(expr, separators=(",", ":"), ensure_ascii=False).encode())
    if size > MAX_BYTES:
        errors.append({"path": at, "message": f"The expression is {size} bytes; the limit is {MAX_BYTES}."})

    def walk(e: Any, depth: int, p: str) -> None:
        if depth > MAX_DEPTH:
            errors.append({"path": p, "message": f"The expression is nested more than {MAX_DEPTH} levels deep."})
            return
        if isinstance(e, list):
            for i, x in enumerate(e):
                walk(x, depth, f"{p}[{i}]")
            return
        if not isinstance(e, dict):
            return
        if len(e) != 1:
            errors.append({"path": p, "message": "An expression object must have exactly one operator."})
            return
        (op, raw), = e.items()
        if op not in OPERATORS:
            errors.append({"path": p, "message": f'Operator "{op}" is not allowed.'})
            return
        if op == "var":
            path = raw[0] if isinstance(raw, list) else raw
            if not isinstance(path, str) or not path:
                errors.append({"path": p, "message": "var needs a path."})
            elif not known_var(path):
                errors.append({"path": p, "message": f'Unknown variable "{path}".'})
            return
        args = raw if isinstance(raw, list) else [raw]
        lo, hi = ARITY[op]
        if not lo <= len(args) <= hi:
            errors.append({"path": p, "message": f'"{op}" takes {lo if lo == hi else f"{lo} to {hi}"} arguments.'})
        for i, a in enumerate(args):
            walk(a, depth + 1, f"{p}.{op}[{i}]")

    walk(expr, 1, at)
    return errors
