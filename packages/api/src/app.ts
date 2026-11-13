import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono, type MiddlewareHandler } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { resolveSessionToken } from './auth/session-token.js'
import broadcastRoutes from './routes/broadcast.js'
import docsRoutes from './routes/docs.js'
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

/**
 * API reference (Scalar) and its OpenAPI document. Public like `GET /`: the
 * document only describes the contract and carries no credentials.
 */
app.route('/docs', docsRoutes)

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

/**
 * Resolves packages/web/dist relative to this module; falls back to cwd-based
 * candidates because the Hono CLI bundles the app with a non-file module URL.
 */
function resolveWebDist(): string {
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
  } catch {
    for (const candidate of ['packages/web/dist', 'web/dist']) {
      const dir = resolve(process.cwd(), candidate)
      if (existsSync(dir)) return dir
    }
    return resolve(process.cwd(), 'packages/web/dist')
  }
}

const webDist = resolveWebDist()
const webIndexPath = resolve(webDist, 'index.html')
const webDevOrigin = 'http://localhost:5173'

/**
 * In dev the vite server owns the UI. `pnpm dev:api` passes --dev, which makes
 * index.ts set SERVE_WEB=false so a stale packages/web/dist is never served.
 */
function webUiEnabled(): boolean {
  const flag = (process.env.SERVE_WEB ?? '').trim().toLowerCase()
  return !(flag === 'false' || flag === '0' || flag === 'off')
}

const appStatic = serveStatic({
  root: webDist,
  rewriteRequestPath: (path) => path.replace(/^\/app\/?/, '/'),
})
const staticUi = (c: Parameters<typeof appStatic>[0], next: () => Promise<void>) =>
  webUiEnabled() ? appStatic(c, next) : next()
app.use('/app', staticUi)
app.use('/app/*', staticUi)
app.get('/app', (c) =>
  c.redirect(webUiEnabled() ? '/app/' : `${webDevOrigin}${c.req.path}`),
)

/**
 * SPA fallback: any unmatched /app path serves the web app for browsers, while
 * API clients keep receiving a JSON 404.
 */
app.notFound((c) => {
  const isUiPath = c.req.path.startsWith('/app')
  if (isUiPath && !webUiEnabled()) {
    return c.redirect(`${webDevOrigin}${c.req.path}`)
  }
  const wantsHtml = (c.req.header('accept') ?? '').includes('text/html')
  if (c.req.method === 'GET' && isUiPath && wantsHtml && existsSync(webIndexPath)) {
    return c.html(readFileSync(webIndexPath, 'utf8'))
  }
  return c.json({ error: 'Not found' }, 404)
})

export default app
