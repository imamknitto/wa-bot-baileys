import { Hono } from 'hono'
import { z } from 'zod'
import {
  BroadcastBusyError,
  BroadcastNotRunningError,
  cancelJob,
  createJob,
  getJob,
  getRunningJobView,
} from '../broadcast/scheduler.js'
import { findJobByReference } from '../broadcast/store.js'
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

  const { text, delayMinMs, delayMaxMs, referenceId } = parsed.data
  const sessionId = id.data

  if (referenceId) {
    const existingJobId = findJobByReference(sessionId, referenceId)
    if (existingJobId) {
      const job = getJob(sessionId, existingJobId)
      return c.json(
        {
          ok: true,
          jobId: existingJobId,
          referenceId,
          duplicate: true,
          status: job?.status ?? null,
        },
        202,
      )
    }
  }

  const seen = new Set<string>()
  const recipients: {
    to: string
    text: string
    customerRef: string | null
    recipientName: string | null
  }[] = []
  for (const recipient of parsed.data.recipients) {
    const jid = toJid(recipient.to)
    if (seen.has(jid)) continue
    seen.add(jid)
    recipients.push({
      to: jid,
      text: recipient.text ?? text,
      customerRef: recipient.customerId ?? null,
      recipientName: recipient.name ?? null,
    })
  }

  try {
    const job = createJob(sessionId, {
      recipients,
      text,
      delayMinMs,
      delayMaxMs,
      referenceId: referenceId ?? null,
    })
    return c.json({ ok: true, jobId: job.jobId, referenceId: job.referenceId }, 202)
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
    console.error(`[${sessionId}] Failed to start broadcast:`, err)
    return c.json({ error: 'Failed to start broadcast' }, 500)
  }
})

app.get('/:id/broadcast/current', (c) => {
  const id = sessionIdSchema.safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Invalid sessionId' }, 400)

  const job = getRunningJobView(id.data)
  if (!job) return c.json({ error: 'No running broadcast job' }, 404)
  return c.json(job)
})

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
