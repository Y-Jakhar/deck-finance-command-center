"""Create and verify an online SQLite backup before a schema change."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path


def backup_database(source: Path, destination: Path) -> dict:
    if not source.is_file():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise FileExistsError(destination)
    with sqlite3.connect(source) as live, sqlite3.connect(destination) as backup:
        live.backup(backup)
        if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Backup failed integrity check")
        version = backup.execute("PRAGMA user_version").fetchone()[0]
        tables = {
            row[0]: backup.execute(f'SELECT COUNT(*) FROM "{row[0]}"').fetchone()[0]
            for row in backup.execute("SELECT name FROM sqlite_master WHERE type='table'")
            if row[0] in {"valuations", "statements", "journal", "datasets", "experiments", "portfolios"}
        }
    receipt = {
        "source": str(source), "backup": str(destination), "created_at": datetime.now(UTC).isoformat(),
        "schema_version": version, "tables": tables,
        "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
    }
    destination.with_suffix(".json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    return receipt


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: backup_research_db.py SOURCE DESTINATION")
    print(json.dumps(backup_database(Path(sys.argv[1]), Path(sys.argv[2])), indent=2))
