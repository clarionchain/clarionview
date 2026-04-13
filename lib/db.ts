import fs from "fs"
import path from "path"
import Database from "better-sqlite3"
import bcrypt from "bcryptjs"

const DEFAULT_PATH = path.join(process.cwd(), "data", "workbench.db")

let dbInstance: Database.Database | null = null

export function getDbPath(): string {
  return process.env.SQLITE_PATH || DEFAULT_PATH
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance
  const dbPath = getDbPath()
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workbooks (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      configs_json TEXT NOT NULL,
      pane_scales_json TEXT,
      log_scale INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      saved_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_workbooks_user_sort ON workbooks(user_id, sort_order);
    CREATE TABLE IF NOT EXISTS ai_usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage_log(user_id, created_at);
    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      public_key TEXT NOT NULL,
      sign_count INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      device_type TEXT,
      backed_up INTEGER NOT NULL DEFAULT 0,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);
  `)
  migrateUsersIsAdmin(db)
  migrateUserAiColumns(db)
  migrateUsersEmail(db)
  bootstrapAdminUser(db)
  dbInstance = db
  return db
}

/** Older DBs created before is_admin existed. */
function migrateUsersIsAdmin(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[]
  if (cols.some((c) => c.name === "is_admin")) return
  db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
  const adminName = process.env.WORKBENCH_ADMIN_USER || "admin"
  const up = db.prepare("UPDATE users SET is_admin = 1 WHERE username = ?").run(adminName)
  if (up.changes === 0) {
    db.prepare("UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users)").run()
  }
}

function migrateUsersEmail(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[]
  if (!cols.some((c) => c.name === "email")) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT")
  }
}

/** OpenRouter BYOK + preferences (added after initial users table). */
function migrateUserAiColumns(db: Database.Database) {
  function userColumnNames(): Set<string> {
    return new Set(
      (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name)
    )
  }
  const alters: [string, string][] = [
    ["openrouter_byok_encrypted", "ALTER TABLE users ADD COLUMN openrouter_byok_encrypted TEXT"],
    ["openrouter_model", "ALTER TABLE users ADD COLUMN openrouter_model TEXT"],
    ["ai_key_source", "ALTER TABLE users ADD COLUMN ai_key_source TEXT NOT NULL DEFAULT 'auto'"],
    ["ai_allow_platform", "ALTER TABLE users ADD COLUMN ai_allow_platform INTEGER NOT NULL DEFAULT 1"],
    ["ai_chat_provider", "ALTER TABLE users ADD COLUMN ai_chat_provider TEXT NOT NULL DEFAULT 'openrouter'"],
    ["local_openai_base_url", "ALTER TABLE users ADD COLUMN local_openai_base_url TEXT"],
    ["local_openai_api_key_encrypted", "ALTER TABLE users ADD COLUMN local_openai_api_key_encrypted TEXT"],
    ["local_model", "ALTER TABLE users ADD COLUMN local_model TEXT"],
    ["routstr_api_key_encrypted", "ALTER TABLE users ADD COLUMN routstr_api_key_encrypted TEXT"],
    ["routstr_model", "ALTER TABLE users ADD COLUMN routstr_model TEXT"],
  ]
  for (const [name, ddl] of alters) {
    if (!userColumnNames().has(name)) {
      db.exec(ddl)
    }
  }
}

function bootstrapAdminUser(db: Database.Database) {
  const row = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }
  if (row.c > 0) return
  const password = process.env.WORKBENCH_ADMIN_PASSWORD
  if (!password || password.length < 4) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[workbench] No users exist. Set WORKBENCH_ADMIN_PASSWORD (min 4 chars) to create the admin user."
      )
    }
    return
  }
  const username = process.env.WORKBENCH_ADMIN_USER || "admin"
  const password_hash = bcrypt.hashSync(password, 12)
  db.prepare("INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)").run(
    username,
    password_hash
  )
  console.info(`[workbench] Created initial admin user "${username}" from WORKBENCH_ADMIN_PASSWORD.`)
}

export function verifyUserPassword(username: string, password: string): number | null {
  const db = getDb()
  const row = db.prepare("SELECT id, password_hash FROM users WHERE username = ?").get(username) as
    | { id: number; password_hash: string }
    | undefined
  if (!row) return null
  if (!bcrypt.compareSync(password, row.password_hash)) return null
  return row.id
}

export function isUserAdmin(userId: number): boolean {
  const db = getDb()
  const row = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId) as
    | { is_admin: number }
    | undefined
  return row?.is_admin === 1
}

export type ListedUser = { id: number; username: string; is_admin: boolean; created_at: string }

export function listUsersForAdmin(): ListedUser[] {
  const db = getDb()
  const rows = db
    .prepare("SELECT id, username, is_admin, created_at FROM users ORDER BY id ASC")
    .all() as { id: number; username: string; is_admin: number; created_at: string }[]
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    is_admin: r.is_admin === 1,
    created_at: r.created_at,
  }))
}

export function createUserAccount(
  username: string,
  password: string
): { ok: true; id: number } | { ok: false; error: string } {
  const u = username.trim()
  if (u.length < 1 || u.length > 128) {
    return { ok: false, error: "Username must be 1–128 characters" }
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters" }
  }
  const db = getDb()
  const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(u) as { 1: number } | undefined
  if (exists) return { ok: false, error: "Username already exists" }
  const password_hash = bcrypt.hashSync(password, 12)
  const r = db.prepare("INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)").run(
    u,
    password_hash
  )
  return { ok: true, id: Number(r.lastInsertRowid) }
}

const MIN_PASSWORD_LEN = 8

function assertPasswordOk(password: string): string | null {
  if (password.length < MIN_PASSWORD_LEN) {
    return `Password must be at least ${MIN_PASSWORD_LEN} characters`
  }
  return null
}

export type SessionUser = { id: number; username: string; is_admin: boolean }

export function getUserById(userId: number): SessionUser | null {
  const db = getDb()
  const row = db.prepare("SELECT id, username, is_admin FROM users WHERE id = ?").get(userId) as
    | { id: number; username: string; is_admin: number }
    | undefined
  if (!row) return null
  return { id: row.id, username: row.username, is_admin: row.is_admin === 1 }
}

export function countAdminUsers(): number {
  const db = getDb()
  const row = db.prepare("SELECT COUNT(*) as c FROM users WHERE is_admin = 1").get() as { c: number }
  return row.c
}

export function changeOwnPassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): { ok: true } | { ok: false; error: string } {
  const msg = assertPasswordOk(newPassword)
  if (msg) return { ok: false, error: msg }
  const db = getDb()
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as
    | { password_hash: string }
    | undefined
  if (!row) return { ok: false, error: "User not found" }
  if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
    return { ok: false, error: "Current password is incorrect" }
  }
  const password_hash = bcrypt.hashSync(newPassword, 12)
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(password_hash, userId)
  return { ok: true }
}

export function adminUpdateUser(
  actingAdminId: number,
  targetId: number,
  fields: { username?: string; password?: string }
): { ok: true } | { ok: false; error: string } {
  if (!isUserAdmin(actingAdminId)) {
    return { ok: false, error: "Forbidden" }
  }
  const target = getUserById(targetId)
  if (!target) return { ok: false, error: "User not found" }

  let newUsername: string | undefined
  if (fields.username !== undefined) {
    const u = fields.username.trim()
    if (u.length < 1 || u.length > 128) {
      return { ok: false, error: "Username must be 1–128 characters" }
    }
    const db = getDb()
    const clash = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(u, targetId) as
      | { id: number }
      | undefined
    if (clash) return { ok: false, error: "Username already taken" }
    newUsername = u
  }

  let newHash: string | undefined
  if (fields.password !== undefined && fields.password.length > 0) {
    const msg = assertPasswordOk(fields.password)
    if (msg) return { ok: false, error: msg }
    newHash = bcrypt.hashSync(fields.password, 12)
  }

  if (newUsername === undefined && newHash === undefined) {
    return { ok: false, error: "Nothing to update" }
  }

  const db = getDb()
  if (newUsername !== undefined && newHash !== undefined) {
    db.prepare("UPDATE users SET username = ?, password_hash = ? WHERE id = ?").run(
      newUsername,
      newHash,
      targetId
    )
  } else if (newUsername !== undefined) {
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(newUsername, targetId)
  } else if (newHash !== undefined) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, targetId)
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export function getUserEmail(userId: number): string | null {
  const db = getDb()
  const row = db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as { email: string | null } | undefined
  return row?.email ?? null
}

export function setUserEmail(userId: number, email: string | null): void {
  getDb().prepare("UPDATE users SET email = ? WHERE id = ?").run(email, userId)
}

export function getUserByEmail(email: string): { id: number; username: string } | null {
  const db = getDb()
  const row = db.prepare("SELECT id, username FROM users WHERE lower(email) = lower(?)").get(email.trim()) as
    | { id: number; username: string }
    | undefined
  return row ?? null
}

// ---------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------

export interface StoredPasskey {
  id: string
  userId: number
  publicKey: string
  signCount: number
  transports: string[] | null
  deviceType: string | null
  backedUp: boolean
  name: string | null
  createdAt: string
}

export function listPasskeysForUser(userId: number): StoredPasskey[] {
  const db = getDb()
  const rows = db
    .prepare("SELECT id, user_id, public_key, sign_count, transports, device_type, backed_up, name, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as {
      id: string; user_id: number; public_key: string; sign_count: number
      transports: string | null; device_type: string | null; backed_up: number; name: string | null; created_at: string
    }[]
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    publicKey: r.public_key,
    signCount: r.sign_count,
    transports: r.transports ? JSON.parse(r.transports) : null,
    deviceType: r.device_type,
    backedUp: r.backed_up === 1,
    name: r.name,
    createdAt: r.created_at,
  }))
}

export function getPasskeyById(credentialId: string): StoredPasskey | null {
  const db = getDb()
  const r = db.prepare("SELECT id, user_id, public_key, sign_count, transports, device_type, backed_up, name, created_at FROM passkeys WHERE id = ?").get(credentialId) as {
    id: string; user_id: number; public_key: string; sign_count: number
    transports: string | null; device_type: string | null; backed_up: number; name: string | null; created_at: string
  } | undefined
  if (!r) return null
  return {
    id: r.id,
    userId: r.user_id,
    publicKey: r.public_key,
    signCount: r.sign_count,
    transports: r.transports ? JSON.parse(r.transports) : null,
    deviceType: r.device_type,
    backedUp: r.backed_up === 1,
    name: r.name,
    createdAt: r.created_at,
  }
}

export function savePasskey(passkey: {
  id: string; userId: number; publicKey: string; signCount: number
  transports?: string[] | null; deviceType?: string | null; backedUp?: boolean; name?: string | null
}): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO passkeys (id, user_id, public_key, sign_count, transports, device_type, backed_up, name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      sign_count = excluded.sign_count,
      backed_up = excluded.backed_up
  `).run(
    passkey.id,
    passkey.userId,
    passkey.publicKey,
    passkey.signCount,
    passkey.transports ? JSON.stringify(passkey.transports) : null,
    passkey.deviceType ?? null,
    passkey.backedUp ? 1 : 0,
    passkey.name ?? null,
  )
}

export function updatePasskeySignCount(id: string, signCount: number): void {
  getDb().prepare("UPDATE passkeys SET sign_count = ? WHERE id = ?").run(signCount, id)
}

export function deletePasskey(id: string, userId: number): boolean {
  const r = getDb().prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").run(id, userId)
  return r.changes > 0
}

export function adminDeleteUser(
  actingAdminId: number,
  targetId: number
): { ok: true } | { ok: false; error: string } {
  if (!isUserAdmin(actingAdminId)) {
    return { ok: false, error: "Forbidden" }
  }
  if (targetId === actingAdminId) {
    return { ok: false, error: "You cannot delete your own account" }
  }
  const target = getUserById(targetId)
  if (!target) return { ok: false, error: "User not found" }
  if (target.is_admin && countAdminUsers() <= 1) {
    return { ok: false, error: "Cannot delete the last admin account" }
  }
  const db = getDb()
  db.prepare("DELETE FROM users WHERE id = ?").run(targetId)
  return { ok: true }
}
