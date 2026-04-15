"""Overnight report generation — structured data + LLM narrative."""
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import pandas as pd

import config
import llm
import report_infographic
from data import (
    fetch_report_data,
    compute_zscore, compute_percentile, rsi, pct_change,
)

log = logging.getLogger(__name__)

_generating = False


# ── Structured data builders ──────────────────────────────────────────────────

def _metric(label: str, series: pd.Series, prefix: str = "", suffix: str = "") -> dict:
    """Build a typed metric dict with value, zscore, percentile."""
    clean = series.dropna()
    if clean.empty:
        return {"label": label, "value": None, "value_fmt": "N/A", "zscore": None, "percentile": None}
    current = float(clean.iloc[-1])
    z = compute_zscore(series)
    pct = compute_percentile(series)
    fmt = f"{prefix}{current:,.4g}{suffix}"
    return {
        "label": label,
        "value": round(current, 6),
        "value_fmt": fmt,
        "zscore": z,
        "percentile": pct,
    }


def _build_structured(
    bv: dict[str, pd.Series],
    yf_data: dict[str, pd.Series],
    fred_data: dict[str, pd.Series],
) -> dict:
    """Build the fully typed structured payload consumed by the frontend."""
    price_series = bv.get("price", pd.Series(dtype=float))
    price_clean = price_series.dropna()

    # ── Price block ───────────────────────────────────────────────────────────
    price_block: dict = {"value": None, "change_1d": None, "change_7d": None,
                         "change_30d": None, "rsi": None, "vs_200dma_pct": None}
    if not price_clean.empty:
        current_price = float(price_clean.iloc[-1])
        price_block["value"] = round(current_price, 2)
        price_block["change_1d"] = pct_change(price_series, 1)
        price_block["change_7d"] = pct_change(price_series, 7)
        price_block["change_30d"] = pct_change(price_series, 30)
        price_block["rsi"] = rsi(price_series)
        ma200 = price_series.rolling(200).mean().dropna()
        if not ma200.empty:
            price_block["vs_200dma_pct"] = round((current_price / float(ma200.iloc[-1]) - 1) * 100, 2)

    # ── On-chain valuation ────────────────────────────────────────────────────
    onchain = [
        _metric("MVRV Ratio", bv.get("mvrv", pd.Series(dtype=float))),
        _metric("NUPL", bv.get("nupl", pd.Series(dtype=float))),
        _metric("SOPR", bv.get("sopr_24h", pd.Series(dtype=float))),
        _metric("RHODL Ratio", bv.get("rhodl_ratio", pd.Series(dtype=float))),
        _metric("Reserve Risk", bv.get("reserve_risk", pd.Series(dtype=float))),
    ]

    # ── Pricing models ────────────────────────────────────────────────────────
    pricing = [
        _metric("Realized Price", bv.get("realized_price", pd.Series(dtype=float)), prefix="$"),
        _metric("True Market Mean", bv.get("true_market_mean", pd.Series(dtype=float)), prefix="$"),
    ]
    rp = bv.get("realized_price", pd.Series(dtype=float)).dropna()
    if not price_clean.empty and not rp.empty:
        premium = round((float(price_clean.iloc[-1]) / float(rp.iloc[-1]) - 1) * 100, 1)
        pricing.append({
            "label": "Price vs Realized (premium)",
            "value": premium,
            "value_fmt": f"{premium:+.1f}%",
            "zscore": None,
            "percentile": None,
        })

    # ── Supply ────────────────────────────────────────────────────────────────
    supply = [
        _metric("Supply in Profit", bv.get("supply_in_profit", pd.Series(dtype=float)), suffix="%"),
        _metric("LTH Supply", bv.get("lth_supply", pd.Series(dtype=float)), suffix=" BTC"),
        _metric("STH Supply", bv.get("sth_supply", pd.Series(dtype=float)), suffix=" BTC"),
    ]

    # ── Mining ────────────────────────────────────────────────────────────────
    mining = [
        _metric("Hash Rate", bv.get("hash_rate", pd.Series(dtype=float))),
        _metric("Puell Multiple", bv.get("puell_multiple", pd.Series(dtype=float))),
    ]

    # ── ETF & equities ────────────────────────────────────────────────────────
    etf = []
    for ticker, series in yf_data.items():
        if series.empty:
            continue
        etf.append({
            "ticker": ticker,
            "price": round(float(series.iloc[-1]), 2),
            "change_1d": pct_change(series, 1),
            "change_30d": pct_change(series, 30),
        })

    # ── Macro ─────────────────────────────────────────────────────────────────
    macro = []
    for fred_id, label, suffix in [
        ("FEDFUNDS", "Fed Funds Rate", "%"),
        ("M2SL", "M2 Money Supply", "B"),
    ]:
        s = fred_data.get(fred_id, pd.Series(dtype=float))
        if s.empty:
            continue
        val = float(s.iloc[-1])
        change_yoy = pct_change(s, 12) if fred_id == "M2SL" else None
        macro.append({
            "label": label,
            "value": round(val, 4),
            "value_fmt": f"{val:,.2f}{suffix}",
            "change_yoy": change_yoy,
        })

    return {
        "price": price_block,
        "onchain": onchain,
        "pricing": pricing,
        "supply": supply,
        "mining": mining,
        "etf": etf,
        "macro": macro,
    }


