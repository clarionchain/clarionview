import type { SeriesDataPoint } from "./workbench-types"

const WINDOW_FN_REGEX =
  /\b(sma|ema|stdev|zscore|roc|delta|cumsum)\(\s*([A-Z])\s*,\s*(\d+)\s*\)/g

interface WindowFnCall {
  fullMatch: string
  fn: string
  variable: string
  window: number
  placeholder: string
}

function findWindowFunctions(formula: string): WindowFnCall[] {
  const calls: WindowFnCall[] = []
  let match: RegExpExecArray | null
  const regex = new RegExp(WINDOW_FN_REGEX.source, "g")
  let idx = 0
  while ((match = regex.exec(formula)) !== null) {
    calls.push({
      fullMatch: match[0],
      fn: match[1],
      variable: match[2],
      window: parseInt(match[3], 10),
      placeholder: `__wf${idx}__`,
    })
    idx++
  }
  return calls
}

function computeSMA(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null
    let sum = 0
    let count = 0
    for (let j = i - window + 1; j <= i; j++) {
      if (values[j] == null) return null
      sum += values[j]!
      count++
    }
    return count === window ? sum / window : null
  })
}

function computeEMA(values: (number | null)[], window: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null)
  const k = 2 / (window + 1)

  let firstValid = -1
  for (let i = 0; i < values.length; i++) {
    if (values[i] != null) { firstValid = i; break }
  }
  if (firstValid < 0) return result

  let sum = 0
  let count = 0
  for (let i = firstValid; i < firstValid + window && i < values.length; i++) {
    if (values[i] == null) return result
    sum += values[i]!
    count++
  }
  if (count < window) return result

  let ema = sum / window
  result[firstValid + window - 1] = ema

  for (let i = firstValid + window; i < values.length; i++) {
    if (values[i] == null) { result[i] = null; continue }
    ema = values[i]! * k + ema * (1 - k)
    result[i] = ema
  }
  return result
}

function computeStdev(values: (number | null)[], window: number): (number | null)[] {
  const sma = computeSMA(values, window)
  return values.map((_, i) => {
    if (sma[i] == null) return null
    let sumSq = 0
    for (let j = i - window + 1; j <= i; j++) {
      if (values[j] == null) return null
      sumSq += (values[j]! - sma[i]!) ** 2
    }
    return Math.sqrt(sumSq / window)
  })
}

/** Rolling z-score: (xᵢ − μ) / σ over the same n-point window as sma/stdev (population σ). */
function computeZscore(values: (number | null)[], window: number): (number | null)[] {
  const mean = computeSMA(values, window)
  const sd = computeStdev(values, window)
  return values.map((v, i) => {
    if (v == null || mean[i] == null || sd[i] == null) return null
    const sigma = sd[i]!
    if (sigma === 0) return null
    return (v - mean[i]!) / sigma
  })
}

function computeROC(values: (number | null)[], window: number): (number | null)[] {
  return values.map((v, i) => {
    if (v == null || i < window || values[i - window] == null || values[i - window] === 0) return null
    return ((v - values[i - window]!) / values[i - window]!) * 100
  })
}

function computeDelta(values: (number | null)[], window: number): (number | null)[] {
  return values.map((v, i) => {
    if (v == null || i < window || values[i - window] == null) return null
    return v - values[i - window]!
  })
}

function computeCumsum(values: (number | null)[]): (number | null)[] {
  let sum = 0
  return values.map((v) => {
    if (v == null) return null
    sum += v
    return sum
  })
}

function applyWindowFn(fn: string, values: (number | null)[], window: number): (number | null)[] {
  switch (fn) {
    case "sma": return computeSMA(values, window)
    case "ema": return computeEMA(values, window)
    case "stdev": return computeStdev(values, window)
    case "zscore": return computeZscore(values, window)
    case "roc": return computeROC(values, window)
    case "delta": return computeDelta(values, window)
    case "cumsum": return computeCumsum(values)
    default: return values
  }
}

function evalPoint(expr: string, vars: Record<string, number>): number | null {
  try {
    let e = expr
    for (const [k, v] of Object.entries(vars)) {
      e = e.replace(new RegExp(`\\b${k}\\b`, "g"), isFinite(v) ? String(v) : "NaN")
    }
    e = e
      .replace(/\blog10\(/g, "Math.log10(")
      .replace(/\blog\(/g, "Math.log10(")
      .replace(/\bln\(/g, "Math.log(")
      .replace(/\bsqrt\(/g, "Math.sqrt(")
      .replace(/\babs\(/g, "Math.abs(")
      .replace(/\bexp\(/g, "Math.exp(")
      .replace(/\bpow\(/g, "Math.pow(")
      .replace(/\bmin\(/g, "Math.min(")
      .replace(/\bmax\(/g, "Math.max(")
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${e})`)() as number
    return isFinite(result) ? result : null
  } catch {
    return null
  }
}

export function computeFormula(
  formula: string,
  variables: Record<string, string>,
  dataMap: Map<string, SeriesDataPoint[]>
): SeriesDataPoint[] {
  const varKeys = Object.keys(variables)
  if (varKeys.length === 0) return []

  const datasets = varKeys.map((k) => dataMap.get(variables[k]))
  if (datasets.some((d) => !d || d.length === 0)) return []

  const lookups = varKeys.map((_, i) => {
    const m = new Map<string, number>()
    for (const p of datasets[i]!) m.set(p.time, p.value)
    return m
  })

  const baseDates = datasets[0]!.map((p) => p.time)

  const alignedValues: Record<string, (number | null)[]> = {}
  for (let vi = 0; vi < varKeys.length; vi++) {
    alignedValues[varKeys[vi]] = baseDates.map((d) => lookups[vi].get(d) ?? null)
  }

  const windowFns = findWindowFunctions(formula)
  let processedFormula = formula

  const precomputed: Record<string, (number | null)[]> = {}
  for (const wf of windowFns) {
    const srcValues = alignedValues[wf.variable]
    if (!srcValues) continue
    precomputed[wf.placeholder] = applyWindowFn(wf.fn, srcValues, wf.window)
    processedFormula = processedFormula.replace(wf.fullMatch, wf.placeholder)
  }

  const result: SeriesDataPoint[] = []
  for (let i = 0; i < baseDates.length; i++) {
    const pointVars: Record<string, number> = {}
    let valid = true

    for (const key of varKeys) {
      const v = alignedValues[key][i]
      if (v == null) { valid = false; break }
      pointVars[key] = v
    }

    for (const wf of windowFns) {
      const v = precomputed[wf.placeholder]?.[i]
      if (v == null) { valid = false; break }
      pointVars[wf.placeholder] = v
    }

    if (!valid) continue

    const value = evalPoint(processedFormula, pointVars)
    if (value != null) {
      result.push({ time: baseDates[i], value })
    }
  }

  return result
}
