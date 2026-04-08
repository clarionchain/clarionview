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
REPORT_HOUR_UTC = int(os.getenv("REPORT_HOUR_UTC", "2"))   # 2am UTC by default
BITVIEW_BASE = "https://bitview.space"

REPORTS_DIR.mkdir(parents=True, exist_ok=True)

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
    scheduler.start()
    log.info("Scheduler started — overnight report at %02d:00 UTC", REPORT_HOUR_UTC)


@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown(wait=False)
