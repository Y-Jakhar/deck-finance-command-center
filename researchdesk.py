"""Local ResearchDesk adapter. Original calculation engines remain untouched."""

from __future__ import annotations

import csv
import importlib.util
import io
import json
import math
import os
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from statistics import stdev
from typing import Literal

from finance_adapters import technical_snapshot, volatility_snapshot
from portfolio_analytics import analyze_portfolio

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware
from financial_import import candidates as financial_candidates
from financial_analysis import analyze_statements
from backup_research_db import backup_database
from versioned_valuation import VersionedCaseRequest, calculate_case, canonical_hash, CALCULATION_VERSION
from versioned_workbook import build_versioned_workbook
from three_statement import (
    CALCULATION_VERSION as THREE_STATEMENT_VERSION,
    ThreeStatementRequest,
    calculate as calculate_three_statement,
    reconcile as reconcile_three_statement,
    INCOME as THREE_INCOME,
    BALANCE as THREE_BALANCE,
    CASH_FLOW as THREE_CASH_FLOW,
)
from three_statement_workbook import build_three_statement_workbook
from three_statement_v2_storage import migrate_schema_v7
from strategy_import import MAX_UPLOAD as STRATEGY_IMPORT_MAX, preview as strategy_import_preview, normalize as strategy_import_normalize

THREE_FIELD_ALIASES = {"cost_of_sales": "cogs", "interest_expense": "interest",
                       "income_tax": "taxes", "ppe": "fixed_assets",
                       "borrowings": "debt", "equity": "shareholders_equity",
                       "cash_capex": "capex"}

ROOT = Path(__file__).resolve().parent
PROJECTS = Path(os.getenv("RESEARCHDESK_PROJECTS", str(ROOT / "external-projects")))
DATA = Path(os.getenv("RESEARCHDESK_DATA", str(ROOT / "data")))
DATA.mkdir(parents=True, exist_ok=True)
os.environ["GO_TERMINAL_DB_PATH"] = str(DATA / "market.db")
os.environ["GO_TERMINAL_EXPORT_ROOT"] = str(DATA / "market-exports")
os.environ["GO_TERMINAL_FRONTEND_DIST"] = str(ROOT / "frontend" / "dist")
os.environ["STRATEGYLAB_RUNS"] = str(DATA / "runs")
INTEGRATIONS = {name: "unavailable" for name in ("market", "valuation_v1", "strategy_lab")}
market_path = PROJECTS / "Go-Terminal" / "backend"
strategy_path = PROJECTS / "StrategyLab"
deal_path = PROJECTS / "DealLens" / "backend" / "app"
for directory in (market_path, strategy_path):
    if directory.is_dir():
        sys.path.insert(0, str(directory))

if deal_path.joinpath("__init__.py").is_file():
    try:
        # DealLens uses relative imports; isolate it from Go-Terminal's `app`.
        spec = importlib.util.spec_from_file_location(
            "researchdesk_deal", deal_path / "__init__.py",
            submodule_search_locations=[str(deal_path)],
        )
        if spec is None or spec.loader is None:
            raise ImportError("DealLens package cannot be loaded")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        from researchdesk_deal.exports import build_excel, build_pdf
        from researchdesk_deal.models import CompanyInput
        from researchdesk_deal.sec import prefill_from_sec
        from researchdesk_deal.valuation import analyze
        INTEGRATIONS["valuation_v1"] = "available"
    except Exception:  # An optional checkout must not make the standalone shell fail to boot.
        INTEGRATIONS["valuation_v1"] = "failed to initialize"

if INTEGRATIONS["valuation_v1"] != "available":
    # Request-shape placeholder only; no alternative DealLens calculation.
    CompanyInput = dict[str, object]

if market_path.is_dir():
    try:
        from app.main import create_app
        INTEGRATIONS["market"] = "available"
    except Exception:  # Report a broken optional integration without replacing its engine.
        INTEGRATIONS["market"] = "failed to initialize"

if strategy_path.is_dir():
    try:
        from strategylab.app import normalize_run
        from strategylab.core import ResearchError, run_research, validate_csv
        from strategylab.storage import RunStore
        from strategylab.strategies import REGISTRY
        import research_strategies  # noqa: F401 - register the reviewed rule
        INTEGRATIONS["strategy_lab"] = "available"
    except Exception:  # No fallback strategy calculation is permitted.
        INTEGRATIONS["strategy_lab"] = "failed to initialize"

if INTEGRATIONS["strategy_lab"] == "available":
    STORE = RunStore(DATA / "runs")
else:
    STORE = None
    REGISTRY = {}

    class ResearchError(Exception):
        """Placeholder exception type for the optional route handlers."""

    def validate_csv(*args, **kwargs):
        raise HTTPException(503, "StrategyLab unavailable; OHLCV validation and simulations require the optional engine")


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


