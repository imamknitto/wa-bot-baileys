import {
  openDb,
  migrate,
  type Db,
  type Migration,
} from "./sqlite.js";

export interface MessageLogInput {
  sessionId: string;
  source: "send" | "broadcast";
  toJid: string;
  text: string | null;
  broadcastJobId?: string | null;
  waMessageId?: string | null;
  status: "sent" | "failed";
  error?: string | null;
  createdAt?: number;
}

export interface MessageLogRow {
  id: number;
  sessionId: string;
  source: "send" | "broadcast";
  to: string;
  text: string | null;
  broadcastJobId: string | null;
  messageId: string | null;
  status: "sent" | "failed";
  error: string | null;
  createdAt: number;
}

export interface MessageLogPage {
  messages: MessageLogRow[];
  nextCursor: number | null;
}

export interface CustomerRow {
  id: number;
  name: string;
  phone: string;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CustomerInput {
  name: string;
  phone: string;
  note: string | null;
}

export interface CustomerPage {
  customers: CustomerRow[];
  nextCursor: number | null;
}

export interface RecentMessageRow {
  id: number;
  sessionId: string;
  source: "send" | "broadcast";
  to: string;
  customerName: string | null;
  text: string | null;
  status: "sent" | "failed";
  error: string | null;
  createdAt: number;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS message_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        source TEXT NOT NULL CHECK (source IN ('send', 'broadcast')),
        to_jid TEXT NOT NULL,
        text TEXT,
        broadcast_job_id TEXT,
        wa_message_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
        error TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_message_log_session_id
        ON message_log(session_id, id DESC);

      CREATE INDEX IF NOT EXISTS idx_message_log_created_at
        ON message_log(created_at);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS broadcast_jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        text TEXT NOT NULL,
        delay_min_ms INTEGER NOT NULL,
        delay_max_ms INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'cancelled', 'failed')),
        total INTEGER NOT NULL,
        next_send_at INTEGER,
        error TEXT,
        created_at INTEGER NOT NULL,
        finished_at INTEGER
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcast_jobs_running
        ON broadcast_jobs(session_id) WHERE status = 'running';

      CREATE INDEX IF NOT EXISTS idx_broadcast_jobs_session
        ON broadcast_jobs(session_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS broadcast_recipients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES broadcast_jobs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        to_jid TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
        scheduled_at INTEGER,
        sent_at INTEGER,
        wa_message_id TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (job_id, position)
      );

      CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_due
        ON broadcast_recipients(job_id, status, scheduled_at);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        note TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

      ALTER TABLE broadcast_recipients ADD COLUMN text TEXT;
    `,
  },
  {
    version: 4,
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

export function getAppDb(): Db {
  if (!db) throw new Error("App database is not initialized");
  return db;
}

export function initAppDb(path: string): void {
  db = openDb(path);
  migrate(db, MIGRATIONS);
}

export function recordMessage(input: MessageLogInput): number {
  const result = getAppDb()
    .prepare(
      `INSERT INTO message_log (
        session_id, direction, source, to_jid, text, broadcast_job_id,
        wa_message_id, status, error, created_at
      ) VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.sessionId,
      input.source,
      input.toJid,
      input.text,
      input.broadcastJobId ?? null,
      input.waMessageId ?? null,
      input.status,
      input.error ?? null,
      input.createdAt ?? Date.now(),
    );
  return Number(result.lastInsertRowid);
}

export function listMessages(
  sessionId: string,
  limit: number,
  cursor?: number,
): MessageLogPage {
  const rows = cursor
    ? getAppDb()
        .prepare(
          `SELECT * FROM message_log
           WHERE session_id = ? AND id < ?
           ORDER BY id DESC LIMIT ?`,
        )
        .all(sessionId, cursor, limit + 1)
    : getAppDb()
        .prepare(
          `SELECT * FROM message_log
           WHERE session_id = ?
           ORDER BY id DESC LIMIT ?`,
        )
        .all(sessionId, limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    messages: page.map((row) => ({
      id: Number(row.id),
      sessionId: String(row.session_id),
      source: row.source as "send" | "broadcast",
      to: String(row.to_jid),
      text: row.text === null ? null : String(row.text),
      broadcastJobId:
        row.broadcast_job_id === null ? null : String(row.broadcast_job_id),
      messageId: row.wa_message_id === null ? null : String(row.wa_message_id),
      status: row.status as "sent" | "failed",
      error: row.error === null ? null : String(row.error),
      createdAt: Number(row.created_at),
    })),
    nextCursor: hasMore ? Number(page[page.length - 1]?.id) : null,
  };
}

export function deleteMessage(id: number): boolean {
  const result = getAppDb()
    .prepare("DELETE FROM message_log WHERE id = ?")
    .run(id);
  return Number(result.changes) > 0;
}

