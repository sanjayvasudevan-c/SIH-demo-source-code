"""Loading and scoring with the trained Isolation Forest bundle."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import joblib
import numpy as np

from .config import MODEL_PATH
from .explain import model_vector, top_deviations


class Scorer:
    def __init__(self, bundle: dict):
        self.model = bundle["model"]
        self.threshold = float(bundle["threshold"])
        self.median: dict[str, float] = bundle["median"]
        self.mad: dict[str, float] = bundle["mad"]
        self.model_median: dict[str, float] = bundle["model_median"]
        self.features: list[str] = bundle["features"]
        self.version: str = bundle["version"]

    def score(self, f: dict[str, Optional[float]]) -> float:
        x = model_vector(f, self.model_median).reshape(1, -1)
        return float(-self.model.score_samples(x)[0])

    def score_many(self, fs: list[dict[str, Optional[float]]]) -> np.ndarray:
        X = np.vstack([model_vector(f, self.model_median) for f in fs])
        return -self.model.score_samples(X)

    def explain(self, f: dict[str, Optional[float]]) -> list[dict]:
        return top_deviations(f, self.median, self.mad)


def load_scorer(path: Path = MODEL_PATH) -> Optional[Scorer]:
    if not path.exists():
        return None
    return Scorer(joblib.load(path))
