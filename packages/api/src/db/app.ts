import { openDb, migrate, type Db, type Migration } from "./sqlite.js";

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
  salesId?: string | null;
  agentId?: string | null;
  customerRef?: string | null;
  recipientName?: string | null;
  referenceId?: string | null;
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
  salesId: string | null;
  agentId: string | null;
  customerId: string | null;
  customerName: string | null;
  referenceId: string | null;
}

export interface MessageLogPage {
  messages: MessageLogRow[];
  nextCursor: number | null;
}

export interface RecentMessageRow {
  id: number;
  sessionId: string;
  source: "send" | "broadcast";
  to: string;
  salesId: string | null;
  customerId: string | null;
  customerName: string | null;
  text: string | null;
  status: "sent" | "failed";
  error: string | null;
  createdAt: number;
}

export interface SessionMeta {
  sessionId: string;
  salesId: string;
  agentId: string | null;
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
  {
    version: 5,
    sql: `
      DROP TABLE IF EXISTS customers;

      CREATE TABLE IF NOT EXISTS session_meta (
        session_id TEXT PRIMARY KEY,
        sales_id TEXT NOT NULL,
        agent_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_meta_sales ON session_meta(sales_id);

      CREATE TABLE IF NOT EXISTS session_tokens (
        token_hash TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_session_tokens_session
        ON session_tokens(session_id);

      ALTER TABLE message_log ADD COLUMN sales_id TEXT;
      ALTER TABLE message_log ADD COLUMN agent_id TEXT;
      ALTER TABLE message_log ADD COLUMN customer_ref TEXT;
      ALTER TABLE message_log ADD COLUMN recipient_name TEXT;
      ALTER TABLE message_log ADD COLUMN reference_id TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_message_log_reference
        ON message_log(session_id, reference_id)
        WHERE reference_id IS NOT NULL;

      ALTER TABLE broadcast_jobs ADD COLUMN reference_id TEXT;
      ALTER TABLE broadcast_jobs ADD COLUMN sales_id TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcast_jobs_reference
        ON broadcast_jobs(session_id, reference_id)
        WHERE reference_id IS NOT NULL;

      ALTER TABLE broadcast_recipients ADD COLUMN customer_ref TEXT;
      ALTER TABLE broadcast_recipients ADD COLUMN recipient_name TEXT;
      ALTER TABLE broadcast_recipients ADD COLUMN sales_id TEXT;

      CREATE TABLE IF NOT EXISTS webhook_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        session_id TEXT,
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_events_due
        ON webhook_events(status, next_attempt_at);
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
        wa_message_id, status, error, created_at, sales_id, agent_id,
        customer_ref, recipient_name, reference_id
      ) VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.salesId ?? null,
      input.agentId ?? null,
      input.customerRef ?? null,
      input.recipientName ?? null,
      input.referenceId ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function findMessageByReference(
  sessionId: string,
  referenceId: string,
): MessageLogRow | null {
  const row = getAppDb()
    .prepare(
      "SELECT * FROM message_log WHERE session_id = ? AND reference_id = ?",
    )
    .get(sessionId, referenceId);
  return row ? toMessageRow(row) : null;
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
    messages: page.map(toMessageRow),
    nextCursor: hasMore ? Number(page[page.length - 1]?.id) : null,
  };
}

function toMessageRow(row: Record<string, unknown>): MessageLogRow {
  return {
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
    salesId: row.sales_id === null ? null : String(row.sales_id),
    agentId: row.agent_id === null ? null : String(row.agent_id),
    customerId: row.customer_ref === null ? null : String(row.customer_ref),
    customerName:
      row.recipient_name === null ? null : String(row.recipient_name),
    referenceId:
      row.reference_id === null ? null : String(row.reference_id),
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
  const sql = `
    SELECT id, session_id, source, to_jid, sales_id, customer_ref,
           recipient_name, text, status, error, created_at
    FROM message_log
    ${sessionId ? "WHERE session_id = ?" : ""}
    ORDER BY id DESC LIMIT ?`;
  const db = getAppDb();
  const rows = sessionId
    ? db.prepare(sql).all(sessionId, limit)
    : db.prepare(sql).all(limit);
  return rows.map((row) => ({
    id: Number(row.id),
    sessionId: String(row.session_id),
    source: row.source as "send" | "broadcast",
    to: String(row.to_jid),
    salesId: row.sales_id === null ? null : String(row.sales_id),
    customerId: row.customer_ref === null ? null : String(row.customer_ref),
    customerName:
      row.recipient_name === null ? null : String(row.recipient_name),
    text: row.text === null ? null : String(row.text),
    status: row.status as "sent" | "failed",
    error: row.error === null ? null : String(row.error),
    createdAt: Number(row.created_at),
  }));
}

export function setSessionMeta(
  sessionId: string,
  salesId: string,
  agentId: string | null,
): SessionMeta {
  const now = Date.now();
  getAppDb()
    .prepare(
      `INSERT INTO session_meta (session_id, sales_id, agent_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         sales_id = excluded.sales_id,
         agent_id = excluded.agent_id`,
    )
    .run(sessionId, salesId, agentId, now);
  return getSessionMeta(sessionId) as SessionMeta;
}

export function getSessionMeta(sessionId: string): SessionMeta | null {
  const row = getAppDb()
    .prepare("SELECT * FROM session_meta WHERE session_id = ?")
    .get(sessionId);
  return row ? toSessionMeta(row) : null;
}

export function listSessionMeta(): Record<string, SessionMeta> {
  const rows = getAppDb().prepare("SELECT * FROM session_meta").all();
  const result: Record<string, SessionMeta> = {};
  for (const row of rows) {
    const meta = toSessionMeta(row);
    result[meta.sessionId] = meta;
  }
  return result;
}

export function deleteSessionMeta(sessionId: string): boolean {
  const result = getAppDb()
    .prepare("DELETE FROM session_meta WHERE session_id = ?")
    .run(sessionId);
  return Number(result.changes) > 0;
}

function toSessionMeta(row: Record<string, unknown>): SessionMeta {
  return {
    sessionId: String(row.session_id),
    salesId: String(row.sales_id),
    agentId: row.agent_id === null ? null : String(row.agent_id),
    createdAt: Number(row.created_at),
  };
}

export function closeAppDb(): void {
  db?.close();
  db = null;
}
