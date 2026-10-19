"""Separate integrated three-statement model with explicit accounting gates."""

from __future__ import annotations

from datetime import date
import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CALCULATION_VERSION = "three-statement-v1.0"
YEARS = 5
INCOME = ("revenue", "cost_of_sales", "operating_expenses", "ebit", "interest_expense",
          "other_income", "income_tax", "net_income")
BALANCE = ("cash", "receivables", "inventory", "other_current_assets", "ppe",
           "other_assets", "payables", "other_current_liabilities", "borrowings",
           "finance_lease_liabilities", "other_liabilities", "equity", "total_assets",
           "total_liabilities_equity")
CASH_FLOW = ("net_income", "da", "change_nwc", "cash_capex",
             "finance_lease_asset_additions", "other_operating_cash_flow",
             "other_investing_cash_flow", "borrowings_net_flow",
             "finance_lease_principal_repayment", "dividends", "repurchases",
             "other_financing_cash_flow", "fx_cash_effect", "net_change_cash",
             "other_ppe_movement", "other_equity_movement",
             "other_borrowings_movement", "other_lease_movement")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Historical(Strict):
    period_end: date
    source_reference: str = Field(min_length=1, max_length=1500)
    statement_id: str | None = None
    income: dict[str, float | None]
    balance: dict[str, float | None]
    cash_flow: dict[str, float | None]


class ForecastDrivers(Strict):
    rationale: str = Field(min_length=1, max_length=3000)
    operating_source: str = Field(min_length=1, max_length=1500)
    financing_source: str = Field(min_length=1, max_length=1500)
    revenue_growth: list[float] = Field(min_length=YEARS, max_length=YEARS)
    cost_of_sales_percent_revenue: list[float] = Field(min_length=YEARS, max_length=YEARS)
    operating_expenses_percent_revenue: list[float] = Field(min_length=YEARS, max_length=YEARS)
    da_percent_revenue: list[float] = Field(min_length=YEARS, max_length=YEARS)
    cash_capex_percent_revenue: list[float] = Field(min_length=YEARS, max_length=YEARS)
    lease_additions_percent_revenue: list[float] = Field(min_length=YEARS, max_length=YEARS)
    receivables_percent_revenue: list[float] = Field(min_length=YEARS, max_length=YEARS)
    inventory_percent_cost_sales: list[float] = Field(min_length=YEARS, max_length=YEARS)
    other_current_assets_percent_revenue: list[float] = Field(min_length=YEARS, max_length=YEARS)
    payables_percent_cost_sales: list[float] = Field(min_length=YEARS, max_length=YEARS)
    other_current_liabilities_percent_revenue: list[float] = Field(min_length=YEARS, max_length=YEARS)
    debt_issuance: list[float] = Field(min_length=YEARS, max_length=YEARS)
    debt_repayment: list[float] = Field(min_length=YEARS, max_length=YEARS)
    lease_principal_repayment: list[float] = Field(min_length=YEARS, max_length=YEARS)
    dividends: list[float] = Field(min_length=YEARS, max_length=YEARS)
    repurchases: list[float] = Field(min_length=YEARS, max_length=YEARS)
    other_income: list[float] = Field(min_length=YEARS, max_length=YEARS)
    income_tax_rate: float = Field(ge=0, le=1)
    borrowings_interest_rate: float = Field(ge=0, le=1)
    lease_interest_rate: float = Field(ge=0, le=1)
    cost_of_equity: float = Field(gt=0, lt=1)
    pretax_cost_of_debt: float = Field(ge=0, lt=1)
    market_debt_weight: float = Field(ge=0, le=1)
    marginal_debt_tax_rate: float = Field(ge=0, le=1)
    terminal_growth: float = Field(ge=0, lt=1)

    @model_validator(mode="after")
    def validate_drivers(self):
        if any(x <= -1 for x in self.revenue_growth):
            raise ValueError("Revenue growth must exceed -100%")
        nonnegative = ("cost_of_sales_percent_revenue", "operating_expenses_percent_revenue",
                       "da_percent_revenue", "cash_capex_percent_revenue",
                       "lease_additions_percent_revenue", "receivables_percent_revenue",
                       "inventory_percent_cost_sales", "other_current_assets_percent_revenue",
                       "payables_percent_cost_sales", "other_current_liabilities_percent_revenue",
                       "debt_issuance", "debt_repayment", "lease_principal_repayment",
                       "dividends", "repurchases")
        if any(x < 0 for field in nonnegative for x in getattr(self, field)):
            raise ValueError("Investment, working-capital, financing and payout drivers must be nonnegative")
        if self.market_debt_weight > 0 and self.pretax_cost_of_debt == 0:
            raise ValueError("Debt weight requires a positive pretax cost of debt")
        return self


