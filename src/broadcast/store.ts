import { randomUUID } from "node:crypto";
import { getAppDb } from "../db/app.js";
import { transaction, type Db } from "../db/sqlite.js";

export type BroadcastJobStatus =
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export interface BroadcastRecipientInput {
  to: string;
  text: string;
}

export interface BroadcastInput {
  recipients: BroadcastRecipientInput[];
  text: string;
  delayMinMs: number;
  delayMaxMs: number;
}

export interface BroadcastResultView {
  to: string;
  ok: boolean;
  messageId?: string;
  error?: string;
  sentAt: number;
}

export interface BroadcastJobView {
  jobId: string;
  status: BroadcastJobStatus;
  total: number;
  sent: number;
  failed: number;
  nextSendAt: number | null;
  results: BroadcastResultView[];
  createdAt: number;
  delayMinMs: number;
  delayMaxMs: number;
}

export interface RunningJob {
  jobId: string;
  text: string;
  delayMinMs: number;
  delayMaxMs: number;
}

export interface DueRecipient {
  id: number;
  position: number;
  toJid: string;
  text: string | null;
}

export class BroadcastBusyError extends Error {
  constructor() {
    super("A broadcast job is already running for this session");
    this.name = "BroadcastBusyError";
  }
}

export class BroadcastNotRunningError extends Error {
  constructor(status: string) {
    super(`Broadcast job is ${status}`);
    this.name = "BroadcastNotRunningError";
  }
}