def _build_llm_context(structured: dict) -> str:
    """Convert structured data to a concise markdown prompt for the LLM."""
    lines = []
    p = structured["price"]
    if p["value"]:
        lines.append(f"## Price\nBTC: ${p['value']:,.0f} | 1d: {p['change_1d']}% | 7d: {p['change_7d']}% | 30d: {p['change_30d']}% | RSI: {p['rsi']} | vs 200DMA: {p['vs_200dma_pct']}%\n")

    for section, title in [("onchain", "On-Chain Valuation"), ("pricing", "Pricing Models"),
                            ("supply", "Supply"), ("mining", "Mining")]:
        items = structured[section]
        if items:
            lines.append(f"## {title}")
            for m in items:
                if m["value"] is not None:
                    z = f"{m['zscore']:+.2f}σ" if m["zscore"] is not None else "N/A"
                    pct = f"{m['percentile']:.0f}th pct" if m["percentile"] is not None else "N/A"
                    lines.append(f"- {m['label']}: {m['value_fmt']} | Z: {z} | Pct: {pct}")
            lines.append("")

    if structured["etf"]:
        lines.append("## ETF & Equities")
        for e in structured["etf"]:
            lines.append(f"- {e['ticker']}: ${e['price']:,.2f} | 1d: {e['change_1d']}% | 30d: {e['change_30d']}%")
        lines.append("")

    if structured["macro"]:
        lines.append("## Macro")
        for m in structured["macro"]:
            yoy = f" | YoY: {m['change_yoy']}%" if m["change_yoy"] is not None else ""
            lines.append(f"- {m['label']}: {m['value_fmt']}{yoy}")

    return "\n".join(lines)


# ── Main generation function ──────────────────────────────────────────────────

async def generate() -> dict:
    """Full overnight report pipeline. Returns the saved report dict."""
    global _generating
    if _generating:
        return {"error": "Report already generating", "status": "already_generating"}

    _generating = True
    log.info("Starting overnight report generation...")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    try:
        raw = await fetch_report_data()
        structured = _build_structured(raw["bv"], raw["yf"], raw["fred"])
        data_context = _build_llm_context(structured)

        narrative = ""
        if llm.is_configured():
            try:
                narrative = llm.chat(
                    [
                        {
                            "role": "system",
                            "content": (
                                "You are a Bitcoin market analyst producing a concise overnight report. "
                                "Analyze the on-chain, macro, and equities data. Focus on: "
                                "(1) where key metrics sit in historical context, "
                                "(2) what z-scores and percentiles imply about cycle positioning, "
                                "(3) notable divergences or signals. "
                                "Be direct, data-driven, specific. 3–5 paragraphs. "
                                "No financial advice or price predictions."
                            ),
                        },
                        {"role": "user", "content": data_context},
                    ],
                    max_tokens=1200,
                )
            except Exception as e:
                log.error("LLM narrative failed: %s", e)
                narrative = f"*Narrative generation failed: {e}*"
        else:
            narrative = "*LLM narrative unavailable — configure OPENROUTER_API_KEY or LOCAL_LLM_URL.*"

        report = {
            "date": today,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "status": "completed",
            "narrative": narrative,
            "structured": structured,
            # data_snapshot kept for backwards compatibility
            "data_snapshot": data_context,
        }

        path = config.REPORTS_DIR / f"{today}.json"
        path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        log.info("Overnight report saved to %s", path)

        # Generate infographic PNG
        try:
            report_infographic.save_infographic(report, config.REPORTS_DIR)
        except Exception as e:
            log.warning("Report infographic skipped: %s", e)

        return report

    except Exception as e:
        log.error("Report generation failed: %s", e)
        return {
            "date": today,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "status": "error",
            "narrative": f"*Report generation failed: {e}*",
            "structured": None,
            "data_snapshot": "",
        }
    finally:
        _generating = False


def is_generating() -> bool:
    return _generating
