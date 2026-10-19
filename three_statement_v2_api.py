"""Non-persistent opt-in review API. Deliberately has no freeze or migration route."""

from fastapi import APIRouter, HTTPException

from three_statement_v2 import (ForecastPackage, HistoricalCase, forecast_preview,
                                reconcile_history, valuation_freeze_gate, valuation_readiness)

router = APIRouter(prefix="/api/desk/three-statement-v2", tags=["three-statement-v2"])


@router.post("/historical/reconcile")
def historical_reconcile(case: HistoricalCase):
    return reconcile_history(case)


@router.post("/historical/accept")
def historical_accept(case: HistoricalCase):
    result = reconcile_history(case)
    if result["status"] != "accepted":
        raise HTTPException(422, result)
    return {"status": "accepted", "history_hash": result["history_hash"],
            "field_hashes": result["field_hashes"], "calculation_version": result["calculation_version"],
            "persistent": False, "valuation_authorized": False}


@router.post("/valuation/readiness")
def valuation_gate(package: ForecastPackage):
    return valuation_readiness(package)


@router.post("/forecast/preview")
def forecast_calculate(package: ForecastPackage):
    try:
        return forecast_preview(package)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/valuation/freeze-check")
def valuation_freeze_check(package: ForecastPackage):
    return valuation_freeze_gate(package)