function randomDelay(minMs: number, maxMs: number): number {
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

function completeJobIfDone(db: Db, jobId: string): boolean {
  const remaining = db
    .prepare(
      `SELECT 1 AS found FROM broadcast_recipients
       WHERE job_id = ? AND status IN ('pending', 'sending')
       LIMIT 1`,
    )
    .get(jobId);
  if (remaining) return false;

  db.prepare(
    `UPDATE broadcast_jobs
     SET status = 'completed', next_send_at = NULL, finished_at = ?
     WHERE id = ? AND status = 'running'`,
  ).run(Date.now(), jobId);
  return true;
}

export function createJob(sessionId: string, input: BroadcastInput): string {
  const db = getAppDb();
  return transaction(db, () => {
    const running = db
      .prepare(
        `SELECT id FROM broadcast_jobs
         WHERE session_id = ? AND status = 'running'`,
      )
      .get(sessionId);
    if (running) throw new BroadcastBusyError();

    const jobId = randomUUID();
    const now = Date.now();

    db.prepare(
      `INSERT INTO broadcast_jobs (
        id, session_id, text, delay_min_ms, delay_max_ms, status, total,
        next_send_at, error, created_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, NULL, ?, NULL)`,
    ).run(
      jobId,
      sessionId,
      input.text,
      input.delayMinMs,
      input.delayMaxMs,
      input.recipients.length,
      now,
      now,
    );

    const insertRecipient = db.prepare(
      `INSERT INTO broadcast_recipients (
        job_id, position, to_jid, text, status, scheduled_at, created_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    );
    for (const [position, recipient] of input.recipients.entries()) {
      insertRecipient.run(
        jobId,
        position,
        recipient.to,
        recipient.text,
        position === 0 ? now : null,
        now,
      );
    }

    return jobId;
  });
}

export function getRunningJob(sessionId: string): RunningJob | null {
  const row = getAppDb()
    .prepare(
      `SELECT id, text, delay_min_ms, delay_max_ms FROM broadcast_jobs
       WHERE session_id = ? AND status = 'running'`,
    )
    .get(sessionId);
  if (!row) return null;
  return {
    jobId: String(row.id),
    text: String(row.text),
    delayMinMs: Number(row.delay_min_ms),
    delayMaxMs: Number(row.delay_max_ms),
  };
}

export function listRunningJobs(): string[] {
  return getAppDb()
    .prepare(
      `SELECT session_id FROM broadcast_jobs
       WHERE status = 'running' ORDER BY created_at`,
    )
    .all()
    .map((row) => String(row.session_id));
}

export function getJobView(
  sessionId: string,
  jobId: string,
): BroadcastJobView | null {
  const db = getAppDb();
  const job = db
    .prepare(
      "SELECT * FROM broadcast_jobs WHERE id = ? AND session_id = ?",
    )
    .get(jobId, sessionId);
  if (!job) return null;

  let sent = 0;
  let failed = 0;
  for (const row of db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM broadcast_recipients
       WHERE job_id = ? GROUP BY status`,
    )
    .all(jobId)) {
    if (row.status === "sent") sent = Number(row.count);
    if (row.status === "failed") failed = Number(row.count);
  }

  const results = db
    .prepare(
      `SELECT to_jid, status, wa_message_id, error, sent_at
       FROM broadcast_recipients
       WHERE job_id = ? AND status IN ('sent', 'failed')
       ORDER BY position`,
    )
    .all(jobId);

  return {
    jobId: String(job.id),
    status: job.status as BroadcastJobStatus,
    total: Number(job.total),
    sent,
    failed,
    nextSendAt: job.next_send_at === null ? null : Number(job.next_send_at),
    results: results.map((row) => ({
      to: String(row.to_jid),
      ok: row.status === "sent",
      messageId:
        row.wa_message_id === null ? undefined : String(row.wa_message_id),
      error: row.error === null ? undefined : String(row.error),
      sentAt: row.sent_at === null ? 0 : Number(row.sent_at),
    })),
    createdAt: Number(job.created_at),
    delayMinMs: Number(job.delay_min_ms),
    delayMaxMs: Number(job.delay_max_ms),
  };
}

export function getNextDueRecipient(
  jobId: string,
  now: number,
): DueRecipient | null {
  const row = getAppDb()
    .prepare(
      `SELECT id, position, to_jid, text FROM broadcast_recipients
       WHERE job_id = ? AND status = 'pending'
         AND scheduled_at IS NOT NULL AND scheduled_at <= ?
       ORDER BY position LIMIT 1`,
    )
    .get(jobId, now);
  if (!row) return null;
  return {
    id: Number(row.id),
    position: Number(row.position),
    toJid: String(row.to_jid),
    text: row.text === null ? null : String(row.text),
  };
}

export function markSending(recipientId: number, jobId: string): boolean {
  const db = getAppDb();
  return transaction(db, () => {
    const result = db
      .prepare(
        `UPDATE broadcast_recipients
         SET status = 'sending', scheduled_at = NULL
         WHERE id = ? AND job_id = ? AND status = 'pending'`,
      )
      .run(recipientId, jobId);
    if (Number(result.changes) === 0) return false;
    db.prepare(
      "UPDATE broadcast_jobs SET next_send_at = NULL WHERE id = ?",
    ).run(jobId);
    return true;
  });
}

export function markSent(
  recipientId: number,
  jobId: string,
  messageId: string,
): void {
  getAppDb()
    .prepare(
      `UPDATE broadcast_recipients
       SET status = 'sent', sent_at = ?, wa_message_id = ?, error = NULL
       WHERE id = ? AND job_id = ?`,
    )
    .run(Date.now(), messageId, recipientId, jobId);
}

export function markFailed(
  recipientId: number,
  jobId: string,
  error: string,
): void {
  getAppDb()
    .prepare(
      `UPDATE broadcast_recipients
       SET status = 'failed', sent_at = ?, error = ?
       WHERE id = ? AND job_id = ?`,
    )
    .run(Date.now(), error, recipientId, jobId);
}

export function hasPending(jobId: string): boolean {
  const row = getAppDb()
    .prepare(
      `SELECT 1 AS found FROM broadcast_recipients
       WHERE job_id = ? AND status = 'pending' LIMIT 1`,
    )
    .get(jobId);
  return row !== undefined;
}

export function completeIfDone(jobId: string): boolean {
  return transaction(getAppDb(), () => completeJobIfDone(getAppDb(), jobId));
}

export function scheduleNext(
  jobId: string,
  afterPosition: number,
  minMs: number,
  maxMs: number,
): number | null {
  const db = getAppDb();
  return transaction(db, () => {
    const job = db
      .prepare("SELECT status FROM broadcast_jobs WHERE id = ?")
      .get(jobId);
    if (!job || job.status !== "running") return null;

    const next = db
      .prepare(
        `SELECT id FROM broadcast_recipients
         WHERE job_id = ? AND status = 'pending' AND position > ?
         ORDER BY position LIMIT 1`,
      )
      .get(jobId, afterPosition);

    if (!next) {
      completeJobIfDone(db, jobId);
      return null;
    }

    const scheduledAt = Date.now() + randomDelay(minMs, maxMs);
    db.prepare(
      "UPDATE broadcast_recipients SET scheduled_at = ? WHERE id = ?",
    ).run(scheduledAt, Number(next.id));
    db.prepare(
      `UPDATE broadcast_jobs SET next_send_at = ?
       WHERE id = ? AND status = 'running'`,
    ).run(scheduledAt, jobId);
    return scheduledAt;
  });
}

export function syncNextSendAt(jobId: string): void {
  getAppDb()
    .prepare(
      `UPDATE broadcast_jobs SET next_send_at = (
         SELECT MIN(scheduled_at) FROM broadcast_recipients
         WHERE job_id = ? AND status = 'pending' AND scheduled_at IS NOT NULL
       ) WHERE id = ?`,
    )
    .run(jobId, jobId);
}

export function cancelJob(
  sessionId: string,
  jobId: string,
): BroadcastJobView | null {
  const db = getAppDb();
  const job = db
    .prepare(
      "SELECT status FROM broadcast_jobs WHERE id = ? AND session_id = ?",
    )
    .get(jobId, sessionId);
  if (!job) return null;
  if (job.status !== "running") {
    throw new BroadcastNotRunningError(String(job.status));
  }

  transaction(db, () => {
    db.prepare(
      `UPDATE broadcast_jobs
       SET status = 'cancelled', next_send_at = NULL, finished_at = ?
       WHERE id = ?`,
    ).run(Date.now(), jobId);
    db.prepare(
      `UPDATE broadcast_recipients SET status = 'cancelled'
       WHERE job_id = ? AND status = 'pending'`,
    ).run(jobId);
  });

  return getJobView(sessionId, jobId);
}

export function failJob(jobId: string, reason: string): void {
  const db = getAppDb();
  transaction(db, () => {
    const result = db
      .prepare(
        `UPDATE broadcast_jobs
         SET status = 'failed', error = ?, next_send_at = NULL, finished_at = ?
         WHERE id = ? AND status = 'running'`,
      )
      .run(reason, Date.now(), jobId);
    if (Number(result.changes) === 0) return;
    db.prepare(
      `UPDATE broadcast_recipients SET status = 'cancelled'
       WHERE job_id = ? AND status = 'pending'`,
    ).run(jobId);
  });
}

export function failSessionJobs(sessionId: string, reason: string): void {
  const jobIds = getAppDb()
    .prepare(
      `SELECT id FROM broadcast_jobs
       WHERE session_id = ? AND status = 'running'`,
    )
    .all(sessionId)
    .map((row) => String(row.id));
  for (const jobId of jobIds) failJob(jobId, reason);
}

export function recoverInterrupted(): number {
  const result = getAppDb()
    .prepare(
      `UPDATE broadcast_recipients
       SET status = 'failed', error = 'interrupted', sent_at = ?
       WHERE status = 'sending'`,
    )
    .run(Date.now());
  return Number(result.changes);
}

export function rescheduleRunningJobs(): void {
  const db = getAppDb();
  const jobs = db
    .prepare(
      `SELECT id, delay_min_ms, delay_max_ms FROM broadcast_jobs
       WHERE status = 'running' ORDER BY created_at`,
    )
    .all();

  for (const job of jobs) {
    const jobId = String(job.id);
    transaction(db, () => {
      const pending = db
        .prepare(
          `SELECT id FROM broadcast_recipients
           WHERE job_id = ? AND status = 'pending' ORDER BY position`,
        )
        .all(jobId);
      if (pending.length === 0) {
        completeJobIfDone(db, jobId);
        return;
      }

      const now = Date.now();
      const scheduledAt =
        now + randomDelay(Number(job.delay_min_ms), Number(job.delay_max_ms));
      db.prepare(
        `UPDATE broadcast_recipients SET scheduled_at = NULL
         WHERE job_id = ? AND status = 'pending'`,
      ).run(jobId);
      db.prepare(
        "UPDATE broadcast_recipients SET scheduled_at = ? WHERE id = ?",
      ).run(scheduledAt, Number(pending[0].id));
      db.prepare(
        `UPDATE broadcast_jobs SET next_send_at = ?
         WHERE id = ? AND status = 'running'`,
      ).run(scheduledAt, jobId);
    });
  }
}