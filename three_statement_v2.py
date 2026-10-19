"""Opt-in, evidence-aware three-statement v2. No persistence or v1 mutation."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from hashlib import sha256
import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from three_statement import Bridge, ForecastDrivers


VERSION = "three-statement-v2.0"
State = Literal["audited", "derived", "analyst_estimated", "not_applicable", "unavailable"]
Mode = Literal["reported_aggregate", "disaggregated"]
SCHEDULES = ("income", "cash_flow", "debt", "equity", "lease", "ppe")
BALANCE_PARTS = ("cash", "receivables", "inventory", "other_current_assets", "ppe",
                 "other_assets", "payables", "other_current_liabilities", "borrowings",
                 "finance_lease_liabilities", "other_liabilities", "equity")
REQUIRED = (
    "income.revenue", "income.cost_of_sales", "income.operating_expenses", "income.ebit",
    "income.net_other", "income.income_tax", "income.net_income",
    *(f"balance.{name}" for name in BALANCE_PARTS),
    "balance.total_assets", "balance.total_liabilities_equity",
    "cash_flow.cfo", "cash_flow.cfi", "cash_flow.cff", "cash_flow.fx_effect",
    "cash_flow.net_change", "cash_flow.end_cash", "cash_scope.difference",
)
FORECAST_FIELDS = tuple(name for name in ForecastDrivers.model_fields
                        if name not in {"rationale", "operating_source", "financing_source"})
BRIDGE_FIELDS = tuple(name for name in Bridge.model_fields if name != "source_reference")
RATIO_FIELDS = frozenset(name for name in FORECAST_FIELDS
                         if name in {"cost_of_equity", "pretax_cost_of_debt"} or any(
                             token in name for token in ("percent", "rate", "growth", "weight")))


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


def digest(value: BaseModel | dict) -> str:
    payload = value.model_dump(mode="json") if isinstance(value, BaseModel) else value
    return sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"),
                             ensure_ascii=False).encode("utf-8")).hexdigest()


class Review(Strict):
    reviewer: str = Field(min_length=1)
    approval_id: str = Field(min_length=1)
    reviewed_at: date
    rationale: str = Field(min_length=1)


class Source(Strict):
    document_id: str = Field(min_length=1)
    url: str = Field(min_length=1)
    locator: str = Field(min_length=1)
    reported_value: Decimal
    period_end: date
    currency: str = Field(min_length=3, max_length=3)
    units: Literal["millions", "ratio", "shares_millions"] = "millions"
    scope: str = Field(min_length=1)
    document_sha256: str | None = Field(default=None, pattern=r"^[a-fA-F0-9]{64}$")


class Formula(Strict):
    operation: Literal["add", "subtract"]
    operands: list[str] = Field(min_length=2)

    @model_validator(mode="after")
    def valid_arity(self):
        if self.operation == "subtract" and len(self.operands) != 2:
            raise ValueError("subtract requires exactly two operands")
        return self


class Evidence(Strict):
    state: State
    value: Decimal | list[Decimal] | None = None
    period_end: date
    currency: str = Field(min_length=3, max_length=3)
    units: Literal["millions", "ratio", "shares_millions"] = "millions"
    scope: str = Field(min_length=1)
    definition: str = Field(min_length=1)
    sources: list[Source] = Field(default_factory=list)
    formula: Formula | None = None
    review: Review | None = None
    reason: str | None = None
    component_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def state_shape(self):
        if self.state in {"not_applicable", "unavailable"}:
            if self.value is not None or not self.reason or self.sources or self.formula:
                raise ValueError("absent fields require a reason and cannot carry a value/source/formula")
        elif self.value is None:
            raise ValueError("observed/derived/estimated fields require a value")
        if self.state == "audited" and (not self.sources or self.formula):
            raise ValueError("audited value needs a source and cannot carry a formula")
        if self.state == "derived" and (self.formula is None or self.sources):
            raise ValueError("derived value needs a formula; lineage follows its operands")
        if self.state == "analyst_estimated" and (not self.review or not self.reason):
            raise ValueError("analyst estimate needs approval and rationale")
        if self.state == "analyst_estimated" and self.formula:
            raise ValueError("analyst estimate cannot claim a deterministic formula")
        if len(self.component_ids) != len(set(self.component_ids)):
            raise ValueError("duplicate component IDs within input")
        return self


class Convention(Strict):
    mode: Mode
    review: Review
    scope: str = Field(min_length=1)


class OpeningCash(Strict):
    period_end: date
    balance_cash: Evidence
    cash_flow_cash: Evidence


class HistoricalPeriod(Strict):
    period_start: date
    period_end: date
    fields: dict[str, Evidence]
    conventions: dict[str, Convention]


class HistoricalCase(Strict):
    version: Literal["2.0"] = "2.0"
    symbol: str = Field(min_length=1, max_length=40)
    currency: str = Field(min_length=3, max_length=3)
    opening_cash: OpeningCash
    periods: list[HistoricalPeriod] = Field(min_length=3, max_length=5)
    notes: str = Field(min_length=1)

    @model_validator(mode="after")
    def calendar(self):
        dates = [row.period_end for row in self.periods]
        if dates != sorted(set(dates)) or self.opening_cash.period_end >= dates[0]:
            raise ValueError("unique ascending annual periods with an earlier cash opening are required")
        if any(not 350 <= (right - left).days <= 380
               for left, right in zip([self.opening_cash.period_end, *dates], dates)):
            raise ValueError("periods must be consecutive annual fiscal years")
        if any(row.period_start > row.period_end for row in self.periods):
            raise ValueError("period start must precede the fiscal end")
        if any(row.period_start != previous + timedelta(days=1)
               for previous, row in zip([self.opening_cash.period_end, *dates], self.periods)):
            raise ValueError("fiscal periods must start immediately after prior fiscal end")
        return self


def _scalar(item: Evidence | None) -> Decimal | None:
    return item.value if item is not None and isinstance(item.value, Decimal) else None


def _close(actual: Decimal, expected: Decimal) -> bool:
    # Source statements in this contract are integer millions. No implicit plug/tolerance.
    return actual == expected


def reconcile_history(case: HistoricalCase) -> dict:
    """Check every independently available identity; do not skip a period on one missing field."""
    issues: list[dict] = []
    checks: list[dict] = []
    registry: dict[str, Evidence] = {
        f"{case.opening_cash.period_end}:opening.balance_cash": case.opening_cash.balance_cash,
        f"{case.opening_cash.period_end}:opening.cash_flow_cash": case.opening_cash.cash_flow_cash,
    }
    for row in case.periods:
        registry.update({f"{row.period_end}:{key}": value for key, value in row.fields.items()})

    def issue(period: date, code: str, detail: str = ""):
        issues.append({"period": period.isoformat(), "code": code, "detail": detail})

    def check(period: date, code: str, actual: Decimal | None, expected: Decimal | None):
        if actual is None or expected is None:
            issue(period, f"unavailable:{code}")
        elif not _close(actual, expected):
            issue(period, f"mismatch:{code}", f"{actual} != {expected}")
        else:
            checks.append({"period": period.isoformat(), "code": code, "value": str(actual)})

    def lineage(reference: str, stack: frozenset[str] = frozenset()) -> set[str]:
        if reference in stack:
            issue(date.fromisoformat(reference.split(":", 1)[0]),
                  f"formula_cycle:{reference.split(':', 1)[1]}")
            return set()
        item = registry.get(reference)
        if item is None:
            return set()
        if item.state == "audited":
            return {source.document_id for source in item.sources}
        if item.state == "derived" and item.formula:
            sources = set()
            for dependency in item.formula.operands:
                sources.update(lineage(dependency, stack | {reference}))
            return sources
        return set()

    # Validate field-by-field provenance, period, scope, and deterministic formulas.
    for key, item in registry.items():
        period_text, field_name = key.split(":", 1)
        period = date.fromisoformat(period_text)
        if item.period_end != period or item.currency != case.currency or item.units != "millions":
            issue(period, f"metadata:{field_name}", "field period/currency/units differ from case")
        if item.scope != field_name:
            issue(period, f"field_scope:{field_name}")
        if item.state in {"audited", "derived", "analyst_estimated"} and item.review is None:
            issue(period, f"unreviewed:{field_name}")
        if item.review is not None and item.review.reviewed_at < item.period_end:
            issue(period, f"review_date:{field_name}")
        if item.state == "analyst_estimated":
            issue(period, f"historical_estimate:{field_name}")
        if item.state == "audited":
            for source in item.sources:
                if not isinstance(item.value, Decimal) or source.reported_value != item.value:
                    issue(period, f"source_value:{field_name}")
                if source.scope != item.scope:
                    issue(period, f"source_scope:{field_name}")
                if (source.period_end != item.period_end or source.currency != item.currency
                        or source.units != item.units):
                    issue(period, f"source_metadata:{field_name}")
                local_hash_url = (source.document_sha256 is not None and
                                  source.url.lower() ==
                                  f"urn:sha256:{source.document_sha256.lower()}")
                if not source.url.startswith("https://") and not local_hash_url:
                    issue(period, f"source_url:{field_name}")
        if item.state == "derived" and item.formula:
            operands = [registry.get(reference) for reference in item.formula.operands]
            if any(operand is None or _scalar(operand) is None for operand in operands):
                issue(period, f"formula_dependency:{field_name}")
            elif any(operand.state not in {"audited", "derived"} for operand in operands if operand):
                issue(period, f"formula_source:{field_name}")
            elif any(operand.currency != item.currency or operand.units != item.units
                     for operand in operands if operand):
                issue(period, f"formula_units:{field_name}")
            else:
                numbers = [_scalar(operand) for operand in operands]
                result = (sum(numbers, Decimal(0)) if item.formula.operation == "add"
                          else numbers[0] - numbers[1])
                if _scalar(item) != result:
                    issue(period, f"formula_value:{field_name}", f"{item.value} != {result}")
        if len(item.component_ids) != len(set(item.component_ids)):
            issue(period, f"double_count:{field_name}")

    opening = case.opening_cash
    for key, item in (("balance_cash", opening.balance_cash),
                      ("cash_flow_cash", opening.cash_flow_cash)):
        if item.state != "audited" or _scalar(item) is None:
            issue(opening.period_end, f"opening_source:{key}")

    previous_balance = _scalar(opening.balance_cash)
    previous_flow = _scalar(opening.cash_flow_cash)
    for row in case.periods:
        period = row.period_end
        fields = row.fields

        def value(name: str) -> Decimal | None:
            return _scalar(fields.get(name))

        for name in REQUIRED:
            item = fields.get(name)
            if item is None or (name != "cash_flow.fx_effect" and value(name) is None):
                issue(period, f"required:{name}")
            elif item is not None and item.state not in ({"audited", "derived", "not_applicable"}
                    if name == "cash_flow.fx_effect" else {"audited", "derived"}):
                issue(period, f"required_source:{name}")
        for schedule in SCHEDULES:
            convention = row.conventions.get(schedule)
            if convention is None:
                issue(period, f"convention:{schedule}")
            elif not convention.review.approval_id:
                issue(period, f"convention_approval:{schedule}")

        def arithmetic(code: str, left: str, parts: tuple[str, ...], signs: tuple[int, ...]):
            operands = [value(name) for name in parts]
            if value(left) is not None and all(number is not None for number in operands):
                check(period, code, value(left), sum((number * sign for number, sign
                                                      in zip(operands, signs)), Decimal(0)))

        arithmetic("ebit", "income.ebit",
                   ("income.revenue", "income.cost_of_sales", "income.operating_expenses"),
                   (1, -1, -1))
        arithmetic("net_income", "income.net_income",
                   ("income.ebit", "income.net_other", "income.income_tax"), (1, 1, -1))
        arithmetic("assets", "balance.total_assets",
                   tuple(f"balance.{name}" for name in BALANCE_PARTS[:6]), (1,) * 6)
        arithmetic("liabilities_equity", "balance.total_liabilities_equity",
                   tuple(f"balance.{name}" for name in BALANCE_PARTS[6:]), (1,) * 6)
        if value("balance.total_assets") is not None and value("balance.total_liabilities_equity") is not None:
            check(period, "balance_sheet", value("balance.total_assets"),
                  value("balance.total_liabilities_equity"))

        fx = fields.get("cash_flow.fx_effect")
        if fx and fx.state == "not_applicable":
            fx_amount = Decimal(0)  # Formula omission only; no observed zero is stored.
        elif fx and fx.state in {"audited", "derived"}:
            fx_amount = value("cash_flow.fx_effect")
        else:
            fx_amount = None
            issue(period, "fx_presentation", "explicit effect or approved not-applicable convention required")
        if all(value(name) is not None for name in ("cash_flow.cfo", "cash_flow.cfi",
                                                    "cash_flow.cff", "cash_flow.net_change")) and fx_amount is not None:
            check(period, "cash_flow_subtotal", value("cash_flow.net_change"),
                  value("cash_flow.cfo") + value("cash_flow.cfi") + value("cash_flow.cff") + fx_amount)
        if previous_flow is not None and value("cash_flow.net_change") is not None:
            check(period, "cash_flow_cash_roll", value("cash_flow.end_cash"),
                  previous_flow + value("cash_flow.net_change"))
        if value("cash_flow.end_cash") is not None and value("balance.cash") is not None:
            check(period, "cash_scope", value("cash_scope.difference"),
                  value("cash_flow.end_cash") - value("balance.cash"))
        if all(number is not None for number in (previous_balance, previous_flow,
                value("balance.cash"), value("cash_flow.net_change"), value("cash_scope.difference"))):
            previous_scope = previous_flow - previous_balance
            check(period, "balance_cash_roll", value("balance.cash") - previous_balance,
                  value("cash_flow.net_change") + previous_scope - value("cash_scope.difference"))
        previous_balance, previous_flow = value("balance.cash"), value("cash_flow.end_cash")

        # A reported aggregate schedule checks its audited closing balance, not unavailable causes.
        for schedule, balance_name in (("debt", "balance.borrowings"),
                                       ("equity", "balance.equity"),
                                       ("lease", "balance.finance_lease_liabilities"),
                                       ("ppe", "balance.ppe")):
            convention = row.conventions.get(schedule)
            if not convention:
                continue
            if convention.mode == "reported_aggregate":
                if value(balance_name) is not None:
                    checks.append({"period": period.isoformat(), "code": f"{schedule}_closing",
                                   "value": str(value(balance_name))})
            elif schedule == "lease":
                addition = value("lease.finance_additions")
                principal = value("lease.finance_principal")
                other = value("lease.other_movement")
                opening_lease = value("lease.opening_liability")
                if all(x is not None for x in (addition, principal, other, opening_lease)):
                    check(period, "lease_roll", value(balance_name),
                          opening_lease + addition - principal + other)
                else:
                    issue(period, "required:lease_disaggregated")
            else:
                opening_value = value(f"{schedule}.opening")
                additions = value(f"{schedule}.additions")
                reductions = value(f"{schedule}.reductions")
                other = value(f"{schedule}.other_movement")
                if all(x is not None for x in (opening_value, additions, reductions, other)):
                    check(period, f"{schedule}_roll", value(balance_name),
                          opening_value + additions - reductions + other)
                else:
                    issue(period, f"required:{schedule}_disaggregated")
        if row.conventions.get("income") and row.conventions["income"].mode == "disaggregated":
            interest = value("income.interest_expense")
            other = value("income.other_income")
            if interest is None or other is None:
                issue(period, "required:income_disaggregated")
            else:
                check(period, "nonoperating_split", value("income.net_other"), other - interest)
        if row.conventions.get("cash_flow") and row.conventions["cash_flow"].mode == "disaggregated":
            for total, components in (("cfo", ("net_income", "da", "working_capital", "other_operating")),
                                      ("cfi", ("cash_capex", "other_investing")),
                                      ("cff", ("debt_net", "lease_principal", "dividends",
                                               "repurchases", "other_financing"))):
                names = [f"cash_flow.{part}" for part in components]
                if any(value(name) is None for name in names):
                    issue(period, f"required:cash_flow_{total}_disaggregated")
                else:
                    signs = (-1, 1) if total == "cfi" else ((1, 1, -1, -1, 1)
                                                              if total == "cff" else (1,) * 4)
                    arithmetic(f"cash_flow_{total}_components", f"cash_flow.{total}",
                               tuple(names), signs)

        # One economic cash/noncash component must not be counted twice in the same year.
        used: list[str] = []
        for field_name, item in fields.items():
            if field_name.startswith("cash_flow.component."):
                used.extend(item.component_ids)
        if len(used) != len(set(used)):
            issue(period, "double_count:cash_flow_components")

    return {"status": "accepted" if not issues else "blocked", "issues": issues,
            "checks": checks, "history_hash": digest(case),
            "field_hashes": {key: digest(value) for key, value in registry.items()},
            "source_lineage": {key: sorted(lineage(key)) for key in registry},
            "calculation_version": VERSION}


class ForecastPackage(Strict):
    history: HistoricalCase
    accepted_history_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    assumption_as_of: date
    scenarios: dict[str, ForecastDrivers]
    scenario_evidence: dict[str, dict[str, Evidence]]
    bridge: Bridge
    bridge_evidence: dict[str, Evidence]
    policies: dict[str, Review]
    lease_policy: Literal["finance_lease_financing"]
    cash_component_ids: list[str]


def valuation_readiness(package: ForecastPackage) -> dict:
    history = reconcile_history(package.history)
    issues = [f"historical:{item['code']}" for item in history["issues"]]
    if package.accepted_history_hash != history["history_hash"]:
        issues.append("historical_snapshot_hash_mismatch")
    if package.assumption_as_of < package.history.periods[-1].period_end:
        issues.append("assumption_date_precedes_history")
    if set(package.scenarios) != {"bear", "base", "bull"}:
        issues.append("scenarios_missing")
    for scenario, drivers in package.scenarios.items():
        evidence = package.scenario_evidence.get(scenario, {})
        for field_name in FORECAST_FIELDS:
            item = evidence.get(field_name)
            if item is None or item.state != "analyst_estimated" or item.review is None:
                issues.append(f"unapproved_assumption:{scenario}.{field_name}")
            elif item.value != _decimal_value(getattr(drivers, field_name)):
                issues.append(f"assumption_value_mismatch:{scenario}.{field_name}")
            elif (item.period_end != package.assumption_as_of
                  or item.currency != package.history.currency or item.scope != field_name
                  or item.units != ("ratio" if field_name in RATIO_FIELDS else "millions")):
                issues.append(f"assumption_metadata:{scenario}.{field_name}")
            elif field_name in {"cost_of_equity", "pretax_cost_of_debt", "market_debt_weight",
                                "marginal_debt_tax_rate"} and not item.sources:
                issues.append(f"market_evidence_missing:{scenario}.{field_name}")
            elif item.sources and any(source.period_end != package.assumption_as_of
                                      or source.currency != package.history.currency
                                      or source.units != item.units
                                      or not source.url.startswith("https://")
                                      for source in item.sources):
                issues.append(f"market_evidence_metadata:{scenario}.{field_name}")
    for field_name in BRIDGE_FIELDS:
        item = package.bridge_evidence.get(field_name)
        if item is None or item.state != "analyst_estimated" or item.review is None:
            issues.append(f"unapproved_bridge:{field_name}")
        elif item.value != _decimal_value(getattr(package.bridge, field_name)):
            issues.append(f"bridge_value_mismatch:{field_name}")
        elif (item.period_end != package.assumption_as_of
              or item.currency != package.history.currency or item.scope != field_name
              or item.units != ("shares_millions" if field_name == "diluted_shares"
                                else "millions")):
            issues.append(f"bridge_metadata:{field_name}")
        elif field_name == "diluted_shares" and not item.sources:
            issues.append("shares_evidence_missing")
        elif item.sources and any(source.period_end != package.assumption_as_of
                                  or source.currency != package.history.currency
                                  or source.units != item.units
                                  or not source.url.startswith("https://")
                                  for source in item.sources):
            issues.append(f"bridge_evidence_metadata:{field_name}")
    for policy in ("wacc", "leases", "nwc", "tax", "excess_cash", "shares"):
        if policy not in package.policies:
            issues.append(f"unapproved_policy:{policy}")
    if len(package.cash_component_ids) != len(set(package.cash_component_ids)):
        issues.append("double_count:forecast_components")
    bridge_components = [component for field in ("excess_cash", "non_operating_assets")
                         for component in (package.bridge_evidence[field].component_ids
                                           if field in package.bridge_evidence else [])]
    if len(bridge_components) != len(set(bridge_components)):
        issues.append("double_count:equity_bridge_components")
    latest_cash = _scalar(package.history.periods[-1].fields.get("balance.cash"))
    if latest_cash is not None and package.bridge.excess_cash > float(latest_cash):
        issues.append("excess_cash_above_balance_cash")
    return {"status": "ready" if not issues else "blocked", "issues": issues,
            "history_hash": history["history_hash"], "calculation_version": VERSION}


def _decimal_value(value: float | list[float]) -> Decimal | list[Decimal]:
    if isinstance(value, list):
        return [Decimal(str(number)) for number in value]
    return Decimal(str(value))


def forecast_preview(package: ForecastPackage) -> dict:
    """Unpersisted approved forecast; intentionally never creates a valuation case."""
    readiness = valuation_readiness(package)
    if readiness["issues"]:
        raise ValueError(f"valuation readiness blocked: {readiness['issues'][:8]}")
    base_fields = package.history.periods[-1].fields
    base = {name: float(_scalar(base_fields[f"balance.{name}"])) for name in BALANCE_PARTS}
    base_revenue = float(_scalar(base_fields["income.revenue"]))

    def nwc(balance: dict) -> float:
        return (balance["receivables"] + balance["inventory"] + balance["other_current_assets"]
                - balance["payables"] - balance["other_current_liabilities"])

    results = {}
    for name, d in package.scenarios.items():
        wacc = ((1 - d.market_debt_weight) * d.cost_of_equity
                + d.market_debt_weight * d.pretax_cost_of_debt * (1 - d.marginal_debt_tax_rate))
        if not d.terminal_growth < wacc < 1:
            raise ValueError(f"{name}: WACC/terminal growth invalid")
        prior, prior_revenue = dict(base), base_revenue
        forecast = []
        for index in range(5):
            revenue = prior_revenue * (1 + d.revenue_growth[index])
            cogs = revenue * d.cost_of_sales_percent_revenue[index]
            opex = revenue * d.operating_expenses_percent_revenue[index]
            ebit = revenue - cogs - opex
            da = revenue * d.da_percent_revenue[index]
            capex = revenue * d.cash_capex_percent_revenue[index]
            lease_additions = revenue * d.lease_additions_percent_revenue[index]
            interest = (prior["borrowings"] * d.borrowings_interest_rate
                        + prior["finance_lease_liabilities"] * d.lease_interest_rate)
            pretax = ebit - interest + d.other_income[index]
            tax = max(pretax, 0) * d.income_tax_rate
            net_income = pretax - tax
            balance = {
                "receivables": revenue * d.receivables_percent_revenue[index],
                "inventory": cogs * d.inventory_percent_cost_sales[index],
                "other_current_assets": revenue * d.other_current_assets_percent_revenue[index],
                "payables": cogs * d.payables_percent_cost_sales[index],
                "other_current_liabilities": revenue * d.other_current_liabilities_percent_revenue[index],
                "other_assets": prior["other_assets"], "other_liabilities": prior["other_liabilities"],
                "ppe": prior["ppe"] + capex + lease_additions - da,
                "borrowings": prior["borrowings"] + d.debt_issuance[index] - d.debt_repayment[index],
                "finance_lease_liabilities": prior["finance_lease_liabilities"]
                                             + lease_additions - d.lease_principal_repayment[index],
                "equity": prior["equity"] + net_income - d.dividends[index] - d.repurchases[index],
            }
            if min(balance["ppe"], balance["borrowings"], balance["finance_lease_liabilities"]) < -1e-8:
                raise ValueError(f"{name} year {index + 1}: negative asset or financing balance")
            change_nwc = nwc(balance) - nwc(prior)
            cfo = net_income + da - change_nwc
            cfi = -capex
            cff = (d.debt_issuance[index] - d.debt_repayment[index]
                   - d.lease_principal_repayment[index] - d.dividends[index] - d.repurchases[index])
            balance["cash"] = prior["cash"] + cfo + cfi + cff
            if balance["cash"] < -1e-8:
                raise ValueError(f"{name} year {index + 1}: negative cash")
            assets = sum(balance[key] for key in BALANCE_PARTS[:6])
            claims = sum(balance[key] for key in BALANCE_PARTS[6:])
            if abs(assets - claims) > 1e-6:
                raise ValueError(f"{name} year {index + 1}: balance sheet difference {assets - claims}")
            fcff = ebit - max(ebit, 0) * d.income_tax_rate + da - capex - lease_additions - change_nwc
            forecast.append({"year": index + 1, "revenue": revenue, "ebit": ebit,
                             "net_income": net_income, "cash": balance["cash"],
                             "balance_check": assets - claims, "cash_from_operations": cfo,
                             "cash_from_investing": cfi, "cash_from_financing": cff,
                             "cash_capex": capex, "finance_lease_additions": lease_additions,
                             "fcff": fcff, "pv_fcff": fcff / (1 + wacc) ** (index + 1)})
            prior, prior_revenue = balance, revenue
        if forecast[-1]["fcff"] <= 0:
            raise ValueError(f"{name}: terminal FCFF must be positive")
        terminal = forecast[-1]["fcff"] * (1 + d.terminal_growth) / (wacc - d.terminal_growth)
        ev = sum(row["pv_fcff"] for row in forecast) + terminal / (1 + wacc) ** 5
        equity = (ev + package.bridge.excess_cash + package.bridge.non_operating_assets
                  - base["borrowings"] - base["finance_lease_liabilities"]
                  - package.bridge.minority_interest - package.bridge.other_non_equity_claims)
        results[name] = {"wacc": wacc, "forecast": forecast, "terminal_value": terminal,
                         "enterprise_value": ev, "equity_value": equity,
                         "equity_value_per_share": equity / package.bridge.diluted_shares}
    return {"calculation_version": VERSION, "historical_hash": readiness["history_hash"],
            "scenarios": results, "persistent": False}


def valuation_freeze_gate(package: ForecastPackage) -> dict:
    """Dry-run gate only. No snapshot or database mutation is implemented here."""
    readiness = valuation_readiness(package)
    if readiness["issues"]:
        return {**readiness, "freeze_permitted": False, "persistent": False}
    try:
        result = forecast_preview(package)
    except ValueError as exc:
        return {**readiness, "status": "blocked", "issues": [f"forecast:{exc}"],
                "freeze_permitted": False, "persistent": False}
    return {**readiness, "freeze_permitted": True, "persistent": False,
            "preview_hash": digest(result)}
