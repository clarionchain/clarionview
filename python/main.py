"""
ClarionView Analytics Service
FastAPI application — routes, scheduler, health check.
Business logic lives in: data.py, signals.py, reports.py, insights.py, llm.py
"""
import json
import logging
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import httpx
from curl_cffi import requests as cffi_requests
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import config
import reports
import insights
import bitcoin_intel
import quant
import mining
from data import compute_mri, fetch_bitview_batch

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="ClarionView Analytics", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


# ── Yahoo Finance ─────────────────────────────────────────────────────────────
# Use curl_cffi with Chrome TLS impersonation — bypasses Yahoo's bot fingerprint detection.

_YF_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
_YF_IMPERSONATE = "chrome124"


def _yf_fetch_series(ticker: str) -> list[dict]:
    """Fetch adjusted-close daily series from Yahoo Finance v8 chart API."""
    url = _YF_CHART_URL.format(ticker=ticker)
    r = cffi_requests.get(
        url,
        params={"range": "max", "interval": "1d", "includeAdjustedClose": "true"},
        impersonate=_YF_IMPERSONATE,
        timeout=20,
    )
    if r.status_code != 200:
        raise HTTPException(status_code=404, detail=f"Yahoo Finance returned {r.status_code} for '{ticker}'")
    payload = r.json()
    result = payload.get("chart", {}).get("result")
    if not result:
        err = payload.get("chart", {}).get("error", {})
        raise HTTPException(status_code=404, detail=f"No data for '{ticker}': {err}")
    timestamps = result[0].get("timestamp", [])
    adj_list = result[0].get("indicators", {}).get("adjclose", [{}])[0].get("adjclose", [])
    return [
        {"time": pd.Timestamp(ts, unit="s").strftime("%Y-%m-%d"), "value": round(float(v), 6)}
        for ts, v in zip(timestamps, adj_list)
        if v is not None
    ]


