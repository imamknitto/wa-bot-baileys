import { Hono } from 'hono'
import QRCode from 'qrcode'
import { getQr } from '../wa/socket.js'

const app = new Hono()

app.get('/', async (c) => {
  const qr = getQr()
  if (!qr) return c.json({ qr: null })
  const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 256 })
  return c.json({ qr: dataUrl })
})

export default app
