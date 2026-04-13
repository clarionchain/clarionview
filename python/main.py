"""
DC Workbench Analytics Service
FastAPI service providing:
  - Yahoo Finance data (equities, ETFs)
  - FRED macroeconomic data
  - Overnight report generation (z-scores, quantiles, LLM narrative)
"""

import os
import json
import logging
import asyncio
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import httpx
import numpy as np
import pandas as pd
import yfinance as yf
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from scipy import stats

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
FRED_API_KEY = os.getenv("FRED_API_KEY", "")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_DEFAULT_MODEL = os.getenv("OPENROUTER_DEFAULT_MODEL", "openai/gpt-4o-mini")
REPORTS_DIR = Path(os.getenv("REPORTS_DIR", "./data/reports"))
INSIGHTS_DIR = Path(os.getenv("INSIGHTS_DIR", "./data/insights"))
REPORT_HOUR_UTC = int(os.getenv("REPORT_HOUR_UTC", "2"))   # 2am UTC by default
BITVIEW_BASE = "https://bitview.space"

REPORTS_DIR.mkdir(parents=True, exist_ok=True)
INSIGHTS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="DC Workbench Analytics", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Track whether a report is currently generating
_report_generating = False


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


# ---------------------------------------------------------------------------
# Yahoo Finance data
# ---------------------------------------------------------------------------
@app.get("/data/yf")
def get_yf_data(ticker: str, field: str = "Close"):
    """
    Return daily time-series for a Yahoo Finance ticker.
    Response: { data: [{time: "YYYY-MM-DD", value: float}], total: int }
    """
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")

    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="max", auto_adjust=True)

        if hist.empty:
            raise HTTPException(status_code=404, detail=f"No data found for ticker '{ticker}'")

        col = field if field in hist.columns else "Close"
        series = hist[col].dropna()

        data = [
            {"time": d.strftime("%Y-%m-%d"), "value": round(float(v), 6)}
            for d, v in series.items()
            if np.isfinite(float(v))
        ]

        return {"data": data, "total": len(data), "ticker": ticker}
    except HTTPException:
        raise
    except Exception as e:
        log.error("yfinance error for %s: %s", ticker, e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch data for '{ticker}': {e}")


# ---------------------------------------------------------------------------
# FRED data
# ---------------------------------------------------------------------------
@app.get("/data/fred")
def get_fred_data(series: str):
    """
    Return daily/monthly time-series from the FRED API.
    Response: { data: [{time: "YYYY-MM-DD", value: float}], total: int }
    """
    if not series:
        raise HTTPException(status_code=400, detail="series is required")
    if not FRED_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="FRED_API_KEY is not configured. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html",
        )

    url = "https://api.stlouisfed.org/fred/series/observations"
    params = {
        "series_id": series,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "observation_start": "2009-01-01",
        "sort_order": "asc",
    }

    try:
        resp = httpx.get(url, params=params, timeout=15)
        if resp.status_code == 400:
            raise HTTPException(status_code=404, detail=f"FRED series '{series}' not found")
        resp.raise_for_status()
        payload = resp.json()

        data = []
        for obs in payload.get("observations", []):
            val_str = obs.get("value", ".")
            if val_str == "." or val_str == "":
                continue
            try:
                data.append({"time": obs["date"], "value": float(val_str)})
            except (ValueError, KeyError):
                continue

        return {"data": data, "total": len(data), "series": series}
    except HTTPException:
        raise
    except Exception as e:
        log.error("FRED error for %s: %s", series, e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch FRED series '{series}': {e}")


# ---------------------------------------------------------------------------
# Overnight report
# ---------------------------------------------------------------------------

def _compute_zscore(series: pd.Series) -> Optional[float]:
    """Z-score of the last value relative to the full history."""
    clean = series.dropna()
    if len(clean) < 30:
        return None
    z = float((clean.iloc[-1] - clean.mean()) / clean.std())
    return round(z, 3)


def _compute_percentile(series: pd.Series) -> Optional[float]:
    """What % of historical values are BELOW the current value (0-100)."""
    clean = series.dropna()
    if len(clean) < 30:
        return None
    pct = float(stats.percentileofscore(clean, clean.iloc[-1], kind="rank"))
    return round(pct, 1)


def _rsi(series: pd.Series, period: int = 14) -> Optional[float]:
    """RSI of the last bar."""
    clean = series.dropna()
    if len(clean) < period + 1:
        return None
    delta = clean.diff().dropna()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(period).mean().iloc[-1]
    avg_loss = loss.rolling(period).mean().iloc[-1]
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(float(100 - (100 / (1 + rs))), 2)


def _pct_change(series: pd.Series, days: int) -> Optional[float]:
    clean = series.dropna()
    if len(clean) <= days:
        return None
    return round(float((clean.iloc[-1] / clean.iloc[-days - 1] - 1) * 100), 2)


async def _fetch_bitview_series(client: httpx.AsyncClient, name: str) -> pd.Series:
    """Fetch a BitView series and return as a named pd.Series indexed by date string."""
    try:
        dates_r, vals_r = await asyncio.gather(
            client.get(f"{BITVIEW_BASE}/api/series/date/day"),
            client.get(f"{BITVIEW_BASE}/api/series/{name}/day/data"),
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


async def _build_report_data() -> dict:
    """Fetch all data needed for the overnight report."""
    async with httpx.AsyncClient(timeout=30) as client:
        # Fetch BitView series concurrently
        bv_names = [
            "price", "mvrv", "nupl", "sopr_24h", "realized_price",
            "true_market_mean", "hash_rate", "puell_multiple",
            "lth_supply", "sth_supply", "supply_in_profit",
            "rhodl_ratio", "reserve_risk", "stock_to_flow",
        ]
        bv_tasks = [_fetch_bitview_series(client, n) for n in bv_names]
        bv_results = await asyncio.gather(*bv_tasks)
        bv = {s.name: s for s in bv_results}

    # Fetch yfinance data (sync, run in thread)
    yf_data = {}
    for ticker in ["MSTR", "IBIT", "MARA", "RIOT"]:
        try:
            t = yf.Ticker(ticker)
            hist = t.history(period="2y", auto_adjust=True)
            if not hist.empty:
                yf_data[ticker] = hist["Close"]
        except Exception as e:
            log.warning("yfinance report fetch failed for %s: %s", ticker, e)

    # Fetch FRED data
    fred_data = {}
    if FRED_API_KEY:
        for fred_series in ["FEDFUNDS", "M2SL"]:
            try:
                resp = httpx.get(
                    "https://api.stlouisfed.org/fred/series/observations",
                    params={
                        "series_id": fred_series,
                        "api_key": FRED_API_KEY,
                        "file_type": "json",
                        "observation_start": "2012-01-01",
                    },
                    timeout=15,
                )
                resp.raise_for_status()
                obs = resp.json().get("observations", [])
                pairs = {o["date"]: float(o["value"]) for o in obs if o["value"] != "."}
                fred_data[fred_series] = pd.Series(pairs, dtype=float)
            except Exception as e:
                log.warning("FRED report fetch failed for %s: %s", fred_series, e)

    return {"bv": bv, "yf": yf_data, "fred": fred_data}


def _build_metric_block(label: str, series: pd.Series, prefix: str = "", suffix: str = "") -> str:
    """Build a formatted metric block with z-score and percentile."""
    if series.empty:
        return f"- **{label}**: N/A\n"

    current = series.dropna().iloc[-1]
    z = _compute_zscore(series)
    pct = _compute_percentile(series)

    val_fmt = f"{prefix}{current:,.4g}{suffix}"
    z_fmt = f"{z:+.2f}σ" if z is not None else "N/A"
    pct_fmt = f"{pct:.0f}th pct" if pct is not None else "N/A"

    context = ""
    if pct is not None:
        if pct >= 90:
            context = " — historically elevated (top 10%)"
        elif pct <= 10:
            context = " — historically depressed (bottom 10%)"
        elif pct >= 75:
            context = " — above average"
        elif pct <= 25:
            context = " — below average"

    return f"- **{label}**: {val_fmt} | Z-score: {z_fmt} | Percentile: {pct_fmt}{context}\n"


async def generate_overnight_report() -> dict:
    """
    Full overnight report pipeline:
    1. Fetch all data
    2. Compute statistics
    3. Build structured prompt
    4. Call OpenRouter for narrative
    5. Return report dict
    """
    global _report_generating
    if _report_generating:
        return {"error": "Report already generating"}

    _report_generating = True
    log.info("Starting overnight report generation...")

    try:
        data = await _build_report_data()
        bv = data["bv"]
        yf_data = data["yf"]
        fred_data = data["fred"]

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        price_series = bv.get("price", pd.Series(dtype=float))

        # Build structured data context
        lines = []
        lines.append(f"# Bitcoin Market Data — {today}\n\n")

        # --- Price ---
        lines.append("## Price & Technical Analysis\n")
        if not price_series.empty:
            current_price = price_series.dropna().iloc[-1]
            lines.append(f"- **BTC Price**: ${current_price:,.0f}\n")
            lines.append(f"- **24h change**: {_pct_change(price_series, 1) or 'N/A'}%\n")
            lines.append(f"- **7d change**: {_pct_change(price_series, 7) or 'N/A'}%\n")
            lines.append(f"- **30d change**: {_pct_change(price_series, 30) or 'N/A'}%\n")
            rsi = _rsi(price_series)
            lines.append(f"- **RSI(14)**: {rsi}\n")
            # vs MAs
            ma200 = price_series.rolling(200).mean().dropna()
            if not ma200.empty:
                pct_vs_200 = round((current_price / ma200.iloc[-1] - 1) * 100, 2)
                lines.append(f"- **vs 200DMA**: {pct_vs_200:+.2f}%\n")
        lines.append("\n")

        # --- Valuation ---
        lines.append("## On-Chain Valuation\n")
        for name, label in [
            ("mvrv", "MVRV Ratio"),
            ("nupl", "NUPL"),
            ("sopr_24h", "SOPR"),
            ("rhodl_ratio", "RHODL Ratio"),
            ("reserve_risk", "Reserve Risk"),
        ]:
            lines.append(_build_metric_block(label, bv.get(name, pd.Series(dtype=float))))
        lines.append("\n")

        # --- Pricing Models ---
        lines.append("## Pricing Models\n")
        for name, label, prefix in [
            ("realized_price", "Realized Price", "$"),
            ("true_market_mean", "True Market Mean", "$"),
        ]:
            lines.append(_build_metric_block(label, bv.get(name, pd.Series(dtype=float)), prefix=prefix))
        if not price_series.empty:
            rp = bv.get("realized_price", pd.Series(dtype=float))
            if not rp.empty:
                premium = round((price_series.iloc[-1] / rp.iloc[-1] - 1) * 100, 1)
                lines.append(f"- **MVRV implied premium**: {premium:+.1f}% above realized price\n")
        lines.append("\n")

        # --- Supply ---
        lines.append("## Supply Dynamics\n")
        for name, label, suffix in [
            ("supply_in_profit", "Supply in Profit", "%"),
            ("lth_supply", "LTH Supply", " BTC"),
            ("sth_supply", "STH Supply", " BTC"),
        ]:
            lines.append(_build_metric_block(label, bv.get(name, pd.Series(dtype=float)), suffix=suffix))
        lines.append("\n")

        # --- Mining ---
        lines.append("## Mining Health\n")
        for name, label in [
            ("hash_rate", "Hash Rate"),
            ("puell_multiple", "Puell Multiple"),
        ]:
            lines.append(_build_metric_block(label, bv.get(name, pd.Series(dtype=float))))
        lines.append("\n")

        # --- ETF & Equities ---
        lines.append("## ETF & Equities\n")
        for ticker, series in yf_data.items():
            if series.empty:
                continue
            current = series.iloc[-1]
            ch1d = _pct_change(series, 1)
            ch30d = _pct_change(series, 30)
            lines.append(
                f"- **{ticker}**: ${current:,.2f} | 1d: {ch1d or 'N/A'}% | 30d: {ch30d or 'N/A'}%\n"
            )
        lines.append("\n")

        # --- Macro ---
        lines.append("## Macro Context\n")
        for fred_series, label, suffix in [
            ("FEDFUNDS", "Fed Funds Rate", "%"),
            ("M2SL", "M2 Money Supply", "B"),
        ]:
            s = fred_data.get(fred_series, pd.Series(dtype=float))
            if not s.empty:
                val = s.iloc[-1]
                ch_yoy = _pct_change(s, 12) if fred_series == "M2SL" else None
                yoy_str = f" | YoY: {ch_yoy}%" if ch_yoy is not None else ""
                lines.append(f"- **{label}**: {val:,.2f}{suffix}{yoy_str}\n")
        lines.append("\n")

        data_context = "".join(lines)

        # --- LLM narrative ---
        narrative = ""
        if OPENROUTER_API_KEY:
            try:
                system_prompt = (
                    "You are a Bitcoin market analyst producing a concise overnight report. "
                    "Analyze the provided on-chain, macro, and equities data. "
                    "Focus on: (1) where key valuation metrics sit in historical context, "
                    "(2) what the z-scores and percentiles imply about cycle positioning, "
                    "(3) any notable divergences or signals. "
                    "Be direct, data-driven, and specific. 3-5 paragraphs. "
                    "Do not give financial advice or price predictions."
                )
                payload = {
                    "model": OPENROUTER_DEFAULT_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": data_context},
                    ],
                    "max_tokens": 1200,
                }
                resp = httpx.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    timeout=60,
                )
                resp.raise_for_status()
                narrative = resp.json()["choices"][0]["message"]["content"]
            except Exception as e:
                log.error("OpenRouter narrative generation failed: %s", e)
                narrative = f"*Narrative generation failed: {e}*"
        else:
            narrative = "*LLM narrative unavailable — OPENROUTER_API_KEY not configured.*"

        report = {
            "date": today,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_snapshot": data_context,
            "narrative": narrative,
            "status": "completed",
        }

        # Save to file
        report_path = REPORTS_DIR / f"{today}.json"
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        log.info("Overnight report saved to %s", report_path)

        return report

    except Exception as e:
        log.error("Report generation failed: %s", e)
        err = {
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_snapshot": "",
            "narrative": f"*Report generation failed: {e}*",
            "status": "error",
        }
        return err
    finally:
        _report_generating = False


