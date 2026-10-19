"""Transparent ratios from reviewed statement rows; missing inputs stay missing."""

from __future__ import annotations

from typing import Any


def analyze_statements(statement: dict[str, Any]) -> dict[str, Any]:
    income = statement["income_statement"]
    balance = statement["balance_sheet"]
    cash_flow = statement["cash_flow"]

    def value(rows: dict, key: str, year: int) -> float | None:
        pair = rows.get(key)
        return float(pair[year]) if pair is not None and pair[year] is not None else None

    def divide(top: float | None, bottom: float | None) -> float | None:
        return top / bottom if top is not None and bottom is not None and bottom > 0 else None

    periods = []
    for year in (0, 1):
        revenue = value(income, "revenue", year)
        ebitda = value(income, "ebitda", year)
        ebit = value(income, "ebit", year)
        net_income = value(income, "net_income", year)
        cash = value(balance, "cash", year)
        debt = value(balance, "debt", year)
        inventory = value(balance, "inventory", year)
        current_assets = value(balance, "current_assets", year)
        current_liabilities = value(balance, "current_liabilities", year)
        equity = value(balance, "shareholders_equity", year)
        interest = value(income, "interest", year)
        cfo = value(cash_flow, "cash_from_operations", year)
        capex = value(cash_flow, "capex", year)
        metrics = {
            "gross_margin": divide(value(income, "gross_profit", year), revenue),
            "ebitda_margin": divide(ebitda, revenue),
            "ebit_margin": divide(ebit, revenue),
            "net_margin": divide(net_income, revenue),
            "roe_end_equity": divide(net_income, equity),
            "current_ratio": divide(current_assets, current_liabilities),
            "quick_ratio": divide(current_assets - inventory if current_assets is not None and inventory is not None else None, current_liabilities),
            "debt_to_equity": divide(debt, equity),
            "net_debt_to_ebitda": divide(debt - cash if debt is not None and cash is not None else None, ebitda),
            "interest_coverage": divide(ebit, interest),
            "free_cash_flow": cfo - capex if cfo is not None and capex is not None and capex >= 0 else None,
            "cash_conversion": divide(cfo, net_income),
            "roic": None,
        }
        periods.append(metrics)

    growth = {
        f"{key}_growth": divide(value(income, key, 1), value(income, key, 0)) - 1
        if value(income, key, 0) is not None and value(income, key, 0) > 0 and value(income, key, 1) is not None else None
        for key in ("revenue", "ebitda", "net_income")
    }
    discrepancies = []
    for year, period in enumerate((statement["prior_period_end"], statement["period_end"])):
        assets = value(balance, "total_assets", year)
        liabilities = value(balance, "total_liabilities", year)
        equity = value(balance, "shareholders_equity", year)
        if None not in (assets, liabilities, equity):
            difference = assets - liabilities - equity
            if abs(difference) > max(1, abs(assets) * 0.01):
                discrepancies.append({"period": period, "identity": "assets = liabilities + equity", "difference": difference})
        revenue = value(income, "revenue", year)
        cogs = value(income, "cogs", year)
        gross = value(income, "gross_profit", year)
        if None not in (revenue, cogs, gross):
            difference = revenue - cogs - gross
            if abs(difference) > max(1, abs(revenue) * 0.01):
                discrepancies.append({"period": period, "identity": "gross profit = revenue - COGS", "difference": difference})
    return {
        "periods": {statement["prior_period_end"]: periods[0], statement["period_end"]: periods[1]},
        "growth": growth,
        "discrepancies": discrepancies,
        "currency": statement["currency"],
        "units": statement["units"],
        "source": statement["source"],
        "methodology": "Ratios use each period's reported ending balances; no interpolation. CapEx is positive spending. ROIC is unavailable until invested capital, tax and lease conventions are reviewed. Missing or zero-denominator inputs return null; no balancing plug is inserted.",
    }
