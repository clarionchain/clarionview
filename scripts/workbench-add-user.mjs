#!/usr/bin/env node
/**
 * Create a non-admin user without the web UI (same rules as /api/admin/users).
 * Run from repo root: node scripts/workbench-add-user.mjs <username> <password>
 * Docker: docker exec -it dc_clarionchain_workbench node scripts/workbench-add-user.mjs alice 'secret-here'
 */
import { createRequire } from "module"
import path from "path"
import { fileURLToPath } from "url"

const require = createRequire(import.meta.url)
const Database = require("better-sqlite3")
const bcrypt = require("bcryptjs")

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")

const dbPath = process.env.SQLITE_PATH || path.join(root, "data", "workbench.db")
const username = process.argv[2]
const password = process.argv[3]
if (!username || !password) {
  console.error("Usage: node scripts/workbench-add-user.mjs <username> <password>")
  process.exit(1)
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters")
  process.exit(1)
}

const db = new Database(dbPath)
try {
  const cols = db.prepare("PRAGMA table_info(users)").all()
  if (!cols.some((c) => c.name === "is_admin")) {
    db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
  }
  const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username.trim())
  if (exists) {
    console.error("Username already exists")
    process.exit(1)
  }
  const hash = bcrypt.hashSync(password, 12)
  db.prepare("INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)").run(
    username.trim(),
    hash
  )
  console.log("Created user:", username.trim())
} finally {
  db.close()
}
