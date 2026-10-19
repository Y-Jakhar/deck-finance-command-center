"""Opt-in, isolated evidence staging. Never writes ResearchDesk's production database."""

from __future__ import annotations

from datetime import UTC, datetime
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import getpass
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from financial_import import candidates as extract_candidates
from three_statement_v2 import Convention, Evidence, HistoricalCase, SCHEDULES, digest, reconcile_history


MAX_FILE_BYTES = 4_500_000  # Below the parent app's five-megabyte request guard.
router = APIRouter(prefix="/api/desk/three-statement-v2/staging", tags=["v2-evidence-staging"])


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Decision(Strict):
    decision: Literal["approve", "reject"]
    note: str = Field(min_length=12, max_length=2000)


class SourceDecision(Decision):
    document_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    original_inspected: bool = False
    issuer_or_auditor_origin_checked: bool = False


class FieldDecision(Decision):
    field: str = Field(min_length=3, max_length=120)
    evidence: Evidence
    document_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    candidate_reference: str | None = None
    value_index: int = Field(default=0, ge=0, le=6)
    source_units: Literal["ones", "thousands", "millions", "billions"] | None = None
    source_currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    source_period_end: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    statement_section: Literal["income", "balance", "cash_flow", "note"] | None = None


class ConventionDecision(Decision):
    period_end: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    schedule: Literal["income", "cash_flow", "debt", "equity", "lease", "ppe"]
    convention: Convention


def _root() -> Path:
    supplied = os.getenv("RESEARCHDESK_EVIDENCE_STAGING_ROOT", "").strip()
    token_hash = os.getenv("RESEARCHDESK_EVIDENCE_TOKEN_SHA256", "").strip().lower()
    if not supplied or not re.fullmatch(r"[a-f0-9]{64}", token_hash):
        raise HTTPException(503, "Isolated evidence staging is not configured")
    root = Path(supplied).resolve()
    production = Path(__file__).resolve().parent / "data"
    if root == production.resolve() or production.resolve() in root.parents:
        raise HTTPException(503, "Evidence staging must be outside the production data directory")
    return root


def _reviewer(authorization: str | None = Header(default=None)) -> str:
    _root()  # Fail closed when staging is disabled.
    expected = os.environ["RESEARCHDESK_EVIDENCE_TOKEN_SHA256"].strip().lower()
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Reviewer token required", headers={"WWW-Authenticate": "Bearer"})
    supplied = authorization[7:]
    if len(supplied) < 32 or not hmac.compare_digest(sha256(supplied.encode()).hexdigest(), expected):
        raise HTTPException(401, "Invalid reviewer token", headers={"WWW-Authenticate": "Bearer"})
    # Identity comes from server configuration/OS, never a browser-supplied reviewer field.
    return os.getenv("RESEARCHDESK_EVIDENCE_REVIEWER_ID", "").strip() or getpass.getuser()


