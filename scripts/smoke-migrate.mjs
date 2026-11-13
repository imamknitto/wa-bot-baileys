import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { openDb, migrate } from '../src/db/sqlite.ts';

const path = 'data/.smoke-migrate.db';
rmSync(path, { force: true });

const legacy = [
  {
    version: 1,
    sql: `CREATE TABLE message_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      source TEXT NOT NULL CHECK (source IN ('send','broadcast')),
      to_jid TEXT NOT NULL,
      text TEXT,
      broadcast_job_id TEXT,
      wa_message_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('sent','failed')),
      error TEXT,
      created_at INTEGER NOT NULL);`,
  },
  {
    version: 2,
    sql: `CREATE TABLE broadcast_jobs (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, text TEXT NOT NULL,
      delay_min_ms INTEGER NOT NULL, delay_max_ms INTEGER NOT NULL,
      status TEXT NOT NULL, total INTEGER NOT NULL, next_send_at INTEGER,
      error TEXT, created_at INTEGER NOT NULL, finished_at INTEGER);
      CREATE TABLE broadcast_recipients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES broadcast_jobs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL, to_jid TEXT NOT NULL,
        status TEXT NOT NULL, scheduled_at INTEGER, sent_at INTEGER,
        wa_message_id TEXT, error TEXT, created_at INTEGER NOT NULL,
        UNIQUE (job_id, position));`,
  },
  {
    version: 3,
    sql: `CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE, note TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      ALTER TABLE broadcast_recipients ADD COLUMN text TEXT;`,
  },
  {
    version: 4,
    sql: `CREATE TABLE credentials (
      session_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE signal_keys (
        session_id TEXT NOT NULL, type TEXT NOT NULL, id TEXT NOT NULL,
        value TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, type, id));`,
  },
];

const db = openDb(path);
migrate(db, legacy);
db.prepare(
  "INSERT INTO customers (name, phone, note, created_at, updated_at) VALUES ('Budi','628111',NULL,1,1)",
).run();
db.prepare(
  `INSERT INTO message_log (session_id, direction, source, to_jid, text, status, created_at)
   VALUES ('sales-1','out','send','628111@s.whatsapp.net','hi','sent',1)`,
).run();
db.prepare(
  `INSERT INTO broadcast_jobs (id, session_id, text, delay_min_ms, delay_max_ms, status, total, created_at)
   VALUES ('job-1','sales-1','promo',10000,20000,'completed',1,1)`,
).run();
db.prepare(
  `INSERT INTO broadcast_recipients (job_id, position, to_jid, status, created_at, text)
   VALUES ('job-1',0,'628111@s.whatsapp.net','sent',1,'promo')`,
).run();
db.close();

process.env.DB_PATH = path;
const { initAppDb, getAppDb, listRecentMessages, findMessageByReference } = await import(
  '../src/db/app.ts'
);
initAppDb(path);

const conn = getAppDb();
const tables = conn
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((row) => String(row.name));
assert.equal(tables.includes('customers'), false, 'customers dropped');
assert.ok(tables.includes('session_meta'));
assert.ok(tables.includes('session_tokens'));
assert.ok(tables.includes('webhook_events'));

// legacy rows survive and new columns are null
const messages = listRecentMessages(5);
assert.equal(messages.length, 1);
assert.equal(messages[0].customerName, null);
assert.equal(messages[0].text, 'hi');

const recipients = conn
  .prepare('SELECT customer_ref, recipient_name, sales_id FROM broadcast_recipients')
  .all();
assert.equal(recipients.length, 1);
assert.equal(recipients[0].customer_ref, null);
assert.equal(recipients[0].text ?? 'promo', 'promo');

// new inserts work on the upgraded schema
conn
  .prepare(
    `INSERT INTO message_log (session_id, direction, source, to_jid, text, status,
       created_at, sales_id, agent_id, customer_ref, recipient_name, reference_id)
     VALUES ('sales-1','out','send','628222@s.whatsapp.net','hi','sent',2,'S-1','A-1','CUST-2','Sinta','ref-9')`,
  )
  .run();
assert.equal(findMessageByReference('sales-1', 'ref-9').customerName, 'Sinta');

const { closeAppDb } = await import('../src/db/app.ts');
closeAppDb();
rmSync(path, { force: true });
rmSync(`${path}-wal`, { force: true });
rmSync(`${path}-shm`, { force: true });
console.log('migration smoke ok');
