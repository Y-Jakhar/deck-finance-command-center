"""Security and accounting boundaries for opt-in evidence staging."""

from __future__ import annotations

from hashlib import sha256
import sqlite3

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from trusted_evidence_review import router


TOKEN = "reviewer-only-token-" + "a" * 48
NOTE = "I checked the original source line and its financial-statement meaning."


@pytest.fixture
def staging(tmp_path, monkeypatch):
    root = tmp_path / "isolated-evidence"
    monkeypatch.setenv("RESEARCHDESK_EVIDENCE_STAGING_ROOT", str(root))
    monkeypatch.setenv("RESEARCHDESK_EVIDENCE_TOKEN_SHA256", sha256(TOKEN.encode()).hexdigest())
    monkeypatch.setenv("RESEARCHDESK_EVIDENCE_REVIEWER_ID", "local-os-reviewer")
    app = FastAPI()
    app.include_router(router)
    return TestClient(app), root


def auth():
    return {"Authorization": f"Bearer {TOKEN}"}


def inspected_source(key):
    return {"document_sha256": key, "decision": "approve", "note": NOTE,
            "original_inspected": True, "issuer_or_auditor_origin_checked": True}


def upload(client, name="filing.csv", content=b"Net sales,100\n"):
    return client.post("/api/desk/three-statement-v2/staging/documents",
                       headers={**auth(), "X-Document-SHA256": sha256(content).hexdigest()},
                       files={"file": (name, content, "text/csv")})


def evidence(document_hash, locator, value=100, field="income.revenue"):
    return {"state": "audited", "value": value, "period_end": "2025-09-27",
            "currency": "USD", "units": "millions", "scope": field,
            "definition": "Net sales, fiscal 2025", "formula": None, "review": None,
            "reason": None, "component_ids": [],
            "sources": [{"document_id": "filing.csv", "url": f"urn:sha256:{document_hash}",
                         "document_sha256": document_hash, "locator": locator,
                         "reported_value": value, "period_end": "2025-09-27",
                         "currency": "USD", "units": "millions", "scope": field}]}


def field_payload(document_hash, locator, value=100, field="income.revenue"):
    return {"decision": "approve", "note": NOTE, "field": field,
            "evidence": evidence(document_hash, locator, value, field),
            "document_sha256": document_hash, "candidate_reference": locator,
            "value_index": 0, "source_units": "millions", "source_currency": "USD",
            "source_period_end": "2025-09-27", "statement_section": "income"}


def test_upload_verifies_actual_bytes_and_blocks_modified_file(staging):
    client, root = staging
    bad = client.post("/api/desk/three-statement-v2/staging/documents",
                      headers={**auth(), "X-Document-SHA256": "0" * 64},
                      files={"file": ("filing.csv", b"Net sales,100\n", "text/csv")})
    assert bad.status_code == 422
    assert not root.exists()
    good = upload(client)
    assert good.status_code == 200
    key = good.json()["sha256"]
    assert good.json()["byte_verified"] and not good.json()["semantic_verified"]
    (root / "files" / key).write_bytes(b"Net sales,101\n")
    assert client.get(f"/api/desk/three-statement-v2/staging/documents/{key}",
                      headers=auth()).status_code == 409
    assert client.post("/api/desk/three-statement-v2/staging/source-review",
                       headers=auth(), json={"document_sha256": key,
                                             "decision": "approve", "note": NOTE}).status_code == 409


def test_identity_is_server_bound_and_no_browser_name_is_accepted(staging):
    client, _ = staging
    assert client.get("/api/desk/three-statement-v2/staging/identity").status_code == 401
    assert client.get("/api/desk/three-statement-v2/staging/identity",
                      headers={"Authorization": "Bearer " + "x" * 64}).status_code == 401
    assert client.get("/api/desk/three-statement-v2/staging/identity",
                      headers=auth()).json()["reviewer"] == "local-os-reviewer"
    key = upload(client).json()["sha256"]
    forged = client.post("/api/desk/three-statement-v2/staging/source-review",
                         headers=auth(), json={"document_sha256": key, "decision": "approve",
                                               "note": NOTE, "reviewer": "forged-admin"})
    assert forged.status_code == 422
    assert client.post("/api/desk/three-statement-v2/staging/source-review",
                       headers=auth(), json={"document_sha256": key,
                                             "decision": "approve", "note": NOTE}).status_code == 422
    accepted = client.post("/api/desk/three-statement-v2/staging/source-review",
                           headers=auth(), json=inspected_source(key))
    assert accepted.status_code == 200
    assert accepted.json()["reviewer"] == "local-os-reviewer"


def test_field_review_checks_value_classification_units_period_and_source(staging):
    client, _ = staging
    key = upload(client).json()["sha256"]
    locator = "filing.csv · CSV row 1"
    route = "/api/desk/three-statement-v2/staging/field-review"
    payload = field_payload(key, locator)
    assert client.post(route, headers=auth(), json=payload).status_code == 422
    assert client.post("/api/desk/three-statement-v2/staging/source-review",
                       headers=auth(), json=inspected_source(key)).status_code == 200
    for changed, failed_check in [
        ({"evidence": evidence(key, locator, 101)}, "numeric_value"),
        ({"source_units": "thousands"}, "numeric_value"),
        ({"source_period_end": "2024-09-28"}, "period"),
        ({"source_currency": "EUR"}, "currency"),
        ({"statement_section": "balance"}, "classification"),
        ({"field": "balance.cash", "evidence": evidence(key, locator, 100, "balance.cash"),
          "statement_section": "balance"}, "classification"),
        ({"candidate_reference": "invented locator"}, "source_identity"),
    ]:
        response = client.post(route, headers=auth(), json={**payload, **changed})
        assert response.status_code == 422
        assert response.json()["detail"]["source_discrepancies"][failed_check] is False
    assert client.post(route, headers=auth(), json=payload).status_code == 200


def test_rejection_supersession_duplicates_and_immutable_history(staging):
    client, root = staging
    key = upload(client).json()["sha256"]
    source_route = "/api/desk/three-statement-v2/staging/source-review"
    approved = inspected_source(key)
    first = client.post(source_route, headers=auth(), json=approved)
    assert first.status_code == 200
    assert client.post(source_route, headers=auth(), json=approved).status_code == 409
    rejected = client.post(source_route, headers=auth(), json={**approved,
        "decision": "reject", "note": "Source contents conflict with the claimed fiscal year."})
    assert rejected.status_code == 200
    assert rejected.json()["previous_hash"] == first.json()["event_hash"]
    field = field_payload(key, "filing.csv · CSV row 1")
    assert client.post("/api/desk/three-statement-v2/staging/field-review",
                       headers=auth(), json=field).status_code == 422
    assert client.post(source_route, headers=auth(), json=approved).status_code == 200
    history_result = client.get("/api/desk/three-statement-v2/staging/history", headers=auth()).json()
    assert history_result["hash_chain_verified"]
    history = history_result["events"]
    assert [event["decision"] for event in history] == ["approve", "reject", "approve"]
    db = sqlite3.connect(root / "evidence-staging.sqlite")
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        db.execute("UPDATE review_events SET decision='reject' WHERE seq=1")
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        db.execute("DELETE FROM review_events WHERE seq=1")
    db.close()
