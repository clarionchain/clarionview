"""Data fetching and statistical computations."""
import asyncio
import logging
import time
from typing import Optional

import httpx
import numpy as np
import pandas as pd
import yfinance as yf
from scipy import stats

import config

log = logging.getLogger(__name__)

# ── Statistical helpers ───────────────────────────────────────────────────────

def compute_zscore(series: pd.Series) -> Optional[float]:
    """Z-score of the last value relative to full history. Requires ≥30 points."""
    clean = series.dropna()
    if len(clean) < 30:
        return None
    std = clean.std()
    if std == 0 or not np.isfinite(float(std)):
        return None
    z = float((clean.iloc[-1] - clean.mean()) / std)
    return round(z, 3) if np.isfinite(z) else None


def compute_percentile(series: pd.Series) -> Optional[float]:
    """Percentage of historical values below the current value (0–100)."""
    clean = series.dropna()
    if len(clean) < 30:
        return None
    return round(float(stats.percentileofscore(clean, clean.iloc[-1], kind="rank")), 1)


def rsi(series: pd.Series, period: int = 14) -> Optional[float]:
    """Relative Strength Index of the last bar."""
    clean = series.dropna()
    if len(clean) < period + 1:
        return None
    delta = clean.diff().dropna()
    avg_gain = delta.clip(lower=0).rolling(period).mean().iloc[-1]
    avg_loss = (-delta.clip(upper=0)).rolling(period).mean().iloc[-1]
    if avg_loss == 0:
        return 100.0
    return round(float(100 - (100 / (1 + avg_gain / avg_loss))), 2)


def pct_change(series: pd.Series, days: int) -> Optional[float]:
    """Percentage change over `days` bars."""
    clean = series.dropna()
    if len(clean) <= days:
        return None
    return round(float((clean.iloc[-1] / clean.iloc[-days - 1] - 1) * 100), 2)


# ── BitView fetcher ───────────────────────────────────────────────────────────

async def fetch_bitview_series(client: httpx.AsyncClient, name: str) -> pd.Series:
    """Fetch a single BitView series as a date-indexed pd.Series."""
    try:
        dates_r, vals_r = await asyncio.gather(
            client.get(f"{config.BITVIEW_BASE}/api/series/date/day"),
            client.get(f"{config.BITVIEW_BASE}/api/series/{name}/day/data"),
        )
        dates_r.raise_for_status()
        vals_r.raise_for_status()
        dates = dates_r.json()["data"]
        values = vals_r.json()
        pairs = {
            dates[i]: values[i]
            for i in range(min(len(dates), len(values)))
            if values[i] is not None
        }
        s = pd.Series(pairs, name=name, dtype=float)
        s.index = pd.to_datetime(s.index)
        return s
    except Exception as e:
        log.warning("BitView fetch failed for %s: %s", name, e)
        return pd.Series(name=name, dtype=float)


async def fetch_bitview_batch(names: list[str]) -> dict[str, pd.Series]:
    """Fetch multiple BitView series concurrently."""
    async with httpx.AsyncClient(timeout=30) as client:
        results = await asyncio.gather(*[fetch_bitview_series(client, n) for n in names])
    return {s.name: s for s in results}


# ── Report data bundle ────────────────────────────────────────────────────────

REPORT_BV_SERIES = [
    "price", "mvrv", "nupl", "sopr_24h", "realized_price",
    "true_market_mean", "hash_rate", "puell_multiple",
    "lth_supply", "sth_supply", "supply_in_profit",
    "rhodl_ratio", "reserve_risk", "stock_to_flow",
]

REPORT_YF_TICKERS = ["MSTR", "IBIT", "MARA", "RIOT"]
REPORT_FRED_SERIES = ["FEDFUNDS", "M2SL"]


