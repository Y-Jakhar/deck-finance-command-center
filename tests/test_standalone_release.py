"""Verify the public package can boot with no authorized sibling engines."""

import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_standalone_startup_and_unavailable_contract(tmp_path):
    env = os.environ.copy()
    env["RESEARCHDESK_PROJECTS"] = str(tmp_path / "missing-siblings")
    env["RESEARCHDESK_DATA"] = str(tmp_path / "runtime")
    env.pop("RESEARCHDESK_EVIDENCE_STAGING_ROOT", None)
    code = """
from fastapi.testclient import TestClient
import sqlite3
from pathlib import Path
import researchdesk as rd

assert set(rd.INTEGRATIONS.values()) == {'unavailable'}
with TestClient(rd.app) as client:
    health = client.get('/api/desk/health')
    assert health.status_code == 200 and health.json()['schema_version'] == 7
    assert client.get('/api/desk/integrations').json()['standalone'] is True
    assert client.get('/api/desk/watchlists').json() == []
    assert client.get('/api/desk/valuation-cases-v2').json() == []
    assert client.get('/api/desk/journal').json() == []
    journal = client.post('/api/desk/journal', json={
        'symbol': 'SYN', 'title': 'Synthetic decision',
        'thesis': 'Fixture only; no investment conclusion',
    })
    assert journal.status_code == 200, journal.text
    entry = journal.json()
    assert entry['version'] == 1
    assert client.get('/api/desk/journal?symbol=SYN').json()[0]['id'] == entry['id']
    source = {
        'symbol': 'SYN', 'currency': 'USD', 'units': 'millions',
        'source': 'Synthetic standalone fixture', 'notes': 'Deliberately incomplete',
        'prior_period_end': '2024-12-31', 'period_end': '2025-12-31',
        'income_statement': {'revenue': [80, 100], 'ebit': [16, 20]},
        'balance_sheet': {'cash': [4, 5]}, 'cash_flow': {'capex': [7, 10]},
    }
    statement = client.post('/api/desk/statements', json=source)
    assert statement.status_code == 200, statement.text
    analysis = client.get('/api/desk/statements/' + statement.json()['id'] + '/analysis')
    assert analysis.status_code == 200, analysis.text
    assert analysis.json()['periods']['2025-12-31']['roic'] is None
    scenario = {
        'rationale': 'Synthetic independent operating assumptions',
        'operating_assumptions_source': 'Synthetic fixture',
        'discount_source': 'Synthetic financing fixture',
        'revenue_growth': [0] * 5, 'ebit_margin': [.2] * 5,
        'da_percent_revenue': [.05] * 5,
        'cash_capex_percent_revenue': [.1] * 5,
        'finance_lease_additions_percent_revenue': [0] * 5,
        'nwc_investment_percent_revenue_change': [.1] * 5,
        'operating_tax_rate': .25, 'cost_of_equity': .12,
        'pretax_cost_of_debt': .06, 'market_debt_weight': .25,
        'marginal_debt_tax_rate': .25,
        'terminal_method': 'perpetuity_growth', 'terminal_growth': .02,
    }
    valuation = {
        'model_version': '1.0', 'symbol': 'SYN', 'title': 'Synthetic control',
        'currency': 'USD', 'units': 'millions', 'valuation_date': '2025-12-31',
        'lease_treatment': 'operating_expensed_finance_capitalized',
        'history': [
            {'period_end': '2023-12-31', 'source_reference': 'Synthetic 2023', 'revenue': 80, 'ebit': 16},
            {'period_end': '2024-12-31', 'source_reference': 'Synthetic 2024', 'revenue': 90, 'ebit': 18},
            {'period_end': '2025-12-31', 'source_reference': 'Synthetic 2025', 'revenue': 100, 'ebit': 20},
        ],
        'bridge': {
            'excess_cash': 5, 'non_operating_assets': 0, 'borrowings': 30,
            'finance_lease_liabilities': 5, 'minority_interest': 2,
            'other_non_equity_claims': 0, 'diluted_shares': 10,
            'source_reference': 'Synthetic bridge',
        },
        'scenarios': {key: scenario for key in ('bear', 'base', 'bull')},
        'notes': 'Synthetic only',
    }
    preview = client.post('/api/desk/valuation-cases-v2/preview', json=valuation)
    assert preview.status_code == 200, preview.text
    base = preview.json()['scenarios']['base']
    assert abs(base['wacc'] - .10125) < 1e-12
    assert abs(base['forecast'][0]['fcff'] - 10) < 1e-12
    assert client.get('/api/desk/strategies').status_code == 503
    assert client.get('/api/desk/company/AAPL').status_code == 503
    assert client.get('/api/v1/search').status_code == 503
    assert client.get('/api/unknown-service').status_code == 503
    assert client.get('/').status_code in (200, 503)
db = sqlite3.connect(Path(rd.DATA) / 'research.db')
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert db.execute('PRAGMA user_version').fetchone()[0] == 7
"""
    result = subprocess.run(
        [sys.executable, "-c", code], cwd=ROOT, env=env,
        capture_output=True, text=True, timeout=45, check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
