"""
Quantitative models for Bitcoin price analysis.

Models:
  1. Linear Regression  — log-linear trend + deviation
  2. GARCH(1,1)         — conditional volatility via MLE
  3. Monte Carlo        — Geometric Brownian Motion price paths
  4. Kalman Filter      — adaptive trend extraction
  5. Hidden Markov      — bear/neutral/bull regime detection
  6. ARIMA              — autoregressive price forecast
  7. Neural Network     — MLP directional signal (pure numpy)

All results cached in-memory for 4 hours.
"""
import logging
import math
from datetime import datetime, timezone, timedelta

import numpy as np
import pandas as pd
from data import fetch_bitview_batch

log = logging.getLogger(__name__)

_cache: dict | None = None
_cache_time: datetime | None = None
CACHE_TTL = 3600 * 4  # 4 hours


# ── Data helpers ──────────────────────────────────────────────────────────────

async def _get_btc_prices() -> pd.Series:
    """Fetch BTC daily price from BitView (same source as mining/strategy dashboards)."""
    bv = await fetch_bitview_batch(["price"])
    s = bv.get("price", pd.Series(dtype=float)).dropna()
    if s.empty:
        raise ValueError("No BTC price data from BitView")
    s.index = pd.to_datetime(s.index)
    return s


def _series(prices: pd.Series, tail: int | None = None) -> list[dict]:
    s = prices.tail(tail) if tail else prices
    return [{"time": idx.strftime("%Y-%m-%d"), "value": round(float(v), 2)} for idx, v in s.items()]


def _log_returns(prices: pd.Series) -> np.ndarray:
    return np.log(prices / prices.shift(1)).dropna().values


# ── 1. Linear Regression ──────────────────────────────────────────────────────

def run_linear_regression(prices: pd.Series) -> dict:
    """Log-linear OLS trend. Returns trend line, R², current deviation, 30d forecast."""
    log_p = np.log(prices.values)
    valid = np.isfinite(log_p)
    if not valid.all():
        prices = prices.iloc[valid]
        log_p = log_p[valid]
    x = np.arange(len(log_p), dtype=float)
    n = len(x)
    xm, ym = x.mean(), log_p.mean()
    b = np.dot(x - xm, log_p - ym) / np.dot(x - xm, x - xm)
    a = ym - b * xm

    trend_log = a + b * x
    trend = np.exp(trend_log)

    ss_res = np.sum((log_p - trend_log) ** 2)
    ss_tot = np.sum((log_p - ym) ** 2)
    r2 = float(1 - ss_res / ss_tot) if ss_tot > 0 else 0.0

    cur_price = float(prices.iloc[-1])
    cur_trend = float(trend[-1])
    deviation_pct = (cur_price / cur_trend - 1) * 100

    # 30-day forecast
    last_date = prices.index[-1]
    tail = 365
    start = max(0, len(prices) - tail)
    trend_series = [
        {"time": prices.index[i].strftime("%Y-%m-%d"), "value": round(float(trend[i]), 2)}
        for i in range(start, len(prices))
    ]
    forecast = [
        {
            "time": (last_date + timedelta(days=i + 1)).strftime("%Y-%m-%d"),
            "value": round(float(math.exp(a + b * (len(x) + i))), 2),
        }
        for i in range(30)
    ]

    return {
        "price": _series(prices, tail=tail),
        "trend": trend_series,
        "forecast": forecast,
        "r2": round(r2, 4),
        "daily_growth_pct": round((math.exp(b) - 1) * 100, 5),
        "current_deviation_pct": round(deviation_pct, 2),
        "current_price": round(cur_price, 2),
        "current_trend": round(cur_trend, 2),
        "above_trend": deviation_pct > 0,
    }


# ── 2. GARCH(1,1) ─────────────────────────────────────────────────────────────

