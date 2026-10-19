"""Check a source-only candidate without printing possible secret values."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

FORBIDDEN_TOP_LEVEL = {"data", "cases", "exercise", "validation", "research-supplements"}
FORBIDDEN_PARTS = {"node_modules", "dist", ".venv", "__pycache__"}
TEXT_FLAGS = {
    "local_path": re.compile(r"(?i)(?:[A-Z]:[/\\](?:Users|Projects)|/" + r"home/[^/\s]+|/" + r"Users/[^/\s]+)"),
    "provider_key": re.compile(r"(?<![A-Za-z0-9_-])(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "email": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
}


def verify(root: Path) -> int:
    manifest_path = root / "PUBLIC_FILE_ALLOWLIST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}
    expected = set(manifest) | {"PUBLIC_FILE_ALLOWLIST.json"}
    errors: list[str] = []
    if actual != expected:
        errors.append(f"inventory mismatch: extra={len(actual - expected)}, missing={len(expected - actual)}")
    for rel, digest in manifest.items():
        path = root / rel
        parts = Path(rel).parts
        if parts[0] in FORBIDDEN_TOP_LEVEL or any(part in FORBIDDEN_PARTS for part in parts) or path.is_symlink():
            errors.append(f"forbidden path: {rel}")
        if not path.is_file():
            continue
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            errors.append(f"hash mismatch: {rel}")
        if path.suffix.lower() in {".db", ".sqlite", ".sqlite3", ".wal", ".shm", ".pdf", ".xlsx", ".csv", ".parquet", ".zip"}:
            errors.append(f"private/binary format: {rel}")
        if path.suffix.lower() in {".png", ".jpg", ".jpeg"}:
            continue  # Manually reviewed screenshots, never treated as content-scanned.
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeError:
            errors.append(f"unreadable text: {rel}")
            continue
        for line_number, line in enumerate(content.splitlines(), 1):
            for label, pattern in TEXT_FLAGS.items():
                if pattern.search(line):
                    errors.append(f"{label}: {rel}:{line_number}")
    print(f"MANIFEST {len(manifest)} files; ACTUAL {len(actual)} files")
    print(f"RESULT {'PASS' if not errors else 'REVIEW'} ({len(errors)} findings)")
    for item in errors:
        print(item)
    return 0 if not errors else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    raise SystemExit(verify(parser.parse_args().root.resolve()))
