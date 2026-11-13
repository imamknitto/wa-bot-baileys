import { Hono } from 'hono'
import { countMessages } from '../db/app.js'
import { listSessions } from '../wa/manager.js'

const app = new Hono()

app.get('/', (c) => {
  const sessions = listSessions()
  return c.json({
    sessions: {
      total: sessions.length,
      connected: sessions.filter((session) => session.connected).length,
    },
    messages: countMessages(),
  })
})

export default app