def run_garch(prices: pd.Series) -> dict:
    """GARCH(1,1) conditional volatility via L-BFGS-B MLE."""
    from scipy.optimize import minimize

    r = _log_returns(prices)

    def neg_ll(params):
        omega, alpha, beta = params
        if omega <= 0 or alpha < 0 or beta < 0 or alpha + beta >= 0.9999:
            return 1e10
        T = len(r)
        h = np.empty(T)
        h[0] = float(np.var(r))
        for t in range(1, T):
            h[t] = omega + alpha * r[t - 1] ** 2 + beta * h[t - 1]
            if h[t] <= 0:
                return 1e10
        return 0.5 * float(np.sum(np.log(h) + r ** 2 / h))

    v0 = float(np.var(r))
    res = minimize(
        neg_ll,
        x0=[v0 * 0.05, 0.1, 0.85],
        method="L-BFGS-B",
        bounds=[(1e-9, None), (1e-6, 0.5), (1e-6, 0.999)],
        options={"maxiter": 300},
    )
    omega, alpha, beta = res.x if res.success else (v0 * 0.05, 0.1, 0.85)

    # In-sample conditional vol
    T = len(r)
    h = np.empty(T)
    h[0] = v0
    for t in range(1, T):
        h[t] = omega + alpha * r[t - 1] ** 2 + beta * h[t - 1]
    ann_vol = np.sqrt(np.maximum(h, 1e-12)) * math.sqrt(252)

    # 30-day vol forecast (mean-reverting to long-run)
    long_run = omega / max(1 - alpha - beta, 1e-8)
    h_f = float(h[-1])
    fcast_30 = []
    for _ in range(30):
        h_f = omega + (alpha + beta) * h_f
        fcast_30.append(math.sqrt(max(h_f, 1e-12)) * math.sqrt(252))

    T = len(r)
    dates = prices.index[-T:]  # align with r length (dropna may shorten r)
    tail = 365
    start = max(0, T - tail)
    vol_series = [
        {"time": dates[i].strftime("%Y-%m-%d"), "value": round(float(ann_vol[i]), 4)}
        for i in range(start, T)
    ]

    cur_vol = float(ann_vol[-1])
    lr_vol = math.sqrt(long_run) * math.sqrt(252)
    regime = "elevated" if cur_vol > lr_vol * 1.3 else ("low" if cur_vol < lr_vol * 0.7 else "normal")

    return {
        "volatility": vol_series,
        "current_vol_annualized": round(cur_vol, 4),
        "long_run_vol_annualized": round(lr_vol, 4),
        "forecast_30d_vol": round(fcast_30[-1], 4),
        "omega": round(float(omega), 9),
        "alpha": round(float(alpha), 4),
        "beta": round(float(beta), 4),
        "persistence": round(float(alpha + beta), 4),
        "vol_regime": regime,
    }


# ── 3. Monte Carlo (GBM) ──────────────────────────────────────────────────────

def run_monte_carlo(prices: pd.Series, days: int = 90, n_sims: int = 500) -> dict:
    """GBM Monte Carlo: 500 paths, percentile fan chart."""
    r = _log_returns(prices)
    mu = float(r.mean())
    sigma = float(r.std())
    cur = float(prices.iloc[-1])
    last_date = prices.index[-1]

    rng = np.random.default_rng(42)
    shocks = rng.normal(0, 1, (n_sims, days))
    step = (mu - 0.5 * sigma ** 2) + sigma * shocks
    paths = cur * np.exp(np.cumsum(step, axis=1))

    future_dates = [(last_date + timedelta(days=i + 1)).strftime("%Y-%m-%d") for i in range(days)]
    pct_map = {}
    for p in [5, 25, 50, 75, 95]:
        vals = np.percentile(paths, p, axis=0)
        pct_map[f"p{p}"] = [{"time": future_dates[i], "value": round(float(vals[i]), 2)} for i in range(days)]

    final = paths[:, -1]
    return {
        "current_price": round(cur, 2),
        "days": days,
        "simulations": n_sims,
        "mu_daily": round(mu, 6),
        "sigma_daily": round(sigma, 6),
        "percentiles": pct_map,
        "prob_above_current": round(float(np.mean(final > cur)), 4),
        "expected_return_pct": round(float((np.mean(final) / cur - 1) * 100), 2),
        "p5_final": round(float(np.percentile(final, 5)), 2),
        "p50_final": round(float(np.percentile(final, 50)), 2),
        "p95_final": round(float(np.percentile(final, 95)), 2),
    }


