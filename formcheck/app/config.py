"""Configuration: paths and the built-in fallback rules (validated with pydantic on startup).

The API sends the case's resolved form check rules and norms with every /score request (add-on A3). This
service no longer reads the shared rule files; app/default_rules.json (generated from the base rule pack by
api/scripts/export-formcheck-defaults.ts) is used only when a request carries no rules.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
SHARED_DIR = Path(os.environ.get("SHARED_DIR", ROOT.parent / "shared"))
MODEL_PATH = Path(os.environ.get("MODEL_PATH", ROOT / "models" / "application_form_v1.joblib"))
DEFAULTS_PATH = Path(__file__).resolve().parent / "default_rules.json"


class PackRule(BaseModel):
    """One formCheckRules entry of a rule pack: an expression over features.* and norms.*."""

    id: str = Field(pattern=r"^[A-Z][A-Z0-9_]{0,15}$")
    label: str = ""
    severity: Literal["HIGH", "MEDIUM"]
    when: Any
    message: str = Field(min_length=1, max_length=400)
    fields: list[str] = Field(min_length=1)
    valueVar: Optional[str] = None
    valueAsPercent: Optional[bool] = None


class DefaultRules(BaseModel):
    version: str
    note: Optional[str] = None
    formCheckRules: list[PackRule] = Field(min_length=1)
    norms: dict[str, float]
    requiredDocs: dict[str, list[str]]


DEFAULTS = DefaultRules.model_validate(json.loads(DEFAULTS_PATH.read_text()))


def required_doc_kinds(app_type: str) -> list[str]:
    """Critical documents of the built-in copy: the required set for docs_ratio when a request has none."""
    return list(DEFAULTS.requiredDocs.get(app_type, []))
