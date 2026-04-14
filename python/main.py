"""
ClarionView Analytics Service
FastAPI application — routes, scheduler, health check.
Business logic lives in: data.py, signals.py, reports.py, insights.py, llm.py
"""
import json
import logging
from datetime import datetime, timezone

import numpy as np
import yfinance as yf
import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import config
import reports
import insights
import bitcoin_intel
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

@app.get("/data/yf")
def get_yf_data(ticker: str, field: str = "Close"):
    """Daily time-series for a Yahoo Finance ticker."""
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")
    try:
        hist = yf.Ticker(ticker).history(period="max", auto_adjust=True)
        if hist.empty:
            raise HTTPException(status_code=404, detail=f"No data for ticker '{ticker}'")
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
