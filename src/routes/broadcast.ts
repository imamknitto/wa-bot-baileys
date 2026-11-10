import { Hono } from 'hono'
import { z } from 'zod'
import { WaNotConnectedError, sendText } from '../wa/socket.js'

const broadcastSchema = z.object({
  recipients: z.array(z.string().min(1)).min(1).max(100),
  text: z.string().min(1),
  delayMs: z.number().int().min(1000).max(600000).default(3000),
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const app = new Hono()

app.post('/', async (c) => {
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

  const { recipients, text, delayMs } = parsed.data
  const results: Array<{ to: string; ok: boolean; error?: string }> = []
  let sent = 0
  let disconnected = false

  for (const [i, to] of recipients.entries()) {
    if (i > 0) await sleep(delayMs)
    try {
      await sendText(to, text)
      sent++
      results.push({ to, ok: true })
    } catch (err) {
      if (err instanceof WaNotConnectedError) {
        disconnected = true
        results.push({ to, ok: false, error: 'WhatsApp disconnected' })
        break
      }
      results.push({
        to,
        ok: false,
        error: err instanceof Error ? err.message : 'send failed',
      })
    }
  }

  const failed = recipients.length - sent
  return c.json(
    { ok: sent > 0, sent, failed, disconnected, results },
    disconnected ? 503 : 200,
  )
})

export default app
