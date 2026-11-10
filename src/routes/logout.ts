import { Hono } from 'hono'
import { getStatus, logout } from '../wa/socket.js'

const app = new Hono()

app.post('/', async (c) => {
  await logout()
  return c.json({ ok: true, status: getStatus().status })
})

export default app