# ---------------------------------------------------------------------------
# Report API endpoints
# ---------------------------------------------------------------------------

@app.post("/report/generate")
async def trigger_report(background_tasks: BackgroundTasks):
    """Manually trigger overnight report generation."""
    global _report_generating
    if _report_generating:
        return JSONResponse({"status": "already_generating"}, status_code=202)
    background_tasks.add_task(generate_overnight_report)
    return {"status": "started"}


@app.get("/report/status")
def report_status():
    """Check if a report is currently generating."""
    return {"generating": _report_generating}


@app.get("/report/list")
def list_reports():
    """List all available reports, newest first."""
    reports = sorted(REPORTS_DIR.glob("*.json"), reverse=True)
    result = []
    for p in reports[:60]:  # cap at 60 (2 months)
        try:
            meta = json.loads(p.read_text(encoding="utf-8"))
            result.append({
                "date": meta.get("date", p.stem),
                "generated_at": meta.get("generated_at"),
                "status": meta.get("status", "unknown"),
            })
        except Exception:
            result.append({"date": p.stem, "generated_at": None, "status": "unknown"})
    return result


@app.get("/report/{date}")
def get_report(date: str):
    """Return a specific report by date (YYYY-MM-DD)."""
    report_path = REPORTS_DIR / f"{date}.json"
    if not report_path.exists():
        raise HTTPException(status_code=404, detail=f"No report found for {date}")
    try:
        return json.loads(report_path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read report: {e}")


# ---------------------------------------------------------------------------
# Mean Reversion Index (MRI)
# ---------------------------------------------------------------------------

MRI_PRICING_MODELS = [
    "realized_price",
    "true_market_mean",
    "cointime_price",
    "active_price",
    "investor_price",
    "vaulted_price",
]

_mri_cache: Optional[dict] = None
_mri_cache_at: float = 0.0
MRI_CACHE_TTL = 6 * 3600  # 6 hours


async def _compute_mri_all() -> dict:
    """Compute all MRI components and cache the result."""
    global _mri_cache, _mri_cache_at
    now = time.monotonic()
    if _mri_cache is not None and (now - _mri_cache_at) < MRI_CACHE_TTL:
        return _mri_cache

    log.info("Computing MRI (fetching %d BitView series)...", len(MRI_PRICING_MODELS) + 1)
    async with httpx.AsyncClient(timeout=30) as client:
        tasks = [_fetch_bitview_series(client, "price")] + [
            _fetch_bitview_series(client, m) for m in MRI_PRICING_MODELS
        ]
        results = await asyncio.gather(*tasks)

    price = results[0]
    df = pd.DataFrame({"price": price})
    for i, name in enumerate(MRI_PRICING_MODELS):
        df[name] = results[i + 1]
    df = df.dropna()

    if df.empty:
        log.warning("MRI: no aligned data after dropna")
        return {}

    # Compute percentile ranks for each model ratio
    # scipy rankdata returns all-NaN when any value is NaN/inf (scipy >= 1.14).
    # Mask non-finite values and rank only the finite subset.
    pct_cols: list[str] = []
    for name in MRI_PRICING_MODELS:
        ratio = (df["price"] / df[name]).values
        pcts = np.full(len(ratio), np.nan, dtype=float)
        mask = np.isfinite(ratio)
        n_fin = int(mask.sum())
        if n_fin > 1:
            finite_vals = ratio[mask]
            r = stats.rankdata(finite_vals, method="average")
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
        "mri_fast":    to_list("mri_index"),   # same as index, daily resolution
        "mri_slow":    to_list("mri_slow"),
        "mri_ceiling": to_list("mri_ceiling"),
        "mri_floor":   to_list("mri_floor"),
        "mri_spread":  to_list("mri_spread"),
    }
    _mri_cache = result
    _mri_cache_at = now
    log.info("MRI computed: %d data points", len(result["mri_index"]))
    return result