@contextmanager
def _connect():
    root = _root()
    root.mkdir(parents=True, exist_ok=True)
    (root / "files").mkdir(exist_ok=True)
    db = sqlite3.connect(root / "evidence-staging.sqlite", timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS documents (
            sha256 TEXT PRIMARY KEY, filename TEXT NOT NULL, format TEXT NOT NULL,
            size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL, extraction TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS review_events (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
            target_kind TEXT NOT NULL CHECK(target_kind IN ('source','field','convention')),
            target_key TEXT NOT NULL, subject_hash TEXT NOT NULL,
            decision TEXT NOT NULL CHECK(decision IN ('approve','reject')),
            reviewer TEXT NOT NULL, created_at TEXT NOT NULL, note TEXT NOT NULL,
            checks TEXT NOT NULL, previous_hash TEXT NOT NULL, event_hash TEXT NOT NULL UNIQUE
        );
        CREATE TRIGGER IF NOT EXISTS review_events_no_update BEFORE UPDATE ON review_events
            BEGIN SELECT RAISE(ABORT, 'staging review history is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS review_events_no_delete BEFORE DELETE ON review_events
            BEGIN SELECT RAISE(ABORT, 'staging review history is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS documents_no_update BEFORE UPDATE ON documents
            BEGIN SELECT RAISE(ABORT, 'staged document identity is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS documents_no_delete BEFORE DELETE ON documents
            BEGIN SELECT RAISE(ABORT, 'staged document identity is immutable'); END;
    """)
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def _document(db: sqlite3.Connection, key: str) -> tuple[sqlite3.Row, bytes]:
    row = db.execute("SELECT * FROM documents WHERE sha256=?", (key,)).fetchone()
    if row is None:
        raise HTTPException(404, "Staged document not found")
    path = _root() / "files" / key
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise HTTPException(409, "Staged source bytes are missing") from exc
    if not hmac.compare_digest(sha256(data).hexdigest(), key):
        raise HTTPException(409, "Staged source bytes no longer match the recorded hash")
    return row, data


def _latest(db: sqlite3.Connection, kind: str, key: str) -> sqlite3.Row | None:
    return db.execute("SELECT * FROM review_events WHERE target_kind=? AND target_key=? "
                      "ORDER BY seq DESC LIMIT 1", (kind, key)).fetchone()


def _append(db: sqlite3.Connection, *, kind: str, key: str, subject_hash: str,
            decision: str, reviewer: str, note: str, checks: dict) -> dict:
    db.execute("BEGIN IMMEDIATE")
    try:
        current = _latest(db, kind, key)
        if current and current["subject_hash"] == subject_hash and current["decision"] == decision:
            raise HTTPException(409, "Duplicate decision; reject or change the evidence before reviewing again")
        previous = db.execute("SELECT event_hash FROM review_events ORDER BY seq DESC LIMIT 1").fetchone()
        record = {"event_id": str(uuid4()), "target_kind": kind, "target_key": key,
                  "subject_hash": subject_hash, "decision": decision, "reviewer": reviewer,
                  "created_at": datetime.now(UTC).isoformat(), "note": note,
                  "checks": checks, "previous_hash": previous[0] if previous else "0" * 64}
        event_hash = digest(record)
        db.execute("INSERT INTO review_events (event_id,target_kind,target_key,subject_hash,decision,"
                   "reviewer,created_at,note,checks,previous_hash,event_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                   (record["event_id"], kind, key, subject_hash, decision, reviewer,
                    record["created_at"], note, json.dumps(checks, sort_keys=True),
                    record["previous_hash"], event_hash))
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return {**record, "event_hash": event_hash}


def _number(raw: str) -> Decimal | None:
    cleaned = raw.strip().replace(",", "").replace("$", "")
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = "-" + cleaned[1:-1]
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


@router.get("/identity")
def identity(reviewer: str = Depends(_reviewer)):
    return {"reviewer": reviewer, "mode": "isolated-single-reviewer", "production_acceptance": False}


@router.post("/documents")
async def upload_document(file: UploadFile = File(...),
                          claimed_sha256: str | None = Header(default=None, alias="X-Document-SHA256"),
                          reviewer: str = Depends(_reviewer)):
    filename = Path(file.filename or "unnamed").name
    if Path(filename).suffix.lower() not in {".csv", ".xlsx", ".pdf"}:
        raise HTTPException(422, "CSV, XLSX, or text-readable PDF required")
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, "Staged file exceeds 4.5 MB")
    actual = sha256(data).hexdigest()
    if claimed_sha256 is not None and not hmac.compare_digest(actual, claimed_sha256.lower()):
        raise HTTPException(422, "Uploaded bytes do not match the claimed SHA-256")
    try:
        extracted = extract_candidates(data, filename)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    with _connect() as db:
        path = _root() / "files" / actual
        existing = db.execute("SELECT sha256 FROM documents WHERE sha256=?", (actual,)).fetchone()
        if existing:
            _document(db, actual)
        else:
            temporary = path.with_name(f".{uuid4().hex}.tmp")
            temporary.write_bytes(data)
            temporary.replace(path)
            db.execute("INSERT INTO documents VALUES (?,?,?,?,?,?)",
                       (actual, filename, Path(filename).suffix.lower().lstrip("."), len(data),
                        datetime.now(UTC).isoformat(), json.dumps(extracted)))
    return {"sha256": actual, "document": extracted, "byte_verified": True,
            "semantic_verified": False, "uploaded_by": reviewer}


@router.get("/documents/{document_sha256}")
def document_detail(document_sha256: str, reviewer: str = Depends(_reviewer)):
    with _connect() as db:
        row, _ = _document(db, document_sha256)
        event = _latest(db, "source", document_sha256)
        return {"sha256": row["sha256"], "filename": row["filename"],
                "format": row["format"], "size_bytes": row["size_bytes"],
                "extraction": json.loads(row["extraction"]),
                "source_review": dict(event) if event else None, "byte_verified": True}


@router.get("/documents/{document_sha256}/original")
def original_document(document_sha256: str, reviewer: str = Depends(_reviewer)):
    with _connect() as db:
        row, data = _document(db, document_sha256)
    suffix = row["format"]
    media = {"csv": "text/csv", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
             "pdf": "application/pdf"}[suffix]
    return Response(data, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="evidence-{document_sha256[:12]}.{suffix}"',
                             "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})


@router.post("/source-review")
def source_review(request: SourceDecision, reviewer: str = Depends(_reviewer)):
    with _connect() as db:
        row, _ = _document(db, request.document_sha256)
        extraction = json.loads(row["extraction"])
        if request.decision == "approve" and not extraction["candidates"]:
            raise HTTPException(422, "No inspectable disclosure lines were extracted")
        if request.decision == "approve" and not (request.original_inspected and
                                                   request.issuer_or_auditor_origin_checked):
            raise HTTPException(422, "Inspect the original and check its issuer/auditor origin before approval")
        return _append(db, kind="source", key=request.document_sha256,
                       subject_hash=request.document_sha256, decision=request.decision,
                       reviewer=reviewer, note=request.note,
                       checks={"bytes_sha256": "matched", "candidate_count": len(extraction["candidates"]),
                               "original_inspected": request.original_inspected,
                               "issuer_or_auditor_origin_checked": request.issuer_or_auditor_origin_checked,
                               "semantic_assessment": "reviewer attestation; no automated disclosure truth claim"})


def _field_key(field: str, evidence: Evidence) -> str:
    return f"{evidence.period_end}:{field}"


def _field_checks(db: sqlite3.Connection, request: FieldDecision) -> dict:
    evidence = request.evidence
    expected_section = request.field.split(".", 1)[0]
    if expected_section == "opening":
        expected_section = "balance" if request.field == "opening.balance_cash" else "cash_flow"
    if expected_section not in {"income", "balance", "cash_flow"}:
        expected_section = "note"
    checks = {"classification": request.statement_section == expected_section and
              evidence.scope == request.field,
              "period": request.source_period_end == evidence.period_end.isoformat(),
              "currency": request.source_currency == evidence.currency,
              "units": request.source_units is not None,
              "numeric_value": False, "source_identity": False}
    if evidence.state != "audited":
        checks.update({"classification": True, "period": True, "currency": True,
                       "units": True, "numeric_value": True, "source_identity": True})
        return checks
    if not request.document_sha256 or not request.candidate_reference or not request.source_units:
        return checks
    row, _ = _document(db, request.document_sha256)
    source = next((source for source in evidence.sources
                   if source.document_sha256 == request.document_sha256 and
                   source.locator == request.candidate_reference), None)
    checks["source_identity"] = source is not None
    candidate = next((item for item in json.loads(row["extraction"])["candidates"]
                      if item["reference"] == request.candidate_reference), None)
    if not candidate or request.value_index >= len(candidate["raw_values"]):
        return checks
    known_fields = {"revenue": "income.revenue", "cogs": "income.cost_of_sales",
                    "operating_expenses": "income.operating_expenses", "ebit": "income.ebit",
                    "taxes": "income.income_tax", "net_income": "income.net_income",
                    "cash_from_operations": "cash_flow.cfo",
                    "cash_from_investing": "cash_flow.cfi",
                    "cash_from_financing": "cash_flow.cff",
                    "net_change_cash": "cash_flow.net_change",
                    "total_assets": "balance.total_assets",
                    "receivables": "balance.receivables", "inventory": "balance.inventory",
                    "debt": "balance.borrowings", "payables": "balance.payables",
                    "shareholders_equity": "balance.equity", "fixed_assets": "balance.ppe",
                    "finance_lease_liabilities": "balance.finance_lease_liabilities",
                    "other_current_assets": "balance.other_current_assets",
                    "other_assets": "balance.other_assets",
                    "other_current_liabilities": "balance.other_current_liabilities",
                    "other_liabilities": "balance.other_liabilities",
                    "total_liabilities_equity": "balance.total_liabilities_equity"}
    suggested = known_fields.get(candidate["suggested_key"])
    if suggested and suggested != request.field:
        checks["classification"] = False
    if candidate["suggested_key"] == "cash" and request.field not in {
            "opening.balance_cash", "opening.cash_flow_cash", "balance.cash", "cash_flow.end_cash"}:
        checks["classification"] = False
    raw = _number(candidate["raw_values"][request.value_index])
    if raw is None or not isinstance(evidence.value, Decimal):
        return checks
    scale = {"ones": Decimal("0.000001"), "thousands": Decimal("0.001"),
             "millions": Decimal(1), "billions": Decimal(1000)}[request.source_units]
    checks["numeric_value"] = (raw * scale == evidence.value and
                               source is not None and source.reported_value == evidence.value)
    return checks


@router.post("/field-review")
def field_review(request: FieldDecision, reviewer: str = Depends(_reviewer)):
    with _connect() as db:
        checks = _field_checks(db, request)
        if request.decision == "approve":
            if request.evidence.state == "audited":
                source = _latest(db, "source", request.document_sha256 or "")
                if not source or source["decision"] != "approve":
                    raise HTTPException(422, "Source verification must be approved first")
            if not all(checks.values()):
                raise HTTPException(422, {"source_discrepancies": checks})
        key = _field_key(request.field, request.evidence)
        return _append(db, kind="field", key=key, subject_hash=digest(request.evidence),
                       decision=request.decision, reviewer=reviewer, note=request.note, checks=checks)


@router.post("/convention-review")
def convention_review(request: ConventionDecision, reviewer: str = Depends(_reviewer)):
    if request.decision == "approve" and not request.convention.review.rationale.strip():
        raise HTTPException(422, "Accounting convention needs a rationale")
    key = f"{request.period_end}:{request.schedule}"
    with _connect() as db:
        return _append(db, kind="convention", key=key,
                       subject_hash=digest(request.convention), decision=request.decision,
                       reviewer=reviewer, note=request.note,
                       checks={"mode": request.convention.mode, "scope": request.convention.scope})


@router.get("/history")
def review_history(reviewer: str = Depends(_reviewer)):
    with _connect() as db:
        previous = "0" * 64
        for row in db.execute("SELECT * FROM review_events ORDER BY seq"):
            record = {"event_id": row["event_id"], "target_kind": row["target_kind"],
                      "target_key": row["target_key"], "subject_hash": row["subject_hash"],
                      "decision": row["decision"], "reviewer": row["reviewer"],
                      "created_at": row["created_at"], "note": row["note"],
                      "checks": json.loads(row["checks"]), "previous_hash": row["previous_hash"]}
            if row["previous_hash"] != previous or row["event_hash"] != digest(record):
                raise HTTPException(409, "Isolated review history hash chain failed integrity check")
            previous = row["event_hash"]
        rows = db.execute("SELECT * FROM review_events ORDER BY seq DESC LIMIT 300").fetchall()
        return {"events": [dict(row) for row in rows], "reviewer": reviewer,
                "hash_chain_verified": True}


@router.post("/readiness")
def historical_readiness(case: HistoricalCase, reviewer: str = Depends(_reviewer)):
    reconciliation = reconcile_history(case)
    missing_sources: list[str] = []
    missing_fields: list[str] = []
    missing_conventions: list[str] = []
    evidence_rows = [(f"{case.opening_cash.period_end}:opening.balance_cash", case.opening_cash.balance_cash),
                     (f"{case.opening_cash.period_end}:opening.cash_flow_cash", case.opening_cash.cash_flow_cash)]
    for period in case.periods:
        evidence_rows.extend((f"{period.period_end}:{field}", item)
                             for field, item in period.fields.items())
    with _connect() as db:
        for key, item in evidence_rows:
            event = _latest(db, "field", key)
            if not event or event["decision"] != "approve" or event["subject_hash"] != digest(item):
                missing_fields.append(key)
            for source in item.sources:
                if not source.document_sha256:
                    missing_sources.append(f"{key}:unstaged-source")
                    continue
                try:
                    _document(db, source.document_sha256)
                except HTTPException:
                    missing_sources.append(f"{key}:bytes-mismatch")
                    continue
                source_event = _latest(db, "source", source.document_sha256)
                if not source_event or source_event["decision"] != "approve":
                    missing_sources.append(f"{key}:source-unreviewed")
        for period in case.periods:
            for schedule in SCHEDULES:
                convention = period.conventions.get(schedule)
                key = f"{period.period_end}:{schedule}"
                event = _latest(db, "convention", key)
                if not convention or not event or event["decision"] != "approve" or event["subject_hash"] != digest(convention):
                    missing_conventions.append(key)
    source_ready = not missing_sources
    field_ready = not missing_fields
    convention_ready = not missing_conventions
    historical_ready = (source_ready and field_ready and convention_ready and
                        reconciliation["status"] == "accepted")
    return {"source_verified": source_ready, "field_mapping_reviewed": field_ready,
            "accounting_convention_approved": convention_ready,
            "historical_ready_for_acceptance": historical_ready,
            "valuation_ready_for_review": False,
            "missing_sources": missing_sources, "missing_fields": missing_fields,
            "missing_conventions": missing_conventions,
            "accounting_issues": reconciliation["issues"],
            "candidate_history_hash": reconciliation["history_hash"],
            "persistent": False}