export function purgeMessageLog(retentionDays: number, now = Date.now()): number {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const result = getAppDb()
    .prepare("DELETE FROM message_log WHERE created_at < ?")
    .run(cutoff);
  return Number(result.changes);
}

export function startOfToday(now = Date.now()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function countMessages(now = Date.now()): {
  total: number;
  today: number;
} {
  const row = getAppDb()
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS today
       FROM message_log`,
    )
    .get(startOfToday(now));
  return { total: Number(row?.total ?? 0), today: Number(row?.today ?? 0) };
}

export function countMessagesTodayBySession(
  now = Date.now(),
): Record<string, number> {
  const rows = getAppDb()
    .prepare(
      `SELECT session_id, COUNT(*) AS count FROM message_log
       WHERE created_at >= ? GROUP BY session_id`,
    )
    .all(startOfToday(now));
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[String(row.session_id)] = Number(row.count);
  }
  return result;
}

export function listRecentMessages(
  limit: number,
  sessionId?: string,
): RecentMessageRow[] {
  const db = getAppDb();
  const sql = `
    SELECT m.id, m.session_id, m.source, m.to_jid, m.text, m.status, m.error,
           m.created_at, c.name AS customer_name
    FROM message_log m
    LEFT JOIN customers c ON c.phone = CASE
      WHEN instr(m.to_jid, '@') > 0
        THEN substr(m.to_jid, 1, instr(m.to_jid, '@') - 1)
      ELSE m.to_jid
    END
    ${sessionId ? "WHERE m.session_id = ?" : ""}
    ORDER BY m.id DESC LIMIT ?`;
  const rows = sessionId
    ? db.prepare(sql).all(sessionId, limit)
    : db.prepare(sql).all(limit);
  return rows.map((row) => ({
    id: Number(row.id),
    sessionId: String(row.session_id),
    source: row.source as "send" | "broadcast",
    to: String(row.to_jid),
    customerName:
      row.customer_name === null ? null : String(row.customer_name),
    text: row.text === null ? null : String(row.text),
    status: row.status as "sent" | "failed",
    error: row.error === null ? null : String(row.error),
    createdAt: Number(row.created_at),
  }));
}

export function listCustomers(
  limit: number,
  cursor?: number,
  query?: string,
): CustomerPage {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const trimmed = query?.trim() ?? "";
  if (trimmed) {
    clauses.push("(name LIKE ? OR phone LIKE ?)");
    params.push(`%${trimmed}%`, `%${trimmed}%`);
  }
  if (cursor !== undefined) {
    clauses.push("id < ?");
    params.push(cursor);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getAppDb()
    .prepare(
      `SELECT * FROM customers ${where} ORDER BY id DESC LIMIT ?`,
    )
    .all(...params, limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    customers: page.map(toCustomerRow),
    nextCursor: hasMore ? Number(page[page.length - 1]?.id) : null,
  };
}

export function getCustomer(id: number): CustomerRow | null {
  const row = getAppDb()
    .prepare("SELECT * FROM customers WHERE id = ?")
    .get(id);
  return row ? toCustomerRow(row) : null;
}

export function getCustomerByPhone(phone: string): CustomerRow | null {
  const row = getAppDb()
    .prepare("SELECT * FROM customers WHERE phone = ?")
    .get(phone);
  return row ? toCustomerRow(row) : null;
}

export function getCustomersByIds(ids: number[]): CustomerRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  return getAppDb()
    .prepare(
      `SELECT * FROM customers WHERE id IN (${placeholders}) ORDER BY id`,
    )
    .all(...ids)
    .map(toCustomerRow);
}

export function createCustomer(input: CustomerInput): CustomerRow {
  const now = Date.now();
  const result = getAppDb()
    .prepare(
      `INSERT INTO customers (name, phone, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.name, input.phone, input.note, now, now);
  return getCustomer(Number(result.lastInsertRowid)) as CustomerRow;
}

export function updateCustomer(
  id: number,
  input: CustomerInput,
): CustomerRow | null {
  const result = getAppDb()
    .prepare(
      `UPDATE customers SET name = ?, phone = ?, note = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(input.name, input.phone, input.note, Date.now(), id);
  if (Number(result.changes) === 0) return null;
  return getCustomer(id);
}

export function deleteCustomer(id: number): boolean {
  const result = getAppDb()
    .prepare("DELETE FROM customers WHERE id = ?")
    .run(id);
  return Number(result.changes) > 0;
}

export function countCustomers(): number {
  const row = getAppDb()
    .prepare("SELECT COUNT(*) AS count FROM customers")
    .get();
  return Number(row?.count ?? 0);
}

function toCustomerRow(row: Record<string, unknown>): CustomerRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    phone: String(row.phone),
    note: row.note === null ? null : String(row.note),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function closeAppDb(): void {
  db?.close();
  db = null;
}