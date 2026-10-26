"""Synthetic application forms for training and evaluating the form check model.

Everything here is synthetic and seeded, so runs are reproducible. Normal forms follow plausible ranges for
engineering and management institutions; faulty forms inject five kinds of error (200 each in the test set):

* unit_error       land area multiplied by 10, divided by 10, or multiplied by 10.76 (square metres vs square feet)
* builtup_over     built-up area larger than the plot
* faculty_short    far too few faculty for the intake (more than 40 students per faculty member)
* expired_lease    a lease that has already expired
* bulk_missing     a form filled in seconds with most required documents missing

Output: data/train.jsonl (4,000 normal), data/test_normal.jsonl (1,000 normal), data/test_faulty.jsonl (1,000 faulty).
Each line: {"type", "values", "today", "requiredDocs", "fault"}.
"""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.config import required_doc_kinds  # noqa: E402

TODAY = date(2026, 6, 1)
SITE_TYPES = ["NEW_INSTITUTION", "CHANGE_OF_SITE"]
COURSES = ["B.Tech Computer Science", "B.Tech Electronics", "B.Tech Mechanical", "B.Tech Civil", "MBA", "MCA", "B.Pharm", "Diploma in Mechanical"]
FAULTS = ["unit_error", "builtup_over", "faculty_short", "expired_lease", "bulk_missing"]


def normal_form(rng: np.random.Generator) -> dict:
    app_type = str(rng.choice(SITE_TYPES, p=[0.8, 0.2]))
    n_courses = int(rng.integers(1, 5))
    courses = []
    for i in range(n_courses):
        years = int(rng.choice([4, 4, 4, 2, 3]))
        courses.append({"name": COURSES[(i + int(rng.integers(0, len(COURSES)))) % len(COURSES)], "intake": int(rng.choice([30, 60, 60, 120, 120, 180])), "years": years})
    total = sum(c["intake"] for c in courses)
    student_years = sum(c["intake"] * c["years"] for c in courses)
    # Built-up space scales with students (about 8-20 square metres per student); land is 1.5-4 times the built-up area.
    built = float(total * rng.uniform(8, 20) * rng.uniform(1.0, 2.2))
    land = float(built * rng.uniform(1.5, 4.0))
    faculty = max(4, int(round(student_years / rng.uniform(12, 20))))
    labs = int(round(n_courses * rng.uniform(3, 8)))
    lease = TODAY + timedelta(days=int(rng.uniform(2, 30) * 365.25))
    required = required_doc_kinds(app_type)
    return {
        "type": app_type,
        "values": {
            "landAreaSqm": round(land),
            "builtupAreaSqm": round(built),
            "courses": courses,
            "facultyCount": faculty,
            "labCount": labs,
            "leaseExpiry": lease.isoformat(),
            "fillSeconds": float(round(rng.lognormal(mean=np.log(1500), sigma=0.45))),
            "documents": list(required),
        },
        "today": TODAY.isoformat(),
        "requiredDocs": required,
        "fault": None,
    }


def faulty_form(rng: np.random.Generator, fault: str) -> dict:
    f = normal_form(rng)
    v = f["values"]
    if fault == "unit_error":
        factor = float(rng.choice([10.0, 0.1, 10.76]))
        v["landAreaSqm"] = round(v["landAreaSqm"] * factor)
    elif fault == "builtup_over":
        v["builtupAreaSqm"] = round(v["landAreaSqm"] * rng.uniform(1.1, 2.0))
    elif fault == "faculty_short":
        student_years = sum(c["intake"] * c["years"] for c in v["courses"])
        v["facultyCount"] = max(1, int(student_years / rng.uniform(45, 90)))
    elif fault == "expired_lease":
        v["leaseExpiry"] = (TODAY - timedelta(days=int(rng.uniform(10, 1100)))).isoformat()
    elif fault == "bulk_missing":
        v["fillSeconds"] = float(rng.integers(20, 120))
        keep = int(rng.integers(0, max(1, len(f["requiredDocs"]) - 1)))
        v["documents"] = f["requiredDocs"][:keep]
    f["fault"] = fault
    return f


def generate(seed: int = 42, n_train: int = 4000, n_test_normal: int = 1000, n_per_fault: int = 200) -> dict[str, list[dict]]:
    rng = np.random.default_rng(seed)
    train = [normal_form(rng) for _ in range(n_train)]
    test_normal = [normal_form(rng) for _ in range(n_test_normal)]
    test_faulty = [faulty_form(rng, fault) for fault in FAULTS for _ in range(n_per_fault)]
    return {"train": train, "test_normal": test_normal, "test_faulty": test_faulty}


def main() -> None:
    out = ROOT / "data"
    out.mkdir(exist_ok=True)
    sets = generate()
    for name, rows in sets.items():
        with open(out / f"{name}.jsonl", "w") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")
    print({k: len(v) for k, v in sets.items()})


if __name__ == "__main__":
    main()