@contextmanager
def connect():
    db = sqlite3.connect(DATA / "research.db", timeout=20)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def migrate():
    with connect() as db:
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version > 7:
            raise RuntimeError("Database version is newer than this application")
        if version == 0:
            db.executescript("""
            BEGIN;
            CREATE TABLE valuations(id TEXT PRIMARY KEY, symbol TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE datasets(id TEXT PRIMARY KEY, symbol TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE experiments(id TEXT PRIMARY KEY, symbol TEXT NOT NULL,
                dataset_id TEXT NOT NULL REFERENCES datasets(id), payload TEXT NOT NULL);
            CREATE TABLE journal(id TEXT PRIMARY KEY, symbol TEXT NOT NULL, status TEXT NOT NULL,
                version INTEGER NOT NULL, payload TEXT NOT NULL,
                valuation_id TEXT REFERENCES valuations(id), experiment_id TEXT REFERENCES experiments(id));
            CREATE TABLE revisions(entry_id TEXT NOT NULL REFERENCES journal(id), version INTEGER NOT NULL,
                payload TEXT NOT NULL, PRIMARY KEY(entry_id,version));
            PRAGMA user_version=1;
            COMMIT;
            """)
        if version <= 1:
            backup = sqlite3.connect(DATA / f"research-pre-v2-{uuid.uuid4().hex[:8]}.db")
            db.backup(backup)
            if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Migration backup integrity check failed")
            backup.close()
            db.executescript("""
            BEGIN;
            CREATE TABLE statements(id TEXT PRIMARY KEY, symbol TEXT NOT NULL, payload TEXT NOT NULL);
            PRAGMA user_version=2;
            COMMIT;
            """)
        if version <= 2:
            backup = sqlite3.connect(DATA / f"research-pre-v3-{uuid.uuid4().hex[:8]}.db")
            db.backup(backup)
            if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Migration backup integrity check failed")
            backup.close()
            db.executescript("""
            BEGIN;
            CREATE TABLE watchlists(id TEXT PRIMARY KEY, symbol TEXT NOT NULL, payload TEXT NOT NULL);
            PRAGMA user_version=3;
            COMMIT;
            """)
        if version <= 3:
            backup = sqlite3.connect(DATA / f"research-pre-v4-{uuid.uuid4().hex[:8]}.db")
            db.backup(backup)
            if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError("Migration backup integrity check failed")
            backup.close()
            db.executescript("""
            BEGIN;
            CREATE TABLE portfolios(id TEXT PRIMARY KEY, symbol TEXT NOT NULL, payload TEXT NOT NULL);
            ALTER TABLE journal ADD COLUMN portfolio_id TEXT REFERENCES portfolios(id);
            PRAGMA user_version=4;
            COMMIT;
            """)
        if version <= 4:
            backup_database(DATA / "research.db", DATA / "backups" / f"research-pre-v5-{uuid.uuid4().hex[:8]}.db")
            db.executescript("""
            BEGIN;
            CREATE TABLE valuation_cases_v2(
                id TEXT PRIMARY KEY, symbol TEXT NOT NULL, model_version TEXT NOT NULL,
                case_revision INTEGER NOT NULL, parent_case_id TEXT REFERENCES valuation_cases_v2(id),
                created_at TEXT NOT NULL, input_hash TEXT NOT NULL, result_hash TEXT NOT NULL,
                payload TEXT NOT NULL);
            CREATE INDEX valuation_cases_v2_symbol_created ON valuation_cases_v2(symbol,created_at);
            CREATE TRIGGER valuation_cases_v2_no_update BEFORE UPDATE ON valuation_cases_v2
                BEGIN SELECT RAISE(ABORT,'Versioned valuation snapshots are immutable'); END;
            CREATE TRIGGER valuation_cases_v2_no_delete BEFORE DELETE ON valuation_cases_v2
                BEGIN SELECT RAISE(ABORT,'Versioned valuation snapshots are immutable'); END;
            PRAGMA user_version=5;
            COMMIT;
            """)
        if version <= 5:
            backup_database(DATA / "research.db", DATA / "backups" / f"research-pre-v6-{uuid.uuid4().hex[:8]}.db")
            db.executescript("""
            BEGIN;
            CREATE TABLE three_statement_cases_v1(
                id TEXT PRIMARY KEY, symbol TEXT NOT NULL, model_version TEXT NOT NULL,
                case_revision INTEGER NOT NULL,
                parent_case_id TEXT REFERENCES three_statement_cases_v1(id),
                created_at TEXT NOT NULL, input_hash TEXT NOT NULL,
                result_hash TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE INDEX three_statement_cases_v1_symbol_created
                ON three_statement_cases_v1(symbol,created_at);
            CREATE TRIGGER three_statement_cases_v1_no_update
                BEFORE UPDATE ON three_statement_cases_v1
                BEGIN SELECT RAISE(ABORT,'Three-statement snapshots are immutable'); END;
            CREATE TRIGGER three_statement_cases_v1_no_delete
                BEFORE DELETE ON three_statement_cases_v1
                BEGIN SELECT RAISE(ABORT,'Three-statement snapshots are immutable'); END;
            PRAGMA user_version=6;
            COMMIT;
            """)
        if version <= 6:
            backup_database(DATA / "research.db", DATA / "backups" /
                            f"research-pre-v7-{uuid.uuid4().hex[:8]}.db")
            migrate_schema_v7(db)


migrate()
if INTEGRATIONS["market"] == "available":
    app = create_app()
else:
    from standalone_market import create_standalone_app
    app = create_standalone_app(ROOT / "frontend" / "dist")
# Insert new API routes before the existing SPA catch-all.
spa_route = app.router.routes.pop()
router = APIRouter(prefix="/api/desk")
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])


def require_integration(name: str):
    if INTEGRATIONS[name] != "available":
        raise HTTPException(503, f"{name.replace('_', ' ')} integration unavailable; configure an authorized optional engine")