async def fetch_report_data() -> dict:
    """Fetch all data needed for the overnight report."""
    bv = await fetch_bitview_batch(REPORT_BV_SERIES)

    yf_data: dict[str, pd.Series] = {}
    for ticker in REPORT_YF_TICKERS:
        try:
            hist = yf.Ticker(ticker).history(period="2y", auto_adjust=True)
            if not hist.empty:
                yf_data[ticker] = hist["Close"]
        except Exception as e:
            log.warning("yfinance fetch failed for %s: %s", ticker, e)

    fred_data: dict[str, pd.Series] = {}
    if config.FRED_API_KEY:
        for fred_id in REPORT_FRED_SERIES:
            try:
                resp = httpx.get(
                    "https://api.stlouisfed.org/fred/series/observations",
                    params={
                        "series_id": fred_id,
                        "api_key": config.FRED_API_KEY,
                        "file_type": "json",
                        "observation_start": "2012-01-01",
                    },
                    timeout=15,
                )
                resp.raise_for_status()
                obs = resp.json().get("observations", [])
                pairs = {o["date"]: float(o["value"]) for o in obs if o["value"] != "."}
                fred_data[fred_id] = pd.Series(pairs, dtype=float)
            except Exception as e:
                log.warning("FRED fetch failed for %s: %s", fred_id, e)

    return {"bv": bv, "yf": yf_data, "fred": fred_data}


# ── MRI computation ───────────────────────────────────────────────────────────

MRI_PRICING_MODELS = [
    "realized_price", "true_market_mean", "cointime_price",
    "active_price", "investor_price", "vaulted_price",
]

_mri_cache: Optional[dict] = None
_mri_cache_at: float = 0.0
MRI_CACHE_TTL = 6 * 3600  # 6 hours


async def compute_mri() -> dict:
    """Compute all MRI components, cached for 6 hours."""
    global _mri_cache, _mri_cache_at
    now = time.monotonic()
    if _mri_cache is not None and (now - _mri_cache_at) < MRI_CACHE_TTL:
        return _mri_cache

    log.info("Computing MRI (%d series)...", len(MRI_PRICING_MODELS) + 1)
    series_names = ["price"] + MRI_PRICING_MODELS
    fetched = await fetch_bitview_batch(series_names)

    price = fetched.get("price", pd.Series(dtype=float))
    df = pd.DataFrame({"price": price})
    for name in MRI_PRICING_MODELS:
        df[name] = fetched.get(name, pd.Series(dtype=float))
    df = df.dropna()

    if df.empty:
        log.warning("MRI: no aligned data after dropna")
        return {}

    pct_cols: list[str] = []
    for name in MRI_PRICING_MODELS:
        ratio = (df["price"] / df[name]).values
        pcts = np.full(len(ratio), np.nan, dtype=float)
        mask = np.isfinite(ratio)
        n_fin = int(mask.sum())
        if n_fin > 1:
            r = stats.rankdata(ratio[mask], method="average")
            pcts[mask] = (r - 1) / (n_fin - 1) * 100
        col = f"_pct_{name}"
        df[col] = pcts
        pct_cols.append(col)

    df["mri_index"] = df[pct_cols].mean(axis=1, skipna=True)
    df["mri_ceiling"] = df[pct_cols].max(axis=1, skipna=True)
    df["mri_floor"] = df[pct_cols].min(axis=1, skipna=True)
    df["mri_spread"] = df["mri_ceiling"] - df["mri_floor"]
    df["mri_slow"] = df["mri_index"].rolling(30, min_periods=1).mean()

    def to_list(col: str) -> list:
        return [
            {"time": t.strftime("%Y-%m-%d"), "value": round(float(v), 2)}
            for t, v in df[col].items()
            if np.isfinite(v)
        ]

    result = {
        "mri_index":   to_list("mri_index"),
        "mri_fast":    to_list("mri_index"),
        "mri_slow":    to_list("mri_slow"),
        "mri_ceiling": to_list("mri_ceiling"),
        "mri_floor":   to_list("mri_floor"),
        "mri_spread":  to_list("mri_spread"),
    }
    _mri_cache = result
    _mri_cache_at = now
    log.info("MRI computed: %d data points", len(result["mri_index"]))
    return result