@app.get("/data/mri")
async def get_mri(component: str = "mri_index"):
    valid = {"mri_index", "mri_fast", "mri_slow", "mri_ceiling", "mri_floor", "mri_spread"}
    if component not in valid:
        raise HTTPException(status_code=400, detail=f"component must be one of {sorted(valid)}")
    try:
        all_comp = await _compute_mri_all()
        if not all_comp:
            raise HTTPException(status_code=503, detail="MRI data unavailable — BitView series may be empty")
        data = all_comp.get(component, [])
        return {"data": data, "total": len(data), "component": component}
    except HTTPException:
        raise
    except Exception as e:
        log.error("MRI endpoint error: %s", e)
        raise HTTPException(status_code=500, detail=f"MRI computation failed: {e}")


# ---------------------------------------------------------------------------
# Insights
# ---------------------------------------------------------------------------

_insights_generating = False


def _detect_signals(bv: dict, mri_components: dict) -> list:
    """Rule-based signal detection from on-chain metrics."""
    signals = []

    price_s = bv.get("price", pd.Series(dtype=float)).dropna()
    mvrv_s = bv.get("mvrv", pd.Series(dtype=float)).dropna()
    nupl_s = bv.get("nupl", pd.Series(dtype=float)).dropna()
    sopr_s = bv.get("sopr_24h", pd.Series(dtype=float)).dropna()

    mri_data = mri_components.get("mri_index", [])
    mri_val = mri_data[-1]["value"] if mri_data else None

    # --- Price change signals ---
    if len(price_s) >= 2:
        chg_1d = _pct_change(price_s, 1)
        if chg_1d is not None and abs(chg_1d) >= 5:
            direction = "surged" if chg_1d > 0 else "dropped"
            signals.append({
                "type": "price_move",
                "level": "warning" if abs(chg_1d) >= 10 else "info",
                "title": f"Bitcoin {direction} {abs(chg_1d):.1f}% in 24h",
                "body": f"BTC price moved {chg_1d:+.1f}% in the past 24 hours, reaching ${price_s.iloc[-1]:,.0f}.",
                "metric": "price",
                "value": round(float(price_s.iloc[-1]), 2),
            })

    # --- MRI signals ---
    if mri_val is not None:
        if mri_val >= 90:
            signals.append({
                "type": "mri_extreme_overbought",
                "level": "critical",
                "title": "MRI: Extreme Overbought",
                "body": f"Mean Reversion Index at {mri_val:.1f} — in the top 10% of all historical readings. Bitcoin is significantly overextended relative to pricing models. Past readings this high have preceded major corrections.",
                "metric": "mri_index",
                "value": mri_val,
            })
        elif mri_val >= 75:
            signals.append({
                "type": "mri_overbought",
                "level": "warning",
                "title": "MRI: Entering Overbought Zone",
                "body": f"Mean Reversion Index at {mri_val:.1f} — approaching historically elevated levels (>75). Monitor for signs of exhaustion.",
                "metric": "mri_index",
                "value": mri_val,
            })
        elif mri_val <= 10:
            signals.append({
                "type": "mri_extreme_oversold",
                "level": "critical",
                "title": "MRI: Extreme Oversold",
                "body": f"Mean Reversion Index at {mri_val:.1f} — in the bottom 10% of all historical readings. Bitcoin is deeply undervalued relative to pricing models. Past readings this low have preceded strong recoveries.",
                "metric": "mri_index",
                "value": mri_val,
            })
        elif mri_val <= 25:
            signals.append({
                "type": "mri_oversold",
                "level": "warning",
                "title": "MRI: Entering Oversold Zone",
                "body": f"Mean Reversion Index at {mri_val:.1f} — in historically depressed territory (<25). May represent an accumulation opportunity.",
                "metric": "mri_index",
                "value": mri_val,
            })
        else:
            signals.append({
                "type": "mri_neutral",
                "level": "info",
                "title": f"MRI: Neutral ({mri_val:.1f})",
                "body": f"Mean Reversion Index at {mri_val:.1f} — within the normal range (25–75). Bitcoin is fairly valued relative to its historical pricing model distribution.",
                "metric": "mri_index",
                "value": mri_val,
            })

    # --- MVRV signals ---
    if not mvrv_s.empty:
        mvrv = float(mvrv_s.iloc[-1])
        if mvrv >= 3.5:
            signals.append({
                "type": "mvrv_high",
                "level": "warning",
                "title": f"MVRV at {mvrv:.2f} — Historically Elevated",
                "body": f"MVRV Ratio of {mvrv:.2f} indicates market value is {mvrv:.1f}× realized value. Readings above 3.5 have historically coincided with cycle peaks.",
                "metric": "mvrv",
                "value": mvrv,
            })
        elif mvrv < 1.0:
            signals.append({
                "type": "mvrv_capitulation",
                "level": "critical",
                "title": f"MVRV Below 1 — Capitulation Zone",
                "body": f"MVRV Ratio at {mvrv:.2f} — market value below realized value. Historically a rare buying opportunity associated with bear market bottoms.",
                "metric": "mvrv",
                "value": mvrv,
            })

    # --- NUPL signals ---
    if not nupl_s.empty:
        nupl = float(nupl_s.iloc[-1])
        if nupl >= 0.75:
            signals.append({
                "type": "nupl_euphoria",
                "level": "warning",
                "title": f"NUPL: Euphoria/Greed ({nupl:.2f})",
                "body": f"Net Unrealized Profit/Loss at {nupl:.2f} — in the greed/euphoria zone. The average holder is sitting on substantial unrealized gains, a historically cautionary signal.",
                "metric": "nupl",
                "value": nupl,
            })
        elif nupl < 0:
            signals.append({
                "type": "nupl_capitulation",
                "level": "critical",
                "title": f"NUPL: Market in Loss ({nupl:.2f})",
                "body": f"NUPL at {nupl:.2f} — the average holder is underwater. This level has historically marked major market bottoms.",
                "metric": "nupl",
                "value": nupl,
            })

    # --- SOPR signals ---
    if not sopr_s.empty:
        sopr = float(sopr_s.iloc[-1])
        if sopr >= 1.05:
            signals.append({
                "type": "sopr_profit_taking",
                "level": "info",
                "title": f"SOPR: Active Profit Taking ({sopr:.3f})",
                "body": f"SOPR at {sopr:.3f} — coins being spent were acquired at lower prices. Elevated readings indicate broad profit-taking activity.",
                "metric": "sopr_24h",
                "value": sopr,
            })
        elif sopr < 0.97:
            signals.append({
                "type": "sopr_loss_selling",
                "level": "warning",
                "title": f"SOPR: Selling at a Loss ({sopr:.3f})",
                "body": f"SOPR at {sopr:.3f} — coins being spent were acquired at higher prices. Sustained loss-selling can indicate capitulation or weak-hand flushing.",
                "metric": "sopr_24h",
                "value": sopr,
            })

    return signals


