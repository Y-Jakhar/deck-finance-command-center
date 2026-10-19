"""One reviewed research rule; simulation, costing and artifacts remain StrategyLab's."""

from strategylab.strategies import REGISTRY, _strategy


def sma_long_cash(history, parameters):
    """Hold long when fast SMA exceeds slow SMA; otherwise cash, including warm-up."""
    fast, slow = int(parameters.get("fast", 20)), int(parameters.get("slow", 100))
    if fast < 1 or slow <= fast or len(history) < slow:
        return 0
    return int(
        sum(b.close for b in history[-fast:]) / fast > sum(b.close for b in history[-slow:]) / slow
    )


REGISTRY["sma_long_cash"] = _strategy(
    "sma_long_cash",
    "1.0",
    "Long/cash close SMA crossover; next-open execution.",
    {"fast": 20, "slow": 100},
    sma_long_cash,
)