@app.middleware("http")
async def local_write_guard(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        if origin and origin not in {
            "http://127.0.0.1:8010",
            "http://localhost:8010",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
        }:
            return Response("Untrusted origin", status_code=403)
        try:
            length = int(request.headers.get("content-length", "0") or 0)
        except ValueError:
            return Response("Invalid Content-Length", status_code=400)
        if length > 5_000_000:
            return Response("Request exceeds 5 MB", status_code=413)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
    response.headers['X-Frame-Options'] = 'DENY'
    return response


def now():
    return datetime.now(UTC).isoformat()


def insert_record(table, symbol, payload, **columns):
    record_id = uuid.uuid4().hex
    payload = dict(payload, id=record_id, symbol=symbol.upper(), created_at=now())
    names = ["id", "symbol", "payload", *columns]
    values = [record_id, symbol.upper(), encode(payload), *columns.values()]
    with connect() as db:
        db.execute(
            f"INSERT INTO {table} ({','.join(names)}) VALUES ({','.join('?' for _ in names)})",
            values,
        )
    return payload


def record(table, record_id):
    with connect() as db:
        row = db.execute(f"SELECT payload FROM {table} WHERE id=?", (record_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Saved record not found")
    return json.loads(row[0])


def listing(table, symbol=None):
    with connect() as db:
        rows = db.execute(
            f"SELECT payload FROM {table} WHERE (? IS NULL OR symbol=?) ORDER BY rowid DESC",
            (symbol, symbol),
        ).fetchall()
    return [json.loads(row[0]) for row in rows]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class WatchlistRequest(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    instrument_ids: list[str] = Field(default_factory=list, max_length=500)


def watchlist_payload(body: WatchlistRequest, request: Request):
    require_integration("market")
    service = request.app.state.market_data_service
    try:
        instruments = [
            service.get_instrument(key).model_dump(by_alias=True)
            for key in dict.fromkeys(body.instrument_ids)
        ]
    except Exception as exc:
        raise HTTPException(422, "Watchlist contains an unregistered instrument") from exc
    return {
        "name": body.name,
        "instrument_ids": list(dict.fromkeys(body.instrument_ids)),
        "instruments": instruments,
    }


@router.get("/watchlists")
def watchlists():
    return listing("watchlists")


@router.post("/watchlists")
def new_watchlist(body: WatchlistRequest, request: Request):
    return insert_record("watchlists", "WATCHLIST", watchlist_payload(body, request))


@router.put("/watchlists/{record_id}")
def edit_watchlist(record_id: str, body: WatchlistRequest, request: Request):
    old = record("watchlists", record_id)
    saved = {**old, **watchlist_payload(body, request), "updated_at": now()}
    with connect() as db:
        db.execute("UPDATE watchlists SET payload=? WHERE id=?", (encode(saved), record_id))
    return saved


@router.delete("/watchlists/{record_id}")
def delete_watchlist(record_id: str):
    record("watchlists", record_id)
    with connect() as db:
        db.execute("DELETE FROM watchlists WHERE id=?", (record_id,))
    return {"deleted": record_id}


class ValuationRequest(StrictModel):
    company: CompanyInput
    case: Literal["base", "bull", "bear"] = "base"
    assumptions_note: str = Field(min_length=1, max_length=10000)


class StatementRequest(StrictModel):
    symbol: str = Field(min_length=1, max_length=40)
    currency: str = Field(min_length=3, max_length=3)
    units: Literal["millions"] = "millions"
    source: str = Field(min_length=1, max_length=1000)
    period_end: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    prior_period_end: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    # Each reported row is [prior fiscal year, current fiscal year]; no inferred missing facts.
    income_statement: dict[str, tuple[float | None, float | None]]
    balance_sheet: dict[str, tuple[float | None, float | None]]
    cash_flow: dict[str, tuple[float | None, float | None]]
    notes: str = Field(min_length=1, max_length=5000)


@router.post("/statements")
def save_statements(body: StatementRequest):
    return insert_record("statements", body.symbol, body.model_dump())


@router.get("/statements")
def statements(symbol: str | None = None):
    return listing("statements", symbol.upper() if symbol else None)


@router.get("/statements/{record_id}/analysis")
def statement_analysis(record_id: str):
    return analyze_statements(record("statements", record_id))


@router.post("/financials/preview")
async def preview_financials(files: list[UploadFile] = File(...)):
    if not 1 <= len(files) <= 5:
        raise HTTPException(422, "Choose one to five financial files")
    documents = []
    for file in files:
        content = await file.read(10_000_001)
        try:
            documents.append(financial_candidates(content, file.filename or "unnamed"))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    return {"documents": documents}


@router.get("/health")
def health():
    with connect() as db:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        schema_version = db.execute("PRAGMA user_version").fetchone()[0]
    return {
        "status": integrity,
        "repositories": str(PROJECTS),
        "storage": str(DATA),
        "version": "0.3.0",
        "schema_version": schema_version,
        "mode": "local personal research" if INTEGRATIONS["market"] == "available" else "local standalone research",
        "integrations": INTEGRATIONS,
    }


@router.get("/integrations")
def integrations():
    return {"integrations": INTEGRATIONS, "standalone": INTEGRATIONS["market"] != "available"}


@router.get("/company/{symbol}")
async def company(symbol: str):
    require_integration("valuation_v1")
    import httpx

    try:
        return await prefill_from_sec(symbol)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            502, "SEC unavailable; import reviewed company JSON or enter sourced inputs"
        ) from exc


@router.post("/company/validate")
def validate_company(body: CompanyInput):
    require_integration("valuation_v1")
    try:
        encode(body.model_dump())
    except ValueError as exc:
        raise HTTPException(422, "Company inputs must be finite") from exc
    return body


@router.post("/valuations")
def valuation(body: ValuationRequest):
    require_integration("valuation_v1")
    # Existing models do not globally forbid NaN; enforce at adapter boundary.
    try:
        encode(body.company.model_dump())
        result = analyze(body.company).model_dump()
        encode(result)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(422, "Inputs and outputs must be finite") from exc
    c = body.company
    ev, eq = result["dcf"]["enterprise_value"], result["dcf"]["equity_value"]
    if not math.isclose(eq, ev + c.cash - c.debt, abs_tol=0.11):
        raise HTTPException(422, "Valuation bridge did not reconcile")
    return insert_record(
        "valuations",
        c.ticker or c.name,
        {
            "case": body.case,
            "assumptions_note": body.assumptions_note,
            "result": result,
        },
    )


@router.get("/valuations")
def valuations(symbol: str | None = None):
    return listing("valuations", symbol.upper() if symbol else None)


@router.get("/valuations/{record_id}/export/{format}")
def valuation_export(record_id: str, format: str):
    require_integration("valuation_v1")
    saved = record("valuations", record_id)
    result = analyze(CompanyInput.model_validate(saved["result"]["company"]))
    if result.model_dump() != saved["result"]:
        raise HTTPException(
            409,
            "Valuation engine output changed; use the retained journal JSON export or create a new case",
        )
    if format not in {"xlsx", "pdf"}:
        raise HTTPException(404, "Choose xlsx or pdf")
    builder, media = (
        (
            build_excel,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        if format == "xlsx"
        else (build_pdf, "application/pdf")
    )
    return Response(
        builder(result).getvalue(),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="valuation-{record_id}.{format}"'},
    )


def _validate_case_sources(body: VersionedCaseRequest) -> None:
    fields = {
        "revenue": ("income_statement", "revenue"),
        "ebit": ("income_statement", "ebit"),
        "depreciation_amortization": ("cash_flow", "da"),
        "cash_capex": ("cash_flow", "capex"),
        "finance_lease_asset_additions": ("cash_flow", "finance_lease_asset_additions"),
        "change_nwc": ("cash_flow", "change_nwc"),
    }
    for year in body.history:
        if not year.statement_id:
            continue
        statement = record("statements", year.statement_id)
        if statement["symbol"] != body.symbol.upper() or statement["currency"] != body.currency or statement["units"] != body.units:
            raise HTTPException(422, "Linked statement symbol, currency or units differ from the case")
        if year.period_end.isoformat() not in (statement["prior_period_end"], statement["period_end"]):
            raise HTTPException(422, "Linked historical period is absent from its statement")
        index = 0 if year.period_end.isoformat() == statement["prior_period_end"] else 1
        for field, (group, key) in fields.items():
            observed = getattr(year, field)
            if observed is None:
                continue
            pair = statement[group].get(key)
            if pair is None and field == "depreciation_amortization":
                pair = statement["income_statement"].get("da")
            expected = pair[index] if pair is not None else None
            if expected is None or not math.isclose(observed, expected, rel_tol=1e-10, abs_tol=1e-8):
                raise HTTPException(422, f"{field} differs from linked reviewed statement; use a manual source reference for overrides")


@router.post("/valuation-cases-v2/preview")
def preview_versioned_valuation(body: VersionedCaseRequest):
    _validate_case_sources(body)
    try:
        return calculate_case(body)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/valuation-cases-v2")
def save_versioned_valuation(body: VersionedCaseRequest):
    _validate_case_sources(body)
    revision = 1
    if body.parent_case_id:
        parent = record("valuation_cases_v2", body.parent_case_id)
        if parent["symbol"] != body.symbol.upper():
            raise HTTPException(422, "Parent case belongs to a different instrument")
        revision = parent["case_revision"] + 1
    try:
        inputs = body.model_dump(mode="json")
        result = calculate_case(body)
        input_hash, result_hash = canonical_hash(inputs), canonical_hash(result)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(422, str(exc)) from exc
    case_id, created_at = uuid.uuid4().hex, now()
    snapshot = {
        "id": case_id, "symbol": body.symbol.upper(), "created_at": created_at,
        "model_version": body.model_version, "calculation_version": CALCULATION_VERSION,
        "case_revision": revision, "parent_case_id": body.parent_case_id,
        "input_hash": input_hash, "result_hash": result_hash,
        "inputs": inputs, "result": result,
    }
    with connect() as db:
        db.execute(
            "INSERT INTO valuation_cases_v2(id,symbol,model_version,case_revision,parent_case_id,created_at,input_hash,result_hash,payload) VALUES(?,?,?,?,?,?,?,?,?)",
            (case_id, body.symbol.upper(), body.model_version, revision, body.parent_case_id,
             created_at, input_hash, result_hash, encode(snapshot)),
        )
    return snapshot


@router.get("/valuation-cases-v2")
def versioned_valuations(symbol: str | None = None):
    return listing("valuation_cases_v2", symbol.upper() if symbol else None)


@router.get("/valuation-cases-v2/{record_id}")
def versioned_valuation(record_id: str):
    return record("valuation_cases_v2", record_id)


@router.get("/valuation-cases-v2/{record_id}/verify")
def verify_versioned_valuation(record_id: str):
    saved = record("valuation_cases_v2", record_id)
    with connect() as db:
        row = db.execute("SELECT input_hash,result_hash FROM valuation_cases_v2 WHERE id=?", (record_id,)).fetchone()
    if row is None or row[0] != saved["input_hash"] or row[1] != saved["result_hash"]:
        raise HTTPException(409, "Saved case metadata does not match the frozen snapshot")
    input_hash = canonical_hash(saved["inputs"])
    result_hash = canonical_hash(saved["result"])
    if input_hash != saved["input_hash"] or result_hash != saved["result_hash"]:
        raise HTTPException(409, "Saved case hash does not match the frozen snapshot")
    if saved["calculation_version"] != CALCULATION_VERSION:
        return {"snapshot_integrity": "verified", "recalculation": "unavailable: calculation version differs"}
    try:
        recomputed = calculate_case(VersionedCaseRequest.model_validate(saved["inputs"]))
    except (ValueError, OverflowError) as exc:
        raise HTTPException(409, "Current calculation cannot reproduce the frozen snapshot") from exc
    if canonical_hash(recomputed) != result_hash:
        raise HTTPException(409, "Current calculation differs from the frozen snapshot")
    return {"snapshot_integrity": "verified", "recalculation": "matched", "calculation_version": CALCULATION_VERSION}


@router.get("/valuation-cases-v2/{record_id}/export")
def export_versioned_valuation(record_id: str):
    saved = versioned_valuation(record_id)
    return Response(
        encode(saved), media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="valuation-case-v2-{record_id}.json"'},
    )


@router.get("/valuation-cases-v2/{record_id}/export/xlsx")
def export_versioned_valuation_xlsx(record_id: str):
    saved = versioned_valuation(record_id)
    verify_versioned_valuation(record_id)
    return Response(
        build_versioned_workbook(saved),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="valuation-case-v2-{record_id}.xlsx"'},
    )


class ThreeStatementNormalizeRequest(StrictModel):
    symbol: str = Field(min_length=1, max_length=40)
    statement_ids: list[str] = Field(min_length=1, max_length=10)


@router.post("/three-statement-cases/normalize")
def normalize_three_statement_sources(body: ThreeStatementNormalizeRequest):
    """Combine reviewed two-period snapshots without filling missing accounting lines."""
    sources = [record("statements", item) for item in body.statement_ids]
    symbol = body.symbol.upper()
    currency = sources[0]["currency"]
    if any(item["symbol"] != symbol or item["currency"] != currency
           or item["units"] != "millions" for item in sources):
        raise HTTPException(422, "Statement symbol, currency and units must match")
    periods: dict[str, dict] = {}
    conflicts = []
    mapping = {"income": ("income_statement", THREE_INCOME),
               "balance": ("balance_sheet", THREE_BALANCE),
               "cash_flow": ("cash_flow", THREE_CASH_FLOW)}
    for source in sources:
        for index, period in enumerate((source["prior_period_end"], source["period_end"])):
            row = periods.setdefault(period, {
                "period_end": period, "source_reference": "", "statement_id": None,
                "income": {}, "balance": {}, "cash_flow": {}, "source_ids": [],
            })
            if source["id"] not in row["source_ids"]:
                row["source_ids"].append(source["id"])
            for group, (statement_group, fields) in mapping.items():
                for field in fields:
                    pair = source[statement_group].get(field)
                    alias_pair = source[statement_group].get(THREE_FIELD_ALIASES[field]) if field in THREE_FIELD_ALIASES else None
                    if pair is not None and alias_pair is not None:
                        left, right = pair[index], alias_pair[index]
                        if left is not None and right is not None and not math.isclose(left, right, abs_tol=1e-8):
                            conflicts.append({"period": period, "group": group, "field": field,
                                              "source_id": source["id"], "existing": left,
                                              "incoming": right})
                    if pair is None or pair[index] is None:
                        pair = alias_pair
                    if pair is None and group == "cash_flow" and field == "da":
                        pair = source["income_statement"].get("da")
                    value = pair[index] if pair else None
                    if value is None:
                        continue
                    current = row[group].get(field)
                    if current is not None and not math.isclose(current, value, abs_tol=1e-8):
                        conflicts.append({"period": period, "group": group, "field": field,
                                          "source_id": source["id"], "existing": current,
                                          "incoming": value})
                    else:
                        row[group][field] = value
    history = []
    for period, row in sorted(periods.items()):
        row["source_reference"] = "; ".join(
            f"{item['id']}: {item['source']}" for item in sources if item["id"] in row["source_ids"]
        )[:1500]
        if len(row["source_ids"]) == 1:
            row["statement_id"] = row["source_ids"][0]
        row.pop("source_ids")
        for group, (_, fields) in mapping.items():
            row[group] = {field: row[group].get(field) for field in fields}
        history.append(row)
    missing = [{"period": row["period_end"], "group": group, "field": field}
               for row in history for group, (_, fields) in mapping.items()
               for field in fields if row[group][field] is None]
    return {"symbol": symbol, "currency": currency, "units": "millions",
            "history": history, "conflicts": conflicts, "missing": missing,
            "warning": "Candidate mappings require analyst review; no missing value was set to zero."}


def _three_statement_issues(body: ThreeStatementRequest) -> list[dict]:
    issues = reconcile_three_statement(body)
    for year in body.history:
        if not year.statement_id:
            continue
        statement = record("statements", year.statement_id)
        period = year.period_end.isoformat()
        if (statement["symbol"] != body.symbol.upper() or statement["currency"] != body.currency
                or statement["units"] != body.units
                or period not in (statement["prior_period_end"], statement["period_end"])):
            issues.append({"period": period, "code": "linked_source_identity_mismatch"})
            continue
        index = 0 if period == statement["prior_period_end"] else 1
        for group, source_group, fields in (("income", "income_statement", THREE_INCOME),
                                            ("balance", "balance_sheet", THREE_BALANCE),
                                            ("cash_flow", "cash_flow", THREE_CASH_FLOW)):
            for field in fields:
                pair = statement[source_group].get(field)
                alias_pair = statement[source_group].get(THREE_FIELD_ALIASES[field]) if field in THREE_FIELD_ALIASES else None
                if pair is not None and alias_pair is not None:
                    left, right = pair[index], alias_pair[index]
                    if left is not None and right is not None and not math.isclose(left, right, abs_tol=1e-8):
                        issues.append({"period": period, "code": f"source_alias_conflict:{group}.{field}",
                                       "observed": left, "expected": right})
                if pair is None or pair[index] is None:
                    pair = alias_pair
                if pair is None and field == "da":
                    pair = statement["income_statement"].get("da")
                expected = pair[index] if pair else None
                observed = getattr(year, group).get(field)
                if expected is not None and observed is not None and not math.isclose(
                    observed, expected, rel_tol=1e-9, abs_tol=1e-8
                ):
                    issues.append({"period": period, "code": f"source_mismatch:{group}.{field}",
                                   "observed": observed, "expected": expected})
    return issues


@router.post("/three-statement-cases/reconcile")
def reconcile_three_statement_case(body: ThreeStatementRequest):
    issues = _three_statement_issues(body)
    return {"status": "ready" if not issues else "blocked", "issues": issues}


@router.post("/three-statement-cases/preview")
def preview_three_statement_case(body: ThreeStatementRequest):
    issues = _three_statement_issues(body)
    if issues:
        raise HTTPException(422, {"message": "Historical inputs do not reconcile", "issues": issues})
    try:
        return calculate_three_statement(body)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/three-statement-cases")
def save_three_statement_case(body: ThreeStatementRequest):
    result = preview_three_statement_case(body)
    revision = 1
    if body.parent_case_id:
        parent = record("three_statement_cases_v1", body.parent_case_id)
        if parent["symbol"] != body.symbol.upper():
            raise HTTPException(422, "Parent case belongs to a different instrument")
        revision = parent["case_revision"] + 1
    inputs = body.model_dump(mode="json")
    case_id, created_at = uuid.uuid4().hex, now()
    snapshot = {"id": case_id, "symbol": body.symbol.upper(),
                "created_at": created_at, "model_version": body.model_version,
                "calculation_version": THREE_STATEMENT_VERSION,
                "case_revision": revision, "parent_case_id": body.parent_case_id,
                "input_hash": canonical_hash(inputs), "result_hash": canonical_hash(result),
                "inputs": inputs, "result": result}
    with connect() as db:
        db.execute("""INSERT INTO three_statement_cases_v1
            (id,symbol,model_version,case_revision,parent_case_id,created_at,input_hash,result_hash,payload)
            VALUES(?,?,?,?,?,?,?,?,?)""",
            (case_id, body.symbol.upper(), body.model_version, revision,
             body.parent_case_id, created_at, snapshot["input_hash"],
             snapshot["result_hash"], encode(snapshot)))
    return snapshot


@router.get("/three-statement-cases")
def three_statement_cases(symbol: str | None = None):
    return listing("three_statement_cases_v1", symbol.upper() if symbol else None)


@router.get("/three-statement-cases/{record_id}")
def three_statement_case(record_id: str):
    return record("three_statement_cases_v1", record_id)


@router.get("/three-statement-cases/{record_id}/verify")
def verify_three_statement_case(record_id: str):
    saved = three_statement_case(record_id)
    with connect() as db:
        metadata = db.execute("SELECT input_hash,result_hash FROM three_statement_cases_v1 WHERE id=?",
                              (record_id,)).fetchone()
    if (metadata is None or tuple(metadata) != (saved["input_hash"], saved["result_hash"])
            or canonical_hash(saved["inputs"]) != saved["input_hash"]
            or canonical_hash(saved["result"]) != saved["result_hash"]):
        raise HTTPException(409, "Frozen snapshot hash differs from stored inputs/results")
    if saved["calculation_version"] != THREE_STATEMENT_VERSION:
        return {"snapshot_integrity": "verified", "recalculation": "version unavailable"}
    body = ThreeStatementRequest.model_validate(saved["inputs"])
    if _three_statement_issues(body) or canonical_hash(calculate_three_statement(body)) != saved["result_hash"]:
        raise HTTPException(409, "Frozen case no longer reproduces")
    return {"snapshot_integrity": "verified", "recalculation": "matched"}


@router.get("/three-statement-cases/{record_id}/export")
def export_three_statement_case(record_id: str):
    verify_three_statement_case(record_id)
    return Response(encode(three_statement_case(record_id)), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="three-statement-{record_id}.json"'})


@router.get("/three-statement-cases/{record_id}/export/xlsx")
def export_three_statement_case_xlsx(record_id: str):
    verify_three_statement_case(record_id)
    saved = three_statement_case(record_id)
    return Response(build_three_statement_workbook(saved),
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="three-statement-{record_id}.xlsx"'})


class CorporateAction(StrictModel):
    effective_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    kind: Literal["split", "cash_dividend"]
    value: float = Field(gt=0, allow_inf_nan=False)
    source: str = Field(min_length=1, max_length=500)


class DatasetRequest(StrictModel):
    symbol: str = Field(min_length=1, max_length=40)
    csv_text: str = Field(min_length=1, max_length=3_000_000)
    source: str = Field(min_length=1, max_length=1000)
    exchange: str = Field(min_length=1, max_length=40)
    currency: str = Field(min_length=3, max_length=3)
    frequency: Literal["1d", "1h", "15m", "1w"]
    adjustment_policy: str = Field(min_length=1, max_length=500)
    timestamp_policy: str = Field(min_length=1, max_length=500)
    import_provenance: dict | None = None
    corporate_actions: list[CorporateAction] = Field(default_factory=list, max_length=1000)


@router.post("/datasets/import-preview")
async def preview_dataset_upload(file: UploadFile = File(...)):
    raw = await file.read(STRATEGY_IMPORT_MAX + 1)
    try:
        return strategy_import_preview(raw, file.filename or "upload.csv")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/datasets/import-normalize")
async def normalize_dataset_upload(file: UploadFile = File(...), mapping: str = Form(...)):
    raw = await file.read(STRATEGY_IMPORT_MAX + 1)
    try:
        selected = json.loads(mapping)
        if not isinstance(selected, dict):
            raise ValueError("Column mapping must be an object")
        csv_text, provenance = strategy_import_normalize(raw, file.filename or "upload.csv", selected)
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    report = validate_csv(csv_text.encode(), "normalized.csv").summary()
    return {"csv_text": csv_text, "import_provenance": provenance, "validation": report}


class DatasetPreviewRequest(StrictModel):
    csv_text: str = Field(min_length=1, max_length=3_000_000)
    filename: str = Field(default="import.csv", max_length=200)


@router.post("/datasets/validate")
def validate_dataset(body: DatasetPreviewRequest):
    return validate_csv(body.csv_text.encode("utf-8"), body.filename).summary()


@router.post("/datasets")
def dataset(body: DatasetRequest):
    parsed = validate_csv(body.csv_text.encode("utf-8"), "import.csv")
    if parsed.fatal:
        raise HTTPException(422, parsed.summary())
    if len(parsed.bars) > 10000:
        raise HTTPException(422, "First release supports at most 10,000 bars per dataset")
    start, end = parsed.bars[0].timestamp.date(), parsed.bars[-1].timestamp.date()
    seen_actions = set()
    for action in body.corporate_actions:
        try:
            effective_date = datetime.fromisoformat(action.effective_date).date()
        except ValueError as exc:
            raise HTTPException(422, "Corporate action has an invalid calendar date") from exc
        key = (effective_date, action.kind)
        if not start <= effective_date <= end or key in seen_actions:
            raise HTTPException(422, "Corporate actions must be within dataset dates and unique by date/type")
        seen_actions.add(key)
    return insert_record(
        "datasets",
        body.symbol,
        {
            **body.model_dump(),
            "identity": parsed.summary(),
            "availability": "Imported historical snapshot; not live data",
        },
    )


@router.get("/datasets")
def datasets(symbol: str | None = None):
    return listing("datasets", symbol.upper() if symbol else None)


@router.get("/datasets/{record_id}/statistics")
def price_statistics(
    record_id: str,
    annual_bars: int = Query(default=252, ge=1, le=100000),
    benchmark_id: str | None = None,
):
    saved = record("datasets", record_id)
    parsed = validate_csv(saved["csv_text"].encode(), "snapshot.csv")
    closes = [bar.close for bar in parsed.bars]
    returns = [right / left - 1 for left, right in zip(closes, closes[1:])]
    result = {
        "price_return": closes[-1] / closes[0] - 1,
        "annualized_price_volatility": stdev(returns) * math.sqrt(annual_bars)
        if len(returns) >= 2
        else None,
        "annual_bars": annual_bars,
        "definition": "Simple close-to-close returns; sample standard deviation × sqrt(analyst-declared bars/year). Excludes dividends unless reflected by source.",
        "source": saved["source"],
        "benchmark": None,
    }
    if benchmark_id:
        benchmark = record("datasets", benchmark_id)
        if (
            benchmark["currency"] != saved["currency"]
            or benchmark["frequency"] != saved["frequency"]
        ):
            raise HTTPException(
                422, "Benchmark must use the same currency and frequency; no implicit FX conversion"
            )
        other = validate_csv(benchmark["csv_text"].encode(), "benchmark.csv")
        # Exact UTC timestamps only; no forward-filling or artificial overlap.
        mapping = {bar.timestamp: bar.close for bar in other.bars}
        aligned = [
            (bar.timestamp.isoformat(), bar.close, mapping[bar.timestamp])
            for bar in parsed.bars
            if bar.timestamp in mapping
        ]
        if len(aligned) < 2:
            raise HTTPException(
                422, "At least two exactly aligned benchmark observations are required"
            )
        first, last = aligned[0], aligned[-1]
        result["benchmark"] = {
            "symbol": benchmark["symbol"],
            "source": benchmark["source"],
            "aligned_bars": len(aligned),
            "start": first[0],
            "end": last[0],
            "instrument_return": last[1] / first[1] - 1,
            "benchmark_return": last[2] / first[2] - 1,
            "alignment": "Exact UTC timestamps; no fill; independent price returns, no dividends added",
        }
    return result


@router.get("/datasets/{record_id}/buy-hold")
def dataset_buy_hold(record_id: str):
    saved = record("datasets", record_id)
    parsed = validate_csv(saved["csv_text"].encode(), "snapshot.csv")
    if parsed.fatal or len(parsed.bars) < 2:
        raise HTTPException(422, "Saved data cannot support a price-only buy-and-hold comparison")
    return {"price_return": parsed.bars[-1].close / parsed.bars[0].close - 1,
            "start": parsed.bars[0].timestamp.isoformat(),
            "end": parsed.bars[-1].timestamp.isoformat(),
            "bars": len(parsed.bars), "dataset_hash": parsed.file_hash,
            "adjustment_policy": saved["adjustment_policy"],
            "corporate_actions": saved.get("corporate_actions", []),
            "definition": "First close to last close; no modeled transaction costs or dividend cash flows. Comparability depends on source price adjustment policy."}


@router.post("/datasets/from-market/{instrument_id}")
async def from_market(instrument_id: str, request: Request):
    require_integration("market")
    service = request.app.state.market_data_service
    try:
        instrument = service.get_instrument(instrument_id)
        series = await service.get_candles(instrument_id, "1d", None, None)
        stream = io.StringIO()
        writer = csv.writer(stream)
        writer.writerow(["timestamp", "open", "high", "low", "close", "volume"])
        for bar in series.candles:
            writer.writerow(
                [
                    bar.timestamp.isoformat(),
                    bar.open,
                    bar.high,
                    bar.low,
                    bar.close,
                    bar.volume,
                ]
            )
        return dataset(
            DatasetRequest(
                symbol=instrument.display_symbol,
                csv_text=stream.getvalue(),
                source=series.source,
                exchange=instrument.mic or "unspecified",
                currency=instrument.quote_currency,
                frequency="1d",
                adjustment_policy="; ".join(sorted({b.adjustment_status for b in series.candles}))
                or "unknown",
                timestamp_policy="Go-Terminal normalized provider timestamps",
            )
        )
    except (ValueError, KeyError, ResearchError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(
            503, "Market provider unavailable; import a sourced historical CSV"
        ) from exc


class ExperimentRequest(StrictModel):
    dataset_id: str
    strategy_name: str | None = None
    parameters: dict[str, float | int] | None = None
    mode: Literal["formal", "exploratory"] = "formal"
    long_only: bool = False
    fast: int = Field(default=10, ge=1, le=500)
    slow: int = Field(default=30, ge=2, le=1000)
    fee_bps: float = Field(default=5, ge=0, le=1000)
    slippage_bps: float = Field(default=5, ge=0, le=1000)
    fixed_fee: float = Field(default=0, ge=0)
    initial_capital: float = Field(default=100000, gt=0)
    is_ratio: float = Field(default=0.6, ge=0.3, le=0.8)
    walk_forward_windows: int = Field(default=3, ge=1, le=10)
    failure_contract: list[dict] = Field(min_length=1, max_length=20)


SUPPORTED_STRATEGIES = {
    "moving_average": "Trend",
    "sma_long_cash": "Trend",
    "donchian_breakout": "Breakout",
    "mean_reversion": "Mean reversion",
    "rsi_reversal": "Mean reversion",
    "rate_of_change": "Momentum",
    "macd_trend": "Trend",
    "keltner_breakout": "Breakout",
}


def strategy_minimum_bars(name: str, parameters: dict) -> int:
    if name in {"moving_average", "sma_long_cash"}:
        return int(parameters["slow"]) + 3
    if name == "macd_trend":
        return int(parameters["slow"]) + int(parameters["signal"]) + 3
    if name == "rsi_reversal":
        return int(parameters["period"]) + 4
    if name == "rate_of_change":
        return int(parameters["lookback"]) + 4
    return int(parameters.get("lookback", 20)) + 4


@router.get("/strategies")
def strategies(dataset_id: str | None = None):
    require_integration("strategy_lab")
    parsed = None
    if dataset_id:
        saved = record("datasets", dataset_id)
        parsed = validate_csv(saved["csv_text"].encode("utf-8"), "snapshot.csv")
    return [
        {
            "name": name,
            "family": family,
            "description": REGISTRY[name].description,
            "version": REGISTRY[name].version,
            "source_hash": REGISTRY[name].source_hash,
            "parameters": REGISTRY[name].parameters,
            "minimum_bars": strategy_minimum_bars(name, REGISTRY[name].parameters),
            "compatible": parsed is None or (not parsed.fatal and len(parsed.bars) >= strategy_minimum_bars(name, REGISTRY[name].parameters)),
            "reason": None if parsed is None or (not parsed.fatal and len(parsed.bars) >= strategy_minimum_bars(name, REGISTRY[name].parameters)) else (
                "Dataset has fatal OHLCV validation issues." if parsed.fatal else
                f"Needs at least {strategy_minimum_bars(name, REGISTRY[name].parameters)} valid bars; dataset has {len(parsed.bars)}."),
        }
        for name, family in SUPPORTED_STRATEGIES.items()
    ]


@router.post("/experiments")
def experiment(body: ExperimentRequest):
    require_integration("strategy_lab")
    if body.strategy_name is None and body.slow <= body.fast:
        raise HTTPException(422, "Slow window must exceed fast window")
    if body.strategy_name is not None and body.strategy_name not in SUPPORTED_STRATEGIES:
        raise HTTPException(422, "Choose a supported StrategyLab strategy")
    if body.strategy_name is not None and body.long_only and body.strategy_name != "sma_long_cash":
        raise HTTPException(422, "Long/cash is a distinct reviewed strategy")
    strategy_name = body.strategy_name or ("sma_long_cash" if body.long_only else "moving_average")
    parameters = body.parameters if body.parameters is not None else (
        {"fast": body.fast, "slow": body.slow} if body.strategy_name is None else dict(REGISTRY[strategy_name].parameters)
    )
    if set(parameters) != set(REGISTRY[strategy_name].parameters):
        raise HTTPException(422, "Strategy parameters must match the registered rule")
    data = record("datasets", body.dataset_id)
    payload = {
        **body.model_dump(),
        "csv_text": data["csv_text"],
        "filename": f"{data['symbol']}.csv",
        "strategy": strategy_name,
        "parameters": parameters,
        "costs": {
            k: getattr(body, k) for k in ("fee_bps", "slippage_bps", "fixed_fee", "initial_capital")
        },
    }
    try:
        config, parsed, strategy, costs = normalize_run(payload)
        if body.strategy_name is not None:
            minimum = strategy_minimum_bars(strategy_name, config["parameters"])
            if len(parsed.bars) < minimum:
                raise ValueError(
                    f"{strategy_name} needs at least {minimum} validated bars with these parameters; dataset has {len(parsed.bars)}"
                )
        result = run_research(
            parsed,
            strategy,
            config["parameters"],
            costs,
            config["failure_contract"],
            config["is_ratio"],
            config["walk_forward_windows"],
        )
        summary = STORE.create(config, result, parsed, strategy)
    except (ResearchError, ValueError, OverflowError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return insert_record(
        "experiments",
        data["symbol"],
        {
            "summary": summary,
            "config": config,
            "result": result,
            "provenance": {k: v for k, v in data.items() if k != "csv_text"},
        },
        dataset_id=body.dataset_id,
    )


@router.get("/experiments")
def experiments(symbol: str | None = None):
    return listing("experiments", symbol.upper() if symbol else None)


@router.get("/experiments/{record_id}/bundle")
def experiment_bundle(record_id: str):
    require_integration("strategy_lab")
    saved = record("experiments", record_id)
    return Response(
        STORE.bundle(saved["summary"]["run_id"]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="backtest-{record_id}.zip"'},
    )


class JournalRequest(StrictModel):
    symbol: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=200)
    category: Literal["fundamental", "strategy", "combined"] = "combined"
    status: Literal["draft", "active", "reviewed", "archived"] = "draft"
    thesis: str = Field(min_length=1, max_length=20000)
    evidence: str = Field(default="", max_length=20000)
    fundamentals: str = Field(default="", max_length=20000)
    price_action: str = Field(default="", max_length=10000)
    catalysts: str = Field(default="", max_length=10000)
    risks: str = Field(default="", max_length=10000)
    invalidation: str = Field(default="", max_length=10000)
    expectation: str = Field(default="", max_length=10000)
    outcome: str = Field(default="", max_length=10000)
    supported: Literal["pending", "yes", "no", "mixed"] = "pending"
    reasoning_errors: str = Field(default="", max_length=10000)
    lessons: str = Field(default="", max_length=10000)
    limitations: str = Field(default="", max_length=10000)
    valuation_id: str | None = None
    valuation_case_v2_id: str | None = None
    experiment_id: str | None = None
    portfolio_id: str | None = None
    version: int = Field(default=0, ge=0)


def save_journal(body, entry_id=None):
    symbol = body.symbol.upper()
    for table, link in (
        ("valuations", body.valuation_id),
        ("valuation_cases_v2", body.valuation_case_v2_id),
        ("experiments", body.experiment_id),
    ):
        if link and record(table, link)["symbol"] != symbol:
            raise HTTPException(422, "Linked research must use the same instrument")
    if body.portfolio_id:
        portfolio = record("portfolios", body.portfolio_id)
        if symbol not in {h["symbol"] for h in portfolio["result"]["holdings"]}:
            raise HTTPException(
                422, "Research instrument must be a holding in the linked portfolio"
            )
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        old_row = (
            db.execute("SELECT payload FROM journal WHERE id=?", (entry_id,)).fetchone()
            if entry_id
            else None
        )
        if entry_id and not old_row:
            raise HTTPException(404, "Journal entry not found")
        old = json.loads(old_row[0]) if old_row else None
        if (old and old["version"] != body.version) or (not old and body.version != 0):
            raise HTTPException(409, "Entry changed; reopen the latest version before saving")
        entry_id = entry_id or uuid.uuid4().hex
        saved = {
            **body.model_dump(),
            "id": entry_id,
            "symbol": symbol,
            "version": body.version + 1,
            "created_at": old["created_at"] if old else now(),
            "updated_at": now(),
        }
        if old:
            db.execute(
                "UPDATE journal SET symbol=?,status=?,version=?,payload=?,valuation_id=?,experiment_id=?,portfolio_id=? WHERE id=?",
                (
                    symbol,
                    body.status,
                    saved["version"],
                    encode(saved),
                    body.valuation_id,
                    body.experiment_id,
                    body.portfolio_id,
                    entry_id,
                ),
            )
        else:
            db.execute(
                "INSERT INTO journal (id,symbol,status,version,payload,valuation_id,experiment_id,portfolio_id) VALUES(?,?,?,?,?,?,?,?)",
                (
                    entry_id,
                    symbol,
                    body.status,
                    saved["version"],
                    encode(saved),
                    body.valuation_id,
                    body.experiment_id,
                    body.portfolio_id,
                ),
            )
        db.execute(
            "INSERT INTO revisions VALUES(?,?,?)",
            (entry_id, saved["version"], encode(saved)),
        )
    return saved


@router.post("/journal")
def create_entry(body: JournalRequest):
    return save_journal(body)


@router.put("/journal/{entry_id}")
def update_entry(entry_id: str, body: JournalRequest):
    return save_journal(body, entry_id)


@router.get("/journal")
def journal(
    q: str = Query(default="", max_length=200),
    status: str | None = None,
    symbol: str | None = None,
):
    return [
        row
        for row in listing("journal", symbol.upper() if symbol else None)
        if (not status or row["status"] == status) and q.casefold() in encode(row).casefold()
    ]


@router.get("/journal/{entry_id}/revisions")
def revisions(entry_id: str):
    record("journal", entry_id)
    with connect() as db:
        return [
            json.loads(row[0])
            for row in db.execute(
                "SELECT payload FROM revisions WHERE entry_id=? ORDER BY version",
                (entry_id,),
            )
        ]


@router.get("/journal/{entry_id}/export")
def journal_export(entry_id: str):
    current = record("journal", entry_id)
    payload = {
        "entry": current,
        "portfolio": record("portfolios", current["portfolio_id"])
        if current.get("portfolio_id")
        else None,
        "revisions": revisions(entry_id),
        "valuation": record("valuations", current["valuation_id"])
        if current["valuation_id"]
        else None,
        "experiment": record("experiments", current["experiment_id"])
        if current["experiment_id"]
        else None,
    }
    if current.get("valuation_case_v2_id"):
        payload["valuation_case_v2"] = record("valuation_cases_v2", current["valuation_case_v2_id"])
    return Response(
        encode(payload),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="research-{entry_id}.json"'},
    )


@router.get("/datasets/{record_id}/technicals")
def technicals(record_id: str, period: int = Query(default=14, ge=2, le=500)):
    saved = record("datasets", record_id)
    bars = validate_csv(saved["csv_text"].encode(), "snapshot.csv").bars
    try:
        return {
            **technical_snapshot(PROJECTS, bars, period),
            "dataset_id": record_id,
            "source": saved["source"],
        }
    except (FileNotFoundError, ImportError) as exc:
        raise HTTPException(503, str(exc)) from exc


class HoldingRequest(StrictModel):
    dataset_id: str
    weight: float = Field(gt=0, le=1)


class PortfolioRequest(StrictModel):
    symbol: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    notes: str = Field(min_length=1, max_length=10000)
    holdings: list[HoldingRequest] = Field(min_length=1, max_length=20)
    benchmark_id: str | None = None
    initial_capital: float = Field(default=100000, gt=0, le=1e12)
    annual_bars: int = Field(default=252, ge=1, le=100000)
    risk_free_rate: float = Field(default=0, gt=-1, le=1)
    valuation_case_v2_id: str | None = None
    experiment_id: str | None = None


def portfolio_dataset(record_id):
    saved = record("datasets", record_id)
    return {**saved, "bars": validate_csv(saved["csv_text"].encode(), "snapshot.csv").bars}


@router.post("/portfolios")
def save_portfolio(body: PortfolioRequest):
    holdings = [
        {"dataset": portfolio_dataset(h.dataset_id), "weight": h.weight} for h in body.holdings
    ]
    if body.symbol.upper() not in {h["dataset"]["symbol"] for h in holdings}:
        raise HTTPException(422, "Research instrument must be one of the holdings")
    evidence = {}
    if body.valuation_case_v2_id:
        case = record("valuation_cases_v2", body.valuation_case_v2_id)
        if case["symbol"] != body.symbol.upper():
            raise HTTPException(422, "Linked valuation must use the research instrument")
        verify_versioned_valuation(case["id"])
        evidence["valuation_case_v2"] = {
            "id": case["id"], "revision": case["case_revision"],
            "input_hash": case["input_hash"], "result_hash": case["result_hash"],
            "calculation_version": case["calculation_version"],
        }
    if body.experiment_id:
        experiment = record("experiments", body.experiment_id)
        if experiment["symbol"] != body.symbol.upper() or experiment["provenance"]["id"] not in {h.dataset_id for h in body.holdings}:
            raise HTTPException(422, "Linked experiment must use the research instrument and a held dataset")
        evidence["experiment"] = {
            "id": experiment["id"], "run_id": experiment["summary"]["run_id"],
            "dataset_id": experiment["provenance"]["id"],
            "strategy_hash": experiment["config"]["strategy_hash"],
            "data_file_hash": experiment["provenance"]["identity"]["file_hash"],
        }
    benchmark = portfolio_dataset(body.benchmark_id) if body.benchmark_id else None
    try:
        result = analyze_portfolio(
            holdings, benchmark, body.initial_capital, body.annual_bars, body.risk_free_rate
        )
        encode(result)
    except (ValueError, OverflowError, ZeroDivisionError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return insert_record(
        "portfolios",
        body.symbol,
        {
            "request": body.model_dump(),
            "result": result,
            "name": body.name,
            "notes": body.notes,
            "evidence": evidence,
            "provenance": [
                {k: v for k, v in h["dataset"].items() if k not in {"bars", "csv_text"}}
                for h in holdings
            ],
        },
    )


@router.get("/portfolios")
def portfolios(symbol: str | None = None):
    return [
        p
        for p in listing("portfolios")
        if not symbol or symbol.upper() in {h["symbol"] for h in p["result"]["holdings"]}
    ]


@router.get("/portfolios/{record_id}/export")
def portfolio_export(record_id: str):
    saved = record("portfolios", record_id)
    request = saved["request"]
    payload = saved
    if request.get("valuation_case_v2_id") or request.get("experiment_id"):
        payload = {
            "portfolio": saved,
            "valuation_case_v2": record("valuation_cases_v2", request["valuation_case_v2_id"])
            if request.get("valuation_case_v2_id") else None,
            "experiment": record("experiments", request["experiment_id"])
            if request.get("experiment_id") else None,
        }
    return Response(
        encode(payload),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="portfolio-{record_id}.json"'},
    )


@router.get("/volatility/{instrument}")
def volatility(
    instrument: Literal["EURUSD", "BTCUSD", "BANKNIFTY"],
    horizon: Literal["1", "5", "10", "22"] = "22",
):
    try:
        return volatility_snapshot(PROJECTS, instrument, horizon)
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    except (ValueError, KeyError) as exc:
        raise HTTPException(
            422, "Volatility Lens snapshot has an unsupported or invalid contract"
        ) from exc


app.include_router(router)
from three_statement_v2_api import router as three_statement_v2_router
from trusted_evidence_review import router as trusted_evidence_review_router

app.include_router(three_statement_v2_router)
app.include_router(trusted_evidence_review_router)
from copilot_api import make_router

app.include_router(make_router(sys.modules[__name__]))
if INTEGRATIONS["market"] != "available":
    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def unavailable_api(path: str):
        raise HTTPException(503, "Requested integration unavailable in standalone mode")
app.router.routes.append(spa_route)