async def generate_insights() -> dict:
    """Generate daily insights from on-chain metrics."""
    global _insights_generating
    if _insights_generating:
        return {"error": "Insights already generating"}

    _insights_generating = True
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    log.info("Generating insights for %s", today)

    try:
        # Fetch BitView series
        bv_names = [
            "price", "mvrv", "nupl", "sopr_24h", "realized_price",
            "true_market_mean", "hash_rate", "puell_multiple",
            "lth_supply", "sth_supply", "supply_in_profit",
        ]
        async with httpx.AsyncClient(timeout=30) as client:
            bv_tasks = [_fetch_bitview_series(client, n) for n in bv_names]
            bv_results = await asyncio.gather(*bv_tasks)
        bv = {s.name: s for s in bv_results}

        # Get MRI
        try:
            mri_components = await _compute_mri_all()
        except Exception as e:
            log.warning("MRI unavailable for insights: %s", e)
            mri_components = {}

        # Detect signals
        signals = _detect_signals(bv, mri_components)

        # Snapshot of current values
        price_s = bv.get("price", pd.Series(dtype=float)).dropna()
        snapshot = {}
        for k, s in bv.items():
            clean = s.dropna()
            if not clean.empty:
                snapshot[k] = round(float(clean.iloc[-1]), 6)
        mri_data = mri_components.get("mri_index", [])
        if mri_data:
            snapshot["mri_index"] = mri_data[-1]["value"]

        # Period changes
        changes = {}
        if not price_s.empty:
            for period, days in [("1d", 1), ("7d", 7), ("30d", 30)]:
                ch = _pct_change(price_s, days)
                if ch is not None:
                    changes[period] = ch

        # Optional LLM narrative for the top signals
        narrative = ""
        if OPENROUTER_API_KEY and signals:
            top_signals = signals[:5]
            signal_text = "\n".join(
                f"- [{s['level'].upper()}] {s['title']}: {s['body']}" for s in top_signals
            )
            price_val = snapshot.get("price", "N/A")
            prompt = (
                f"Bitcoin price: ${price_val:,.0f}\n"
                f"Price changes: {changes}\n\n"
                f"Today's signals:\n{signal_text}\n\n"
                "Write a 2-3 sentence market insight summary. Be concise, data-driven, and direct. "
                "Focus on what the signals mean in combination. No price predictions."
            )
            try:
                resp = httpx.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    json={
                        "model": OPENROUTER_DEFAULT_MODEL,
                        "messages": [
                            {"role": "system", "content": "You are a concise Bitcoin market analyst."},
                            {"role": "user", "content": prompt},
                        ],
                        "max_tokens": 300,
                    },
                    headers={
                        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    timeout=30,
                )
                resp.raise_for_status()
                narrative = resp.json()["choices"][0]["message"]["content"]
            except Exception as e:
                log.warning("Insights LLM narrative failed: %s", e)

        insight = {
            "date": today,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "signals": signals,
            "snapshot": snapshot,
            "changes": changes,
            "narrative": narrative,
            "status": "completed",
        }

        path = INSIGHTS_DIR / f"{today}.json"
        path.write_text(json.dumps(insight, indent=2), encoding="utf-8")
        log.info("Insights saved to %s (%d signals)", path, len(signals))
        return insight

    except Exception as e:
        log.error("Insights generation failed: %s", e)
        return {
            "date": today,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "signals": [],
            "snapshot": {},
            "changes": {},
            "narrative": "",
            "status": "error",
            "error": str(e),
        }
    finally:
        _insights_generating = False


