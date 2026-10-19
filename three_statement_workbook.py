"""Runtime XLSX export for frozen integrated three-statement cases."""

from __future__ import annotations

import io

import xlsxwriter
from xlsxwriter.utility import xl_rowcol_to_cell as cell

from three_statement import BALANCE, CASH_FLOW, INCOME

SCENARIOS = ("bear", "base", "bull")
DRIVER_ARRAYS = (
    "revenue_growth", "cost_of_sales_percent_revenue",
    "operating_expenses_percent_revenue", "da_percent_revenue",
    "cash_capex_percent_revenue", "lease_additions_percent_revenue",
    "receivables_percent_revenue", "inventory_percent_cost_sales",
    "other_current_assets_percent_revenue", "payables_percent_cost_sales",
    "other_current_liabilities_percent_revenue", "debt_issuance",
    "debt_repayment", "lease_principal_repayment", "dividends",
    "repurchases", "other_income",
)
DRIVER_SCALARS = (
    "income_tax_rate", "borrowings_interest_rate", "lease_interest_rate",
    "cost_of_equity", "pretax_cost_of_debt", "market_debt_weight",
    "marginal_debt_tax_rate", "terminal_growth",
)
INCOME_ROWS = ("revenue", "cost_of_sales", "operating_expenses", "ebit",
               "interest_expense", "other_income", "pretax_income", "income_tax",
               "net_income", "da", "cash_capex", "finance_lease_asset_additions")
BALANCE_ROWS = ("cash", "receivables", "inventory", "other_current_assets",
                "ppe", "other_assets", "total_assets", "payables",
                "other_current_liabilities", "borrowings", "finance_lease_liabilities",
                "other_liabilities", "equity", "total_liabilities_equity",
                "balance_check", "operating_nwc")
CF_ROWS = ("net_income", "da", "change_nwc", "cash_from_operations",
           "cash_capex", "cash_from_investing", "debt_issuance",
           "debt_repayment", "lease_principal_repayment", "dividends",
           "repurchases", "cash_from_financing", "net_change_cash", "closing_cash")


