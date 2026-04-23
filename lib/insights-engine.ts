// ─────────────────────────────────────────────────────────────────────────────
// Insights engine
//
// Pure synthesis layer over the structured data already produced by the app's
// quant/reports/mining pipelines. Consumes the /api/quant payload and emits
// a fixed set of Insight objects — one per stable question.
//
// The design principle: the *questions* are fixed (so the user's eye learns
// where each answer lives on the card grid); the *answers* vary daily.
//
// Rules are hand-authored below. When you want to tune an insight's behavior,
// edit the corresponding `derive*` function. Each function is a pure input→
// insight mapping with no side effects.
// ─────────────────────────────────────────────────────────────────────────────

import type { QuantResult } from "@/lib/quant-models"

export type Lean = "bullish" | "bearish" | "neutral" | "caution"

export type Insight = {
  slot: "cycle" | "regime" | "valuation" | "volatility" | "momentum"
  question: string              // The stable question this slot always answers
  headline: string              // Plain-English one-line answer
  lean: Lean                    // For color/icon
  confidence: number            // 0–100; product of signal strength × agreement
  contributors: string[]        // 2–4 short lines naming the signals that fed it
  deepLink: string              // Path into the Workbench view that drives it
}

// ── Halving cycle reference points ───────────────────────────────────────────
// Used by the Cycle slot. Historical: peak typically ~450–550 days after a
// halving; bear/accumulation bottoms roughly 900–1200 days in.
const HALVINGS = [
  "2009-01-03", // Genesis (epoch marker, not a real halving)
  "2012-11-28",
  "2016-07-09",
  "2020-05-11",
  "2024-04-20",
  "2028-04-15", // projected
] as const

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000)
}

