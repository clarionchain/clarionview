"""Tests for statistical helper functions in data.py."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

# Add python/ to path so imports work
sys.path.insert(0, str(Path(__file__).parent.parent))

from data import compute_zscore, compute_percentile, rsi, pct_change


def _series(values: list[float]) -> pd.Series:
    return pd.Series(values, dtype=float)


class TestComputeZscore:
    def test_returns_none_for_short_series(self):
        assert compute_zscore(_series([1.0] * 29)) is None

    def test_returns_zero_for_uniform_series(self):
        # All same values → std=0 → z-score is undefined, returns nan → we return None
        s = _series([5.0] * 50)
        # std=0, so this would divide by zero; function should handle gracefully
        # In practice pandas returns nan, and float(nan) is nan
        result = compute_zscore(s)
        assert result is None or (result is not None and not np.isfinite(result)) or result == 0.0

    def test_returns_positive_for_above_mean(self):
        base = [1.0] * 50
        base[-1] = 100.0
        result = compute_zscore(_series(base))
        assert result is not None and result > 0

    def test_returns_negative_for_below_mean(self):
        base = [100.0] * 50
        base[-1] = 1.0
        result = compute_zscore(_series(base))
        assert result is not None and result < 0

    def test_returns_float_with_3_decimals(self):
        s = _series(list(range(1, 51)))
        result = compute_zscore(s)
        assert isinstance(result, float)
        assert round(result, 3) == result


class TestComputePercentile:
    def test_returns_none_for_short_series(self):
        assert compute_percentile(_series([1.0] * 20)) is None

    def test_min_value_near_zero_percentile(self):
        s = _series(list(range(1, 51)))
        # Temporarily make last value the minimum
        vals = list(range(2, 51)) + [1]
        result = compute_percentile(_series(vals))
        assert result is not None and result < 10

    def test_max_value_near_100_percentile(self):
        s = _series(list(range(1, 51)))
        result = compute_percentile(s)
        assert result is not None and result > 90

    def test_range_0_to_100(self):
        for last in [1, 25, 50, 75, 100]:
            vals = list(range(1, 100)) + [last]
            result = compute_percentile(_series(vals))
            assert result is not None
            assert 0 <= result <= 100


class TestRsi:
    def test_returns_none_for_short_series(self):
        assert rsi(_series([1.0] * 14)) is None

    def test_all_gains_returns_100(self):
        # Monotonically increasing series → RSI = 100
        s = _series(list(range(1, 30)))
        result = rsi(s)
        assert result == 100.0

    def test_in_range_0_to_100(self):
        import random
        random.seed(42)
        vals = [50.0]
        for _ in range(50):
            vals.append(vals[-1] + random.uniform(-2, 2))
        result = rsi(_series(vals))
        assert result is not None
        assert 0 <= result <= 100


class TestPctChange:
    def test_returns_none_for_too_few_points(self):
        assert pct_change(_series([1.0, 2.0]), 5) is None

    def test_positive_change(self):
        vals = [100.0] * 10 + [110.0]
        result = pct_change(_series(vals), 1)
        assert result == pytest.approx(10.0, abs=0.01)

    def test_negative_change(self):
        vals = [100.0] * 10 + [90.0]
        result = pct_change(_series(vals), 1)
        assert result == pytest.approx(-10.0, abs=0.01)

    def test_no_change(self):
        vals = [100.0] * 10
        result = pct_change(_series(vals), 1)
        assert result == pytest.approx(0.0, abs=0.01)