@app.get("/data/yf")
def get_yf_data(ticker: str):
    """Daily adjusted-close time-series for a Yahoo Finance ticker."""
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")
    try:
        data = _yf_fetch_series(ticker)
        if not data:
            raise HTTPException(status_code=404, detail=f"No data for ticker '{ticker}'")
        return {"data": data, "total": len(data), "ticker": ticker}
    except HTTPException:
        raise
    except Exception as e:
        log.error("YF fetch error for %s: %s", ticker, e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch '{ticker}': {e}")


# ── FRED ──────────────────────────────────────────────────────────────────────

@app.get("/data/fred")
def get_fred_data(series: str):
    """Daily/monthly time-series from the FRED API."""
    if not series:
        raise HTTPException(status_code=400, detail="series is required")
    if not config.FRED_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="FRED_API_KEY not configured. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html",
        )
    try:
        resp = httpx.get(
            "https://api.stlouisfed.org/fred/series/observations",
            params={
                "series_id": series,
                "api_key": config.FRED_API_KEY,
                "file_type": "json",
                "observation_start": "2009-01-01",
                "sort_order": "asc",
            },
            timeout=15,
        )
        if resp.status_code == 400:
            raise HTTPException(status_code=404, detail=f"FRED series '{series}' not found")
        resp.raise_for_status()
        data = [
            {"time": obs["date"], "value": float(obs["value"])}
            for obs in resp.json().get("observations", [])
            if obs.get("value") not in (".", "")
        ]
        return {"data": data, "total": len(data), "series": series}
    except HTTPException:
        raise
    except Exception as e:
        log.error("FRED error for %s: %s", series, e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch FRED '{series}': {e}")


# ── MRI ───────────────────────────────────────────────────────────────────────

VALID_MRI_COMPONENTS = {"mri_index", "mri_fast", "mri_slow", "mri_ceiling", "mri_floor", "mri_spread"}

@app.get("/data/mri")
async def get_mri(component: str = "mri_index"):
    if component not in VALID_MRI_COMPONENTS:
        raise HTTPException(status_code=400, detail=f"component must be one of {sorted(VALID_MRI_COMPONENTS)}")
    try:
        all_comp = await compute_mri()
        if not all_comp:
            raise HTTPException(status_code=503, detail="MRI data unavailable — BitView series may be empty")
        data = all_comp.get(component, [])
        return {"data": data, "total": len(data), "component": component}
    except HTTPException:
        raise
    except Exception as e:
        log.error("MRI error: %s", e)
        raise HTTPException(status_code=500, detail=f"MRI computation failed: {e}")


# ── Reports ───────────────────────────────────────────────────────────────────

@app.post("/report/generate")
async def trigger_report(background_tasks: BackgroundTasks):
    if reports.is_generating():
        return JSONResponse({"status": "already_generating"}, status_code=202)
    background_tasks.add_task(reports.generate)
    return {"status": "started"}


@app.get("/report/status")
def report_status():
    return {"generating": reports.is_generating()}


@app.get("/report/list")
def list_reports():
    result = []
    for p in sorted(config.REPORTS_DIR.glob("*.json"), reverse=True)[:60]:
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
    path = config.REPORTS_DIR / f"{date}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"No report for {date}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read report: {e}")


@app.get("/report/{date}/infographic.png")
def get_report_infographic(date: str):
    from fastapi.responses import Response
    import report_infographic as ri
    png_path = config.REPORTS_DIR / f"{date}_report_infographic.png"
    if not png_path.exists():
        json_path = config.REPORTS_DIR / f"{date}.json"
        if not json_path.exists():
            raise HTTPException(status_code=404, detail=f"No report for {date}")
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
            ri.save_infographic(data, config.REPORTS_DIR)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Infographic generation failed: {e}")
    try:
        return Response(
            content=png_path.read_bytes(), media_type="image/png",
            headers={"Cache-Control": "public, max-age=3600",
                     "Content-Disposition": f'inline; filename="{date}_report.png"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to serve infographic: {e}")


# ── Insights ──────────────────────────────────────────────────────────────────

@app.post("/insights/generate")
async def trigger_insights(background_tasks: BackgroundTasks):
    if insights.is_generating():
        return JSONResponse({"status": "already_generating"}, status_code=202)
    background_tasks.add_task(insights.generate)
    return {"status": "started"}


@app.get("/insights/list")
def list_insights():
    result = []
    for p in sorted(config.INSIGHTS_DIR.glob("*.json"), reverse=True)[:90]:
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
    files = sorted(config.INSIGHTS_DIR.glob("*.json"), reverse=True)
    if not files:
        raise HTTPException(status_code=404, detail="No insights generated yet")
    try:
        return json.loads(files[0].read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read insight: {e}")


@app.get("/insights/{date}")
def get_insight(date: str):
    path = config.INSIGHTS_DIR / f"{date}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"No insight for {date}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read insight: {e}")


@app.get("/insights/{date}/infographic.png")
def get_infographic(date: str):
    from fastapi.responses import Response
    png_path = config.INSIGHTS_DIR / f"{date}_infographic.png"
    # Generate on-demand if missing but JSON exists
    if not png_path.exists():
        json_path = config.INSIGHTS_DIR / f"{date}.json"
        if not json_path.exists():
            raise HTTPException(status_code=404, detail=f"No insight for {date}")
        try:
            insight_data = json.loads(json_path.read_text(encoding="utf-8"))
            infographic.save_infographic(insight_data, config.INSIGHTS_DIR)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Infographic generation failed: {e}")
    try:
        return Response(content=png_path.read_bytes(), media_type="image/png",
                        headers={"Cache-Control": "public, max-age=3600",
                                 "Content-Disposition": f'inline; filename="{date}_btc_insight.png"'})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to serve infographic: {e}")


# ── Bitcoin Intelligence ──────────────────────────────────────────────────────

@app.post("/intel/generate")
async def trigger_intel(background_tasks: BackgroundTasks):
    if bitcoin_intel.is_generating():
        return JSONResponse({"status": "already_generating"}, status_code=202)
    background_tasks.add_task(bitcoin_intel.generate)
    return {"status": "started"}


@app.get("/intel/status")
def intel_status():
    return {"generating": bitcoin_intel.is_generating()}


@app.get("/intel/latest")
def intel_latest():
    """Return metadata about the most recently generated knowledge graph."""
    index_path = config.INTEL_DIR / "index.md"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="No intel generated yet")
    stat = index_path.stat()
    from datetime import datetime, timezone as _tz
    modified = datetime.fromtimestamp(stat.st_mtime, tz=_tz.utc).isoformat()
    narratives = list((config.INTEL_DIR / "narratives").glob("*.md")) if (config.INTEL_DIR / "narratives").exists() else []
    entities = list((config.INTEL_DIR / "entities").glob("*.md")) if (config.INTEL_DIR / "entities").exists() else []
    return {
        "last_modified": modified,
        "narrative_count": len(narratives),
        "entity_count": len(entities),
    }


# ── Metrics / Percentiles ────────────────────────────────────────────────────

_metrics_cache: dict | None = None
_metrics_cache_at: float = 0.0
METRICS_CACHE_TTL = 3600  # 1 hour

@app.get("/metrics")
async def get_metrics():
    """
    Return all on-chain + macro metrics with current value, z-score, and percentile.
    Results are cached for 1 hour. Pass ?refresh to force recompute.
    """
    import time
    global _metrics_cache, _metrics_cache_at
    now = time.time()
    if _metrics_cache and (now - _metrics_cache_at) < METRICS_CACHE_TTL:
        return _metrics_cache

    try:
        from data import fetch_report_data, compute_zscore, compute_percentile, pct_change, rsi
        import pandas as pd

        raw = await fetch_report_data()
        bv = raw["bv"]
        yf_data = raw["yf"]

        def metric(label: str, series: pd.Series, category: str,
                   fmt_fn=None, unit: str = "") -> dict | None:
            clean = series.dropna()
            if clean.empty:
                return None
            val = float(clean.iloc[-1])
            z = compute_zscore(series)
            pct = compute_percentile(series)
            if fmt_fn:
                val_fmt = fmt_fn(val)
            elif abs(val) >= 1e9:
                val_fmt = f"{val/1e9:.2f}B{unit}"
            elif abs(val) >= 1e6:
                val_fmt = f"{val/1e6:.2f}M{unit}"
            elif abs(val) >= 1000:
                val_fmt = f"{val:,.0f}{unit}"
            else:
                val_fmt = f"{val:.4g}{unit}"
            return {
                "label": label,
                "category": category,
                "value": round(val, 6),
                "value_fmt": val_fmt,
                "zscore": z,
                "percentile": pct,
                "history_points": int(len(clean)),
            }

        items = []

        # ── Price ─────────────────────────────────────────────────────────────
        price_s = bv.get("price", pd.Series(dtype=float))
        if not price_s.dropna().empty:
            price_val = float(price_s.dropna().iloc[-1])
            items.append({
                "label": "BTC Price",
                "category": "Price",
                "value": round(price_val, 2),
                "value_fmt": f"${price_val:,.0f}",
                "zscore": compute_zscore(price_s),
                "percentile": compute_percentile(price_s),
                "history_points": int(price_s.dropna().__len__()),
            })
            # RSI
            rsi_val = rsi(price_s)
            if rsi_val is not None:
                items.append({
                    "label": "RSI (14)",
                    "category": "Price",
                    "value": rsi_val,
                    "value_fmt": f"{rsi_val:.1f}",
                    "zscore": None,
                    "percentile": None,
                    "history_points": 0,
                    "note": "Overbought >70, Oversold <30",
                })
            # 200DMA deviation
            ma200 = price_s.rolling(200).mean().dropna()
            if not ma200.empty:
                dev = round((price_val / float(ma200.iloc[-1]) - 1) * 100, 2)
                items.append({
                    "label": "vs 200DMA",
                    "category": "Price",
                    "value": dev,
                    "value_fmt": f"{dev:+.1f}%",
                    "zscore": None,
                    "percentile": None,
                    "history_points": 0,
                })

        # ── On-chain ──────────────────────────────────────────────────────────
        for name, label, unit in [
            ("mvrv", "MVRV Ratio", ""),
            ("nupl", "NUPL", ""),
            ("sopr_24h", "SOPR", ""),
            ("rhodl_ratio", "RHODL Ratio", ""),
            ("reserve_risk", "Reserve Risk", ""),
            ("stock_to_flow", "Stock-to-Flow", ""),
        ]:
            m = metric(label, bv.get(name, pd.Series(dtype=float)), "On-Chain", unit=unit)
            if m:
                items.append(m)

        # ── Pricing models ────────────────────────────────────────────────────
        for name, label in [
            ("realized_price", "Realized Price"),
            ("true_market_mean", "True Market Mean"),
        ]:
            m = metric(label, bv.get(name, pd.Series(dtype=float)), "Pricing",
                       fmt_fn=lambda v: f"${v:,.0f}")
            if m:
                items.append(m)

        # MVRV premium
        rp = bv.get("realized_price", pd.Series(dtype=float)).dropna()
        if not price_s.dropna().empty and not rp.empty:
            premium = round((float(price_s.dropna().iloc[-1]) / float(rp.iloc[-1]) - 1) * 100, 1)
            items.append({
                "label": "Price vs Realized (premium)",
                "category": "Pricing",
                "value": premium,
                "value_fmt": f"{premium:+.1f}%",
                "zscore": None,
                "percentile": None,
                "history_points": 0,
            })

        # ── Supply ────────────────────────────────────────────────────────────
        for name, label, sfx in [
            ("supply_in_profit", "Supply in Profit", "%"),
            ("lth_supply", "LTH Supply", " BTC"),
            ("sth_supply", "STH Supply", " BTC"),
        ]:
            m = metric(label, bv.get(name, pd.Series(dtype=float)), "Supply", unit=sfx)
            if m:
                items.append(m)

        # ── Mining ────────────────────────────────────────────────────────────
        for name, label in [
            ("hash_rate", "Hash Rate"),
            ("puell_multiple", "Puell Multiple"),
        ]:
            m = metric(label, bv.get(name, pd.Series(dtype=float)), "Mining")
            if m:
                items.append(m)

        # ── ETF / equities ────────────────────────────────────────────────────
        for ticker, series in yf_data.items():
            m = metric(ticker, series, "ETF / Equities",
                       fmt_fn=lambda v: f"${v:,.2f}")
            if m:
                items.append(m)

        result = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "metrics": [m for m in items if m is not None],
        }
        _metrics_cache = result
        _metrics_cache_at = now
        return result

    except Exception as e:
        log.error("Metrics endpoint error: %s", e)
        raise HTTPException(status_code=503, detail=str(e))


# ── Mobile Metrics (8-year z-score + percentile quantile) ────────────────────

_mobile_metrics_cache: dict | None = None
_mobile_metrics_cache_at: float = 0.0
MOBILE_METRICS_CACHE_TTL = 3600


def _zscore_8y(series: pd.Series):
    """Z-score of current value relative to last 8 years (2920 days)."""
    import math
    window = series.dropna().tail(2920)
    if len(window) < 30:
        return None
    std = float(window.std())
    if std == 0 or not math.isfinite(std):
        return None
    z = float((window.iloc[-1] - window.mean()) / std)
    return round(z, 3) if math.isfinite(z) else None


def _percentile_8y(series: pd.Series):
    """Percentile of current value within last 8 years (0–100)."""
    from scipy import stats as scipy_stats
    window = series.dropna().tail(2920)
    if len(window) < 30:
        return None
    return round(float(scipy_stats.percentileofscore(window, window.iloc[-1], kind="rank")), 1)


@app.get("/metrics/mobile")
async def get_mobile_metrics():
    """
    10 curated metrics for the mobile view — each with 8-year z-score and
    5%-increment percentile quantile. Cached for 1 hour.
    """
    import math, time
    global _mobile_metrics_cache, _mobile_metrics_cache_at
    now = time.time()
    if _mobile_metrics_cache and (now - _mobile_metrics_cache_at) < MOBILE_METRICS_CACHE_TTL:
        return _mobile_metrics_cache

    try:
        bv_names = [
            "mvrv", "nupl", "sopr_24h", "puell_multiple",
            "reserve_risk", "supply_in_profit", "hash_rate", "rhodl_ratio",
        ]
        bv = await fetch_bitview_batch(bv_names)

        # FRED: Fed Funds Rate
        fedfunds_s = pd.Series(dtype=float)
        if config.FRED_API_KEY:
            try:
                resp = httpx.get(
                    "https://api.stlouisfed.org/fred/series/observations",
                    params={
                        "series_id": "FEDFUNDS",
                        "api_key": config.FRED_API_KEY,
                        "file_type": "json",
                        "observation_start": "2012-01-01",
                    },
                    timeout=15,
                )
                resp.raise_for_status()
                obs = resp.json().get("observations", [])
                pairs = {o["date"]: float(o["value"]) for o in obs if o["value"] != "."}
                fedfunds_s = pd.Series(pairs, dtype=float)
            except Exception as e:
                log.warning("FRED FEDFUNDS fetch failed: %s", e)

        # MRI index as time series
        mri_result = await compute_mri()
        mri_series = pd.Series(dtype=float)
        if mri_result and "mri_index" in mri_result:
            mri_series = pd.Series(
                {pd.Timestamp(p["time"]): p["value"] for p in mri_result["mri_index"]},
                dtype=float,
            )

        def make_metric(label, series, category, description, fmt_fn=None):
            clean = series.dropna()
            if clean.empty:
                return None
            val = float(clean.iloc[-1])
            z8 = _zscore_8y(series)
            p8 = _percentile_8y(series)
            if fmt_fn:
                val_fmt = fmt_fn(val)
            elif abs(val) >= 1e9:
                val_fmt = f"{val/1e9:.2f}B"
            elif abs(val) >= 1e6:
                val_fmt = f"{val/1e6:.2f}M"
            elif abs(val) >= 1000:
                val_fmt = f"{val:,.0f}"
            else:
                val_fmt = f"{val:.4g}"
            if z8 is None:
                signal = "neutral"
            elif z8 >= 2.0:
                signal = "overbought"
            elif z8 >= 1.0:
                signal = "elevated"
            elif z8 <= -2.0:
                signal = "oversold"
            elif z8 <= -1.0:
                signal = "depressed"
            else:
                signal = "neutral"
            bucket = min(19, int(p8 / 5)) if p8 is not None else None
            return {
                "label": label,
                "category": category,
                "description": description,
                "value": round(val, 8),
                "value_fmt": val_fmt,
                "zscore_8y": z8,
                "percentile_8y": p8,
                "quantile_bucket": bucket,
                "signal": signal,
            }

        metrics_list = []

        m = make_metric("MRI Index", mri_series, "Quant",
                        "Mean Reversion Index — composite of 6 on-chain pricing models",
                        fmt_fn=lambda v: f"{v:.1f}")
        if m: metrics_list.append(m)

        m = make_metric("MVRV Ratio", bv.get("mvrv", pd.Series(dtype=float)), "On-Chain",
                        "Market Value to Realized Value — measures aggregate unrealized profit/loss")
        if m: metrics_list.append(m)

        m = make_metric("NUPL", bv.get("nupl", pd.Series(dtype=float)), "P&L",
                        "Net Unrealized Profit/Loss — overall holder profitability (>0.75 euphoria, <0 capitulation)",
                        fmt_fn=lambda v: f"{v:.3f}")
        if m: metrics_list.append(m)

        m = make_metric("Puell Multiple", bv.get("puell_multiple", pd.Series(dtype=float)), "Mining",
                        "Daily miner revenue vs 365-day moving average — mining profitability cycle indicator")
        if m: metrics_list.append(m)

        m = make_metric("SOPR", bv.get("sopr_24h", pd.Series(dtype=float)), "P&L",
                        "Spent Output Profit Ratio — ratio of realized value to value at last move (>1 profit, <1 loss)",
                        fmt_fn=lambda v: f"{v:.4f}")
        if m: metrics_list.append(m)

        m = make_metric("Reserve Risk", bv.get("reserve_risk", pd.Series(dtype=float)), "On-Chain",
                        "Risk/reward vs long-term holder conviction — low = high confidence buy, high = sell signal",
                        fmt_fn=lambda v: f"{v:.6f}")
        if m: metrics_list.append(m)

        m = make_metric("Supply in Profit", bv.get("supply_in_profit", pd.Series(dtype=float)), "Supply",
                        "% of circulating supply last moved at a lower price — high = holders mostly in profit",
                        fmt_fn=lambda v: f"{v:.1f}%")
        if m: metrics_list.append(m)

        m = make_metric("Hash Rate", bv.get("hash_rate", pd.Series(dtype=float)), "Mining",
                        "Total network hash rate (EH/s) — measures miner commitment and network security",
                        fmt_fn=lambda v: f"{v:.1f} EH/s")
        if m: metrics_list.append(m)

        m = make_metric("RHODL Ratio", bv.get("rhodl_ratio", pd.Series(dtype=float)), "Liquidity",
                        "Realized HODL Ratio — long-term vs short-term holder dominance; high = illiquid supply",
                        fmt_fn=lambda v: f"{v:,.0f}")
        if m: metrics_list.append(m)

        m = make_metric("Fed Funds Rate", fedfunds_s, "Rates",
                        "US Federal Funds target rate — macro liquidity proxy; falling rates = risk-on tailwind",
                        fmt_fn=lambda v: f"{v:.2f}%")
        if m: metrics_list.append(m)

        result = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "metrics": metrics_list,
        }
        _mobile_metrics_cache = result
        _mobile_metrics_cache_at = now
        return result

    except Exception as e:
        log.error("Mobile metrics error: %s", e)
        raise HTTPException(status_code=503, detail=str(e))


# ── Quant Models ─────────────────────────────────────────────────────────────

@app.get("/quant")
async def get_quant():
    """Run all 7 quant models on BTC price data (cached 4 h)."""
    try:
        return await quant.run_all()
    except Exception as e:
        log.error("Quant endpoint error: %s", e)
        raise HTTPException(status_code=503, detail=str(e))


@app.post("/quant/refresh")
async def refresh_quant():
    """Invalidate the quant cache and recompute."""
    quant.invalidate_cache()
    try:
        return await quant.run_all()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


# ── Mining ────────────────────────────────────────────────────────────────────

@app.get("/mining")
async def get_mining():
    """Mining fundamentals + public company data (cached 30 min)."""
    try:
        return await mining.fetch_all()
    except Exception as e:
        log.error("Mining endpoint error: %s", e)
        raise HTTPException(status_code=503, detail=str(e))


# ── Scheduler ─────────────────────────────────────────────────────────────────

scheduler = AsyncIOScheduler(timezone="UTC")

@app.on_event("startup")
async def startup():
    scheduler.add_job(
        reports.generate, trigger="cron",
        hour=config.REPORT_HOUR_UTC, minute=0,
        id="overnight_report", replace_existing=True, misfire_grace_time=3600,
    )
    scheduler.add_job(
        insights.generate, trigger="cron",
        hour=config.REPORT_HOUR_UTC, minute=30,
        id="daily_insights", replace_existing=True, misfire_grace_time=3600,
    )
    scheduler.add_job(
        bitcoin_intel.generate, trigger="cron",
        hour=config.INTEL_HOUR_UTC, minute=0,
        id="daily_intel", replace_existing=True, misfire_grace_time=3600,
    )
    scheduler.start()
    log.info(
        "Scheduler started — report %02d:00, insights %02d:30, intel %02d:00 UTC",
        config.REPORT_HOUR_UTC, config.REPORT_HOUR_UTC, config.INTEL_HOUR_UTC,
    )

@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown(wait=False)
