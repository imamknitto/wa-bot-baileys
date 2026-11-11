import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type MiddlewareHandler } from 'hono'
import broadcastRoutes from './routes/broadcast.js'
import customersRoutes from './routes/customers.js'
import historyRoutes from './routes/history.js'
import messagesRoutes from './routes/messages.js'
import sendRoutes from './routes/send.js'
import serviceRoutes from './routes/service.js'
import sessionsRoutes from './routes/sessions.js'
import statsRoutes from './routes/stats.js'

const apiKeyAuth: MiddlewareHandler = async (c, next) => {
  const key = c.req.header('x-api-key')
  const expected = process.env.API_KEY
  if (!expected || key !== expected) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
}

const app = new Hono()

app.route('/', serviceRoutes)

app.use('/sessions', apiKeyAuth)
app.use('/sessions/*', apiKeyAuth)
app.route('/sessions', sessionsRoutes)
app.route('/sessions', sendRoutes)
app.route('/sessions', broadcastRoutes)
app.route('/sessions', messagesRoutes)

app.use('/customers', apiKeyAuth)
app.use('/customers/*', apiKeyAuth)
app.route('/customers', customersRoutes)

app.use('/stats', apiKeyAuth)
app.route('/stats', statsRoutes)

app.use('/messages', apiKeyAuth)
app.route('/messages', historyRoutes)

const demoStatic = serveStatic({
  root: './public',
  rewriteRequestPath: (path) => path.replace(/^\/demo/, '') || '/',
})
app.use('/demo', demoStatic)
app.use('/demo/*', demoStatic)

export default app