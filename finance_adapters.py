"""Read-only adapters for inspected finance projects; original source stays in place."""

import hashlib
import importlib.util
import json
from datetime import UTC, date, datetime


def technical_snapshot(projects, bars, period):
    # Reuse the existing causal EMA/ATR/stochastic definitions, not a second engine.
    path = projects / "Trading Strategy Research" / "src" / "trading_research" / "indicators.py"
    if not path.is_file():
        raise FileNotFoundError("Trading Strategy Research indicator module unavailable")
    import pandas as pd

    spec = importlib.util.spec_from_file_location("researchdesk_indicators", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    frame = pd.DataFrame(
        [
            {
                "timestamp": b.timestamp.isoformat(),
                "open": b.open,
                "high": b.high,
                "low": b.low,
                "close": b.close,
                "volume": b.volume,
            }
            for b in bars
        ]
    )
    k, d = module.stochastic(frame, period, 3)
    series = {
        "ema": module.ema(frame["close"], period),
        "atr": module.atr(frame, period),
        "stochastic_k": k,
        "stochastic_d": d,
        "sma": frame["close"].rolling(period, min_periods=period).mean(),
    }
    return {
        "period": period,
        "module_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "definition": "Existing Trading Strategy Research causal indicators: first-close-seeded EMA; Wilder-style EWM ATR; rolling stochastic %K / SMA(3) %D; SMA. Warm-up values are null.",
        "observations": [
            {
                "timestamp": b.timestamp.isoformat(),
                "close": b.close,
                **{
                    name: None if pd.isna(s.iloc[i]) else float(s.iloc[i])
                    for name, s in series.items()
                },
            }
            for i, b in enumerate(bars)
        ],
    }


def volatility_snapshot(projects, instrument, horizon):
    root = projects / "Volitility Forecaster"
    path = root / "public" / "data" / f"{instrument}-{horizon}.json"
    if instrument == "BANKNIFTY":
        path = root / "public" / "data" / "BANKNIFTY-status.json"
    if not path.is_file():
        raise FileNotFoundError(
            "Volatility Lens snapshot unavailable; generate it in the original project"
        )
    raw = path.read_bytes()
    result = json.loads(raw)
    if instrument == "BANKNIFTY":
        return {
            "result": result,
            "integration": {
                "usable_as_current": False,
                "reason": result["reason"],
                "snapshot_sha256": hashlib.sha256(raw).hexdigest(),
            },
        }
    if result.get("contract_version") != "1.0":
        raise ValueError("Unsupported Volatility Lens contract")
    checked = []
    for metadata in [result["provenance"]] + (
        [result["options"]["provenance"]] if result.get("options") else []
    ):
        filename = metadata.get("input_file", "").replace("\\", "/").split("/")[-1]
        source = root / "data" / filename
        checked.append(
            source.is_file()
            and hashlib.sha256(source.read_bytes()).hexdigest() == metadata["input_sha256"]
        )
    age = (
        datetime.now(UTC).date() - date.fromisoformat(result["data_freshness"]["as_of"][:10])
    ).days
    usable = all(checked) and 0 <= age <= 7 and result["evidence"]["status"] == "sufficient"
    return {
        "result": result,
        "integration": {
            "read_at": datetime.now(UTC).isoformat(),
            "age_calendar_days": age,
            "snapshot_sha256": hashlib.sha256(raw).hexdigest(),
            "input_hashes_match": all(checked),
            "usable_as_current": usable,
            "reason": "Current hash-matched research snapshot"
            if usable
            else "Historical snapshot only: stale, missing/mismatched input hash or insufficient original evidence. No live options signal.",
            "mode": "Read-only original engine output; no forecast regenerated and no original journal modified",
        },
    }