def build_three_statement_workbook(saved: dict) -> bytes:
    inputs, result = saved["inputs"], saved["result"]
    output = io.BytesIO()
    book = xlsxwriter.Workbook(output, {"in_memory": True})
    book.set_calc_mode("auto")
    formats = {
        "title": book.add_format({"font_size": 16, "bold": True, "font_color": "white", "bg_color": "#183047"}),
        "head": book.add_format({"bold": True, "font_color": "white", "bg_color": "#183047"}),
        "input": book.add_format({"font_color": "#215BB0", "num_format": "#,##0.000"}),
        "percent_input": book.add_format({"font_color": "#215BB0", "num_format": "0.00%"}),
        "formula": book.add_format({"font_color": "#17664D", "num_format": "#,##0.000"}),
        "percent_formula": book.add_format({"font_color": "#17664D", "num_format": "0.00%"}),
        "check": book.add_format({"bold": True, "font_color": "#17664D", "num_format": "#,##0.000"}),
        "note": book.add_format({"font_color": "#495A68", "text_wrap": True, "valign": "top"}),
    }
    names = ("Summary", "Historical", "Drivers", "Income", "Balance", "Cash Flow", "DCF", "Checks")
    sheets = {name: book.add_worksheet(name) for name in names}
    for sheet in sheets.values():
        sheet.hide_gridlines(2)
        sheet.set_column("A:A", 38)
        sheet.set_column("B:F", 19)
        sheet.set_column("G:G", 58)
        sheet.freeze_panes(4, 1)
        sheet.fit_to_pages(1, 0)

    def put(ws, row, col, formula, value, kind="formula"):
        ws.write_formula(row, col, formula, formats[kind], value)

    def ref(sheet, row, col):
        return f"'{sheet}'!{cell(row, col)}"

    historical = sheets["Historical"]
    historical.merge_range("A1:G1", f"{saved['symbol']} | entered historical inputs", formats["title"])
    historical.write("A2", f"{inputs['currency']} millions except shares; blue cells are entered inputs", formats["note"])
    historical.write(3, 0, "Fiscal period", formats["head"])
    hstart = {"income": 5, "balance": 17, "cash_flow": 36}
    hfields = {"income": INCOME, "balance": BALANCE, "cash_flow": CASH_FLOW}
    hrow = {group: {field: start + i for i, field in enumerate(fields)}
            for group, (start, fields) in
            ((g, (hstart[g], hfields[g])) for g in hstart)}
    for group, start in hstart.items():
        historical.write(start - 1, 0, group.upper(), formats["head"])
        for field, row in hrow[group].items():
            historical.write(row, 0, field.replace("_", " ").title())
    for i, year in enumerate(inputs["history"], 1):
        historical.write(3, i, year["period_end"], formats["head"])
        for group in hstart:
            for field, row in hrow[group].items():
                historical.write_number(row, i, year[group][field], formats["input"])
        historical.write(60, i, year["source_reference"], formats["note"])
    historical.write(60, 0, "Source references", formats["head"])
    historical.set_row(60, 72)
    last = len(inputs["history"])
    def hist(group, field):
        return ref("Historical", hrow[group][field], last)
    hist_nwc = (f"({hist('balance','receivables')}+{hist('balance','inventory')}+"
                f"{hist('balance','other_current_assets')}-{hist('balance','payables')}-"
                f"{hist('balance','other_current_liabilities')})")

    drivers = sheets["Drivers"]
    drivers.merge_range("A1:G1", "Editable operating and financing drivers", formats["title"])
    drivers.write("A2", "Blue inputs. Scenario assumptions are analyst-sourced, not historical facts.", formats["note"])
    bridge_start = 107
    bridge_fields = ("excess_cash", "non_operating_assets", "minority_interest",
                     "other_non_equity_claims", "diluted_shares")
    drivers.write(bridge_start, 0, "Enterprise to equity bridge", formats["head"])
    for i, field in enumerate(bridge_fields, bridge_start + 1):
        drivers.write(i, 0, field.replace("_", " ").title())
        drivers.write_number(i, 1, inputs["bridge"][field], formats["input"])
    drivers.write(bridge_start + 7, 0, "Bridge/share source")
    drivers.write(bridge_start + 7, 1, inputs["bridge"]["source_reference"], formats["note"])
    drivers.set_row(bridge_start + 7, 58)
    def bridge(field):
        return ref("Drivers", bridge_start + 1 + bridge_fields.index(field), 1)

    for si, name in enumerate(SCENARIOS):
        dstart = 5 + si * 32
        d = inputs["scenarios"][name]
        drivers.write(dstart, 0, name.upper(), formats["head"])
        drivers.write(dstart, 6, "Operating: " + d["operating_source"], formats["note"])
        drivers.write(dstart + 1, 6, "Financing: " + d["financing_source"], formats["note"])
        drivers.write(dstart + 2, 6, "Rationale: " + d["rationale"], formats["note"])
        for y in range(1, 6):
            drivers.write(dstart + 1, y, f"Year {y}", formats["head"])
        for fi, field in enumerate(DRIVER_ARRAYS):
            row = dstart + 2 + fi
            drivers.write(row, 0, field.replace("_", " "))
            for y, value in enumerate(d[field], 1):
                drivers.write_number(row, y, value, formats["percent_input"] if fi <= 10 else formats["input"])
        for fi, field in enumerate(DRIVER_SCALARS):
            row = dstart + 20 + fi
            drivers.write(row, 0, field.replace("_", " "))
            drivers.write_number(row, 1, d[field], formats["percent_input"])
        def array(field, col):
            return ref("Drivers", dstart + 2 + DRIVER_ARRAYS.index(field), col)

        def scalar(field):
            return ref("Drivers", dstart + 20 + DRIVER_SCALARS.index(field), 1)

        istart, bstart, cstart, vstart = 5 + si * 16, 5 + si * 21, 5 + si * 18, 5 + si * 16
        income, balance, cf, dcf = (sheets[k] for k in ("Income", "Balance", "Cash Flow", "DCF"))
        for sheet, start, fields in ((income, istart, INCOME_ROWS),
                                      (balance, bstart, BALANCE_ROWS),
                                      (cf, cstart, CF_ROWS)):
            sheet.write(start, 0, name.upper(), formats["head"])
            for off, field in enumerate(fields, 2):
                sheet.write(start + off, 0, field.replace("_", " ").title())
        dcf.write(vstart, 0, name.upper(), formats["head"])
        for off, label in ((2, "FCFF"), (3, "PV FCFF"), (4, "WACC"),
                           (5, "Terminal value"), (6, "PV terminal"),
                           (7, "PV forecast"), (8, "Enterprise value"),
                           (9, "Equity residual"), (10, "Equity residual/share")):
            dcf.write(vstart + off, 0, label)
        for y in range(1, 6):
            for sheet, start in ((income, istart), (balance, bstart), (cf, cstart), (dcf, vstart)):
                sheet.write(start + 1, y, f"Year {y}", formats["head"])
        def ir(field, col):
            return ref("Income", istart + 2 + INCOME_ROWS.index(field), col)

        def br(field, col):
            return ref("Balance", bstart + 2 + BALANCE_ROWS.index(field), col)

        def cr(field, col):
            return ref("Cash Flow", cstart + 2 + CF_ROWS.index(field), col)

        def vr(off, col=1):
            return ref("DCF", vstart + off, col)
        calc = result["scenarios"][name]
        for y, observed in enumerate(calc["forecast"], 1):
            prev_revenue = hist("income", "revenue") if y == 1 else ir("revenue", y - 1)
            prev_debt = hist("balance", "borrowings") if y == 1 else br("borrowings", y - 1)
            prev_lease = hist("balance", "finance_lease_liabilities") if y == 1 else br("finance_lease_liabilities", y - 1)
            prev_cash = hist("balance", "cash") if y == 1 else br("cash", y - 1)
            prev_ppe = hist("balance", "ppe") if y == 1 else br("ppe", y - 1)
            prev_equity = hist("balance", "equity") if y == 1 else br("equity", y - 1)
            prev_nwc = hist_nwc if y == 1 else br("operating_nwc", y - 1)
            inc_formulas = {
                "revenue": f"={prev_revenue}*(1+{array('revenue_growth',y)})",
                "cost_of_sales": f"={ir('revenue',y)}*{array('cost_of_sales_percent_revenue',y)}",
                "operating_expenses": f"={ir('revenue',y)}*{array('operating_expenses_percent_revenue',y)}",
                "ebit": f"={ir('revenue',y)}-{ir('cost_of_sales',y)}-{ir('operating_expenses',y)}",
                "interest_expense": f"={prev_debt}*{scalar('borrowings_interest_rate')}+{prev_lease}*{scalar('lease_interest_rate')}",
                "other_income": f"={array('other_income',y)}",
                "pretax_income": f"={ir('ebit',y)}-{ir('interest_expense',y)}+{ir('other_income',y)}",
                "income_tax": f"=MAX({ir('pretax_income',y)},0)*{scalar('income_tax_rate')}",
                "net_income": f"={ir('pretax_income',y)}-{ir('income_tax',y)}",
                "da": f"={ir('revenue',y)}*{array('da_percent_revenue',y)}",
                "cash_capex": f"={ir('revenue',y)}*{array('cash_capex_percent_revenue',y)}",
                "finance_lease_asset_additions": f"={ir('revenue',y)}*{array('lease_additions_percent_revenue',y)}",
            }
            for field, formula in inc_formulas.items():
                value = observed["income"].get(field)
                if field == "pretax_income":
                    value = observed["income"]["net_income"] + observed["income"]["income_tax"]
                if field in ("da", "cash_capex", "finance_lease_asset_additions"):
                    source_field = {"da": "da", "cash_capex": "cash_capex",
                                    "finance_lease_asset_additions": "finance_lease_asset_additions"}[field]
                    value = observed["cash_flow"][source_field]
                put(income, istart + 2 + INCOME_ROWS.index(field), y, formula, value)
            bal_formulas = {
                "cash": f"={prev_cash}+{cr('net_change_cash',y)}",
                "receivables": f"={ir('revenue',y)}*{array('receivables_percent_revenue',y)}",
                "inventory": f"={ir('cost_of_sales',y)}*{array('inventory_percent_cost_sales',y)}",
                "other_current_assets": f"={ir('revenue',y)}*{array('other_current_assets_percent_revenue',y)}",
                "ppe": f"={prev_ppe}+{ir('cash_capex',y)}+{ir('finance_lease_asset_additions',y)}-{ir('da',y)}",
                "other_assets": f"={hist('balance','other_assets')}" if y == 1 else f"={br('other_assets',y-1)}",
                "total_assets": f"=SUM({br('cash',y)}:{br('other_assets',y)})",
                "payables": f"={ir('cost_of_sales',y)}*{array('payables_percent_cost_sales',y)}",
                "other_current_liabilities": f"={ir('revenue',y)}*{array('other_current_liabilities_percent_revenue',y)}",
                "borrowings": f"={prev_debt}+{cr('debt_issuance',y)}-{cr('debt_repayment',y)}",
                "finance_lease_liabilities": f"={prev_lease}+{ir('finance_lease_asset_additions',y)}-{cr('lease_principal_repayment',y)}",
                "other_liabilities": f"={hist('balance','other_liabilities')}" if y == 1 else f"={br('other_liabilities',y-1)}",
                "equity": f"={prev_equity}+{ir('net_income',y)}-{cr('dividends',y)}-{cr('repurchases',y)}",
                "total_liabilities_equity": f"=SUM({br('payables',y)}:{br('equity',y)})",
                "balance_check": f"={br('total_assets',y)}-{br('total_liabilities_equity',y)}",
                "operating_nwc": f"={br('receivables',y)}+{br('inventory',y)}+{br('other_current_assets',y)}-{br('payables',y)}-{br('other_current_liabilities',y)}",
            }
            for field, formula in bal_formulas.items():
                value = observed["balance_check"] if field == "balance_check" else (
                    observed["balance"]["receivables"]+observed["balance"]["inventory"]
                    +observed["balance"]["other_current_assets"]-observed["balance"]["payables"]
                    -observed["balance"]["other_current_liabilities"] if field == "operating_nwc"
                    else observed["balance"][field])
                put(balance, bstart + 2 + BALANCE_ROWS.index(field), y, formula, value,
                    "check" if field == "balance_check" else "formula")
            cf_formulas = {
                "net_income": f"={ir('net_income',y)}", "da": f"={ir('da',y)}",
                "change_nwc": f"={br('operating_nwc',y)}-{prev_nwc}",
                "cash_from_operations": f"={cr('net_income',y)}+{cr('da',y)}-{cr('change_nwc',y)}",
                "cash_capex": f"={ir('cash_capex',y)}",
                "cash_from_investing": f"=-{cr('cash_capex',y)}",
                "debt_issuance": f"={array('debt_issuance',y)}",
                "debt_repayment": f"={array('debt_repayment',y)}",
                "lease_principal_repayment": f"={array('lease_principal_repayment',y)}",
                "dividends": f"={array('dividends',y)}",
                "repurchases": f"={array('repurchases',y)}",
                "cash_from_financing": f"={cr('debt_issuance',y)}-{cr('debt_repayment',y)}-{cr('lease_principal_repayment',y)}-{cr('dividends',y)}-{cr('repurchases',y)}",
                "net_change_cash": f"={cr('cash_from_operations',y)}+{cr('cash_from_investing',y)}+{cr('cash_from_financing',y)}",
                "closing_cash": f"={br('cash',y)}",
            }
            for field, formula in cf_formulas.items():
                value = observed["balance"]["cash"] if field == "closing_cash" else (
                    inputs["scenarios"][name][field][y-1] if field in (
                        "debt_issuance", "debt_repayment", "lease_principal_repayment",
                        "dividends", "repurchases") else observed["cash_flow"][field])
                put(cf, cstart + 2 + CF_ROWS.index(field), y, formula, value)
            fcff_formula = (f"={ir('ebit',y)}-MAX({ir('ebit',y)},0)*{scalar('income_tax_rate')}"
                            f"+{ir('da',y)}-{cr('cash_capex',y)}-{ir('finance_lease_asset_additions',y)}"
                            f"-{cr('change_nwc',y)}")
            put(dcf, vstart + 2, y, fcff_formula, observed["fcff"])
            put(dcf, vstart + 3, y, f"={vr(2,y)}/(1+{vr(4)})^{y}", observed["pv_fcff"])
        wacc = f"=(1-{scalar('market_debt_weight')})*{scalar('cost_of_equity')}+{scalar('market_debt_weight')}*{scalar('pretax_cost_of_debt')}*(1-{scalar('marginal_debt_tax_rate')})"
        put(dcf, vstart + 4, 1, wacc, calc["wacc"], "percent_formula")
        put(dcf, vstart + 5, 1, f"={vr(2,5)}*(1+{scalar('terminal_growth')})/({vr(4)}-{scalar('terminal_growth')})", calc["terminal_value"])
        put(dcf, vstart + 6, 1, f"={vr(5)}/(1+{vr(4)})^5", calc["pv_terminal_value"])
        put(dcf, vstart + 7, 1, f"=SUM({vr(3,1)}:{vr(3,5)})", calc["pv_forecast_fcff"])
        put(dcf, vstart + 8, 1, f"={vr(6)}+{vr(7)}", calc["enterprise_value"])
        eq_formula = (f"={vr(8)}+{bridge('excess_cash')}+{bridge('non_operating_assets')}"
                      f"-{hist('balance','borrowings')}-{hist('balance','finance_lease_liabilities')}"
                      f"-{bridge('minority_interest')}-{bridge('other_non_equity_claims')}")
        put(dcf, vstart + 9, 1, eq_formula, calc["equity_value"])
        put(dcf, vstart + 10, 1, f"={vr(9)}/{bridge('diluted_shares')}", calc["equity_value_per_share"])
        sens_start = 58 + si * 9
        dcf.write(sens_start, 0, name.upper() + " WACC / terminal growth sensitivity", formats["head"])
        for gi, step in enumerate((-.01, -.005, 0, .005, .01), 1):
            put(dcf, sens_start + 1, gi, f"={scalar('terminal_growth')}+{step}",
                d["terminal_growth"] + step, "percent_formula")
        for ri, step in enumerate((-.02, -.01, 0, .01, .02)):
            rr = sens_start + 2 + ri
            put(dcf, rr, 0, f"={vr(4)}+{step}", calc["wacc"] + step, "percent_formula")
            for gi, value in enumerate(calc["sensitivity"][ri], 1):
                rate, growth = cell(rr, 0), cell(sens_start + 1, gi)
                pv = "+".join(f"{vr(2,y)}/(1+{rate})^{y}" for y in range(1,6))
                terminal = f"{vr(2,5)}*(1+{growth})/({rate}-{growth})/(1+{rate})^5"
                formula = (f"=IF(OR({rate}<=0,{growth}>={rate}),\"\",(({pv})+{terminal}"
                           f"+{bridge('excess_cash')}+{bridge('non_operating_assets')}"
                           f"-{hist('balance','borrowings')}-{hist('balance','finance_lease_liabilities')}"
                           f"-{bridge('minority_interest')}-{bridge('other_non_equity_claims')})"
                           f"/{bridge('diluted_shares')})")
                put(dcf, rr, gi, formula, value if value is not None else "")

    summary = sheets["Summary"]
    summary.merge_range("A1:G1", f"{saved['symbol']} | integrated three-statement model", formats["title"])
    summary.write("A2", f"Frozen revision {saved['case_revision']} · {inputs['valuation_date']} · {inputs['currency']} millions", formats["note"])
    summary.write("A3", "Calculation integrity: passed historical and five-year balance checks", formats["check"])
    summary.write("A4", "Decision readiness: analyst assumptions and source completeness require independent review", formats["note"])
    summary.write(5, 0, "Metric", formats["head"])
    for si, name in enumerate(SCENARIOS, 1):
        summary.write(5, si, name.upper(), formats["head"])
        vstart = 5 + (si - 1) * 16
        bstart = 5 + (si - 1) * 21
        cstart = 5 + (si - 1) * 18
        calc = result["scenarios"][name]
        rows = ((6, "WACC", f"={ref('DCF',vstart+4,1)}", calc["wacc"]),
                (7, "Enterprise value", f"={ref('DCF',vstart+8,1)}", calc["enterprise_value"]),
                (8, "Equity residual/share", f"={ref('DCF',vstart+10,1)}", calc["equity_value_per_share"]),
                (9, "Year-five closing cash", f"={ref('Balance',bstart+2,5)}", calc["forecast"][-1]["balance"]["cash"]),
                (10, "Year-five borrowings", f"={ref('Balance',bstart+11,5)}", calc["forecast"][-1]["balance"]["borrowings"]),
                (11, "Year-five CFO", f"={ref('Cash Flow',cstart+5,5)}", calc["forecast"][-1]["cash_flow"]["cash_from_operations"]),
                (12, "Year-five balance check", f"={ref('Balance',bstart+16,5)}", calc["forecast"][-1]["balance_check"]))
        for row, label, formula, value in rows:
            if si == 1:
                summary.write(row, 0, label)
            put(summary, row, si, formula, value,
                "percent_formula" if row == 6 else "check" if row == 12 else "formula")
    summary.write(15, 0, "Frozen case ID: " + saved["id"], formats["note"])
    summary.write(16, 0, "Input SHA-256: " + saved["input_hash"], formats["note"])
    summary.write(17, 0, "Result SHA-256: " + saved["result_hash"], formats["note"])
    summary.write(19, 0, result["lease_convention"], formats["note"])
    summary.write(20, 0, result["cash_convention"], formats["note"])
    summary.write(21, 0, inputs["notes"], formats["note"])
    for row in (19, 20, 21):
        summary.set_row(row, 60)
    checks = sheets["Checks"]
    checks.merge_range("A1:G1", "Accounting and source checks", formats["title"])
    checks.write("A2", "Zero balance differences show calculation integrity, not source or decision readiness.", formats["note"])
    for si, name in enumerate(SCENARIOS):
        row = 5 + si * 3
        checks.write(row, 0, name.upper(), formats["head"])
        for y in range(1,6):
            checks.write(row, y, f"Year {y}", formats["head"])
            bstart = 5 + si * 21
            put(checks, row+1, y, f"={ref('Balance',bstart+16,y)}", 0, "check")
    checks.write(17, 0, "Historical reconciliation: " + result["historical_reconciliation"], formats["check"])
    book.close()
    return output.getvalue()