# ── 4. Kalman Filter ──────────────────────────────────────────────────────────

def run_kalman(prices: pd.Series) -> dict:
    """Local linear trend Kalman filter: state = [level, slope]."""
    y = prices.values.astype(float)
    n = len(y)

    F = np.array([[1.0, 1.0], [0.0, 1.0]])
    H = np.array([[1.0, 0.0]])
    Q = np.diag([prices.values.std() ** 2 * 0.01, prices.values.std() ** 2 * 0.0001])
    R = np.array([[prices.values.std() ** 2 * 2.0]])

    x = np.array([[y[0]], [0.0]])
    P = np.eye(2) * 1e8

    smoothed = np.empty(n)
    slopes = np.empty(n)

    for t in range(n):
        xp = F @ x
        Pp = F @ P @ F.T + Q
        S = H @ Pp @ H.T + R
        K = Pp @ H.T / float(S[0, 0])
        inn = y[t] - float((H @ xp)[0, 0])
        x = xp + K * inn
        P = (np.eye(2) - K @ H) @ Pp
        smoothed[t] = float(x[0, 0])
        slopes[t] = float(x[1, 0])

    tail = 365
    dates = prices.index[-tail:]
    sm_tail = smoothed[-tail:]
    cur_slope = float(slopes[-1])

    return {
        "price": _series(prices, tail=tail),
        "trend": [{"time": dates[i].strftime("%Y-%m-%d"), "value": round(float(sm_tail[i]), 2)} for i in range(len(dates))],
        "current_trend_value": round(float(smoothed[-1]), 2),
        "current_slope": round(cur_slope, 2),
        "trend_label": "bullish" if cur_slope > 0 else "bearish",
        "current_price": round(float(prices.iloc[-1]), 2),
    }


# ── 5. Hidden Markov Model ────────────────────────────────────────────────────

def run_hmm(prices: pd.Series, n_states: int = 3) -> dict:
    """
    Gaussian HMM via EM on (daily_return, rolling_vol) features.
    States sorted so 0=bear, 1=neutral, 2=bull by mean return.
    """
    from scipy.stats import multivariate_normal

    r = _log_returns(prices)
    w = 5
    rv = np.array([r[max(0, i - w):i + 1].std() for i in range(len(r))])
    X = np.column_stack([r, rv])
    n = len(X)

    # Init labels by return quantile buckets
    qi = np.argsort(r)
    chunk = n // n_states
    labels = np.zeros(n, dtype=int)
    for k in range(n_states):
        s = k * chunk
        e = (k + 1) * chunk if k < n_states - 1 else n
        labels[qi[s:e]] = k

    log_probs = np.zeros((n, n_states))

    for _ in range(40):
        means = np.array([X[labels == k].mean(axis=0) if (labels == k).sum() > 1 else X.mean(axis=0) for k in range(n_states)])
        covs = []
        for k in range(n_states):
            xk = X[labels == k]
            if len(xk) > 1:
                cov = np.cov(xk.T) + np.eye(2) * 1e-6
            else:
                cov = np.eye(2) * 1e-4
            covs.append(cov)
        pi = np.array([(labels == k).mean() + 1e-8 for k in range(n_states)])
        pi /= pi.sum()

        for k in range(n_states):
            try:
                log_probs[:, k] = np.log(pi[k]) + multivariate_normal.logpdf(X, mean=means[k], cov=covs[k])
            except Exception:
                log_probs[:, k] = np.log(pi[k]) - 1e6

        new_labels = np.argmax(log_probs, axis=1)
        if np.all(new_labels == labels):
            break
        labels = new_labels

    # Sort states by mean return → 0=bear, 1=neutral, 2=bull
    mean_rets = [r[labels == k].mean() if (labels == k).any() else 0.0 for k in range(n_states)]
    order = np.argsort(mean_rets)
    state_map = {int(order[i]): i for i in range(n_states)}
    seq = np.array([state_map[int(l)] for l in labels])

    cur = int(seq[-1])
    raw_probs = np.exp(log_probs[-1] - log_probs[-1].max())
    raw_probs /= raw_probs.sum()
    remapped = {state_map[k]: float(raw_probs[k]) for k in range(n_states)}
    cur_prob = remapped.get(cur, 0.0)

    STATE_LABELS = {0: "Bear", 1: "Neutral", 2: "Bull"}
    STATE_COLORS = {0: "bearish", 1: "neutral", 2: "bullish"}
    CHART_COLORS = {0: "#fb4b4b", 1: "#78829680", 2: "#34d399"}

    tail = 365
    dates = prices.index[1:]
    tail_dates = dates[-tail:]
    tail_seq = seq[-tail:]

    regime_series = [
        {
            "time": tail_dates[i].strftime("%Y-%m-%d"),
            "value": int(tail_seq[i]),
            "color": CHART_COLORS[int(tail_seq[i])],
        }
        for i in range(len(tail_dates))
    ]

    return {
        "regimes": regime_series,
        "current_regime": cur,
        "current_regime_label": STATE_LABELS.get(cur, "Unknown"),
        "current_regime_class": STATE_COLORS.get(cur, "neutral"),
        "current_regime_probability": round(cur_prob, 3),
        "n_states": n_states,
    }


