import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type Db = DatabaseSync;
type Row = Record<string, unknown>;

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db: Db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(all<{ name: string }>(db, 'SELECT name FROM schema_migrations').map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    tx(db, () => {
      db.exec(readFileSync(MIGRATIONS_DIR + f, 'utf8'));
      run(db, 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', f, new Date().toISOString());
    });
  }
}

const depth = new WeakMap<Db, number>();

/** Runs fn atomically. Nests safely (savepoints), so helpers can call each other inside one. */
export function tx<T>(db: Db, fn: () => T): T {
  const level = depth.get(db) ?? 0;
  const sp = `sp${level}`;
  db.exec(`SAVEPOINT ${sp}`);
  depth.set(db, level + 1);
  try {
    const result = fn();
    db.exec(`RELEASE ${sp}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${sp}`);
    db.exec(`RELEASE ${sp}`);
    throw err;
  } finally {
    depth.set(db, level);
  }
}

export function all<T = Row>(db: Db, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T = Row>(db: Db, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(db: Db, sql: string, ...params: SQLInputValue[]) {
  const r = db.prepare(sql).run(...params);
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

export function getSetting(db: Db, key: string, fallback = ''): string {
  return get<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key)?.value ?? fallback;
}

export function setSetting(db: Db, key: string, value: string) {
  run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
