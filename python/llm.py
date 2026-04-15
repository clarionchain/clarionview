"""LLM abstraction — OpenRouter with local Ollama fallback."""
import httpx
import config


def is_configured() -> bool:
    return bool(config.OPENROUTER_API_KEY or config.LOCAL_LLM_URL)


def chat(messages: list[dict], max_tokens: int = 1200) -> str:
    """
    Send a chat completion request.
    Priority: OpenRouter (if key set) → LOCAL_LLM_URL → RuntimeError
    """
    if config.OPENROUTER_API_KEY:
        resp = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            json={
                "model": config.OPENROUTER_DEFAULT_MODEL,
                "messages": messages,
                "max_tokens": max_tokens,
            },
            headers={
                "Authorization": f"Bearer {config.OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    if config.LOCAL_LLM_URL:
        resp = httpx.post(
            f"{config.LOCAL_LLM_URL.rstrip('/')}/chat/completions",
            json={
                "model": config.LOCAL_LLM_MODEL,
                "messages": messages,
                "max_tokens": max_tokens,
            },
            headers={
                "Authorization": f"Bearer {config.LOCAL_LLM_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=120,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    raise RuntimeError("No LLM configured — set OPENROUTER_API_KEY or LOCAL_LLM_URL")
