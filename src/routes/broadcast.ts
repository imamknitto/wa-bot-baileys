import { Hono } from 'hono'
import { z } from 'zod'
import {
  BroadcastBusyError,
  BroadcastNotRunningError,
  cancelJob,
  createJob,
  getJob,
} from '../broadcast/scheduler.js'
import { getCustomersByIds } from '../db/app.js'
import {
  SessionNotFoundError,
  WaNotConnectedError,
  toJid,
} from '../wa/manager.js'
import {
  broadcastSchema,
  jobIdSchema,
  sessionIdSchema,
} from '../validation.js'

const app = new Hono()

app.post('/:id/broadcast', async (c) => {
  const id = sessionIdSchema.safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Invalid sessionId' }, 400)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const parsed = broadcastSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: z.treeifyError(parsed.error) },
      400,
    )
  }

  const customerIds = [...new Set(parsed.data.customerIds ?? [])]
  const customers = getCustomersByIds(customerIds)
  if (customers.length !== customerIds.length) {
    return c.json({ error: 'Customer not found' }, 400)
  }

  const byId = new Map(customers.map((customer) => [customer.id, customer]))
  const seen = new Set<string>()
  const recipients: { to: string; text: string }[] = []
  const addRecipient = (to: string, name: string | null) => {
    const jid = toJid(to)
    if (seen.has(jid)) return
    seen.add(jid)
    recipients.push({
      to: jid,
      text: renderTemplate(parsed.data.text, name),
    })
  }

  for (const customerId of customerIds) {
    const customer = byId.get(customerId)
    if (customer) addRecipient(customer.phone, customer.name)
  }
  for (const to of parsed.data.recipients ?? []) addRecipient(to, null)

  try {
    const job = createJob(id.data, {
      recipients,
      text: parsed.data.text,
      delayMinMs: parsed.data.delayMinMs,
      delayMaxMs: parsed.data.delayMaxMs,
    })
    return c.json({ ok: true, jobId: job.jobId }, 202)
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return c.json({ error: 'Session not found' }, 404)
    }
    if (err instanceof WaNotConnectedError) {
      return c.json({ error: 'WhatsApp is not connected' }, 503)
    }
    if (err instanceof BroadcastBusyError) {
      return c.json({ error: err.message }, 409)
    }
    console.error(`[${id.data}] Failed to start broadcast:`, err)
    return c.json({ error: 'Failed to start broadcast' }, 500)
  }
})

function renderTemplate(text: string, name: string | null): string {
  if (!text.includes('{nama}')) return text
  return text
    .replaceAll('{nama}', () => name ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

app.get('/:id/broadcast/:jobId', (c) => {
  const id = sessionIdSchema.safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Invalid sessionId' }, 400)
  const jobId = jobIdSchema.safeParse(c.req.param('jobId'))
  if (!jobId.success) return c.json({ error: 'Invalid jobId' }, 400)

  const job = getJob(id.data, jobId.data)
  if (!job) return c.json({ error: 'Broadcast job not found' }, 404)
  return c.json(job)
})

app.post('/:id/broadcast/:jobId/cancel', (c) => {
  const id = sessionIdSchema.safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Invalid sessionId' }, 400)
  const jobId = jobIdSchema.safeParse(c.req.param('jobId'))
  if (!jobId.success) return c.json({ error: 'Invalid jobId' }, 400)

  try {
    const job = cancelJob(id.data, jobId.data)
    if (!job) return c.json({ error: 'Broadcast job not found' }, 404)
    return c.json({ ok: true, jobId: job.jobId, status: job.status })
  } catch (err) {
    if (err instanceof BroadcastNotRunningError) {
      return c.json({ error: err.message }, 409)
    }
    console.error(`[${id.data}] Failed to cancel broadcast:`, err)
    return c.json({ error: 'Failed to cancel broadcast' }, 500)
  }
})

export default app