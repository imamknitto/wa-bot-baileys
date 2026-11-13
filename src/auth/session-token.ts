import { createHash, randomBytes } from 'node:crypto'
import { getAppDb } from '../db/app.js'

export interface TokenOwner {
  sessionId: string
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function issueSessionToken(sessionId: string): string {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  const db = getAppDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      `UPDATE session_tokens SET revoked_at = ?
       WHERE session_id = ? AND revoked_at IS NULL`,
    ).run(now, sessionId)
    db.prepare(
      `INSERT INTO session_tokens (token_hash, session_id, created_at, revoked_at)
       VALUES (?, ?, ?, NULL)`,
    ).run(hashToken(token), sessionId, now)
    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // The transaction may already be rolled back by SQLite.
    }
    throw err
  }
  return token
}

export function resolveSessionToken(token: string): TokenOwner | null {
  if (!token) return null
  const row = getAppDb()
    .prepare(
      `SELECT session_id FROM session_tokens
       WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .get(hashToken(token))
  if (!row) return null
  return { sessionId: String(row.session_id) }
}

export function revokeSessionTokens(sessionId: string): number {
  const result = getAppDb()
    .prepare(
      `UPDATE session_tokens SET revoked_at = ?
       WHERE session_id = ? AND revoked_at IS NULL`,
    )
    .run(Date.now(), sessionId)
  return Number(result.changes)
}
