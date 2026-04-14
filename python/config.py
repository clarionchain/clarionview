"""Central configuration — all env vars in one place."""
import os
from pathlib import Path

# ── LLM ──────────────────────────────────────────────────────────────────────
OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_DEFAULT_MODEL: str = os.getenv("OPENROUTER_DEFAULT_MODEL", "openai/gpt-4o-mini")
LOCAL_LLM_URL: str = os.getenv("LOCAL_LLM_URL", "")
LOCAL_LLM_MODEL: str = os.getenv("LOCAL_LLM_MODEL", "gemma3:4b")
LOCAL_LLM_API_KEY: str = os.getenv("LOCAL_LLM_API_KEY", "ollama")

# ── Data sources ──────────────────────────────────────────────────────────────
FRED_API_KEY: str = os.getenv("FRED_API_KEY", "")
BITVIEW_BASE: str = "https://bitview.space"

# ── Storage ───────────────────────────────────────────────────────────────────
REPORTS_DIR: Path = Path(os.getenv("REPORTS_DIR", "./data/reports"))
INSIGHTS_DIR: Path = Path(os.getenv("INSIGHTS_DIR", "./data/insights"))
INTEL_DIR: Path = Path(os.getenv("INTEL_DIR", "./data/intel"))
REPORT_HOUR_UTC: int = int(os.getenv("REPORT_HOUR_UTC", "2"))
INTEL_HOUR_UTC: int = int(os.getenv("INTEL_HOUR_UTC", "3"))

REPORTS_DIR.mkdir(parents=True, exist_ok=True)
INSIGHTS_DIR.mkdir(parents=True, exist_ok=True)
INTEL_DIR.mkdir(parents=True, exist_ok=True)
