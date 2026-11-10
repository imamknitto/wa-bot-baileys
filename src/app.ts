import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type MiddlewareHandler } from 'hono'
import broadcastRoutes from './routes/broadcast.js'
import loginRoutes from './routes/login.js'
import logoutRoutes from './routes/logout.js'
import qrRoutes from './routes/qr.js'
import sendRoutes from './routes/send.js'
import statusRoutes from './routes/status.js'

const apiKeyAuth: MiddlewareHandler = async (c, next) => {
  const key = c.req.header('x-api-key')
  const expected = process.env.API_KEY
  if (!expected || key !== expected) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
}

const app = new Hono()

app.use('/send', apiKeyAuth)
app.use('/status', apiKeyAuth)
app.use('/qr', apiKeyAuth)
app.use('/login', apiKeyAuth)
app.use('/logout', apiKeyAuth)
app.use('/broadcast', apiKeyAuth)
app.route('/send', sendRoutes)
app.route('/status', statusRoutes)
app.route('/qr', qrRoutes)
app.route('/login', loginRoutes)
app.route('/logout', logoutRoutes)
app.route('/broadcast', broadcastRoutes)
app.use('*', serveStatic({ root: './public' }))

export default app
