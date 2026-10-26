"""Model features and explanations: log transforms for the model, robust z-scores for the explanation."""
from __future__ import annotations

import math
from typing import Optional

import numpy as np

from .features import FEATURE_NAMES, FIELD_LABEL

# Heavy-tailed features are log-transformed (log1p) for the model.
LOG_FEATURES = {"land_area_sqm", "builtup_area_sqm", "total_intake", "faculty_count", "sqm_per_student", "students_per_faculty"}


def model_vector(f: dict[str, Optional[float]], medians: dict[str, float]) -> np.ndarray:
    row = []
    for name in FEATURE_NAMES:
        v = f.get(name)
        if v is None or (isinstance(v, float) and math.isnan(v)):
            v = medians[name]
        if name in LOG_FEATURES:
            v = math.log1p(max(v, 0.0))
        row.append(float(v))
    return np.array(row, dtype=float)


def display_value(name: str, v: float) -> float:
    """Show seconds instead of log seconds, and round."""
    if name == "log_fill_seconds":
        return round(math.expm1(v))
    if name == "docs_ratio":
        return round(v * 100)
    return round(v, 2)


def top_deviations(f: dict[str, Optional[float]], median: dict[str, float], mad: dict[str, float], k: int = 3) -> list[dict]:
    """Top-k features by absolute robust z-score (value - median) / MAD, with the typical (median) value."""
    scored = []
    for name in FEATURE_NAMES:
        v = f.get(name)
        if v is None:
            continue
        z = (v - median[name]) / mad[name]
        scored.append((abs(z), name, v, z))
    scored.sort(reverse=True)
    out = []
    for _, name, v, z in scored[:k]:
        label = FIELD_LABEL.get(name, name)
        typical = display_value(name, median[name])
        shown = display_value(name, v)
        direction = "higher" if z > 0 else "lower"
        out.append(
            {
                "source": "model",
                "field": label,
                "value": shown,
                "typical": typical,
                "z": round(float(z), 2),
                "message": f"{label} is much {direction} than in similar applications (you entered {shown}; typical {typical}). Check the value and its unit.",
                "severity": "MEDIUM",
            }
        )
    return out
