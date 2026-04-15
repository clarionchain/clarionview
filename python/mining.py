"""
Bitcoin Mining Intelligence — fundamentals + public company data.

Returns:
  fundamentals  — hash rate, Puell multiple, hash price, difficulty metrics
  companies     — all public miners: price, changes, market cap, beta vs BTC
  hash_rate_series / puell_series — time-series for charts
"""
import logging
import time
from datetime import datetime, timezone, date

import numpy as np
import pandas as pd
import yfinance as yf

import config
from data import fetch_bitview_batch, compute_zscore, compute_percentile, pct_change

log = logging.getLogger(__name__)

_cache: dict | None = None
_cache_at: float = 0.0
CACHE_TTL = 1800  # 30 min — mining data changes slowly


MINING_COMPANIES = [
    ("MARA",  "Marathon Digital Holdings"),
    ("RIOT",  "Riot Platforms"),
    ("CLSK",  "CleanSpark"),
    ("CORZ",  "Core Scientific"),
    ("CIFR",  "Cipher Mining"),
    ("WULF",  "TeraWulf"),
    ("HUT",   "Hut 8 Corp"),
    ("BTBT",  "Bit Digital"),
    ("IREN",  "Iris Energy"),
    ("BTDR",  "Bitdeer Technologies"),
    ("HIVE",  "HIVE Digital Technologies"),
    ("GRIID", "GRIID Infrastructure"),
]

MINING_BV_SERIES = ["hash_rate", "puell_multiple", "price"]


def _ytd_change(series: pd.Series) -> float | None:
    """% change from Jan 1 of current year to latest value."""
    if series.dropna().empty:
        return None
    year_start = date(date.today().year, 1, 1)
    # Find first available value at or after year start
    try:
        idx = series.index
        if hasattr(idx[0], 'date'):
            mask = pd.Series([d.date() >= year_start for d in idx], index=idx)
        else:
            mask = idx >= str(year_start)
        sub = series[mask].dropna()
        if len(sub) < 2:
            return None
        return round((float(sub.iloc[-1]) / float(sub.iloc[0]) - 1) * 100, 2)
    except Exception:
        return None


def _beta_vs_btc(stock: pd.Series, btc: pd.Series, days: int = 90) -> float | None:
    """Beta of stock returns vs BTC returns over `days` days."""
    try:
        s = stock.dropna().tail(days)
        b = btc.dropna().tail(days)
        # Align by date
        s.index = pd.to_datetime(s.index).normalize()
        b.index = pd.to_datetime(b.index).normalize()
        common = s.index.intersection(b.index)
        if len(common) < 20:
            return None
        sr = s[common].pct_change().dropna()
        br = b[common].pct_change().dropna()
        common2 = sr.index.intersection(br.index)
        if len(common2) < 15:
            return None
        sr, br = sr[common2].values, br[common2].values
        var_btc = float(np.var(br))
        if var_btc == 0:
            return None
        beta = float(np.cov(sr, br)[0, 1] / var_btc)
        return round(beta, 2)
    except Exception:
        return None