# ── 6. ARIMA(2,1,2) ───────────────────────────────────────────────────────────

def run_arima(prices: pd.Series, steps: int = 14) -> dict:
    """ARIMA(2,1,2) forecast with 80% CI. Falls back to AR(1) if statsmodels unavailable."""
    last_date = prices.index[-1]
    future_dates = [(last_date + timedelta(days=i + 1)).strftime("%Y-%m-%d") for i in range(steps)]
    cur = float(prices.iloc[-1])

    try:
        from statsmodels.tsa.arima.model import ARIMA as _ARIMA
        mdl = _ARIMA(prices.values, order=(2, 1, 2))
        fit = mdl.fit()
        fc = fit.get_forecast(steps=steps)
        fc_mean = fc.predicted_mean
        fc_ci = fc.conf_int(alpha=0.2)
        fc_14d = round(float(fc_mean[-1]), 2)
        return {
            "price": _series(prices, tail=90),
            "forecast": [{"time": future_dates[i], "value": round(float(fc_mean[i]), 2)} for i in range(steps)],
            "lower": [{"time": future_dates[i], "value": round(float(fc_ci[i, 0]), 2)} for i in range(steps)],
            "upper": [{"time": future_dates[i], "value": round(float(fc_ci[i, 1]), 2)} for i in range(steps)],
            "steps": steps,
            "current_price": round(cur, 2),
            "forecast_14d": fc_14d,
            "change_pct": round((fc_14d / cur - 1) * 100, 2),
        }
    except Exception as e:
        log.warning("ARIMA statsmodels failed (%s) — using AR(1) fallback", e)
        r = _log_returns(prices)
        rho = float(np.corrcoef(r[:-1], r[1:])[0, 1])
        mu = float(r.mean())
        spread = float(r.std()) * cur * 1.96

        fc_prices, lr = [cur], float(r[-1])
        for _ in range(steps):
            lr = mu + rho * (lr - mu)
            fc_prices.append(fc_prices[-1] * math.exp(lr))
        fc = fc_prices[1:]
        fc_14d = round(fc[-1], 2)
        return {
            "price": _series(prices, tail=90),
            "forecast": [{"time": future_dates[i], "value": round(fc[i], 2)} for i in range(steps)],
            "lower": [{"time": future_dates[i], "value": round(fc[i] - spread, 2)} for i in range(steps)],
            "upper": [{"time": future_dates[i], "value": round(fc[i] + spread, 2)} for i in range(steps)],
            "steps": steps,
            "current_price": round(cur, 2),
            "forecast_14d": fc_14d,
            "change_pct": round((fc_14d / cur - 1) * 100, 2),
        }


