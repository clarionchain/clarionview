import type { SeriesDataPoint } from "@/lib/workbench-types"

export type QuantMetrics = {
  cagr: number | null
  annualizedVol: number | null
  sharpe: number | null
  sortino: number | null
  maxDrawdown: number | null
  calmar: number | null
  var95: number | null
  skewness: number | null
  kurtosis: number | null
  totalReturn: number | null
  nPeriods: number
  periodsPerYear: number
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function stdDev(arr: number[], mu?: number): number {
  if (arr.length < 2) return 0
  const m = mu ?? mean(arr)
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(variance)
}

function logReturns(data: SeriesDataPoint[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1]!.value
    const curr = data[i]!.value
    if (prev > 0 && curr > 0 && Number.isFinite(prev) && Number.isFinite(curr)) {
      returns.push(Math.log(curr / prev))
    }
  }
  return returns
}

function yearsFromData(data: SeriesDataPoint[]): number {
  if (data.length < 2) return 0
  const first = new Date(data[0]!.time).getTime()
  const last = new Date(data[data.length - 1]!.time).getTime()
  if (isNaN(first) || isNaN(last)) return 0
  return (last - first) / (365.25 * 24 * 3600 * 1000)
}

function detectPeriodsPerYear(data: SeriesDataPoint[]): number {
  if (data.length < 2) return 252
  const d0 = new Date(data[0]!.time).getTime()
  const d1 = new Date(data[1]!.time).getTime()
  if (isNaN(d0) || isNaN(d1)) return 252
  const daysBetween = (d1 - d0) / (24 * 3600 * 1000)
  if (daysBetween <= 1.5) return 252
  if (daysBetween <= 7.5) return 52
  if (daysBetween <= 31) return 12
  return 1
}

export function computeMetrics(data: SeriesDataPoint[]): QuantMetrics {
  const n = data.length
  const periodsPerYear = detectPeriodsPerYear(data)
  const empty: QuantMetrics = {
    cagr: null, annualizedVol: null, sharpe: null, sortino: null,
    maxDrawdown: null, calmar: null, var95: null, skewness: null,
    kurtosis: null, totalReturn: null, nPeriods: n, periodsPerYear,
  }
  if (n < 10) return empty

  const first = data[0]!.value
  const last = data[n - 1]!.value
  const years = yearsFromData(data)

  const totalReturn = first > 0 ? (last - first) / first : null
  const cagr = first > 0 && last > 0 && years > 0.5
    ? Math.pow(last / first, 1 / years) - 1 : null

  const rets = logReturns(data)
  if (rets.length < 5) return { ...empty, cagr, totalReturn }

  const mu = mean(rets)
  const sigma = stdDev(rets, mu)

  const annualizedVol = sigma > 0 ? sigma * Math.sqrt(periodsPerYear) : null
  const annualizedReturn = mu * periodsPerYear

  const sharpe = annualizedVol && annualizedVol > 0 ? annualizedReturn / annualizedVol : null

  const negRets = rets.filter(r => r < 0)
  const downsideStd = negRets.length > 1
    ? Math.sqrt(negRets.reduce((s, r) => s + r * r, 0) / negRets.length) * Math.sqrt(periodsPerYear)
    : null
  const sortino = downsideStd && downsideStd > 0 ? annualizedReturn / downsideStd : null

  // Max drawdown
  let peak = data[0]!.value
  let maxDD = 0
  for (const d of data) {
    if (d.value > peak) peak = d.value
    if (peak > 0) {
      const dd = (peak - d.value) / peak
      if (dd > maxDD) maxDD = dd
    }
  }
  const maxDrawdown = maxDD

  const calmar = cagr !== null && maxDD > 0 ? cagr / maxDD : null

  // Historical VaR 95%
  const sorted = [...rets].sort((a, b) => a - b)
  const varIdx = Math.max(0, Math.floor(sorted.length * 0.05))
  const var95 = sorted[varIdx] ?? null

  // Skewness
  let skewness: number | null = null
  if (sigma > 0 && rets.length >= 3) {
    skewness = rets.reduce((s, r) => s + ((r - mu) / sigma) ** 3, 0) / rets.length
  }

  // Excess kurtosis
  let kurtosis: number | null = null
  if (sigma > 0 && rets.length >= 4) {
    kurtosis = rets.reduce((s, r) => s + ((r - mu) / sigma) ** 4, 0) / rets.length - 3
  }

  return { cagr, annualizedVol, sharpe, sortino, maxDrawdown, calmar, var95, skewness, kurtosis, totalReturn, nPeriods: n, periodsPerYear }
}

export type MonteCarloResult = {
  paths: number[][]
  p10: number[]
  p50: number[]
  p90: number[]
  lastValue: number
  nDays: number
}

export function runMonteCarlo(
  data: SeriesDataPoint[],
  nPaths = 200,
  nDays = 252
): MonteCarloResult | null {
  if (data.length < 20) return null
  if (!data.every(d => d.value > 0 && Number.isFinite(d.value))) return null

  const rets = logReturns(data)
  if (rets.length < 5) return null

  const mu = mean(rets)
  const sigma = stdDev(rets, mu)
  const lastVal = data[data.length - 1]!.value

  const paths: number[][] = []

  for (let p = 0; p < nPaths; p++) {
    const path: number[] = [lastVal]
    let curr = lastVal
    for (let d = 0; d < nDays; d++) {
      const u1 = Math.max(Math.random(), 1e-10)
      const u2 = Math.random()
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      curr = curr * Math.exp(mu + sigma * z)
      path.push(curr)
    }
    paths.push(path)
  }

  const p10: number[] = []
  const p50: number[] = []
  const p90: number[] = []

  for (let i = 0; i <= nDays; i++) {
    const vals = paths.map(p => p[i]!).sort((a, b) => a - b)
    p10.push(vals[Math.floor(vals.length * 0.10)]!)
    p50.push(vals[Math.floor(vals.length * 0.50)]!)
    p90.push(vals[Math.floor(vals.length * 0.90)]!)
  }

  return { paths, p10, p50, p90, lastValue: lastVal, nDays }
}

export function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—"
  return (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%"
}

export function fmtRatio(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—"
  return v.toFixed(2)
}

export function fmtNum(v: number | null, decimals = 2): string {
  if (v === null || !Number.isFinite(v)) return "—"
  return v.toFixed(decimals)
}

export function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return "—"
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M"
  if (v >= 1e3) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 })
  if (v >= 1) return "$" + v.toFixed(2)
  return "$" + v.toPrecision(4)
}
