import { Hono } from 'hono'
import { z } from 'zod'
import { listMessages } from '../db/app.js'
import { getSessionView } from '../wa/manager.js'
import { messagesQuerySchema, sessionIdSchema } from '../validation.js'

const app = new Hono()

app.get('/:id/messages', (c) => {
  const id = sessionIdSchema.safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Invalid sessionId' }, 400)

  const parsed = messagesQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: z.treeifyError(parsed.error) },
      400,
    )
  }

  if (!getSessionView(id.data)) {
    return c.json({ error: 'Session not found' }, 404)
  }

  return c.json(listMessages(id.data, parsed.data.limit, parsed.data.cursor))
})

export default app