async def fetch_all() -> dict:
    global _cache, _cache_at
    now = time.time()
    if _cache and (now - _cache_at) < CACHE_TTL:
        return _cache

    log.info("Mining: fetching data…")

    # ── On-chain fundamentals ─────────────────────────────────────────────────
    bv = await fetch_bitview_batch(MINING_BV_SERIES)
    hash_s   = bv.get("hash_rate",      pd.Series(dtype=float)).dropna()
    puell_s  = bv.get("puell_multiple", pd.Series(dtype=float)).dropna()
    price_s  = bv.get("price",          pd.Series(dtype=float)).dropna()

    def _fund(label: str, series: pd.Series, unit: str = "", fmt=None) -> dict:
        if series.empty:
            return {"label": label, "value": None, "value_fmt": "N/A", "unit": unit,
                    "zscore": None, "percentile": None}
        val = float(series.iloc[-1])
        val_fmt = fmt(val) if fmt else f"{val:.4g}{unit}"
        return {
            "label": label,
            "value": round(val, 6),
            "value_fmt": val_fmt,
            "unit": unit,
            "zscore": compute_zscore(series),
            "percentile": compute_percentile(series),
            "change_30d": pct_change(series, 30),
            "change_90d": pct_change(series, 90),
        }

    def fmt_hash(v):
        # BitView hash_rate is in H/s
        if v >= 1e21:
            return f"{v/1e21:.2f} ZH/s"
        if v >= 1e18:
            return f"{v/1e18:.1f} EH/s"
        if v >= 1e15:
            return f"{v/1e15:.1f} PH/s"
        if v >= 1e12:
            return f"{v/1e12:.1f} TH/s"
        return f"{v:.2g} H/s"

    fundamentals = {
        "hash_rate": _fund("Hash Rate", hash_s, fmt=fmt_hash),
        "puell_multiple": _fund("Puell Multiple", puell_s,
                                fmt=lambda v: f"{v:.3f}"),
    }

    # Hash price = (Puell × average_daily_subsidy_USD_historical) / hash_rate
    # Approximation: puell_multiple = miner_daily_revenue / 365d_avg_revenue
    # Not directly computable without miner_revenue series — show N/A if unavailable

    # Difficulty (approximate from hash rate: difficulty ≈ hash_rate × 600 / 2^32)
    if not hash_s.empty:
        # BitView hash_rate is already in H/s; difficulty ≈ HR × 600 / 2^32
        hr_hs = float(hash_s.iloc[-1])
        diff_approx = hr_hs * 600 / (2 ** 32)
        fundamentals["difficulty"] = {
            "label": "Est. Difficulty",
            "value": round(diff_approx, 0),
            "value_fmt": f"{diff_approx/1e12:.2f} T",
            "unit": "",
            "zscore": None,
            "percentile": None,
            "change_30d": None,
            "change_90d": None,
        }

    # ── Chart series (last 365 days) ──────────────────────────────────────────
    tail = 365

    def _to_series(s: pd.Series, t: int = tail) -> list[dict]:
        sub = s.tail(t)
        return [{"time": idx.strftime("%Y-%m-%d"), "value": round(float(v), 6)}
                for idx, v in sub.items()]

    hash_series  = _to_series(hash_s)
    puell_series = _to_series(puell_s)

    # ── Mining companies ──────────────────────────────────────────────────────
    companies = []
    for ticker, name in MINING_COMPANIES:
        try:
            t = yf.Ticker(ticker)
            hist = t.history(period="1y", auto_adjust=True)
            if hist.empty:
                continue
            price_col = hist["Close"].dropna()
            if price_col.empty:
                continue

            cur_price = float(price_col.iloc[-1])

            # Market cap from fast_info (lightweight, no extra API call)
            mktcap = None
            try:
                fi = t.fast_info
                mc = getattr(fi, "market_cap", None)
                if mc and mc > 0:
                    mktcap = int(mc)
            except Exception:
                pass

            # Volume (10-day avg)
            vol_avg = None
            if "Volume" in hist.columns:
                vol_series = hist["Volume"].dropna().tail(10)
                if not vol_series.empty:
                    vol_avg = int(vol_series.mean())

            beta = _beta_vs_btc(price_col, price_s)

            companies.append({
                "ticker":      ticker,
                "name":        name,
                "price":       round(cur_price, 2),
                "change_1d":   pct_change(price_col, 1),
                "change_7d":   pct_change(price_col, 7),
                "change_30d":  pct_change(price_col, 30),
                "change_ytd":  _ytd_change(price_col),
                "market_cap":  mktcap,
                "vol_10d_avg": vol_avg,
                "beta_btc":    beta,
            })
            log.info("Mining company OK: %s $%.2f", ticker, cur_price)
        except Exception as e:
            log.warning("Mining company failed %s: %s", ticker, e)

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "fundamentals": fundamentals,
        "hash_rate_series": hash_series,
        "puell_series": puell_series,
        "companies": companies,
    }
    _cache = result
    _cache_at = now
    return result
