/**
 * Preset columns: each column is one hue family, top → bottom light → dark.
 */
export const PALETTE_COLUMNS = [
  ["#fecaca", "#f87171", "#dc2626", "#991b1b"],
  ["#ffedd5", "#fb923c", "#ea580c", "#9a3412"],
  ["#fef3c7", "#fcd34d", "#ca8a04", "#854d0e"],
  ["#dcfce7", "#86efac", "#22c55e", "#166534"],
  ["#ccfbf1", "#5eead4", "#14b8a6", "#115e59"],
  ["#e0f2fe", "#38bdf8", "#0ea5e9", "#075985"],
  ["#dbeafe", "#60a5fa", "#2563eb", "#1e3a8a"],
  ["#ede9fe", "#a78bfa", "#7c3aed", "#4c1d95"],
  ["#fae8ff", "#e879f9", "#c026d3", "#86198f"],
  ["#f4f4f5", "#a1a1aa", "#52525b", "#27272a"],
] as const

export const PALETTE_COLUMN_COUNT = PALETTE_COLUMNS.length
