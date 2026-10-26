"""Train the Isolation Forest on synthetic normal forms and save the bundle with joblib."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.config import MODEL_PATH  # noqa: E402
from app.explain import model_vector  # noqa: E402
from app.features import FEATURE_NAMES, FormValues, compute_features  # noqa: E402

VERSION = "application_form_v1"


def load(name: str) -> list[dict]:
    return [json.loads(line) for line in (ROOT / "data" / f"{name}.jsonl").read_text().splitlines()]


def features_of(rows: list[dict]) -> list[dict]:
    return [compute_features(FormValues.model_validate(r["values"]), r["today"], r["requiredDocs"]) for r in rows]


def train(rows: list[dict]) -> dict:
    feats = features_of(rows)
    raw = {n: np.array([f[n] for f in feats if f[n] is not None], dtype=float) for n in FEATURE_NAMES}
    median = {n: float(np.median(raw[n])) for n in FEATURE_NAMES}
    mad = {}
    for n in FEATURE_NAMES:
        m = float(np.median(np.abs(raw[n] - median[n])) * 1.4826)
        mad[n] = m if m > 1e-9 else max(float(np.std(raw[n])), 1e-3)
    # Model space: log-transformed heavy-tailed features, missing values imputed with the model-space median.
    X = np.vstack([model_vector(f, median) for f in feats])
    model_median = median
    model = IsolationForest(n_estimators=200, max_samples=256, random_state=7)
    model.fit(X)
    scores = -model.score_samples(X)
    threshold = float(np.percentile(scores, 97))
    return {"model": model, "threshold": threshold, "median": median, "mad": mad, "model_median": model_median, "features": FEATURE_NAMES, "version": VERSION}


def main() -> None:
    bundle = train(load("train"))
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, MODEL_PATH)
    print(f"saved {MODEL_PATH.name}: threshold {bundle['threshold']:.4f}")


if __name__ == "__main__":
    main()