class Bridge(Strict):
    excess_cash: float = Field(ge=0)
    non_operating_assets: float = Field(ge=0)
    minority_interest: float = Field(ge=0)
    other_non_equity_claims: float = Field(ge=0)
    diluted_shares: float = Field(gt=0)
    source_reference: str = Field(min_length=1, max_length=1500)


class ThreeStatementRequest(Strict):
    model_version: Literal["1.0"] = "1.0"
    parent_case_id: str | None = None
    symbol: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=200)
    currency: str = Field(min_length=3, max_length=3)
    units: Literal["millions"] = "millions"
    valuation_date: date
    history: list[Historical] = Field(min_length=3, max_length=5)
    scenarios: dict[str, ForecastDrivers]
    bridge: Bridge
    notes: str = Field(min_length=1, max_length=10000)

    @model_validator(mode="after")
    def check_periods(self):
        periods = [item.period_end for item in self.history]
        if periods != sorted(set(periods)) or periods[-1] != self.valuation_date:
            raise ValueError("Use unique ascending fiscal ends; valuation date equals latest year")
        if any(not 350 <= (b - a).days <= 380 for a, b in zip(periods, periods[1:])):
            raise ValueError("Historical periods must be consecutive annual fiscal years")
        if set(self.scenarios) != {"bear", "base", "bull"}:
            raise ValueError("Enter independent bear, base and bull drivers")
        return self


def _nwc(balance: dict) -> float:
    return (balance["receivables"] + balance["inventory"]
            + balance["other_current_assets"] - balance["payables"]
            - balance["other_current_liabilities"])


def reconcile(body: ThreeStatementRequest) -> list[dict]:
    """Return auditable source/model issues; never create plugs for missing data."""
    issues = []

    def issue(period: str, code: str, observed=None, expected=None):
        issues.append({"period": period, "code": code, "observed": observed, "expected": expected})

    for i, row in enumerate(body.history):
        period = row.period_end.isoformat()
        for group_name, group, names in (("income", row.income, INCOME),
                                         ("balance", row.balance, BALANCE),
                                         ("cash_flow", row.cash_flow, CASH_FLOW)):
            for name in names:
                if group.get(name) is None:
                    issue(period, f"missing:{group_name}.{name}")
        for group_name, group, names in (("income", row.income,
                                         ("revenue", "cost_of_sales", "operating_expenses")),
                                         ("balance", row.balance,
                                          ("cash", "receivables", "inventory", "ppe",
                                           "borrowings", "finance_lease_liabilities")),
                                         ("cash_flow", row.cash_flow,
                                          ("da", "cash_capex", "finance_lease_asset_additions",
                                           "finance_lease_principal_repayment", "dividends",
                                           "repurchases"))):
            for name in names:
                value = group.get(name)
                if value is not None and (value < 0 or (group_name == "income" and name == "revenue" and value == 0)):
                    issue(period, f"invalid_sign:{group_name}.{name}", value, ">= 0")
        if any(row.income.get(k) is None for k in INCOME) or any(row.balance.get(k) is None for k in BALANCE) or any(row.cash_flow.get(k) is None for k in CASH_FLOW):
            continue
        inc, bal, cf = row.income, row.balance, row.cash_flow
        def tie(code, actual, expected):
            if not math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-5):
                issue(period, code, actual, expected)

        tie("ebit", inc["ebit"], inc["revenue"] - inc["cost_of_sales"] - inc["operating_expenses"])
        tie("net_income", inc["net_income"], inc["ebit"] - inc["interest_expense"]
            + inc["other_income"] - inc["income_tax"])
        assets = sum(bal[k] for k in ("cash", "receivables", "inventory",
                                      "other_current_assets", "ppe", "other_assets"))
        liabilities_equity = sum(bal[k] for k in ("payables", "other_current_liabilities",
                                                  "borrowings", "finance_lease_liabilities",
                                                  "other_liabilities", "equity"))
        tie("assets", bal["total_assets"], assets)
        tie("liabilities_equity", bal["total_liabilities_equity"], liabilities_equity)
        tie("balance_sheet", bal["total_assets"], bal["total_liabilities_equity"])
        tie("cash_flow_net_income", cf["net_income"], inc["net_income"])
        cash_change = (cf["net_income"] + cf["da"] - cf["change_nwc"]
                       + cf["other_operating_cash_flow"] - cf["cash_capex"]
                       + cf["other_investing_cash_flow"] + cf["borrowings_net_flow"]
                       - cf["finance_lease_principal_repayment"] - cf["dividends"]
                       - cf["repurchases"] + cf["other_financing_cash_flow"]
                       + cf["fx_cash_effect"])
        tie("cash_flow", cf["net_change_cash"], cash_change)
        if i:
            prev = body.history[i - 1]
            if all(prev.balance.get(k) is not None for k in BALANCE):
                tie("cash_roll", bal["cash"], prev.balance["cash"] + cf["net_change_cash"])
                tie("operating_nwc", cf["change_nwc"], _nwc(bal) - _nwc(prev.balance))
                tie("ppe_roll", bal["ppe"], prev.balance["ppe"] + cf["cash_capex"]
                    + cf["finance_lease_asset_additions"] - cf["da"]
                    + cf["other_ppe_movement"])
                tie("borrowings_roll", bal["borrowings"], prev.balance["borrowings"]
                    + cf["borrowings_net_flow"] + cf["other_borrowings_movement"])
                tie("lease_roll", bal["finance_lease_liabilities"],
                    prev.balance["finance_lease_liabilities"]
                    + cf["finance_lease_asset_additions"]
                    - cf["finance_lease_principal_repayment"] + cf["other_lease_movement"])
                tie("equity_roll", bal["equity"], prev.balance["equity"]
                    + inc["net_income"] - cf["dividends"] - cf["repurchases"]
                    + cf["other_equity_movement"])
    if body.bridge.excess_cash > (body.history[-1].balance.get("cash") or 0):
        issue(body.valuation_date.isoformat(), "excess_cash_above_reported_cash")
    return issues


