import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

export interface Migration {
  version: number;
  sql: string;
}

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function transaction<T>(db: Db, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The transaction may already be rolled back by SQLite.
    }
    throw err;
  }
}

export function migrate(db: Db, migrations: Migration[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => Number(row.version)),
  );

  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(migration.version, Date.now());
    });
  }
}