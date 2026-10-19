"""Independent, versioned FCFF valuation; no DealLens imports or model changes."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CALCULATION_VERSION = "fcff-v1.0"
YEARS = 5


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class HistoricalYear(Strict):
    period_end: date
    source_reference: str = Field(min_length=1, max_length=1000)
    statement_id: str | None = None
    revenue: float = Field(gt=0)
    ebit: float | None = None
    depreciation_amortization: float | None = Field(default=None, ge=0)
    cash_capex: float | None = Field(default=None, ge=0)
    finance_lease_asset_additions: float | None = Field(default=None, ge=0)
    change_nwc: float | None = None


class EquityBridge(Strict):
    excess_cash: float = Field(ge=0)
    non_operating_assets: float = Field(ge=0)
    borrowings: float = Field(ge=0)
    finance_lease_liabilities: float = Field(ge=0)
    minority_interest: float = Field(ge=0)
    other_non_equity_claims: float = Field(ge=0)
    diluted_shares: float = Field(gt=0)
    source_reference: str = Field(min_length=1, max_length=1000)


class Scenario(Strict):
    rationale: str = Field(min_length=1, max_length=3000)
    operating_assumptions_source: str = Field(min_length=1, max_length=1000)
    discount_source: str = Field(min_length=1, max_length=1000)
    revenue_growth: list[float] = Field(min_length=YEARS, max_length=YEARS)
    ebit_margin: list[float] = Field(min_length=YEARS, max_length=YEARS)
    da_percent_revenue: list[float] = Field(min_length=YEARS, max_length=YEARS)
    cash_capex_percent_revenue: list[float] = Field(min_length=YEARS, max_length=YEARS)
    finance_lease_additions_percent_revenue: list[float] = Field(min_length=YEARS, max_length=YEARS)
    nwc_investment_percent_revenue_change: list[float] = Field(min_length=YEARS, max_length=YEARS)
    operating_tax_rate: float = Field(ge=0, le=1)
    cost_of_equity: float = Field(ge=0)
    pretax_cost_of_debt: float = Field(ge=0)
    market_debt_weight: float = Field(ge=0, le=1)
    marginal_debt_tax_rate: float = Field(ge=0, le=1)
    terminal_method: Literal["perpetuity_growth", "exit_ebitda_multiple"]
    terminal_growth: float | None = None
    exit_ebitda_multiple: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_economics(self):
        if any(rate <= -1 for rate in self.revenue_growth):
            raise ValueError("Revenue growth must exceed -100% in every year")
        if any(rate < 0 for rate in self.da_percent_revenue + self.cash_capex_percent_revenue + self.finance_lease_additions_percent_revenue):
            raise ValueError("D&A and reinvestment ratios must be nonnegative")
        if self.market_debt_weight and self.pretax_cost_of_debt == 0:
            raise ValueError("Debt financing requires an explicit positive pre-tax cost of debt")
        if self.terminal_method == "perpetuity_growth":
            if self.terminal_growth is None or self.exit_ebitda_multiple is not None:
                raise ValueError("Specify terminal growth only for a perpetuity case")
            if self.terminal_growth <= -1:
                raise ValueError("Terminal growth must exceed -100%")
        elif self.exit_ebitda_multiple is None or self.terminal_growth is not None:
            raise ValueError("Specify the exit multiple only for an exit-multiple case")
        return self


class VersionedCaseRequest(Strict):
    model_version: Literal["1.0"] = "1.0"
    parent_case_id: str | None = None
    symbol: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=200)
    currency: str = Field(min_length=3, max_length=3)
    units: Literal["millions"] = "millions"
    valuation_date: date
    history: list[HistoricalYear] = Field(min_length=2, max_length=10)
    lease_treatment: Literal["operating_expensed_finance_capitalized"]
    bridge: EquityBridge
    scenarios: dict[str, Scenario]
    notes: str = Field(min_length=1, max_length=10000)

    @model_validator(mode="after")
    def validate_case(self):
        periods = [row.period_end for row in self.history]
        if periods != sorted(set(periods)):
            raise ValueError("Historical fiscal periods must be unique and ascending")
        if periods[-1] != self.valuation_date:
            raise ValueError("Valuation date must equal the latest historical fiscal end; stub-period bridging is unsupported")
        if set(self.scenarios) != {"bear", "base", "bull"}:
            raise ValueError("Enter independent bear, base and bull scenarios")
        return self


def _bridge(result_ev: float, bridge: EquityBridge) -> dict:
    equity_value = (
        result_ev + bridge.excess_cash + bridge.non_operating_assets
        - bridge.borrowings - bridge.finance_lease_liabilities
        - bridge.minority_interest - bridge.other_non_equity_claims
    )
    return {
        "enterprise_value": result_ev,
        "excess_cash": bridge.excess_cash,
        "non_operating_assets": bridge.non_operating_assets,
        "borrowings": bridge.borrowings,
        "finance_lease_liabilities": bridge.finance_lease_liabilities,
        "minority_interest": bridge.minority_interest,
        "other_non_equity_claims": bridge.other_non_equity_claims,
        "equity_value": equity_value,
        "diluted_shares": bridge.diluted_shares,
        "equity_value_per_share": equity_value / bridge.diluted_shares,
    }


def _terminal_value(method: str, final: dict, rate: float, terminal_parameter: float) -> float | None:
    if method == "perpetuity_growth":
        if terminal_parameter >= rate or final["fcff"] <= 0:
            return None
        return final["fcff"] * (1 + terminal_parameter) / (rate - terminal_parameter)
    if final["ebitda"] <= 0 or terminal_parameter <= 0:
        return None
    return final["ebitda"] * terminal_parameter


def calculate_case(body: VersionedCaseRequest) -> dict:
    result = {}
    initial_revenue = body.history[-1].revenue
    for name, assumption in body.scenarios.items():
        wacc = (
            (1 - assumption.market_debt_weight) * assumption.cost_of_equity
            + assumption.market_debt_weight * assumption.pretax_cost_of_debt
            * (1 - assumption.marginal_debt_tax_rate)
        )
        if not 0 < wacc < 1:
            raise ValueError(f"{name}: WACC must be between 0 and 100%")
        previous_revenue = initial_revenue
        forecast = []
        for i in range(YEARS):
            revenue = previous_revenue * (1 + assumption.revenue_growth[i])
            ebit = revenue * assumption.ebit_margin[i]
            da = revenue * assumption.da_percent_revenue[i]
            cash_taxes = max(ebit, 0) * assumption.operating_tax_rate
            cash_capex = revenue * assumption.cash_capex_percent_revenue[i]
            lease_additions = revenue * assumption.finance_lease_additions_percent_revenue[i]
            change_nwc = (revenue - previous_revenue) * assumption.nwc_investment_percent_revenue_change[i]
            fcff = ebit - cash_taxes + da - cash_capex - lease_additions - change_nwc
            discount_factor = (1 + wacc) ** (i + 1)
            forecast.append({
                "year": i + 1, "revenue": revenue, "ebit": ebit, "ebitda": ebit + da,
                "cash_taxes": cash_taxes, "da": da, "cash_capex": cash_capex,
                "finance_lease_asset_additions": lease_additions, "change_nwc": change_nwc,
                "fcff": fcff, "present_value_fcff": fcff / discount_factor,
            })
            previous_revenue = revenue
        parameter = assumption.terminal_growth if assumption.terminal_method == "perpetuity_growth" else assumption.exit_ebitda_multiple
        assert parameter is not None
        terminal = _terminal_value(assumption.terminal_method, forecast[-1], wacc, parameter)
        if terminal is None:
            raise ValueError(f"{name}: terminal assumptions do not produce a valid positive terminal value below WACC")
        pv_forecast = sum(row["present_value_fcff"] for row in forecast)
        pv_terminal = terminal / (1 + wacc) ** YEARS
        ev = pv_forecast + pv_terminal
        if not all(math.isfinite(value) for value in (pv_forecast, terminal, pv_terminal, ev)):
            raise ValueError(f"{name}: valuation overflow")
        rate_steps = [wacc + step for step in (-.02, -.01, 0, .01, .02)]
        parameter_steps = [parameter + step for step in (-.01, -.005, 0, .005, .01)] if assumption.terminal_method == "perpetuity_growth" else [parameter * factor for factor in (.8, .9, 1, 1.1, 1.2)]
        sensitivity = []
        for rate in rate_steps:
            row = []
            for selected_parameter in parameter_steps:
                tv = _terminal_value(assumption.terminal_method, forecast[-1], rate, selected_parameter) if rate > 0 else None
                if tv is None:
                    row.append(None)
                else:
                    pv = sum(item["fcff"] / (1 + rate) ** item["year"] for item in forecast)
                    value = _bridge(pv + tv / (1 + rate) ** YEARS, body.bridge)["equity_value_per_share"]
                    row.append(value if math.isfinite(value) else None)
            sensitivity.append(row)
        result[name] = {
            "wacc": wacc, "equity_weight": 1 - assumption.market_debt_weight,
            "debt_weight": assumption.market_debt_weight, "forecast": forecast,
            "terminal_method": assumption.terminal_method, "terminal_parameter": parameter,
            "terminal_value": terminal, "pv_forecast_fcff": pv_forecast,
            "pv_terminal_value": pv_terminal, "terminal_share_of_ev": pv_terminal / ev if ev > 0 else None,
            "bridge": _bridge(ev, body.bridge),
            "sensitivity": {"wacc": rate_steps, "terminal_parameter": parameter_steps, "equity_value_per_share": sensitivity},
        }
    return {
        "calculation_version": CALCULATION_VERSION,
        "historical_base_period": body.history[-1].period_end.isoformat(),
        "historical_base_revenue": initial_revenue,
        "discount_convention": "Five annual end-of-year periods; all cash flows and terminal value discounted from valuation date by 1/(1+WACC)^year.",
        "lease_convention": "Operating leases stay expensed in EBIT and their liabilities are excluded; finance-lease assets enter reinvestment, their depreciation enters D&A, and financing liabilities enter the equity bridge.",
        "tax_convention": "Cash operating taxes apply to positive forecast EBIT only; no NOL carryforward. A separate marginal tax rate discounts financing debt in WACC.",
        "scenarios": result,
    }


def canonical_hash(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
