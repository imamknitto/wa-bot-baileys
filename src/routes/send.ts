import { Hono } from 'hono'
import { z } from 'zod'
import { WaNotConnectedError, sendText } from '../wa/socket.js'

const sendSchema = z.object({
  to: z.string().min(1),
  text: z.string().min(1),
})

const app = new Hono()

app.post('/', async (c) => {
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

  try {
    const id = await sendText(parsed.data.to, parsed.data.text)
    return c.json({ ok: true, id })
  } catch (err) {
    if (err instanceof WaNotConnectedError) {
      return c.json({ error: 'WhatsApp is not connected' }, 503)
    }
    console.error('Send failed:', err)
    return c.json({ error: 'Failed to send message' }, 502)
  }
})

export default app