# ── 7. Neural Network (MLP, pure numpy) ───────────────────────────────────────

def run_neural_network(prices: pd.Series) -> dict:
    """
    1-hidden-layer MLP trained on 20-day return windows.
    Predicts P(next-day return > 0). Pure numpy — no framework needed.
    Architecture: 20 → 32 → 1  (ReLU + sigmoid)
    """
    r = _log_returns(prices)
    w = 20

    X, y = [], []
    for i in range(w, len(r)):
        feat = r[i - w:i]
        std = feat.std() + 1e-8
        X.append(feat / std)
        y.append(1.0 if r[i] > 0 else 0.0)

    X = np.array(X, dtype=np.float32)
    y = np.array(y, dtype=np.float32)

    split = max(len(X) - 90, int(len(X) * 0.8))
    X_tr, X_te = X[:split], X[split:]
    y_tr, y_te = y[:split], y[split:]

    n_in, n_h = w, 32
    rng = np.random.default_rng(42)
    W1 = rng.standard_normal((n_in, n_h)).astype(np.float32) * math.sqrt(2.0 / n_in)
    b1 = np.zeros(n_h, dtype=np.float32)
    W2 = rng.standard_normal((n_h, 1)).astype(np.float32) * math.sqrt(2.0 / n_h)
    b2 = np.zeros(1, dtype=np.float32)

    def relu(x): return np.maximum(0.0, x)
    def sig(x): return 1.0 / (1.0 + np.exp(-np.clip(x, -20, 20)))

    lr, bs, epochs = 0.005, 32, 80
    for _ in range(epochs):
        idx = rng.permutation(len(X_tr))
        for s in range(0, len(idx), bs):
            bi = idx[s:s + bs]
            Xb, yb = X_tr[bi], y_tr[bi].reshape(-1, 1)
            z1 = Xb @ W1 + b1
            a1 = relu(z1)
            p = sig(a1 @ W2 + b2)
            d2 = p - yb
            W2 -= lr * (a1.T @ d2) / len(Xb)
            b2 -= lr * d2.mean(axis=0)
            d1 = (d2 @ W2.T) * (z1 > 0)
            W1 -= lr * (Xb.T @ d1) / len(Xb)
            b1 -= lr * d1.mean(axis=0)

    def predict(Xp):
        return sig(relu(Xp @ W1 + b1) @ W2 + b2).flatten()

    test_preds = predict(X_te)
    acc = float(np.mean((test_preds > 0.5) == y_te))

    cur_feat = r[-w:] / (r[-w:].std() + 1e-8)
    cur_prob = float(predict(cur_feat.reshape(1, -1).astype(np.float32))[0])

    # Rolling signal series (last ~365 days)
    n_tail = min(len(X), 365)
    tail_preds = predict(X[-n_tail:])
    tail_start = len(r) - n_tail + w  # offset to align with price dates
    tail_dates = prices.index[min(tail_start, len(prices) - n_tail):]

    signal_series = [
        {"time": tail_dates[min(i, len(tail_dates) - 1)].strftime("%Y-%m-%d"), "value": round(float(tail_preds[i]), 4)}
        for i in range(min(n_tail, len(tail_dates)))
    ]

    label = "bullish" if cur_prob > 0.55 else ("bearish" if cur_prob < 0.45 else "neutral")

    return {
        "signal": signal_series,
        "current_probability_up": round(cur_prob, 4),
        "signal_label": label,
        "test_accuracy": round(acc, 4),
        "n_train": int(split),
        "n_test": len(X_te),
        "architecture": f"MLP({n_in}→{n_h}→1, ReLU+Sigmoid)",
    }


# ── 8. Chronos (Amazon Foundation Model) ─────────────────────────────────────

_chronos_pipeline = None  # lazy-loaded singleton — weights download once to /app/data/hf_cache


