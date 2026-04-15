"""
Bitcoin Mining Intelligence — fundamentals + public company data.

Returns:
  fundamentals  — hash rate, Puell multiple, difficulty metrics
  companies     — all public miners: price, changes, volume, beta vs BTC
  hash_rate_series / puell_series — time-series for charts

Uses curl_cffi with Chrome TLS impersonation to bypass Yahoo Finance bot detection.
"""
import asyncio
import json
import logging
import time
from datetime import datetime, timezone, date
from pathlib import Path

import numpy as np
import pandas as pd
from curl_cffi.requests import AsyncSession as CffiAsyncSession

import config
from data import fetch_bitview_batch, compute_zscore, compute_percentile, pct_change

log = logging.getLogger(__name__)

_cache: dict | None = None
_cache_at: float = 0.0
CACHE_TTL = 1800  # 30 min

# Disk cache survives container restarts; used as fallback when Yahoo is unreachable
_COMPANY_DISK_CACHE = Path(str(config.REPORTS_DIR.parent / "mining_companies.json"))
_COMPANY_DISK_TTL = 3600 * 12  # 12-hour stale tolerance

_YF_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
_YF_IMPERSONATE = "chrome124"

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
    if series.dropna().empty:
        return None
    year_start = date(date.today().year, 1, 1)
    try:
        idx = series.index
        mask = idx >= str(year_start) if not hasattr(idx[0], "date") else pd.Series(
            [d.date() >= year_start for d in idx], index=idx
        )
        sub = series[mask].dropna()
        if len(sub) < 2:
            return None
        return round((float(sub.iloc[-1]) / float(sub.iloc[0]) - 1) * 100, 2)
    except Exception:
        return None


def _beta_vs_btc(stock: pd.Series, btc: pd.Series, days: int = 90) -> float | None:
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


async def _fetch_one_company(
    session: CffiAsyncSession,
    ticker: str,
    name: str,
    btc_series: pd.Series,
) -> dict | None:
    """Fetch one company via Yahoo Finance v8 chart API with Chrome TLS impersonation."""
    url = _YF_CHART_URL.format(ticker=ticker)
    try:
        resp = await session.get(
            url,
            params={"range": "max", "interval": "1d", "includeAdjustedClose": "true"},
            timeout=20,
        )
        if resp.status_code != 200:
            log.warning("%s: HTTP %d from Yahoo Finance", ticker, resp.status_code)
            return None

        payload = resp.json()
        result = payload.get("chart", {}).get("result")
        if not result:
            log.warning("%s: no chart result", ticker)
            return None

        timestamps = result[0].get("timestamp", [])
        adj_closes = (
            result[0].get("indicators", {})
            .get("adjclose", [{}])[0]
            .get("adjclose", [])
        )
        volumes = result[0].get("indicators", {}).get("quote", [{}])[0].get("volume", [])

        if not timestamps or not adj_closes:
            return None

        close = pd.Series(
            {pd.Timestamp(ts, unit="s").strftime("%Y-%m-%d"): v
             for ts, v in zip(timestamps, adj_closes) if v is not None},
            dtype=float,
        )
        close.index = pd.to_datetime(close.index)

        vol = pd.Series(
            {pd.Timestamp(ts, unit="s").strftime("%Y-%m-%d"): v
             for ts, v in zip(timestamps, volumes) if v is not None},
            dtype=float,
        )

        cur_price = float(close.iloc[-1])
        vol_avg = int(vol.tail(10).mean()) if not vol.empty else None

        log.info("Company OK: %s $%.2f", ticker, cur_price)
        return {
            "ticker":      ticker,
            "name":        name,
            "price":       round(cur_price, 2),
            "change_1d":   pct_change(close, 1),
            "change_7d":   pct_change(close, 7),
            "change_30d":  pct_change(close, 30),
            "change_ytd":  _ytd_change(close),
            "market_cap":  None,
            "vol_10d_avg": vol_avg,
            "beta_btc":    _beta_vs_btc(close, btc_series),
        }
    except Exception as e:
        log.warning("%s: fetch failed: %s", ticker, e)
        return None


async def _fetch_companies(btc_series: pd.Series) -> list[dict]:
    """Fetch all mining companies concurrently; fall back to disk cache on failure."""
    log.info("Mining: fetching %d company tickers (Chrome TLS impersonation)…", len(MINING_COMPANIES))
    try:
        async with CffiAsyncSession(impersonate=_YF_IMPERSONATE) as session:
            results = await asyncio.gather(
                *[_fetch_one_company(session, t, n, btc_series) for t, n in MINING_COMPANIES]
            )
        companies = [r for r in results if r is not None]
    except Exception as e:
        log.warning("Company fetch session failed: %s", e)
        companies = []

    if companies:
        _save_company_disk_cache(companies)
        return companies

    cached = _load_company_disk_cache()
    if cached:
        log.info("Using disk-cached company data (%d companies)", len(cached))
        return cached

    log.warning("No company data available (no fresh data, no disk cache)")
    return []


async def fetch_all() -> dict:
    global _cache, _cache_at
    now = time.time()
    if _cache and (now - _cache_at) < CACHE_TTL:
        return _cache

    log.info("Mining: fetching data…")

    # ── On-chain fundamentals (BitView — always works) ────────────────────────
    bv = await fetch_bitview_batch(MINING_BV_SERIES)
    hash_s  = bv.get("hash_rate",      pd.Series(dtype=float)).dropna()
    puell_s = bv.get("puell_multiple", pd.Series(dtype=float)).dropna()
    price_s = bv.get("price",          pd.Series(dtype=float)).dropna()

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
        hr = float(hash_s.iloc[-1])
        diff = hr * 600 / (2 ** 32)
        fundamentals["difficulty"] = {
            "label": "Est. Difficulty", "value": round(diff, 0),
            "value_fmt": f"{diff/1e12:.2f} T", "unit": "",
            "zscore": None, "percentile": None,
            "change_30d": None, "change_90d": None,
        }

    def _to_series(s: pd.Series, tail: int = 365) -> list[dict]:
        return [{"time": idx.strftime("%Y-%m-%d"), "value": round(float(v), 6)}
                for idx, v in s.tail(tail).items()]

    # Run BitView chart series + company fetches concurrently
    hash_series  = _to_series(hash_s)
    puell_series = _to_series(puell_s)
    companies    = await _fetch_companies(price_s)

    result = {
        "generated_at":     datetime.now(timezone.utc).isoformat(),
        "fundamentals":     fundamentals,
        "hash_rate_series": hash_series,
        "puell_series":     puell_series,
        "companies":        companies,
    }
    _cache = result
    _cache_at = now
    return result