def calculate(body: ThreeStatementRequest) -> dict:
    issues = reconcile(body)
    if issues:
        raise ValueError(f"Historical reconciliation failed: {issues[:8]}; {len(issues)} issue(s) total")
    base = body.history[-1].balance
    results = {}
    for name, d in body.scenarios.items():
        wacc = ((1 - d.market_debt_weight) * d.cost_of_equity
                + d.market_debt_weight * d.pretax_cost_of_debt
                * (1 - d.marginal_debt_tax_rate))
        if not d.terminal_growth < wacc < 1:
            raise ValueError(f"{name}: terminal growth must be below positive WACC")
        prior = dict(base)
        prior_revenue = body.history[-1].income["revenue"]
        prior_nwc = _nwc(prior)
        forecast = []
        for year in range(YEARS):
            revenue = prior_revenue * (1 + d.revenue_growth[year])
            cogs = revenue * d.cost_of_sales_percent_revenue[year]
            opex = revenue * d.operating_expenses_percent_revenue[year]
            ebit = revenue - cogs - opex
            da = revenue * d.da_percent_revenue[year]
            capex = revenue * d.cash_capex_percent_revenue[year]
            lease_additions = revenue * d.lease_additions_percent_revenue[year]
            interest = (prior["borrowings"] * d.borrowings_interest_rate
                        + prior["finance_lease_liabilities"] * d.lease_interest_rate)
            pretax = ebit - interest + d.other_income[year]
            tax = max(pretax, 0) * d.income_tax_rate
            net_income = pretax - tax
            inc = {"revenue": revenue, "cost_of_sales": cogs, "operating_expenses": opex,
                   "ebit": ebit, "interest_expense": interest,
                   "other_income": d.other_income[year], "income_tax": tax,
                   "net_income": net_income}
            bal = {
                "receivables": revenue * d.receivables_percent_revenue[year],
                "inventory": cogs * d.inventory_percent_cost_sales[year],
                "other_current_assets": revenue * d.other_current_assets_percent_revenue[year],
                "payables": cogs * d.payables_percent_cost_sales[year],
                "other_current_liabilities": revenue * d.other_current_liabilities_percent_revenue[year],
                "other_assets": prior["other_assets"], "other_liabilities": prior["other_liabilities"],
                "ppe": prior["ppe"] + capex + lease_additions - da,
                "borrowings": prior["borrowings"] + d.debt_issuance[year] - d.debt_repayment[year],
                "finance_lease_liabilities": prior["finance_lease_liabilities"]
                                             + lease_additions - d.lease_principal_repayment[year],
                "equity": prior["equity"] + net_income - d.dividends[year] - d.repurchases[year],
            }
            if bal["borrowings"] < -1e-8 or bal["finance_lease_liabilities"] < -1e-8 or bal["ppe"] < -1e-8:
                raise ValueError(f"{name} year {year + 1}: debt/lease/PP&E schedule turns negative")
            change_nwc = _nwc(bal) - prior_nwc
            cfo = net_income + da - change_nwc
            cfi = -capex
            cff = (d.debt_issuance[year] - d.debt_repayment[year]
                   - d.lease_principal_repayment[year] - d.dividends[year] - d.repurchases[year])
            bal["cash"] = prior["cash"] + cfo + cfi + cff
            if bal["cash"] < -1e-8:
                raise ValueError(f"{name} year {year + 1}: negative cash; finance the shortfall explicitly")
            bal["total_assets"] = sum(bal[k] for k in ("cash", "receivables", "inventory",
                                                     "other_current_assets", "ppe", "other_assets"))
            bal["total_liabilities_equity"] = sum(bal[k] for k in ("payables", "other_current_liabilities",
                                                                 "borrowings", "finance_lease_liabilities",
                                                                 "other_liabilities", "equity"))
            check = bal["total_assets"] - bal["total_liabilities_equity"]
            if not math.isclose(check, 0, rel_tol=0, abs_tol=1e-6):
                raise ValueError(f"{name} year {year + 1}: balance sheet does not balance ({check})")
            cf = {"net_income": net_income, "da": da, "change_nwc": change_nwc,
                  "cash_from_operations": cfo, "cash_capex": capex,
                  "finance_lease_asset_additions": lease_additions,
                  "cash_from_investing": cfi, "cash_from_financing": cff,
                  "net_change_cash": cfo + cfi + cff}
            fcff = ebit - max(ebit, 0) * d.income_tax_rate + da - capex - lease_additions - change_nwc
            forecast.append({"year": year + 1, "income": inc, "balance": bal,
                             "cash_flow": cf, "fcff": fcff,
                             "pv_fcff": fcff / (1 + wacc) ** (year + 1),
                             "balance_check": check})
            prior, prior_revenue, prior_nwc = bal, revenue, _nwc(bal)
        terminal_fcff = forecast[-1]["fcff"]
        if terminal_fcff <= 0:
            raise ValueError(f"{name}: terminal FCFF must be positive")
        terminal = terminal_fcff * (1 + d.terminal_growth) / (wacc - d.terminal_growth)
        pv_forecast = sum(item["pv_fcff"] for item in forecast)
        pv_terminal = terminal / (1 + wacc) ** YEARS
        ev = pv_forecast + pv_terminal
        equity = (ev + body.bridge.excess_cash + body.bridge.non_operating_assets
                  - base["borrowings"] - base["finance_lease_liabilities"]
                  - body.bridge.minority_interest - body.bridge.other_non_equity_claims)
        if not all(math.isfinite(x) for x in (terminal, ev, equity)):
            raise ValueError(f"{name}: non-finite valuation")
        sensitivity = []
        for rate in (wacc - .02, wacc - .01, wacc, wacc + .01, wacc + .02):
            values = []
            for growth in (d.terminal_growth - .01, d.terminal_growth - .005,
                           d.terminal_growth, d.terminal_growth + .005,
                           d.terminal_growth + .01):
                if growth >= rate or rate <= 0 or growth <= -1:
                    values.append(None)
                    continue
                varied_ev = sum(row["fcff"] / (1 + rate) ** row["year"] for row in forecast)
                varied_ev += terminal_fcff * (1 + growth) / (rate - growth) / (1 + rate) ** YEARS
                values.append((varied_ev + body.bridge.excess_cash + body.bridge.non_operating_assets
                               - base["borrowings"] - base["finance_lease_liabilities"]
                               - body.bridge.minority_interest - body.bridge.other_non_equity_claims)
                              / body.bridge.diluted_shares)
            sensitivity.append(values)
        results[name] = {"wacc": wacc, "forecast": forecast, "terminal_value": terminal,
                         "pv_forecast_fcff": pv_forecast, "pv_terminal_value": pv_terminal,
                         "enterprise_value": ev, "equity_value": equity,
                         "equity_value_per_share": equity / body.bridge.diluted_shares,
                         "sensitivity": sensitivity}
    return {"calculation_version": CALCULATION_VERSION, "historical_reconciliation": "passed",
            "historical_periods": [row.period_end.isoformat() for row in body.history],
            "lease_convention": "Operating leases remain expensed. Finance-lease asset additions increase PP&E and lease liabilities without cash; lease principal repayment is a financing cash outflow. FCFF deducts lease asset additions once.",
            "cash_convention": "Cash is a cash-flow result, never a balance-sheet plug. Negative cash blocks the case.",
            "scenarios": results}
