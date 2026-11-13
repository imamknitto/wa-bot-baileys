import { randomUUID } from 'node:crypto'
import { getConfig, isWebhookEnabled } from '../config.js'
import { getAppDb } from '../db/app.js'

export type WebhookEventType =
  | 'message.sent'
  | 'message.failed'
  | 'broadcast.completed'
  | 'broadcast.failed'
  | 'broadcast.cancelled'

export interface WebhookEventRow {
  id: string
  type: WebhookEventType
  sessionId: string | null
  payload: string
  attempts: number
}

export interface BroadcastResultPayload {
  customerId: string | null
  customerName: string | null
  to: string
  ok: boolean
  messageId?: string
  error?: string
  sentAt: number
}

export interface MessageWebhookPayload {
  eventId: string
  type: WebhookEventType
  occurredAt: number
  salesId: string | null
  agentId: string | null
  sessionId: string
  referenceId: string | null
  customerId: string | null
  customerName: string | null
  to: string
  text: string
  messageId: string | null
  status: 'sent' | 'failed'
  error?: string
}

export interface BroadcastWebhookPayload {
  eventId: string
  type: WebhookEventType
  occurredAt: number
  salesId: string | null
  agentId: string | null
  sessionId: string
  referenceId: string | null
  jobId: string
  status: 'completed' | 'failed' | 'cancelled'
  total: number
  sent: number
  failed: number
  error?: string
  results: BroadcastResultPayload[]
}

export type WebhookPayload = MessageWebhookPayload | BroadcastWebhookPayload

export function enqueueWebhook(
  type: WebhookEventType,
  sessionId: string | null,
  payload: WebhookPayload,
): void {
  if (!isWebhookEnabled()) return
  const now = Date.now()
  try {
    getAppDb()
      .prepare(
        `INSERT INTO webhook_events (
          id, type, session_id, payload, status, attempts, next_attempt_at,
          last_error, created_at, delivered_at
        ) VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, ?, NULL)`,
      )
      .run(payload.eventId, type, sessionId, JSON.stringify(payload), now, now)
  } catch (err) {
    console.error(`[${sessionId ?? 'webhook'}] Failed to enqueue ${type}:`, err)
  }
}

export function newEventId(): string {
  return randomUUID()
}

export function claimDueEvents(limit: number, now = Date.now()): WebhookEventRow[] {
  const rows = getAppDb()
    .prepare(
      `SELECT id, type, session_id, payload, attempts FROM webhook_events
       WHERE status = 'pending' AND next_attempt_at <= ?
       ORDER BY next_attempt_at LIMIT ?`,
    )
    .all(now, limit)
  return rows.map((row) => ({
    id: String(row.id),
    type: row.type as WebhookEventType,
    sessionId: row.session_id === null ? null : String(row.session_id),
    payload: String(row.payload),
    attempts: Number(row.attempts),
  }))
}

export function markDelivered(id: string): void {
  getAppDb()
    .prepare(
      `UPDATE webhook_events SET status = 'delivered', delivered_at = ?,
         last_error = NULL WHERE id = ?`,
    )
    .run(Date.now(), id)
}

export function markAttemptFailed(
  id: string,
  attempts: number,
  error: string,
): void {
  const maxAttempts = getConfig().webhookMaxAttempts
  if (attempts >= maxAttempts) {
    getAppDb()
      .prepare(
        `UPDATE webhook_events SET status = 'failed', attempts = ?,
           last_error = ? WHERE id = ?`,
      )
      .run(attempts, error, id)
    return
  }
  const delay = 5000 * 5 ** (attempts - 1)
  getAppDb()
    .prepare(
      `UPDATE webhook_events SET attempts = ?, last_error = ?,
         next_attempt_at = ? WHERE id = ?`,
    )
    .run(attempts, error, Date.now() + delay, id)
}

export function purgeWebhookEvents(retentionDays: number, now = Date.now()): number {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
  const result = getAppDb()
    .prepare(
      `DELETE FROM webhook_events
       WHERE status != 'pending' AND created_at < ?`,
    )
    .run(cutoff)
  return Number(result.changes)
}
