"""Rule-based on-chain signal detection."""
import logging
from typing import Optional

import pandas as pd

from data import pct_change

log = logging.getLogger(__name__)


def _sig(
    sig_type: str,
    level: str,
    title: str,
    body: str,
    metric: str,
    value: float,
) -> dict:
    return {
        "type": sig_type,
        "level": level,
        "title": title,
        "body": body,
        "metric": metric,
        "value": round(float(value), 6),
    }


def detect_signals(bv: dict[str, pd.Series], mri_components: dict) -> list[dict]:
    """
    Evaluate on-chain metrics and MRI against historical thresholds.
    Returns a list of signal dicts ordered by severity (critical → warning → info).
    """
    signals: list[dict] = []

    price_s: pd.Series = bv.get("price", pd.Series(dtype=float)).dropna()
    mvrv_s: pd.Series = bv.get("mvrv", pd.Series(dtype=float)).dropna()
    nupl_s: pd.Series = bv.get("nupl", pd.Series(dtype=float)).dropna()
    sopr_s: pd.Series = bv.get("sopr_24h", pd.Series(dtype=float)).dropna()

    mri_data = mri_components.get("mri_index", [])
    mri_val: Optional[float] = mri_data[-1]["value"] if mri_data else None

    # ── Price move ────────────────────────────────────────────────────────────
    if len(price_s) >= 2:
        chg_1d = pct_change(price_s, 1)
        if chg_1d is not None and abs(chg_1d) >= 5:
            direction = "surged" if chg_1d > 0 else "dropped"
            signals.append(_sig(
                "price_move",
                "warning" if abs(chg_1d) >= 10 else "info",
                f"Bitcoin {direction} {abs(chg_1d):.1f}% in 24h",
                f"BTC moved {chg_1d:+.1f}% in 24 hours, reaching ${price_s.iloc[-1]:,.0f}.",
                "price",
                price_s.iloc[-1],
            ))

    # ── MRI ───────────────────────────────────────────────────────────────────
    if mri_val is not None:
        if mri_val >= 90:
            signals.append(_sig(
                "mri_extreme_overbought", "critical",
                "MRI: Extreme Overbought",
                f"Mean Reversion Index at {mri_val:.1f} — top 10% of all readings. "
                "Bitcoin is significantly overextended relative to pricing models. "
                "Past readings this high have preceded major corrections.",
                "mri_index", mri_val,
            ))
        elif mri_val >= 75:
            signals.append(_sig(
                "mri_overbought", "warning",
                "MRI: Entering Overbought Zone",
                f"Mean Reversion Index at {mri_val:.1f} — approaching historically elevated levels (>75). "
                "Monitor for signs of exhaustion.",
                "mri_index", mri_val,
            ))
        elif mri_val <= 10:
            signals.append(_sig(
                "mri_extreme_oversold", "critical",
                "MRI: Extreme Oversold",
                f"Mean Reversion Index at {mri_val:.1f} — bottom 10% of all readings. "
                "Bitcoin is deeply undervalued relative to pricing models. "
                "Past readings this low have preceded strong recoveries.",
                "mri_index", mri_val,
            ))
        elif mri_val <= 25:
            signals.append(_sig(
                "mri_oversold", "warning",
                "MRI: Entering Oversold Zone",
                f"Mean Reversion Index at {mri_val:.1f} — historically depressed territory (<25). "
                "May represent an accumulation opportunity.",
                "mri_index", mri_val,
            ))
        else:
            signals.append(_sig(
                "mri_neutral", "info",
                f"MRI: Neutral ({mri_val:.1f})",
                f"Mean Reversion Index at {mri_val:.1f} — within the normal range (25–75). "
                "Bitcoin is fairly valued relative to its historical pricing model distribution.",
                "mri_index", mri_val,
            ))

    # ── MVRV ─────────────────────────────────────────────────────────────────
    if not mvrv_s.empty:
        mvrv = float(mvrv_s.iloc[-1])
        if mvrv >= 3.5:
            signals.append(_sig(
                "mvrv_high", "warning",
                f"MVRV at {mvrv:.2f} — Historically Elevated",
                f"MVRV Ratio of {mvrv:.2f} indicates market value is {mvrv:.1f}× realized value. "
                "Readings above 3.5 have historically coincided with cycle peaks.",
                "mvrv", mvrv,
            ))
        elif mvrv < 1.0:
            signals.append(_sig(
                "mvrv_capitulation", "critical",
                "MVRV Below 1 — Capitulation Zone",
                f"MVRV Ratio at {mvrv:.2f} — market value below realized value. "
                "Historically a rare buying opportunity associated with bear market bottoms.",
                "mvrv", mvrv,
            ))

    # ── NUPL ─────────────────────────────────────────────────────────────────
    if not nupl_s.empty:
        nupl = float(nupl_s.iloc[-1])
        if nupl >= 0.75:
            signals.append(_sig(
                "nupl_euphoria", "warning",
                f"NUPL: Euphoria/Greed ({nupl:.2f})",
                f"Net Unrealized Profit/Loss at {nupl:.2f} — the greed/euphoria zone. "
                "The average holder is sitting on substantial unrealized gains, a historically cautionary signal.",
                "nupl", nupl,
            ))
        elif nupl < 0:
            signals.append(_sig(
                "nupl_capitulation", "critical",
                f"NUPL: Market in Loss ({nupl:.2f})",
                f"NUPL at {nupl:.2f} — the average holder is underwater. "
                "This level has historically marked major market bottoms.",
                "nupl", nupl,
            ))

    # ── SOPR ─────────────────────────────────────────────────────────────────
    if not sopr_s.empty:
        sopr = float(sopr_s.iloc[-1])
        if sopr >= 1.05:
            signals.append(_sig(
                "sopr_profit_taking", "info",
                f"SOPR: Active Profit Taking ({sopr:.3f})",
                f"SOPR at {sopr:.3f} — coins being spent were acquired at lower prices. "
                "Elevated readings indicate broad profit-taking activity.",
                "sopr_24h", sopr,
            ))
        elif sopr < 0.97:
            signals.append(_sig(
                "sopr_loss_selling", "warning",
                f"SOPR: Selling at a Loss ({sopr:.3f})",
                f"SOPR at {sopr:.3f} — coins being spent were acquired at higher prices. "
                "Sustained loss-selling can indicate capitulation or weak-hand flushing.",
                "sopr_24h", sopr,
            ))

    # Sort: critical first, then warning, then info
    level_order = {"critical": 0, "warning": 1, "info": 2}
    signals.sort(key=lambda s: level_order.get(s["level"], 3))
    return signals
