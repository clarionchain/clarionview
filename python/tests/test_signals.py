"""Tests for signal detection in signals.py."""
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from signals import detect_signals


def _bv(price: list[float] | None = None, mvrv: list[float] | None = None,
        nupl: list[float] | None = None, sopr: list[float] | None = None) -> dict:
    return {
        "price": pd.Series(price or [], dtype=float),
        "mvrv": pd.Series(mvrv or [], dtype=float),
        "nupl": pd.Series(nupl or [], dtype=float),
        "sopr_24h": pd.Series(sopr or [], dtype=float),
    }


def _mri(val: float) -> dict:
    return {"mri_index": [{"time": "2026-01-01", "value": val}]}


class TestMriSignals:
    def test_extreme_overbought(self):
        sigs = detect_signals(_bv(), _mri(92))
        assert any(s["type"] == "mri_extreme_overbought" for s in sigs)
        assert any(s["level"] == "critical" for s in sigs)

    def test_overbought(self):
        sigs = detect_signals(_bv(), _mri(80))
        assert any(s["type"] == "mri_overbought" for s in sigs)
        assert any(s["level"] == "warning" for s in sigs)

    def test_extreme_oversold(self):
        sigs = detect_signals(_bv(), _mri(5))
        assert any(s["type"] == "mri_extreme_oversold" for s in sigs)
        assert any(s["level"] == "critical" for s in sigs)

    def test_oversold(self):
        sigs = detect_signals(_bv(), _mri(20))
        assert any(s["type"] == "mri_oversold" for s in sigs)

    def test_neutral(self):
        sigs = detect_signals(_bv(), _mri(50))
        assert any(s["type"] == "mri_neutral" for s in sigs)
        assert any(s["level"] == "info" for s in sigs)

    def test_no_mri(self):
        # Should not crash and produce no MRI signals
        sigs = detect_signals(_bv(), {})
        assert not any("mri" in s["type"] for s in sigs)


class TestMvrvSignals:
    def test_high_mvrv(self):
        sigs = detect_signals(_bv(mvrv=[3.8]), _mri(50))
        assert any(s["type"] == "mvrv_high" for s in sigs)

    def test_capitulation_mvrv(self):
        sigs = detect_signals(_bv(mvrv=[0.8]), _mri(50))
        assert any(s["type"] == "mvrv_capitulation" for s in sigs)
        assert any(s["level"] == "critical" for s in sigs)

    def test_normal_mvrv_no_signal(self):
        sigs = detect_signals(_bv(mvrv=[2.0]), _mri(50))
        assert not any("mvrv" in s["type"] for s in sigs)


class TestNuplSignals:
    def test_euphoria(self):
        sigs = detect_signals(_bv(nupl=[0.8]), _mri(50))
        assert any(s["type"] == "nupl_euphoria" for s in sigs)

    def test_capitulation(self):
        sigs = detect_signals(_bv(nupl=[-0.1]), _mri(50))
        assert any(s["type"] == "nupl_capitulation" for s in sigs)
        assert any(s["level"] == "critical" for s in sigs)


class TestSoprSignals:
    def test_profit_taking(self):
        sigs = detect_signals(_bv(sopr=[1.08]), _mri(50))
        assert any(s["type"] == "sopr_profit_taking" for s in sigs)

    def test_loss_selling(self):
        sigs = detect_signals(_bv(sopr=[0.95]), _mri(50))
        assert any(s["type"] == "sopr_loss_selling" for s in sigs)


class TestPriceSignals:
    def test_large_pump_generates_signal(self):
        prices = [80000.0] * 10 + [88000.0]  # +10% move
        sigs = detect_signals(_bv(price=prices), _mri(50))
        assert any(s["type"] == "price_move" for s in sigs)

    def test_small_move_no_signal(self):
        prices = [80000.0] * 10 + [80100.0]  # tiny move
        sigs = detect_signals(_bv(price=prices), _mri(50))
        assert not any(s["type"] == "price_move" for s in sigs)


class TestSignalOrdering:
    def test_critical_before_warning_before_info(self):
        sigs = detect_signals(
            _bv(mvrv=[0.8], nupl=[0.8], sopr=[1.08]),
            _mri(92),
        )
        levels = [s["level"] for s in sigs]
        level_order = {"critical": 0, "warning": 1, "info": 2}
        assert levels == sorted(levels, key=lambda l: level_order[l])
