import json
import math

import pytest
from fastapi.testclient import TestClient

from app.config import SHARED_DIR, required_doc_kinds
from app.features import FormValues, compute_features
from app.model import load_scorer
from app.rules import evaluate_rules, rule_hits

TODAY = "2026-06-01"


def values(**over):
    base = {
        "landAreaSqm": 20000,
        "builtupAreaSqm": 9000,
        "courses": [{"name": "B.Tech CSE", "intake": 120, "years": 4}, {"name": "B.Tech ECE", "intake": 60, "years": 4}],
        "facultyCount": 48,
        "labCount": 12,
        "leaseExpiry": "2036-06-01",
        "fillSeconds": 1500,
        "documents": ["LAND_LEASE", "BUILDING_PLAN", "AFFIDAVIT"],
    }
    base.update(over)
    return FormValues.model_validate(base)


def feats(**over):
    return compute_features(values(**over), TODAY, required_doc_kinds("NEW_INSTITUTION"))


def test_features():
    f = feats()
    assert f["land_area_sqm"] == 20000
    assert f["builtup_ratio"] == pytest.approx(0.45)
    assert f["total_intake"] == 180
    assert f["sqm_per_student"] == pytest.approx(50)
    assert f["students_per_faculty"] == pytest.approx(720 / 48)
    assert f["labs_per_course"] == pytest.approx(6)
    assert f["lease_years_remaining"] == pytest.approx(3653 / 365.25)
    assert f["docs_ratio"] == 1.0
    assert f["log_fill_seconds"] == pytest.approx(math.log1p(1500))


def test_docs_ratio_unknown_until_documents_step():
    v = values()
    v.documents = None
    assert compute_features(v, TODAY, required_doc_kinds("NEW_INSTITUTION"))["docs_ratio"] is None


def test_no_rule_on_a_normal_form():
    assert rule_hits(feats()) == []


@pytest.mark.parametrize(
    "over,rule",
    [
        ({"builtupAreaSqm": 25000}, "R1"),
        ({"leaseExpiry": "2026-06-01"}, "R2"),
        ({"documents": ["LAND_LEASE"]}, "R3"),
        ({"facultyCount": 10}, "R4"),
        ({"builtupAreaSqm": 300}, "R5"),
    ],
)
def test_each_rule(over, rule):
    hits = rule_hits(feats(**over))
    assert rule in hits
    w = next(x for x in evaluate_rules(feats(**over)) if x["ruleId"] == rule)
    assert w["severity"] == "HIGH" and w["message"] and w["field"]


def test_fallback_parity_with_node():
    samples = json.loads((SHARED_DIR / "formcheck-samples.json").read_text())
    assert len(samples) == 50
    for s in samples:
        f = compute_features(FormValues.model_validate(s["values"]), s["today"], s["requiredDocs"])
        assert rule_hits(f) == s["expectedRuleHits"], s


scorer = load_scorer()
needs_model = pytest.mark.skipif(scorer is None, reason="model not trained (run training/generate.py and training/train.py)")


@needs_model
def test_deterministic_score():
    a = scorer.score(feats())
    b = scorer.score(feats())
    assert a == b
    assert 0 < a < 1


@needs_model
def test_score_contract():
    from app.main import app

    client = TestClient(app)
    assert client.get("/health").status_code == 200
    body = {"type": "NEW_INSTITUTION", "values": values(builtupAreaSqm=25000).model_dump(exclude_none=True), "today": TODAY}
    r = client.post("/score", json=body)
    assert r.status_code == 200
    j = r.json()
    assert set(j) == {"modelVersion", "severity", "score", "threshold", "warnings"}
    assert j["modelVersion"] == "application_form_v1"
    assert j["severity"] == "HIGH"
    assert any(w["source"] == "rule" and w["ruleId"] == "R1" for w in j["warnings"])
    r2 = client.post("/score", json={"type": "NEW_INSTITUTION", "values": values().model_dump(exclude_none=True), "today": TODAY})
    assert r2.json()["severity"] in ("NONE", "MEDIUM")
    bad = client.post("/score", json={"type": "NOPE", "values": {}, "today": TODAY})
    assert bad.status_code == 422


@needs_model
def test_model_warnings_name_top_features_with_typical_values():
    from app.main import ScoreRequest, score_request

    # A land area entered in square feet (x10.76) with everything else normal.
    req = ScoreRequest.model_validate({"type": "NEW_INSTITUTION", "values": values(landAreaSqm=20000 * 10.76 * 4, builtupAreaSqm=9000).model_dump(exclude_none=True), "today": TODAY})
    out = score_request(req)
    model = [w for w in out["warnings"] if w["source"] == "model"]
    if out["severity"] == "MEDIUM":
        assert 1 <= len(model) <= 3
        assert all(w["typical"] is not None and w["message"] for w in model)


@needs_model
def test_500_normal_forms_warning_rate_at_most_5_percent():
    from training.generate import generate

    rows = generate(seed=2027, n_train=0, n_test_normal=500, n_per_fault=0)["test_normal"]
    fs = [compute_features(FormValues.model_validate(r["values"]), r["today"], r["requiredDocs"]) for r in rows]
    scores = scorer.score_many(fs)
    warned = 0
    for f, s in zip(fs, scores):
        warnings = evaluate_rules(f) + (scorer.explain(f) if s > scorer.threshold else [])
        if warnings:
            warned += 1
            assert all(w["message"] for w in warnings)
    assert warned / len(rows) <= 0.05


def test_pack_rules_and_norms_from_the_request():
    from app.config import DEFAULTS

    f = feats(facultyCount=10)  # 72 students per faculty member
    assert "R4" in rule_hits(f)
    relaxed = dict(DEFAULTS.norms, maxStudentsPerFaculty=80)
    assert "R4" not in rule_hits(f, DEFAULTS.formCheckRules, relaxed)


@needs_model
def test_score_uses_rules_sent_by_the_api_and_refuses_unknown_vars():
    from app.config import DEFAULTS
    from app.main import app

    client = TestClient(app)
    rules = [r.model_dump(exclude_none=True) for r in DEFAULTS.formCheckRules]
    body = {"type": "NEW_INSTITUTION", "values": values(facultyCount=10).model_dump(exclude_none=True), "today": TODAY, "rules": rules, "norms": dict(DEFAULTS.norms, maxStudentsPerFaculty=80)}
    j = client.post("/score", json=body).json()
    assert not any(w.get("ruleId") == "R4" for w in j["warnings"])
    bad = dict(body, rules=[dict(rules[0], when={">": [{"var": "formData.secret"}, 1]})])
    r = client.post("/score", json=bad)
    assert r.status_code == 422 and r.json()["errors"][0]["path"].startswith("rules[0].when")
