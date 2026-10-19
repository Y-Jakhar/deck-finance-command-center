"""Limited long-only buy-and-hold analysis of existing validated price snapshots.

No execution, dividends, FX conversion, rebalancing or optimization is implied.
"""

from math import isclose, sqrt
from statistics import correlation, mean, stdev


def analyze_portfolio(holdings, benchmark, initial_capital, annual_bars, risk_free_rate):
    if not isclose(sum(h["weight"] for h in holdings), 1, abs_tol=1e-9):
        raise ValueError("Initial weights must sum to 1")
    datasets = [h["dataset"] for h in holdings] + ([benchmark] if benchmark else [])
    if len({d["currency"].upper() for d in datasets}) != 1:
        raise ValueError(
            "Holdings and benchmark must share a currency; FX conversion is unsupported"
        )
    if len({d["frequency"] for d in datasets}) != 1:
        raise ValueError("Holdings and benchmark must share a frequency")
    if len({h["dataset"]["symbol"] for h in holdings}) != len(holdings):
        raise ValueError("Use one price snapshot per holding symbol")
    maps = [{b.timestamp: b.close for b in d["bars"]} for d in datasets]
    times = sorted(set.intersection(*(set(m) for m in maps)))
    if len(times) < 3:
        raise ValueError("At least three exactly aligned observations required; no forward fill")
    prices = [[m[t] for t in times] for m in maps]
    units = [initial_capital * h["weight"] / p[0] for h, p in zip(holdings, prices)]
    values = [sum(u * p[i] for u, p in zip(units, prices)) for i in range(len(times))]
    returns = [b / a - 1 for a, b in zip(values, values[1:])]
    peak = values[0]
    drawdowns = []
    for value in values:
        peak = max(peak, value)
        drawdowns.append(value / peak - 1)
    sigma = stdev(returns)
    rf_bar = (1 + risk_free_rate) ** (1 / annual_bars) - 1
    asset_returns = [[b / a - 1 for a, b in zip(p, p[1:])] for p in prices[: len(holdings)]]
    correlations = [
        [correlation(a, b) if stdev(a) > 0 and stdev(b) > 0 else None for b in asset_returns]
        for a in asset_returns
    ]
    equity = [
        {"timestamp": t.isoformat(), "equity": v, "drawdown": dd}
        for t, v, dd in zip(times, values, drawdowns)
    ]
    compare = None
    if benchmark:
        curve = [initial_capital * p / prices[-1][0] for p in prices[-1]]
        compare = {
            "symbol": benchmark["symbol"],
            "source": benchmark["source"],
            "dataset_id": benchmark["id"],
            "price_return": curve[-1] / curve[0] - 1,
            "equity_curve": curve,
            "excess_price_return": values[-1] / values[0] - curve[-1] / curve[0],
        }
    return {
        "engine": "limited-buy-and-hold-v1",
        "aligned_bars": len(times),
        "start": times[0].isoformat(),
        "end": times[-1].isoformat(),
        "annual_bars": annual_bars,
        "risk_free_rate": risk_free_rate,
        "metrics": {
            "price_return": values[-1] / values[0] - 1,
            "annualized_volatility": sigma * sqrt(annual_bars),
            "annualized_geometric_return": (values[-1] / values[0])
            ** (annual_bars / (len(values) - 1))
            - 1,
            "max_drawdown": min(drawdowns),
            "sharpe": (mean(returns) - rf_bar) / sigma * sqrt(annual_bars) if sigma > 0 else None,
        },
        "holdings": [
            {
                "symbol": h["dataset"]["symbol"],
                "dataset_id": h["dataset"]["id"],
                "initial_weight": h["weight"],
                "units": u,
                "initial_value": u * p[0],
                "ending_value": u * p[-1],
                "ending_weight": u * p[-1] / values[-1],
                "source": h["dataset"]["source"],
                "currency": h["dataset"]["currency"],
                "adjustment_policy": h["dataset"]["adjustment_policy"],
            }
            for h, p, u in zip(holdings, prices, units)
        ],
        "correlation": correlations,
        "equity_curve": equity,
        "benchmark": compare,
        "dropped_observations": [
            {"dataset_id": d["id"], "excluded_bars": len(m) - len(times)}
            for d, m in zip(datasets, maps)
        ],
        "limitations": [
            "Historical hypothetical buy-and-hold at first aligned close; fractional units; initial weights drift.",
            "Exact UTC timestamp intersection across holdings and benchmark. No fill or exchange-calendar normalization.",
            "Price-only: no added dividends, trading costs, tax, FX, cash flows, corporate actions or rebalancing.",
            "Annualization assumes the analyst-declared bars/year and treats adjacent aligned observations as one period.",
            "Sharpe uses sample simple-return deviation and annual risk-free rate converted to a per-bar rate.",
            "Correlation is null when either series has zero variance. Sector, factor and derivative exposures unsupported.",
        ],
    }
