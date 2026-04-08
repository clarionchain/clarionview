import type { SavedWorkbook } from "@/lib/workbench-types"
import { uid, normalizeSeriesConfigs } from "@/lib/workbench-types"
import { getDb } from "@/lib/db"

type Row = {
  id: string
  user_id: number
  name: string
  configs_json: string
  pane_scales_json: string | null
  log_scale: number
  sort_order: number
  saved_at: string
}

export function rowToSavedWorkbook(row: Row): SavedWorkbook {
  return {
    id: row.id,
    name: row.name,
    configs: normalizeSeriesConfigs(JSON.parse(row.configs_json)),
    logScale: row.log_scale !== 0,
    paneScales: row.pane_scales_json ? JSON.parse(row.pane_scales_json) : undefined,
    savedAt: row.saved_at,
  }
}

export function listWorkbooksForUser(userId: number): SavedWorkbook[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, user_id, name, configs_json, pane_scales_json, log_scale, sort_order, saved_at
       FROM workbooks WHERE user_id = ? ORDER BY sort_order ASC, saved_at DESC`
    )
    .all(userId) as Row[]
  return rows.map(rowToSavedWorkbook)
}

export function upsertWorkbook(userId: number, wb: SavedWorkbook): SavedWorkbook {
  const db = getDb()
  const savedAt = wb.savedAt || new Date().toISOString()
  const paneJson = wb.paneScales ? JSON.stringify(wb.paneScales) : null
  const configsJson = JSON.stringify(wb.configs)
  const logScale = wb.logScale ? 1 : 0

  const byName = db.prepare("SELECT id, sort_order FROM workbooks WHERE user_id = ? AND name = ?").get(userId, wb.name) as
    | { id: string; sort_order: number }
    | undefined

  if (byName) {
    db.prepare(
      `UPDATE workbooks SET configs_json = ?, pane_scales_json = ?, log_scale = ?, saved_at = ? WHERE id = ? AND user_id = ?`
    ).run(configsJson, paneJson, logScale, savedAt, byName.id, userId)
    return { ...wb, id: byName.id, savedAt }
  }

  const maxSort =
    (db.prepare("SELECT COALESCE(MAX(sort_order), -1) as m FROM workbooks WHERE user_id = ?").get(userId) as { m: number })
      .m + 1
  const id = wb.id || uid()
  db.prepare(
    `INSERT INTO workbooks (id, user_id, name, configs_json, pane_scales_json, log_scale, sort_order, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, wb.name, configsJson, paneJson, logScale, maxSort, savedAt)
  return { ...wb, id, savedAt }
}

export function deleteWorkbook(userId: number, id: string): boolean {
  const db = getDb()
  const r = db.prepare("DELETE FROM workbooks WHERE id = ? AND user_id = ?").run(id, userId)
  return r.changes > 0
}

export function reorderWorkbooks(userId: number, orderedIds: string[]): void {
  const db = getDb()
  const stmt = db.prepare("UPDATE workbooks SET sort_order = ? WHERE id = ? AND user_id = ?")
  const tx = db.transaction(() => {
    orderedIds.forEach((id, index) => {
      stmt.run(index, id, userId)
    })
  })
  tx()
}
