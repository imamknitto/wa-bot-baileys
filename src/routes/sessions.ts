import { Hono } from 'hono'
import QRCode from 'qrcode'
import { z } from 'zod'
import { countMessagesTodayBySession } from '../db/app.js'
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
} from '../wa/manager.js'
import { sessionIdSchema } from '../validation.js'

const createSessionSchema = z
  .object({
    sessionId: sessionIdSchema,
    mode: z.enum(['pairing', 'qr']).default('pairing'),
    phone: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode !== 'pairing') return
    const digits = digitsOnly(value.phone ?? '')
    if (digits.length < 8 || digits.length > 15) {
      ctx.addIssue({
        code: 'custom',
        message: 'phone must contain 8-15 digits',
        path: ['phone'],
      })
    }
  })

const app = new Hono()

app.post('/', async (c) => {
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

  const { sessionId, mode } = parsed.data
  const phone = mode === 'pairing' ? digitsOnly(parsed.data.phone ?? '') : null

  try {
    const session = await startSession(sessionId, { mode, phone })
    return c.json({ ok: true, ...session }, 202)
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
  return c.json({
    sessions: listSessions().map((session) => ({
      ...session,
      sentToday: sentToday[session.sessionId] ?? 0,
    })),
  })
})

app.get('/:id/status', (c) => {
  const parsed = sessionIdSchema.safeParse(c.req.param('id'))
  if (!parsed.success) return c.json({ error: 'Invalid sessionId' }, 400)

  const session = getSessionView(parsed.data)
  if (!session) return c.json({ error: 'Session not found' }, 404)
  return c.json(session)
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

app.post('/:id/logout', async (c) => {
  const parsed = sessionIdSchema.safeParse(c.req.param('id'))
  if (!parsed.success) return c.json({ error: 'Invalid sessionId' }, 400)

  const session = await logoutSession(parsed.data)
  if (!session) return c.json({ error: 'Session not found' }, 404)
  return c.json({ ok: true, sessionId: session.sessionId, status: session.status })
})

app.delete('/:id', async (c) => {
  const parsed = sessionIdSchema.safeParse(c.req.param('id'))
  if (!parsed.success) return c.json({ error: 'Invalid sessionId' }, 400)

  const deleted = await deleteSession(parsed.data)
  if (!deleted) return c.json({ error: 'Session not found' }, 404)
  return c.json({ ok: true, sessionId: parsed.data })
})

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

export default app