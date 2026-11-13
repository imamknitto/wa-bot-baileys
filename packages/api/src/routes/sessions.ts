import { Hono } from 'hono'
import QRCode from 'qrcode'
import { z } from 'zod'
import { issueSessionToken, revokeSessionTokens } from '../auth/session-token.js'
import type { AppEnv } from '../app.js'
import { isAdmin } from './guards.js'
import {
  countMessagesTodayBySession,
  deleteSessionMeta,
  getSessionMeta,
  listSessionMeta,
  setSessionMeta,
} from '../db/app.js'
import {
  SessionActiveError,
  SessionLimitError,
  deleteSession,
  getSessionPairing,
  getSessionQr,
  getSessionView,
  listSessions,
  logoutSession,
  startSession,
  type SessionView,
} from '../wa/manager.js'
import {
  createSessionSchema,
  digitsOnly,
  sessionIdSchema,
} from '../validation.js'

const app = new Hono<AppEnv>()

app.post('/', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Forbidden' }, 403)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const parsed = createSessionSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: z.treeifyError(parsed.error) },
      400,
    )
  }

  const { salesId, agentId, mode } = parsed.data
  const sessionId = parsed.data.sessionId ?? salesId
  const phone = mode === 'pairing' ? digitsOnly(parsed.data.phone ?? '') : null

  const existingMeta = getSessionMeta(sessionId)
  if (existingMeta && existingMeta.salesId !== salesId) {
    return c.json({ error: 'Session is owned by another sales' }, 409)
  }

  try {
    const session = await startSession(sessionId, { mode, phone })
    const meta = setSessionMeta(sessionId, salesId, agentId ?? null)
    const token = issueSessionToken(sessionId)
    return c.json({ ok: true, ...session, ...meta, token }, 202)
  } catch (err) {
    if (err instanceof SessionActiveError) {
      return c.json({ ok: false, error: err.message }, 409)
    }
    if (err instanceof SessionLimitError) {
      return c.json({ ok: false, error: err.message }, 409)
    }
    console.error(`Failed to start session ${sessionId}:`, err)
    return c.json({ error: 'Failed to start session' }, 500)
  }
})

app.get('/', (c) => {
  const sentToday = countMessagesTodayBySession()
  const meta = listSessionMeta()
  const tokenSessionId = c.get('tokenSessionId')
  const visible = tokenSessionId
    ? listSessions().filter((session) => session.sessionId === tokenSessionId)
    : listSessions()

  return c.json({
    sessions: visible.map((session) => ({
      ...session,
      salesId: meta[session.sessionId]?.salesId ?? null,
      agentId: meta[session.sessionId]?.agentId ?? null,
      sentToday: sentToday[session.sessionId] ?? 0,
    })),
  })
})

app.get('/:id/status', (c) => {
  const parsed = sessionIdSchema.safeParse(c.req.param('id'))
  if (!parsed.success) return c.json({ error: 'Invalid sessionId' }, 400)

  const session = getSessionView(parsed.data)
  if (!session) return c.json({ error: 'Session not found' }, 404)
  return c.json(withMeta(session))
})

app.get('/:id/qr', async (c) => {
  const parsed = sessionIdSchema.safeParse(c.req.param('id'))
  if (!parsed.success) return c.json({ error: 'Invalid sessionId' }, 400)

  const rawQr = getSessionQr(parsed.data)
  if (rawQr === undefined) return c.json({ error: 'Session not found' }, 404)
  if (!rawQr) return c.json({ qr: null })

  const qr = await QRCode.toDataURL(rawQr, { margin: 1, width: 256 })
  c.header('Cache-Control', 'no-store')
  return c.json({ qr })
})

app.get('/:id/pairing', (c) => {
  const parsed = sessionIdSchema.safeParse(c.req.param('id'))
  if (!parsed.success) return c.json({ error: 'Invalid sessionId' }, 400)

  const pairing = getSessionPairing(parsed.data)
  if (!pairing) return c.json({ error: 'Session not found' }, 404)
  c.header('Cache-Control', 'no-store')
  return c.json(pairing)
})

app.post('/:id/token', (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Forbidden' }, 403)

  const parsed = sessionIdSchema.safeParse(c.req.param('id'))
  if (!parsed.success) return c.json({ error: 'Invalid sessionId' }, 400)

  if (!getSessionView(parsed.data)) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const token = issueSessionToken(parsed.data)
  c.header('Cache-Control', 'no-store')
  return c.json({ ok: true, sessionId: parsed.data, token })
})

app.post('/:id/login', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Forbidden' }, 403)

  const parsed = sessionIdSchema.safeParse(c.req.param('id'))
  if (!parsed.success) return c.json({ error: 'Invalid sessionId' }, 400)

  if (!getSessionMeta(parsed.data)) {
    return c.json({ error: 'Session not found' }, 404)
  }

  try {
    const session = await startSession(parsed.data, { mode: 'qr', phone: null })
    return c.json({ ok: true, ...withMeta(session) }, 202)
  } catch (err) {
    if (err instanceof SessionActiveError) {
      return c.json({ ok: false, error: err.message }, 409)
    }
    if (err instanceof SessionLimitError) {
      return c.json({ ok: false, error: err.message }, 409)
    }
    console.error(`Failed to restart session ${parsed.data}:`, err)
    return c.json({ error: 'Failed to restart session' }, 500)
  }
})

app.post('/:id/logout', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Forbidden' }, 403)

  const parsed = sessionIdSchema.safeParse(c.req.param('id'))
  if (!parsed.success) return c.json({ error: 'Invalid sessionId' }, 400)

  const session = await logoutSession(parsed.data)
  if (!session) return c.json({ error: 'Session not found' }, 404)
  revokeSessionTokens(parsed.data)
  return c.json({ ok: true, sessionId: session.sessionId, status: session.status })
})

app.delete('/:id', async (c) => {
  if (!isAdmin(c)) return c.json({ error: 'Forbidden' }, 403)

  const parsed = sessionIdSchema.safeParse(c.req.param('id'))
  if (!parsed.success) return c.json({ error: 'Invalid sessionId' }, 400)

  const deleted = await deleteSession(parsed.data)
  if (!deleted) return c.json({ error: 'Session not found' }, 404)
  revokeSessionTokens(parsed.data)
  deleteSessionMeta(parsed.data)
  return c.json({ ok: true, sessionId: parsed.data })
})

function withMeta(session: SessionView): SessionView & {
  salesId: string | null
  agentId: string | null
} {
  const meta = getSessionMeta(session.sessionId)
  return {
    ...session,
    salesId: meta?.salesId ?? null,
    agentId: meta?.agentId ?? null,
  }
}

export default app
