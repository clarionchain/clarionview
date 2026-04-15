"""
Bitcoin Mining Intelligence — fundamentals + public company data.

Returns:
  fundamentals  — hash rate, Puell multiple, hash price, difficulty metrics
  companies     — all public miners: price, changes, market cap, beta vs BTC
  hash_rate_series / puell_series — time-series for charts
"""
import asyncio
import json
import logging
import time
from datetime import datetime, timezone, date
from functools import partial
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

import config
from data import fetch_bitview_batch, compute_zscore, compute_percentile, pct_change

log = logging.getLogger(__name__)

_cache: dict | None = None
_cache_at: float = 0.0
CACHE_TTL = 1800  # 30 min — mining data changes slowly

# Disk cache for company equity data (survives restarts; falls back if Yahoo blocks us)
_COMPANY_DISK_CACHE = Path(str(config.REPORTS_DIR.parent / "mining_companies.json"))
_COMPANY_DISK_TTL = 3600 * 12  # 12-hour stale tolerance


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
        return round(float(np.cov(sr, br)[0, 1] / var_btc), 2)
    except Exception:
        return None


def _load_company_disk_cache() -> list | None:
    """Return cached company list if fresh enough, else None."""
    try:
        if _COMPANY_DISK_CACHE.exists():
            obj = json.loads(_COMPANY_DISK_CACHE.read_text())
            if time.time() - obj.get("_at", 0) < _COMPANY_DISK_TTL:
                return obj.get("data", [])
    except Exception:
        pass
    return None


def _save_company_disk_cache(companies: list) -> None:
    try:
        _COMPANY_DISK_CACHE.write_text(json.dumps({"_at": time.time(), "data": companies}))
    except Exception as e:
        log.warning("Could not persist company cache: %s", e)


async def _fetch_companies(price_s: pd.Series) -> list[dict]:
    """
    Fetch mining company equity data via a single yf.download() batch call.
    Falls back to disk-persisted data when Yahoo Finance is unreachable.
    """
    tickers_list = [t for t, _ in MINING_COMPANIES]
    loop = asyncio.get_event_loop()

    log.info("Mining: bulk-downloading %d company tickers…", len(tickers_list))
    try:
        raw: pd.DataFrame = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                partial(
                    yf.download,
                    tickers_list,
                    period="max",
                    auto_adjust=True,
                    progress=False,
                    group_by="ticker",
                    threads=True,
                ),
            ),
            timeout=60.0,
        )
    except (asyncio.TimeoutError, Exception) as e:
        log.warning("Bulk yfinance download failed: %s", e)
        cached = _load_company_disk_cache()
        if cached:
            log.info("Falling back to disk cache (%d companies)", len(cached))
        return cached or []

    if raw is None or raw.empty:
        log.warning("Bulk download returned empty DataFrame")
        return _load_company_disk_cache() or []

    is_multi = isinstance(raw.columns, pd.MultiIndex)

    companies: list[dict] = []
    for ticker, name in MINING_COMPANIES:
        try:
            if is_multi:
                if ticker not in raw.columns.get_level_values(0):
                    continue
                close = raw[ticker]["Close"].dropna()
                vol   = raw[ticker]["Volume"].dropna() if "Volume" in raw[ticker].columns else pd.Series(dtype=float)
            else:
                close = raw["Close"].dropna()
                vol   = raw["Volume"].dropna() if "Volume" in raw.columns else pd.Series(dtype=float)

            if close.empty:
                continue

            cur_price = float(close.iloc[-1])
            vol_avg   = int(vol.tail(10).mean()) if not vol.empty else None

            companies.append({
                "ticker":      ticker,
                "name":        name,
                "price":       round(cur_price, 2),
                "change_1d":   pct_change(close, 1),
                "change_7d":   pct_change(close, 7),
                "change_30d":  pct_change(close, 30),
                "change_ytd":  _ytd_change(close),
                "market_cap":  None,
                "vol_10d_avg": vol_avg,
                "beta_btc":    _beta_vs_btc(close, price_s),
            })
            log.info("Company OK: %s $%.2f", ticker, cur_price)
        except Exception as e:
            log.warning("Company processing failed %s: %s", ticker, e)

    if companies:
        _save_company_disk_cache(companies)
        return companies

    # Fresh download produced nothing — use disk cache
    cached = _load_company_disk_cache()
    if cached:
        log.info("Fresh fetch yielded no companies — using disk cache (%d)", len(cached))
        return cached
    return []


async def fetch_all() -> dict:
    global _cache, _cache_at
    now = time.time()
    if _cache and (now - _cache_at) < CACHE_TTL:
        return _cache

    log.info("Mining: fetching data…")

    # ── On-chain fundamentals (BitView) ───────────────────────────────────────
    bv = await fetch_bitview_batch(MINING_BV_SERIES)
    hash_s   = bv.get("hash_rate",      pd.Series(dtype=float)).dropna()
    puell_s  = bv.get("puell_multiple", pd.Series(dtype=float)).dropna()
    price_s  = bv.get("price",          pd.Series(dtype=float)).dropna()

    def _fund(label: str, series: pd.Series, fmt=None) -> dict:
        if series.empty:
            return {"label": label, "value": None, "value_fmt": "N/A", "unit": "",
                    "zscore": None, "percentile": None}
        val = float(series.iloc[-1])
        return {
            "label":      label,
            "value":      round(val, 6),
            "value_fmt":  fmt(val) if fmt else f"{val:.4g}",
            "unit":       "",
            "zscore":     compute_zscore(series),
            "percentile": compute_percentile(series),
            "change_30d": pct_change(series, 30),
            "change_90d": pct_change(series, 90),
        }

    def fmt_hash(v: float) -> str:
        if v >= 1e21: return f"{v/1e21:.2f} ZH/s"
        if v >= 1e18: return f"{v/1e18:.1f} EH/s"
        if v >= 1e15: return f"{v/1e15:.1f} PH/s"
        if v >= 1e12: return f"{v/1e12:.1f} TH/s"
        return f"{v:.2g} H/s"

    fundamentals: dict = {
        "hash_rate":      _fund("Hash Rate",      hash_s,  fmt=fmt_hash),
        "puell_multiple": _fund("Puell Multiple", puell_s, fmt=lambda v: f"{v:.3f}"),
    }

    if not hash_s.empty:
        hr_hs = float(hash_s.iloc[-1])
        diff_approx = hr_hs * 600 / (2 ** 32)
        fundamentals["difficulty"] = {
            "label": "Est. Difficulty", "value": round(diff_approx, 0),
            "value_fmt": f"{diff_approx/1e12:.2f} T", "unit": "",
            "zscore": None, "percentile": None,
            "change_30d": None, "change_90d": None,
        }

    # ── Chart series (last 365 days) ──────────────────────────────────────────
    def _to_series(s: pd.Series, t: int = 365) -> list[dict]:
        return [{"time": idx.strftime("%Y-%m-%d"), "value": round(float(v), 6)}
                for idx, v in s.tail(t).items()]

    hash_series  = _to_series(hash_s)
    puell_series = _to_series(puell_s)

    # ── Company equity data ───────────────────────────────────────────────────
    companies = await _fetch_companies(price_s)

    result = {
        "generated_at":    datetime.now(timezone.utc).isoformat(),
        "fundamentals":    fundamentals,
        "hash_rate_series": hash_series,
        "puell_series":    puell_series,
        "companies":       companies,
    }
    _cache = result
    _cache_at = now
    return result
