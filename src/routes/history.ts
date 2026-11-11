import { Hono } from 'hono'
import { z } from 'zod'
import { deleteMessage, listRecentMessages } from '../db/app.js'
import { messageIdSchema, recentMessagesQuerySchema } from '../validation.js'

const app = new Hono()

app.get('/', (c) => {
  const parsed = recentMessagesQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: z.treeifyError(parsed.error) },
      400,
    )
  }

  return c.json({
    messages: listRecentMessages(parsed.data.limit, parsed.data.sessionId),
  })
})

app.delete('/:id', (c) => {
  const id = messageIdSchema.safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Invalid message id' }, 400)

  if (!deleteMessage(id.data)) {
    return c.json({ error: 'Message not found' }, 404)
  }
  return c.json({ ok: true, id: id.data })
})

export default app