function lastHalving(today: Date): { date: Date; index: number; daysSince: number } {
  for (let i = HALVINGS.length - 1; i >= 1; i--) {
    const d = new Date(HALVINGS[i]!)
    if (d <= today) return { date: d, index: i, daysSince: daysBetween(d, today) }
  }
  const d = new Date(HALVINGS[1]!)
  return { date: d, index: 1, daysSince: daysBetween(d, today) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot: Regime  —  "Bull, bear, or neutral?"
// Synthesizes HMM (primary) + Kalman slope (confirm/deny) + GARCH vol state.
// ─────────────────────────────────────────────────────────────────────────────
function deriveRegime(q: QuantResult): Insight | null {
  const hmm = q.hmm
  if (!hmm || "error" in (hmm as object)) return null

  const kalman = q.kalman && !("error" in (q.kalman as object)) ? q.kalman : null
  const garch = q.garch && !("error" in (q.garch as object)) ? q.garch : null

  const hmmLabel = hmm.current_regime_label.toLowerCase()
  const hmmProb = hmm.current_regime_probability ?? 0.5
  const hmmClass = hmm.current_regime_class // "bullish" | "bearish" | "neutral"

  const kalmanPositive = kalman ? kalman.current_slope > 0 : null
  const kalmanLabel = kalman?.trend_label.toLowerCase() ?? null

  // Agreement: does the Kalman trend direction match HMM class?
  let agree: boolean | null = null
  if (kalmanLabel !== null) {
    if (hmmClass === "bullish") agree = kalmanLabel === "bullish"
    else if (hmmClass === "bearish") agree = kalmanLabel === "bearish"
    else agree = true // HMM neutral → any Kalman is fine
  }

  // Confidence: start from HMM prob (0–1), scale to 0–100. Adjust for agreement.
  let confidence = Math.round(hmmProb * 100)
  if (agree === false) confidence = Math.max(30, confidence - 25)
  if (agree === true) confidence = Math.min(95, confidence + 5)

  // Headline
  let headline: string
  let lean: Lean
  if (agree === false) {
    // Conflicting signals — weakening or strengthening regime
    if (hmmClass === "bullish" && kalmanPositive === false) {
      headline = `${hmm.current_regime_label} regime, but trend momentum weakening — watch for flip.`
      lean = "caution"
    } else if (hmmClass === "bearish" && kalmanPositive === true) {
      headline = `${hmm.current_regime_label} regime, but short-term trend turning up — possible basing.`
      lean = "caution"
    } else {
      headline = `${hmm.current_regime_label} regime, with mixed trend signals.`
      lean = "neutral"
    }
  } else {
    if (hmmClass === "bullish") {
      headline = `Bull regime confirmed, trend supportive.`
      lean = "bullish"
    } else if (hmmClass === "bearish") {
      headline = `Bear regime confirmed, trend negative.`
      lean = "bearish"
    } else {
      headline = `Neutral regime — no dominant trend.`
      lean = "neutral"
    }
  }

  const contributors: string[] = [
    `HMM: ${hmm.current_regime_label} (${Math.round(hmmProb * 100)}% conf, 3-state Gaussian)`,
  ]
  if (kalman) {
    contributors.push(`Kalman slope: ${kalmanPositive ? "positive" : "negative"} ($${Math.abs(kalman.current_slope).toFixed(0)}/day)`)
  }
  if (garch) {
    contributors.push(`GARCH regime: ${garch.vol_regime} vol`)
  }

  return {
    slot: "regime",
    question: "What regime are we in?",
    headline,
    lean,
    confidence,
    contributors,
    deepLink: "/dashboards/quant",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot: Valuation  —  "Over- or under-priced vs trend?"
// Uses Kalman trend (adaptive, less biased than 15-year OLS) as reference.
// Notes the OLS deviation only as context, since it's known to run too hot.
// ─────────────────────────────────────────────────────────────────────────────
function deriveValuation(q: QuantResult): Insight | null {
  const kalman = q.kalman && !("error" in (q.kalman as object)) ? q.kalman : null
  const lr = q.linear_regression && !("error" in (q.linear_regression as object)) ? q.linear_regression : null
  if (!kalman && !lr) return null

  let headline = ""
  let lean: Lean = "neutral"
  let confidence = 50
  const contributors: string[] = []

  if (kalman) {
    const ratio = kalman.current_price / kalman.current_trend_value
    const pctVsKalman = (ratio - 1) * 100
    contributors.push(`Price vs Kalman trend: ${pctVsKalman >= 0 ? "+" : ""}${pctVsKalman.toFixed(1)}%`)

    if (ratio > 1.20) {
      headline = "Extended above adaptive trend — elevated reversion risk."
      lean = "caution"
      confidence = 70
    } else if (ratio > 1.05) {
      headline = "Above adaptive trend — modestly rich."
      lean = "caution"
      confidence = 60
    } else if (ratio < 0.80) {
      headline = "Deep below adaptive trend — historically favorable entry zone."
      lean = "bullish"
      confidence = 70
    } else if (ratio < 0.95) {
      headline = "Below adaptive trend — constructive."
      lean = "bullish"
      confidence = 60
    } else {
      headline = "Near adaptive trend — fair value."
      lean = "neutral"
      confidence = 55
    }
  }

  if (lr) {
    // Include as context only; the OLS fit runs too hot so don't let it dominate.
    contributors.push(`OLS deviation: ${lr.current_deviation_pct.toFixed(0)}% (long-run fit runs hot — context only)`)
  }

  return {
    slot: "valuation",
    question: "Over- or under-valued vs trend?",
    headline,
    lean,
    confidence,
    contributors,
    deepLink: "/dashboards/quant",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot: Volatility  —  "Is the environment calm, normal, or stormy?"
// GARCH regime + current/long-run ratio + 30d forecast direction.
// ─────────────────────────────────────────────────────────────────────────────
function deriveVolatility(q: QuantResult): Insight | null {
  const g = q.garch
  if (!g || "error" in (g as object)) return null

  const cur = g.current_vol_annualized ?? 0
  const lr = g.long_run_vol_annualized ?? 0
  const ratio = lr > 0 ? cur / lr : 1
  const fcst = g.forecast_30d_vol ?? cur
  const trajectory = fcst > cur * 1.05 ? "rising" : fcst < cur * 0.95 ? "falling" : "stable"

  let headline = ""
  let lean: Lean = "neutral"
  let confidence = 60

  if (ratio > 1.3) {
    headline = `Volatility elevated (${(cur * 100).toFixed(0)}% ann., ${trajectory}) — size positions smaller.`
    lean = "caution"
    confidence = 75
  } else if (ratio < 0.7) {
    headline = `Volatility compressed (${(cur * 100).toFixed(0)}% ann., ${trajectory}) — breakout risk rising.`
    lean = "caution"
    confidence = 65
  } else {
    headline = `Volatility normal (${(cur * 100).toFixed(0)}% ann., ${trajectory}).`
    lean = "neutral"
    confidence = 60
  }

  return {
    slot: "volatility",
    question: "What's the volatility environment?",
    headline,
    lean,
    confidence,
    contributors: [
      `Current: ${(cur * 100).toFixed(1)}% ann. vs long-run ${(lr * 100).toFixed(1)}% (ratio ${ratio.toFixed(2)}×)`,
      `30d GARCH forecast: ${(fcst * 100).toFixed(1)}% (${trajectory})`,
      `Regime: ${g.vol_regime}`,
    ],
    deepLink: "/dashboards/quant",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot: Momentum  —  "Short-horizon drift direction?"
// Vote across Chronos (if available), ARIMA, and Neural Network.
// ─────────────────────────────────────────────────────────────────────────────
function deriveMomentum(q: QuantResult): Insight | null {
  type Vote = { name: string; dir: 1 | -1 | 0; weight: number; detail: string }
  const votes: Vote[] = []

  if (q.timesfm && !("error" in (q.timesfm as object))) {
    const c = q.timesfm.change_pct
    votes.push({
      name: "Chronos (90d)",
      dir: c > 1 ? 1 : c < -1 ? -1 : 0,
      weight: 1.2, // foundation model, weight slightly higher
      detail: `${c >= 0 ? "+" : ""}${c.toFixed(1)}% expected`,
    })
  }
  if (q.arima && !("error" in (q.arima as object))) {
    const c = q.arima.change_pct
    votes.push({
      name: "ARIMA (14d)",
      dir: c > 1 ? 1 : c < -1 ? -1 : 0,
      weight: 1,
      detail: `${c >= 0 ? "+" : ""}${c.toFixed(1)}% expected`,
    })
  }
  if (q.neural_network && !("error" in (q.neural_network as object))) {
    const p = q.neural_network.current_probability_up
    votes.push({
      name: "Neural Net (1d)",
      dir: p > 0.55 ? 1 : p < 0.45 ? -1 : 0,
      weight: 0.8, // 1-day NN is noisy, weight slightly lower
      detail: `P(up) = ${(p * 100).toFixed(0)}%`,
    })
  }

  if (votes.length === 0) return null

  const totalWeight = votes.reduce((s, v) => s + v.weight, 0)
  const net = votes.reduce((s, v) => s + v.dir * v.weight, 0) / totalWeight // -1..+1
  const agreement = Math.abs(net) // 0 = split, 1 = all agree

  let headline = ""
  let lean: Lean
  if (net > 0.5) {
    headline = "Models agree: upward momentum."
    lean = "bullish"
  } else if (net > 0.15) {
    headline = "Modest upward bias across models."
    lean = "bullish"
  } else if (net < -0.5) {
    headline = "Models agree: downward momentum."
    lean = "bearish"
  } else if (net < -0.15) {
    headline = "Modest downward bias across models."
    lean = "bearish"
  } else {
    headline = "Models split — no clear momentum."
    lean = "neutral"
  }

  const confidence = Math.round(40 + agreement * 50) // 40–90

  return {
    slot: "momentum",
    question: "Which way are the models leaning?",
    headline,
    lean,
    confidence,
    contributors: votes.map((v) => `${v.name}: ${v.detail}`),
    deepLink: "/dashboards/quant",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot: Cycle  —  "Where in the halving cycle are we?"
// Pure date math; no market data needed. Phase bands are hand-authored
// based on historical cycle behavior.
// ─────────────────────────────────────────────────────────────────────────────
function deriveCycle(today: Date, q: QuantResult): Insight {
  const h = lastHalving(today)
  const d = h.daysSince

  let phase: string
  let headline: string
  let lean: Lean
  let confidence: number

  if (d < 180) {
    phase = "Post-halving accumulation"
    headline = `Day ${d} since halving — early accumulation phase. Supply shock not yet priced.`
    lean = "bullish"
    confidence = 65
  } else if (d < 420) {
    phase = "Supply-shock expansion"
    headline = `Day ${d} since halving — expansion phase; historical strongest returns window.`
    lean = "bullish"
    confidence = 75
  } else if (d < 620) {
    phase = "Cycle peak window"
    headline = `Day ${d} since halving — typical peak window (historical peaks: day 450–550).`
    lean = "caution"
    confidence = 70
  } else if (d < 900) {
    phase = "Post-peak cooling"
    headline = `Day ${d} since halving — post-peak cooling; reversion historically dominates.`
    lean = "caution"
    confidence = 65
  } else {
    phase = "Late-cycle accumulation"
    headline = `Day ${d} since halving — late-cycle; next halving becomes proximate driver.`
    lean = "neutral"
    confidence = 55
  }

  const nextHalvingDate = new Date(HALVINGS[Math.min(h.index + 1, HALVINGS.length - 1)]!)
  const daysToNext = daysBetween(today, nextHalvingDate)

  return {
    slot: "cycle",
    question: "Where in the halving cycle?",
    headline,
    lean,
    confidence,
    contributors: [
      `Phase: ${phase}`,
      `Last halving: ${HALVINGS[h.index]} (day ${d})`,
      daysToNext > 0 ? `Next halving: ${HALVINGS[Math.min(h.index + 1, HALVINGS.length - 1)]} (${daysToNext} days)` : `Next halving pending`,
      `Price at this halving: ${q.price_current ? "$" + q.price_current.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "n/a"}`,
    ],
    deepLink: "/dashboards/quant",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────
export function buildInsights(q: QuantResult, today: Date = new Date()): Insight[] {
  const out: Insight[] = []

  // Order matters — this is the visual left-to-right / top-to-bottom reading
  // order on the landing page. Cycle first (strategic frame), then Regime
  // (current state), then Valuation / Volatility (conditions), then Momentum
  // (tactical lean).
  out.push(deriveCycle(today, q))
  const r = deriveRegime(q); if (r) out.push(r)
  const v = deriveValuation(q); if (v) out.push(v)
  const vol = deriveVolatility(q); if (vol) out.push(vol)
  const m = deriveMomentum(q); if (m) out.push(m)

  return out
}
