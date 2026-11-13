import { Hono } from 'hono'
import { z } from 'zod'
import {
  findMessageByReference,
  getSessionMeta,
  recordMessage,
} from '../db/app.js'
import {
  SessionNotFoundError,
  WaNotConnectedError,
  sendText,
  toJid,
} from '../wa/manager.js'
import {
  enqueueWebhook,
  newEventId,
  type MessageWebhookPayload,
} from '../webhook/store.js'
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

  const { to, text, customerId, customerName, referenceId } = parsed.data
  const sessionId = id.data
  const jid = toJid(to)
  const meta = getSessionMeta(sessionId)

  if (referenceId) {
    const existing = findMessageByReference(sessionId, referenceId)
    if (existing) {
      return c.json({
        ok: existing.status === 'sent',
        id: existing.messageId,
        referenceId: existing.referenceId,
        status: existing.status,
        duplicate: true,
      })
    }
  }

  const baseLog = {
    sessionId,
    source: 'send' as const,
    toJid: jid,
    text,
    salesId: meta?.salesId ?? null,
    agentId: meta?.agentId ?? null,
    customerRef: customerId ?? null,
    recipientName: customerName ?? null,
    referenceId: referenceId ?? null,
  }

  try {
    const messageId = await sendText(sessionId, to, text)
    try {
      recordMessage({ ...baseLog, waMessageId: messageId, status: 'sent' })
    } catch (err) {
      console.error(`[${sessionId}] Failed to record message:`, err)
    }
    emitEvent({
      type: 'message.sent',
      sessionId,
      salesId: baseLog.salesId,
      agentId: baseLog.agentId,
      referenceId: baseLog.referenceId,
      customerId: baseLog.customerRef,
      customerName: baseLog.recipientName,
      to: jid,
      text,
      messageId,
      status: 'sent',
    })
    return c.json({ ok: true, id: messageId, referenceId: referenceId ?? null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'send failed'
    try {
      recordMessage({ ...baseLog, status: 'failed', error: message })
    } catch (logErr) {
      console.error(`[${sessionId}] Failed to record message:`, logErr)
    }
    emitEvent({
      type: 'message.failed',
      sessionId,
      salesId: baseLog.salesId,
      agentId: baseLog.agentId,
      referenceId: baseLog.referenceId,
      customerId: baseLog.customerRef,
      customerName: baseLog.recipientName,
      to: jid,
      text,
      messageId: null,
      status: 'failed',
      error: message,
    })

    if (err instanceof SessionNotFoundError) {
      return c.json({ error: 'Session not found' }, 404)
    }
    if (err instanceof WaNotConnectedError) {
      return c.json({ error: 'WhatsApp is not connected' }, 503)
    }
    console.error(`[${sessionId}] Send failed:`, err)
    return c.json({ error: 'Failed to send message' }, 502)
  }
})

interface MessageEventInput {
  type: 'message.sent' | 'message.failed'
  sessionId: string
  salesId: string | null
  agentId: string | null
  referenceId: string | null
  customerId: string | null
  customerName: string | null
  to: string
  text: string
  messageId: string | null
  status: 'sent' | 'failed'
  error?: string
}

function emitEvent(input: MessageEventInput): void {
  const payload: MessageWebhookPayload = {
    eventId: newEventId(),
    type: input.type,
    occurredAt: Date.now(),
    salesId: input.salesId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    referenceId: input.referenceId,
    customerId: input.customerId,
    customerName: input.customerName,
    to: input.to,
    text: input.text,
    messageId: input.messageId,
    status: input.status,
    ...(input.error === undefined ? {} : { error: input.error }),
  }
  enqueueWebhook(input.type, input.sessionId, payload)
}

export default app