@app.post("/insights/generate")
async def trigger_insights(background_tasks: BackgroundTasks):
    global _insights_generating
    if _insights_generating:
        return JSONResponse({"status": "already_generating"}, status_code=202)
    background_tasks.add_task(generate_insights)
    return {"status": "started"}


@app.get("/insights/list")
def list_insights():
    files = sorted(INSIGHTS_DIR.glob("*.json"), reverse=True)
    result = []
    for p in files[:90]:
        try:
            meta = json.loads(p.read_text(encoding="utf-8"))
            result.append({
                "date": meta.get("date", p.stem),
                "generated_at": meta.get("generated_at"),
                "signal_count": len(meta.get("signals", [])),
                "status": meta.get("status", "unknown"),
            })
        except Exception:
            result.append({"date": p.stem, "generated_at": None, "signal_count": 0, "status": "unknown"})
    return result


@app.get("/insights/latest")
def get_latest_insight():
    files = sorted(INSIGHTS_DIR.glob("*.json"), reverse=True)
    if not files:
        raise HTTPException(status_code=404, detail="No insights generated yet")
    try:
        return json.loads(files[0].read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read insight: {e}")


@app.get("/insights/{date}")
def get_insight(date: str):
    path = INSIGHTS_DIR / f"{date}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"No insight found for {date}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read insight: {e}")


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------

scheduler = AsyncIOScheduler(timezone="UTC")


@app.on_event("startup")
async def startup():
    scheduler.add_job(
        generate_overnight_report,
        trigger="cron",
        hour=REPORT_HOUR_UTC,
        minute=0,
        id="overnight_report",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        generate_insights,
        trigger="cron",
        hour=REPORT_HOUR_UTC,
        minute=30,
        id="daily_insights",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.start()
    log.info("Scheduler started — overnight report at %02d:00 UTC, insights at %02d:30 UTC", REPORT_HOUR_UTC, REPORT_HOUR_UTC)


@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown(wait=False)
