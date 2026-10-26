"""Form check features (section 9.2). Computed identically in the API (api/src/formcheck/features.ts)."""
from __future__ import annotations

import math
from datetime import date
from typing import Optional

from pydantic import BaseModel, Field

FEATURE_NAMES = [
    "land_area_sqm",
    "builtup_area_sqm",
    "builtup_ratio",
    "total_intake",
    "sqm_per_student",
    "faculty_count",
    "students_per_faculty",
    "labs_per_course",
    "lease_years_remaining",
    "docs_ratio",
    "log_fill_seconds",
]

FIELD_LABEL = {
    "landAreaSqm": "Land area",
    "builtupAreaSqm": "Built-up area",
    "courses": "Courses and intake",
    "facultyCount": "Faculty count",
    "labCount": "Laboratories",
    "leaseExpiry": "Lease expiry date",
    "intakeIncreasePct": "Intake increase",
    "proposedName": "Proposed name",
    "documents": "Required documents attached (%)",
    "land_area_sqm": "Land area",
    "builtup_area_sqm": "Built-up area",
    "builtup_ratio": "Built-up to land ratio",
    "total_intake": "Total intake",
    "sqm_per_student": "Square metres per student",
    "faculty_count": "Faculty count",
    "students_per_faculty": "Students per faculty member",
    "labs_per_course": "Laboratories per course",
    "lease_years_remaining": "Years left on the lease",
    "docs_ratio": "Share of required documents attached",
    "log_fill_seconds": "Time spent filling the form",
}


class Course(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    intake: int = Field(ge=0, le=5000)
    years: int = Field(ge=1, le=6)


class FormValues(BaseModel):
    landAreaSqm: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    builtupAreaSqm: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    courses: Optional[list[Course]] = Field(default=None, max_length=30)
    facultyCount: Optional[int] = Field(default=None, ge=0, le=100_000)
    labCount: Optional[int] = Field(default=None, ge=0, le=10_000)
    leaseExpiry: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    intakeIncreasePct: Optional[float] = Field(default=None, ge=0, le=1000)
    proposedName: Optional[str] = Field(default=None, max_length=200)
    fillSeconds: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    documents: Optional[list[str]] = Field(default=None, max_length=30)
    programme: Optional[str] = Field(default=None, pattern=r"^[A-Z0-9_]{2,20}$")


def _div(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None or b is None or b == 0:
        return None
    return a / b


def compute_features(values: FormValues, today: str, required_docs: list[str]) -> dict[str, Optional[float]]:
    courses = values.courses or []
    land = values.landAreaSqm
    built = values.builtupAreaSqm
    total_intake = float(sum(c.intake for c in courses)) if courses else None
    student_years = float(sum(c.intake * c.years for c in courses)) if courses else None
    faculty = float(values.facultyCount) if values.facultyCount is not None else None
    labs = float(values.labCount) if values.labCount is not None else None
    lease_years: Optional[float] = None
    if values.leaseExpiry:
        days = (date.fromisoformat(values.leaseExpiry) - date.fromisoformat(today)).days
        lease_years = days / 365.25
    if values.documents is None:
        docs_ratio: Optional[float] = None  # unknown until the applicant reaches the documents step
    elif required_docs:
        uploaded = set(values.documents)
        docs_ratio = sum(1 for k in required_docs if k in uploaded) / len(required_docs)
    else:
        docs_ratio = 1.0
    return {
        "land_area_sqm": land,
        "builtup_area_sqm": built,
        "builtup_ratio": _div(built, land),
        "total_intake": total_intake,
        "sqm_per_student": _div(built, total_intake),
        "faculty_count": faculty,
        "students_per_faculty": _div(student_years, faculty),
        "labs_per_course": (labs / len(courses)) if courses and labs is not None else None,
        "lease_years_remaining": lease_years,
        "docs_ratio": docs_ratio,
        "log_fill_seconds": math.log1p(values.fillSeconds) if values.fillSeconds is not None else None,
    }
