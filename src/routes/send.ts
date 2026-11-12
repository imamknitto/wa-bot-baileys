import { Hono } from 'hono'
import { z } from 'zod'
import { recordMessage } from '../db/app.js'
import {
  SessionNotFoundError,
  WaNotConnectedError,
  sendText,
  toJid,
} from '../wa/manager.js'
import { sendSchema, sessionIdSchema } from '../validation.js'

const app = new Hono()

app.post('/:id/send', async (c) => {
  const id = sessionIdSchema.safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Invalid sessionId' }, 400)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const parsed = sendSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: z.treeifyError(parsed.error) },
      400,
    )
  }

  const { to, text } = parsed.data
  try {
    const messageId = await sendText(id.data, to, text)
    try {
      recordMessage({
        sessionId: id.data,
        source: 'send',
        toJid: toJid(to),
        text,
        waMessageId: messageId,
        status: 'sent',
      })
    } catch (err) {
      console.error(`[${id.data}] Failed to record message:`, err)
    }
    return c.json({ ok: true, id: messageId })
  } catch (err) {
    try {
      recordMessage({
        sessionId: id.data,
        source: 'send',
        toJid: toJid(to),
        text,
        status: 'failed',
        error: err instanceof Error ? err.message : 'send failed',
      })
    } catch (logErr) {
      console.error(`[${id.data}] Failed to record message:`, logErr)
    }

    if (err instanceof SessionNotFoundError) {
      return c.json({ error: 'Session not found' }, 404)
    }
    if (err instanceof WaNotConnectedError) {
      return c.json({ error: 'WhatsApp is not connected' }, 503)
    }
    console.error(`[${id.data}] Send failed:`, err)
    return c.json({ error: 'Failed to send message' }, 502)
  }
})

export default app