"""Daily insights generation — signals + LLM narrative."""
import json
import logging
from datetime import datetime, timezone

import pandas as pd

import config
import infographic
import llm
from data import fetch_bitview_batch, compute_mri, pct_change
from signals import detect_signals

log = logging.getLogger(__name__)

_generating = False

INSIGHTS_BV_SERIES = [
    "price", "mvrv", "nupl", "sopr_24h", "realized_price",
    "true_market_mean", "hash_rate", "puell_multiple",
    "lth_supply", "sth_supply", "supply_in_profit",
]


async def generate() -> dict:
    """Generate daily insights from on-chain metrics and MRI."""
    global _generating
    if _generating:
        return {"error": "Insights already generating", "status": "already_generating"}

    _generating = True
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    log.info("Generating insights for %s", today)

    try:
        bv = await fetch_bitview_batch(INSIGHTS_BV_SERIES)

        try:
            mri_components = await compute_mri()
        except Exception as e:
            log.warning("MRI unavailable for insights: %s", e)
            mri_components = {}

        signals = detect_signals(bv, mri_components)

        # Build snapshot
        snapshot: dict[str, float] = {}
        for k, s in bv.items():
            clean = s.dropna()
            if not clean.empty:
                snapshot[k] = round(float(clean.iloc[-1]), 6)
        mri_data = mri_components.get("mri_index", [])
        if mri_data:
            snapshot["mri_index"] = mri_data[-1]["value"]

        # Period changes
        price_s = bv.get("price", pd.Series(dtype=float)).dropna()
        changes: dict[str, float] = {}
        for period, days in [("1d", 1), ("7d", 7), ("30d", 30)]:
            ch = pct_change(price_s, days)
            if ch is not None:
                changes[period] = ch

        # LLM narrative
        narrative = ""
        if llm.is_configured() and signals:
            top = signals[:5]
            signal_text = "\n".join(
                f"- [{s['level'].upper()}] {s['title']}: {s['body']}" for s in top
            )
            price_val = snapshot.get("price")
            price_str = f"${price_val:,.0f}" if price_val else "N/A"
            prompt = (
                f"Bitcoin price: {price_str}\nPrice changes: {changes}\n\n"
                f"Today's signals:\n{signal_text}\n\n"
                "Write a 2–3 sentence market insight summary. "
                "Be concise, data-driven, and direct. "
                "Focus on what the signals mean in combination. No price predictions."
            )
            try:
                narrative = llm.chat(
                    [
                        {"role": "system", "content": "You are a concise Bitcoin market analyst."},
                        {"role": "user", "content": prompt},
                    ],
                    max_tokens=300,
                )
            except Exception as e:
                log.warning("Insights LLM narrative failed: %s", e)

        insight = {
            "date": today,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "status": "completed",
            "signals": signals,
            "snapshot": snapshot,
            "changes": changes,
            "narrative": narrative,
        }

        path = config.INSIGHTS_DIR / f"{today}.json"
        path.write_text(json.dumps(insight, indent=2), encoding="utf-8")
        log.info("Insights saved: %d signals", len(signals))

        # Generate X.com infographic
        try:
            infographic.save_infographic(insight, config.INSIGHTS_DIR)
        except Exception as e:
            log.warning("Infographic generation skipped: %s", e)

        return insight

    except Exception as e:
        log.error("Insights generation failed: %s", e)
        return {
            "date": today,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "status": "error",
            "signals": [],
            "snapshot": {},
            "changes": {},
            "narrative": "",
            "error": str(e),
        }
    finally:
        _generating = False


def is_generating() -> bool:
    return _generating
