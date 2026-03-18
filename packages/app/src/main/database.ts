import initSqlJs, { type Database } from 'sql.js'
import fs from 'fs'
import { DB_PATH, DIMENSIONS_DIR } from './constants'

let db: Database | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

// Each migration has a version number and SQL.
// Only migrations with version > current schema_version will run.
// NEVER modify existing migrations — only append new ones.
const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS kv (
      widget_id TEXT NOT NULL,
      scene_id  TEXT NOT NULL,
      key       TEXT NOT NULL,
      value     TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (widget_id, scene_id, key)
    )`,
  },
  {
    version: 2,
    sql: `CREATE TABLE IF NOT EXISTS scenes (
      id         TEXT PRIMARY KEY,
      slug       TEXT UNIQUE NOT NULL,
      title      TEXT NOT NULL,
      path       TEXT NOT NULL,
      thumbnail  TEXT,
      updated_at INTEGER NOT NULL
    )`,
  },
  {
    version: 3,
    sql: `CREATE TABLE IF NOT EXISTS grants (
      widget_id  TEXT NOT NULL,
      capability TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      PRIMARY KEY (widget_id, capability)
    )`,
  },
  {
    version: 4,
    sql: `CREATE TABLE IF NOT EXISTS env_bindings (
      widget_id TEXT NOT NULL,
      env_key   TEXT NOT NULL,
      PRIMARY KEY (widget_id, env_key)
    )`,
  },
  {
    version: 5,
    sql: `CREATE TABLE IF NOT EXISTS history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id   TEXT NOT NULL,
      timestamp  INTEGER NOT NULL
    )`,
  },
  {
    version: 6,
    sql: `CREATE TABLE IF NOT EXISTS env_values (
      key              TEXT PRIMARY KEY,
      encrypted_value  BLOB NOT NULL
    )`,
  },
  {
    version: 7,
    sql: `CREATE TABLE IF NOT EXISTS widget_secrets (
      widget_id        TEXT NOT NULL,
      key              TEXT NOT NULL,
      encrypted_value  BLOB NOT NULL,
      PRIMARY KEY (widget_id, key)
    )`,
  },
  {
    version: 8,
    sql: `CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  },
]

function ensureSchemaVersionTable(database: Database): void {
  database.run(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  )`)
}

function getCurrentVersion(database: Database): number {
  const result = database.exec('SELECT MAX(version) as v FROM schema_version')
  if (result.length === 0 || result[0].values.length === 0 || result[0].values[0][0] === null) {
    return 0
  }
  return result[0].values[0][0] as number
}

function runMigrations(database: Database): void {
  ensureSchemaVersionTable(database)
  const currentVersion = getCurrentVersion(database)

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      database.run(migration.sql)
      database.run('INSERT INTO schema_version (version) VALUES (?)', [migration.version])
    }
  }
}

export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs()

  // Ensure ~/Dimensions/ exists
  if (!fs.existsSync(DIMENSIONS_DIR)) {
    fs.mkdirSync(DIMENSIONS_DIR, { recursive: true })
  }

  if (fs.existsSync(DB_PATH)) {
    try {
      const buffer = fs.readFileSync(DB_PATH)
      db = new SQL.Database(buffer)
    } catch (err) {
      console.error('Failed to load existing database (corrupted?), creating fresh:', err)
      db = new SQL.Database()
    }
    runMigrations(db)
  } else {
    db = new SQL.Database()
    runMigrations(db)
    persistDbSync(db)
  }

  return db
}

export function persistDb(): void {
  if (!db) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!db) return
    persistDbSync(db)
  }, 50)
}

function persistDbSync(database: Database): void {
  const data = database.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.')
  return db
}

// ── Settings helpers ──

export function getSetting(key: string): string | null {
  const database = getDb()
  const result = database.exec('SELECT value FROM settings WHERE key = ?', [key])
  if (result.length === 0 || result[0].values.length === 0) return null
  return result[0].values[0][0] as string
}

export function setSetting(key: string, value: string): void {
  const database = getDb()
  database.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
  persistDb()
}

export function closeDatabase(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (db) {
    persistDbSync(db)
    db.close()
    db = null
  }
}
