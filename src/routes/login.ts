import { Hono } from 'hono'
import { getStatus, startWhatsApp } from '../wa/socket.js'

const app = new Hono()

app.post('/', async (c) => {
  const { status } = getStatus()
  if (status === 'connected' || status === 'connecting') {
    return c.json({ ok: false, error: `Already ${status}` }, 409)
  }
  await startWhatsApp()
  return c.json({ ok: true, status: getStatus().status })
})

export default app