def _get_chronos():
    global _chronos_pipeline
    if _chronos_pipeline is not None:
        return _chronos_pipeline
    import os
    import torch
    from chronos import ChronosPipeline
    os.environ.setdefault("HF_HOME", "/app/data/hf_cache")
    log.info("Chronos: loading model weights (first run downloads ~700 MB)…")
    _chronos_pipeline = ChronosPipeline.from_pretrained(
        "amazon/chronos-t5-large",
        device_map="cpu",
        torch_dtype=torch.float32,
    )
    log.info("Chronos: model ready")
    return _chronos_pipeline


def run_chronos(prices: pd.Series, horizon: int = 90, num_samples: int = 20) -> dict:
    """Amazon Chronos-T5-Large zero-shot probabilistic 90-day price forecast."""
    import torch

    pipeline = _get_chronos()

    context_len = min(512, len(prices))
    context_vals = prices.values[-context_len:].astype(float)
    context = torch.tensor(context_vals, dtype=torch.float32)

    forecast = pipeline.predict(
        context=context,
        prediction_length=horizon,
        num_samples=num_samples,
    )  # shape: (num_samples, prediction_length)

    fc_np = forecast.numpy()  # (num_samples, horizon)
    median = np.median(fc_np, axis=0)
    lower  = np.quantile(fc_np, 0.1, axis=0)
    upper  = np.quantile(fc_np, 0.9, axis=0)

    last_date = prices.index[-1]
    future_dates = [(last_date + timedelta(days=i + 1)).strftime("%Y-%m-%d") for i in range(horizon)]

    cur = float(prices.iloc[-1])
    fc_final = float(median[-1])

    return {
        "price":         _series(prices, tail=180),
        "forecast":      [{"time": future_dates[i], "value": round(float(median[i]), 2)} for i in range(horizon)],
        "lower":         [{"time": future_dates[i], "value": round(float(lower[i]), 2)} for i in range(horizon)],
        "upper":         [{"time": future_dates[i], "value": round(float(upper[i]), 2)} for i in range(horizon)],
        "current_price": round(cur, 2),
        "forecast_90d":  round(fc_final, 2),
        "change_pct":    round((fc_final / cur - 1) * 100, 2),
        "horizon_days":  horizon,
        "context_points": context_len,
    }


# ── Runner ────────────────────────────────────────────────────────────────────

def _clean(obj):
    """Recursively replace nan/inf/numpy types for JSON safety."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return _clean(obj.tolist())
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else f
    return obj


async def run_all() -> dict:
    """Run all 7 models and return combined result (cached 4 h)."""
    global _cache, _cache_time
    now = datetime.now(timezone.utc)
    if _cache and _cache_time and (now - _cache_time).total_seconds() < CACHE_TTL:
        return _cache

    log.info("Quant: fetching BTC price data…")
    prices = await _get_btc_prices()
    prices = prices[np.isfinite(prices.values) & (prices.values > 0)]  # drop inf/nan/zero rows
    log.info("Quant: %d price points, running 8 models…", len(prices))

    result: dict = {
        "generated_at": now.isoformat(),
        "price_current": round(float(prices.iloc[-1]), 2),
        "price_date": prices.index[-1].strftime("%Y-%m-%d"),
        "data_points": len(prices),
    }

    MODELS = [
        ("linear_regression", lambda: run_linear_regression(prices)),
        ("garch",             lambda: run_garch(prices)),
        ("monte_carlo",       lambda: run_monte_carlo(prices)),
        ("kalman",            lambda: run_kalman(prices)),
        ("hmm",               lambda: run_hmm(prices)),
        ("arima",             lambda: run_arima(prices)),
        ("neural_network",    lambda: run_neural_network(prices)),
        ("timesfm",           lambda: run_chronos(prices)),
    ]

    for name, fn in MODELS:
        try:
            result[name] = _clean(fn())
            log.info("Quant ✓ %s", name)
        except Exception as exc:
            log.error("Quant ✗ %s: %s", name, exc)
            result[name] = {"error": str(exc)}

    _cache = result
    _cache_time = now
    log.info("Quant: all models complete")
    return result


def invalidate_cache() -> None:
    global _cache, _cache_time
    _cache = None
    _cache_time = None
