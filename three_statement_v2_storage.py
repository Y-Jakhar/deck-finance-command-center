"""Isolated optional v2 historical snapshot schema; never called by production startup."""

from __future__ import annotations

from datetime import UTC, datetime
from hashlib import sha256
import json
import sqlite3
from uuid import uuid4

from three_statement_v2 import HistoricalCase, reconcile_history


SCHEMA_STATEMENTS = (
    """CREATE TABLE three_statement_history_v2 (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES three_statement_history_v2(id),
        symbol TEXT NOT NULL,
        model_version TEXT NOT NULL CHECK(model_version = 'three-statement-v2.0'),
        created_at TEXT NOT NULL,
        content_hash TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        source_manifest TEXT NOT NULL
    )""",
    """CREATE INDEX three_statement_history_v2_symbol_created
        ON three_statement_history_v2(symbol, created_at)""",
    """CREATE TRIGGER three_statement_history_v2_no_update
        BEFORE UPDATE ON three_statement_history_v2
        BEGIN SELECT RAISE(ABORT, 'v2 historical snapshots are immutable'); END""",
    """CREATE TRIGGER three_statement_history_v2_no_delete
        BEFORE DELETE ON three_statement_history_v2
        BEGIN SELECT RAISE(ABORT, 'v2 historical snapshots are immutable'); END""",
    """CREATE TABLE three_statement_approvals_v2 (
        id TEXT PRIMARY KEY,
        history_id TEXT NOT NULL REFERENCES three_statement_history_v2(id),
        created_at TEXT NOT NULL,
        gate TEXT NOT NULL CHECK(gate IN ('historical', 'forecast_assumptions')),
        reviewer TEXT NOT NULL,
        approval_id TEXT NOT NULL,
        rationale TEXT NOT NULL
    )""",
    """CREATE TRIGGER three_statement_approvals_v2_no_update
        BEFORE UPDATE ON three_statement_approvals_v2
        BEGIN SELECT RAISE(ABORT, 'v2 approvals are immutable'); END""",
    """CREATE TRIGGER three_statement_approvals_v2_no_delete
        BEFORE DELETE ON three_statement_approvals_v2
        BEGIN SELECT RAISE(ABORT, 'v2 approvals are immutable'); END""",
)


def create_schema(db: sqlite3.Connection) -> None:
    """Execute the additive schema inside the caller's transaction; never commit implicitly."""
    for statement in SCHEMA_STATEMENTS:
        db.execute(statement)


def legacy_snapshot(db: sqlite3.Connection) -> dict[str, dict]:
    """Stable row-level fingerprint of every pre-v2 user table."""
    output = {}
    names = [row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' "
        "AND name NOT IN ('three_statement_history_v2','three_statement_approvals_v2') "
        "ORDER BY name")]
    for name in names:
        columns = [row[1] for row in db.execute(f'PRAGMA table_info("{name}")')]
        fingerprints = {label: sha256() for label in ("rows", "ids", "payloads")}
        count = 0
        for record in db.execute(f'SELECT * FROM "{name}" ORDER BY rowid'):
            values = dict(zip(columns, record))
            fingerprints["rows"].update(json.dumps(
                values, sort_keys=True, ensure_ascii=False, default=str,
                separators=(",", ":")).encode("utf-8") + b"\n")
            if "id" in values:
                fingerprints["ids"].update(str(values["id"]).encode("utf-8") + b"\n")
            if "payload" in values:
                fingerprints["payloads"].update(str(values["payload"]).encode("utf-8") + b"\n")
            count += 1
        output[name] = {"count": count, **{f"{key}_sha256": value.hexdigest()
                                           for key, value in fingerprints.items()}}
    return output


def migrate_schema_v7(db: sqlite3.Connection) -> dict:
    """Version-6 to version-7 DDL, atomically; caller must have a verified backup."""
    if db.in_transaction:
        raise RuntimeError("v7 migration requires a fresh connection without an open transaction")
    if db.execute("PRAGMA user_version").fetchone()[0] != 6:
        raise RuntimeError("v7 migration requires schema version 6")
    existing = {row[0] for row in db.execute("SELECT name FROM sqlite_master")}
    if existing & {"three_statement_history_v2", "three_statement_approvals_v2"}:
        raise RuntimeError("partial v2 schema already exists")
    db.execute("BEGIN EXCLUSIVE")
    try:
        before = legacy_snapshot(db)
        create_schema(db)
        db.execute("PRAGMA user_version=7")
        after = legacy_snapshot(db)
        if before != after:
            raise RuntimeError("legacy row counts/IDs/payloads/hashes changed during v7 migration")
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("v7 migration failed SQLite integrity check")
        if db.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("v7 migration failed SQLite foreign-key check")
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return {"before": before, "after": after, "version": 7}


def save_accepted_history(db: sqlite3.Connection, case: HistoricalCase,
                          *, reviewer: str, approval_id: str,
                          rationale: str, parent_id: str | None = None) -> dict:
    """Persist a reviewed historical snapshot only on an explicitly supplied database."""
    if not reviewer or not approval_id or not rationale:
        raise ValueError("independent historical reviewer, approval ID and rationale required")
    result = reconcile_history(case)
    if result["status"] != "accepted":
        raise ValueError(f"historical gate blocked: {result['issues'][:8]}")
    if parent_id is not None:
        parent = db.execute("SELECT symbol FROM three_statement_history_v2 WHERE id=?",
                            (parent_id,)).fetchone()
        if parent is None or parent[0] != case.symbol:
            raise ValueError("parent historical snapshot must exist for the same company")
    timestamp = datetime.now(UTC).isoformat()
    identifier = str(uuid4())
    approval_key = str(uuid4())
    with db:
        db.execute("""INSERT INTO three_statement_history_v2
            (id,parent_id,symbol,model_version,created_at,content_hash,payload,source_manifest)
            VALUES (?,?,?,?,?,?,?,?)""", (
                identifier, parent_id, case.symbol, result["calculation_version"],
                timestamp, result["history_hash"], case.model_dump_json(),
                json.dumps(result["source_lineage"], sort_keys=True)))
        db.execute("""INSERT INTO three_statement_approvals_v2
            (id,history_id,created_at,gate,reviewer,approval_id,rationale)
            VALUES (?,?,?,?,?,?,?)""", (
                approval_key, identifier, timestamp, "historical", reviewer, approval_id, rationale))
    return {"id": identifier, "content_hash": result["history_hash"],
            "approval_id": approval_key, "valuation_authorized": False}
