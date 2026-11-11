import type { AuthenticationCreds, SignalDataSet } from "@whiskeysockets/baileys";
import { BufferJSON } from "@whiskeysockets/baileys";
import {
  openDb,
  migrate,
  transaction,
  type Db,
  type Migration,
} from "./sqlite.js";

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS credentials (
        session_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS signal_keys (
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        id TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, type, id)
      );
    `,
  },
];

let db: Db | null = null;

function getDb(): Db {
  if (!db) throw new Error("Auth database is not initialized");
  return db;
}

export function initAuthDb(path: string): void {
  db = openDb(path);
  migrate(db, MIGRATIONS);
}

export function loadCredentials(sessionId: string): AuthenticationCreds | null {
  const row = getDb()
    .prepare("SELECT data FROM credentials WHERE session_id = ?")
    .get(sessionId);
  if (!row) return null;
  return JSON.parse(String(row.data), BufferJSON.reviver) as AuthenticationCreds;
}

export function saveCredentials(
  sessionId: string,
  creds: AuthenticationCreds,
): void {
  getDb()
    .prepare(
      `INSERT INTO credentials (session_id, data, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         data = excluded.data,
         updated_at = excluded.updated_at`,
    )
    .run(
      sessionId,
      JSON.stringify(creds, BufferJSON.replacer),
      Date.now(),
    );
}

export function loadSignalKeys(
  sessionId: string,
  type: string,
  ids: string[],
): Record<string, unknown> {
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT id, value FROM signal_keys
       WHERE session_id = ? AND type = ? AND id IN (${placeholders})`,
    )
    .all(sessionId, type, ...ids);

  const result: Record<string, unknown> = {};
  for (const row of rows) {
    result[String(row.id)] = JSON.parse(
      String(row.value),
      BufferJSON.reviver,
    );
  }
  return result;
}

export function saveSignalKeys(
  sessionId: string,
  data: SignalDataSet,
): void {
  const entries = data as Record<
    string,
    Record<string, unknown> | null | undefined
  >;
  const now = Date.now();

  transaction(getDb(), () => {
    const upsert = getDb().prepare(
      `INSERT INTO signal_keys (session_id, type, id, value, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, type, id) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    );
    const remove = getDb().prepare(
      "DELETE FROM signal_keys WHERE session_id = ? AND type = ? AND id = ?",
    );

    for (const type of Object.keys(entries)) {
      const values = entries[type];
      if (!values) continue;
      for (const id of Object.keys(values)) {
        const value = values[id];
        if (value === null || value === undefined) {
          remove.run(sessionId, type, id);
          continue;
        }
        upsert.run(
          sessionId,
          type,
          id,
          JSON.stringify(value, BufferJSON.replacer),
          now,
        );
      }
    }
  });
}

export function clearSignalKeys(sessionId: string): void {
  getDb()
    .prepare("DELETE FROM signal_keys WHERE session_id = ?")
    .run(sessionId);
}

export function deleteAuthStateRows(sessionId: string): void {
  transaction(getDb(), () => {
    getDb()
      .prepare("DELETE FROM signal_keys WHERE session_id = ?")
      .run(sessionId);
    getDb()
      .prepare("DELETE FROM credentials WHERE session_id = ?")
      .run(sessionId);
  });
}

export function listCredentialSessionIds(): string[] {
  return getDb()
    .prepare("SELECT session_id FROM credentials ORDER BY session_id")
    .all()
    .map((row) => String(row.session_id));
}

export function closeAuthDb(): void {
  db?.close();
  db = null;
}