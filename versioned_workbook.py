"""Formula-linked XLSX export for immutable FCFF cases."""

from __future__ import annotations

import io

import xlsxwriter
from xlsxwriter.utility import xl_rowcol_to_cell as cell

SCENARIOS = ("bear", "base", "bull")
DRIVERS = ("revenue_growth", "ebit_margin", "da_percent_revenue",
           "cash_capex_percent_revenue", "finance_lease_additions_percent_revenue",
           "nwc_investment_percent_revenue_change")
BRIDGE = ("excess_cash", "non_operating_assets", "borrowings",
          "finance_lease_liabilities", "minority_interest",
          "other_non_equity_claims", "diluted_shares")


def build_versioned_workbook(saved: dict) -> bytes:
    """Create an editable, linked workbook; cached values match the frozen result."""
    inputs, result = saved["inputs"], saved["result"]
    stream = io.BytesIO()
    book = xlsxwriter.Workbook(stream, {"in_memory": True})
    book.set_calc_mode("auto")
    dark = book.add_format({"bold": True, "font_color": "white", "bg_color": "#183047"})
    title = book.add_format({"bold": True, "font_size": 16, "font_color": "white", "bg_color": "#183047"})
    source = book.add_format({"font_color": "#495A68", "text_wrap": True, "valign": "top"})
    inp = book.add_format({"font_color": "#215BB0", "num_format": "#,##0.000"})
    pct_in = book.add_format({"font_color": "#215BB0", "num_format": "0.00%"})
    out = book.add_format({"font_color": "#17664D", "num_format": "#,##0.000"})
    pct_out = book.add_format({"font_color": "#17664D", "num_format": "0.00%"})
    key = book.add_format({"bold": True, "font_color": "#17664D", "top": 1,
                           "top_color": "#215BB0", "num_format": "#,##0.000"})
    ws = {name: book.add_worksheet(name) for name in
          ("Summary", "Historical", "Assumptions", "Forecast", "DCF")}
    for sheet in ws.values():
        sheet.hide_gridlines(2)
        sheet.set_column("A:A", 40)
        sheet.set_column("B:F", 18)
        sheet.set_column("G:G", 56)
        sheet.freeze_panes(4, 1)
        sheet.set_landscape()
        sheet.fit_to_pages(1, 0)

    hist = ws["Historical"]
    hist.merge_range("A1:G1", f"{saved['symbol']} | reported fiscal history", title)
    hist.write("A2", f"{inputs['currency']} millions; as filed", source)
    hist.write(3, 0, "Fiscal end", dark)
    historical = ((4, "Revenue", "revenue"), (5, "EBIT", "ebit"),
                  (6, "D&A", "depreciation_amortization"),
                  (7, "Cash CapEx", "cash_capex"),
                  (8, "Finance-lease asset additions", "finance_lease_asset_additions"),
                  (9, "Change in NWC", "change_nwc"))
    for row, label, _ in historical:
        hist.write(row, 0, label)
    hist.write(11, 0, "Source reference", dark)
    for i, year in enumerate(inputs["history"], 1):
        hist.write(3, i, year["period_end"], dark)
        for row, _, field in historical:
            if year.get(field) is not None:
                hist.write_number(row, i, year[field], inp)
        hist.write(11, i, year["source_reference"], source)
    hist.set_row(11, 54)
    latest = f"'Historical'!{cell(4, len(inputs['history']))}"

    ass = ws["Assumptions"]
    ass.merge_range("A1:G1", "Editable operating and financing assumptions", title)
    ass.write("A2", f"Case {saved['id']} | revision {saved['case_revision']} | {inputs['currency']} millions", source)
    bridge_row = 76
    ass.write(bridge_row, 0, "Enterprise-to-equity bridge", dark)
    for i, field in enumerate(BRIDGE, bridge_row + 1):
        ass.write(i, 0, field.replace("_", " ").title())
        ass.write_number(i, 1, inputs["bridge"][field], inp)
    ass.write(bridge_row + 9, 0, "Bridge and share source")
    ass.write(bridge_row + 9, 1, inputs["bridge"]["source_reference"], source)
    ass.set_row(bridge_row + 9, 48)

    fore = ws["Forecast"]
    fore.merge_range("A1:G1", "Five-year operating forecast", title)
    fore.write("A2", "End-of-year FCFF; each colored output is a formula", source)
    dcf = ws["DCF"]
    dcf.merge_range("A1:G1", "Discounted cash flow and sensitivity", title)
    dcf.write("A2", "Scenario assumptions and bridge link to editable cells", source)
    dcf_labels = ("WACC", "PV forecast FCFF", "Terminal value at year five",
                  "PV terminal value", "Enterprise value", "Excess cash",
                  "Non-operating assets", "Borrowings", "Finance-lease liabilities",
                  "Minority interest", "Other non-equity claims", "Equity residual",
                  "Diluted shares", "Equity residual per share")
    dcf.write(3, 0, "Scenario", dark)
    for i, label in enumerate(dcf_labels, 4):
        dcf.write(i, 0, label)

    for si, name in enumerate(SCENARIOS):
        a, f, c = 6 + si * 22, 6 + si * 17, si + 1
        driver = inputs["scenarios"][name]
        calc = result["scenarios"][name]
        ass.write(a, 0, name.upper(), dark)
        for offset, description in enumerate(("Operating source: " + driver["operating_assumptions_source"],
                                               "Discount source: " + driver["discount_source"],
                                               "Rationale: " + driver["rationale"]), 0):
            ass.write(a + offset, 6, description, source)
            ass.set_row(a + offset, 38)
        for yr in range(5):
            ass.write(a + 3, yr + 1, f"Year {yr + 1}", dark)
        for offset, field in enumerate(DRIVERS, 4):
            ass.write(a + offset, 0, field.replace("_", " "))
            for yr, value in enumerate(driver[field], 1):
                ass.write_number(a + offset, yr, value, pct_in)
        scalar_fields = ("operating_tax_rate", "cost_of_equity", "pretax_cost_of_debt",
                         "market_debt_weight", "marginal_debt_tax_rate")
        for offset, field in enumerate(scalar_fields, 10):
            ass.write(a + offset, 0, field.replace("_", " "))
            ass.write_number(a + offset, 1, driver[field], pct_in)
        ass.write(a + 15, 0, "Terminal method")
        ass.write(a + 15, 1, driver["terminal_method"], source)
        ass.write(a + 16, 0, "Terminal parameter")
        is_growth = driver["terminal_method"] == "perpetuity_growth"
        ass.write_number(a + 16, 1, calc["terminal_parameter"], pct_in if is_growth else inp)
        def ar(offset, col=1):
            return f"'Assumptions'!{cell(a + offset, col)}"

        def fr(offset, col):
            return f"'Forecast'!{cell(f + offset, col)}"

        def dr(row):
            return cell(row, c)

        fore.write(f, 0, name.upper(), dark)
        forecast_fields = ((2, "Revenue", "revenue"), (3, "EBIT", "ebit"),
                           (4, "D&A", "da"), (5, "Operating cash taxes", "cash_taxes"),
                           (6, "Cash CapEx", "cash_capex"),
                           (7, "Finance-lease asset additions", "finance_lease_asset_additions"),
                           (8, "Change NWC", "change_nwc"), (9, "FCFF", "fcff"),
                           (10, "PV FCFF", "present_value_fcff"), (11, "EBITDA", "ebitda"))
        for offset, description, _ in forecast_fields:
            fore.write(f + offset, 0, description)
        for yr, values in enumerate(calc["forecast"], 1):
            fore.write(f + 1, yr, f"Year {yr}", dark)
            prev = latest if yr == 1 else cell(f + 2, yr - 1)
            def q(row):
                return cell(f + row, yr)
            formulas = {
                2: f"={prev}*(1+{ar(4, yr)})",
                3: f"={q(2)}*{ar(5, yr)}",
                4: f"={q(2)}*{ar(6, yr)}",
                5: f"=MAX({q(3)},0)*{ar(10)}",
                6: f"={q(2)}*{ar(7, yr)}",
                7: f"={q(2)}*{ar(8, yr)}",
                8: f"=({q(2)}-{prev})*{ar(9, yr)}",
                9: f"={q(3)}-{q(5)}+{q(4)}-{q(6)}-{q(7)}-{q(8)}",
                10: f"={q(9)}/(1+'DCF'!{dr(4)})^{yr}",
                11: f"={q(3)}+{q(4)}",
            }
            for offset, _, field in forecast_fields:
                fore.write_formula(f + offset, yr, formulas[offset], key if offset == 9 else out, values[field])

        dcf.write(3, c, name.upper(), dark)
        wacc = f"=(1-{ar(13)})*{ar(11)}+{ar(13)}*{ar(12)}*(1-{ar(14)})"
        terminal = (f"={fr(9, 5)}*(1+{ar(16)})/({dr(4)}-{ar(16)})"
                    if is_growth else f"={fr(11, 5)}*{ar(16)}")
        expressions = {
            4: (wacc, calc["wacc"]),
            5: (f"=SUM('Forecast'!{cell(f + 10, 1)}:{cell(f + 10, 5)})", calc["pv_forecast_fcff"]),
            6: (terminal, calc["terminal_value"]),
            7: (f"={dr(6)}/(1+{dr(4)})^5", calc["pv_terminal_value"]),
            8: (f"=SUM({dr(5)},{dr(7)})", calc["bridge"]["enterprise_value"]),
        }
        for row, field in enumerate(BRIDGE[:6], 9):
            expressions[row] = (f"='Assumptions'!{cell(bridge_row + 1 + BRIDGE.index(field), 1)}",
                                calc["bridge"][field])
        expressions[15] = (f"={dr(8)}+{dr(9)}+{dr(10)}-SUM({dr(11)}:{dr(14)})",
                           calc["bridge"]["equity_value"])
        expressions[16] = (f"='Assumptions'!{cell(bridge_row + 7, 1)}", calc["bridge"]["diluted_shares"])
        expressions[17] = (f"={dr(15)}/{dr(16)}", calc["bridge"]["equity_value_per_share"])
        for row, (formula, value) in expressions.items():
            dcf.write_formula(row, c, formula, pct_out if row == 4 else key if row in (8, 15, 17) else out, value)

        # Ordinary linked formulas keep the two-variable grid portable in XLSX writers.
        start = 23 + si * 10
        dcf.write(start, 0, name.upper() + " per-share sensitivity", dark)
        for pi, value in enumerate(calc["sensitivity"]["terminal_parameter"], 1):
            delta = (-.01, -.005, 0, .005, .01)[pi - 1]
            factor = (.8, .9, 1, 1.1, 1.2)[pi - 1]
            formula = f"={ar(16)}+{delta}" if is_growth else f"={ar(16)}*{factor}"
            dcf.write_formula(start + 1, pi, formula, pct_out if is_growth else out, value)
        for ri, rate in enumerate(calc["sensitivity"]["wacc"]):
            rr = start + 2 + ri
            dcf.write_formula(rr, 0, f"={dr(4)}+{(-.02, -.01, 0, .01, .02)[ri]}", pct_out, rate)
            for pi, value in enumerate(calc["sensitivity"]["equity_value_per_share"][ri], 1):
                rate_ref, parameter = cell(rr, 0), cell(start + 1, pi)
                pv = "+".join(f"{fr(9, yr)}/(1+{rate_ref})^{yr}" for yr in range(1, 6))
                tv = (f"{fr(9, 5)}*(1+{parameter})/({rate_ref}-{parameter})"
                      if is_growth else f"{fr(11, 5)}*{parameter}")
                invalid = (f"OR({parameter}>={rate_ref},{fr(9, 5)}<=0)" if is_growth
                           else f"{fr(11, 5)}<=0")
                formula = (f"=IF({invalid},\"\",(({pv})+({tv})/(1+{rate_ref})^5+"
                           f"{dr(9)}+{dr(10)}-SUM({dr(11)}:{dr(14)}))/{dr(16)})")
                dcf.write_formula(rr, pi, formula, out, value if value is not None else "")

    summary = ws["Summary"]
    summary.merge_range("A1:G1", f"{saved['symbol']} | versioned FCFF valuation", title)
    summary.write("A2", f"As of {inputs['valuation_date']} | {inputs['currency']} millions except per share", source)
    summary.write("A3", f"Frozen case {saved['id']} | revision {saved['case_revision']} | calculation {saved['calculation_version']}", source)
    summary.write("A4", "Input SHA-256 " + saved["input_hash"], source)
    summary.write("A5", "Result SHA-256 " + saved["result_hash"], source)
    summary.write(6, 0, "Metric", dark)
    lines = ((7, "WACC", 4, "wacc"), (8, "PV forecast FCFF", 5, "pv_forecast_fcff"),
             (9, "PV terminal value", 7, "pv_terminal_value"),
             (10, "Enterprise value", 8, "enterprise_value"),
             (11, "Equity residual", 15, "equity_value"),
             (12, "Equity residual per share", 17, "equity_value_per_share"))
    for row, description, _, _ in lines:
        summary.write(row, 0, description)
    for si, name in enumerate(SCENARIOS, 1):
        summary.write(6, si, name.upper(), dark)
        for row, _, dcf_row, field in lines:
            scenario = result["scenarios"][name]
            value = scenario[field] if field in scenario else scenario["bridge"][field]
            summary.write_formula(row, si, f"='DCF'!{cell(dcf_row, si)}",
                                  pct_out if field == "wacc" else key if row in (10, 12) else out, value)
    summary.write(15, 0, "Model conventions and source limits", dark)
    for row, statement in enumerate((result["discount_convention"], result["lease_convention"],
                                     result["tax_convention"], inputs["notes"]), 16):
        summary.write(row, 0, statement, source)
        summary.set_row(row, 52)
    summary.write(21, 0, "Sensitivity: DCF. Historical sources: Historical. Editable inputs: Assumptions.", source)
    book.close()
    return stream.getvalue()
