import { Hono, type MiddlewareHandler } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { resolveSessionToken } from './auth/session-token.js'
import broadcastRoutes from './routes/broadcast.js'
import historyRoutes from './routes/history.js'
import messagesRoutes from './routes/messages.js'
import sendRoutes from './routes/send.js'
import serviceRoutes from './routes/service.js'
import sessionsRoutes from './routes/sessions.js'
import statsRoutes from './routes/stats.js'

export type AuthRole = 'admin' | 'sales'

export type AppEnv = {
  Variables: {
    role: AuthRole
    tokenSessionId: string | null
  }
}

const app = new Hono<AppEnv>()

function adminKeyMatches(header: string | undefined): boolean {
  const expected = process.env.API_KEY
  if (!expected) return false
  return header === expected
}

const apiKeyAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!adminKeyMatches(c.req.header('x-api-key'))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('role', 'admin')
  c.set('tokenSessionId', null)
  await next()
}

/**
 * Accepts either the admin service key or a per-session Bearer token.
 * Sales tokens are scoped to a single session: whenever the route carries a
 * session id parameter, it must match the token's session.
 */
const sessionAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (adminKeyMatches(c.req.header('x-api-key'))) {
    c.set('role', 'admin')
    c.set('tokenSessionId', null)
    await next()
    return
  }

  const authorization = c.req.header('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  const owner = match ? resolveSessionToken(match[1].trim()) : null
  if (!owner) return c.json({ error: 'Unauthorized' }, 401)

  const routeSessionId = sessionIdFromPath(c.req.path)
  if (routeSessionId && routeSessionId !== owner.sessionId) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  c.set('role', 'sales')
  c.set('tokenSessionId', owner.sessionId)
  await next()
}

/** Extracts the session id segment from /sessions/<id>/... without router params. */
function sessionIdFromPath(path: string): string | null {
  const match = /^\/sessions\/([^/]+)/.exec(path)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

app.route('/', serviceRoutes)

app.use('/sessions', sessionAuth)
app.use('/sessions/*', sessionAuth)
app.route('/sessions', sessionsRoutes)
app.route('/sessions', sendRoutes)
app.route('/sessions', broadcastRoutes)
app.route('/sessions', messagesRoutes)

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
