import { serve } from '@hono/node-server'
import app from './app.js'
import * as scheduler from './broadcast/scheduler.js'
import { getConfig, type Config } from './config.js'
import { initAppDb } from './db/app.js'
import * as webhook from './webhook/dispatcher.js'
import { restoreSessions } from './wa/manager.js'

function loadConfigOrExit(): Config {
  try {
    return getConfig()
  } catch (err) {
    console.error(
      'Invalid configuration:',
      err instanceof Error ? err.message : err,
    )
    process.exit(1)
  }
}

const envFiles = [process.env.ENV_FILE, '.env', '../../.env'].filter(
  (file): file is string => typeof file === 'string' && file.length > 0,
)
let envLoaded = false
for (const file of envFiles) {
  try {
    process.loadEnvFile(file)
    envLoaded = true
    break
  } catch {}
}
if (!envLoaded) {
  console.warn('No .env file found, using environment variables only')
}

const apiKey = process.env.API_KEY
if (!apiKey) {
  console.error('API_KEY is not set. Copy .env.example to .env and set it.')
  process.exit(1)
}

const config = loadConfigOrExit()

initAppDb(config.dbPath)
scheduler.initialize()

const devMode = process.argv.includes('--dev')
if (devMode) {
  if (process.env.SERVE_WEB === undefined) process.env.SERVE_WEB = 'false'
  console.log('Dev mode: UI is served by vite at http://localhost:5173/app/')
}

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  },
  (info) => {
    const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host
    console.log(`Server is running on http://${displayHost}:${info.port}`)
    if (!devMode) {
      console.log(`Platform UI: http://${displayHost}:${info.port}/app/`)
    }
  },
)

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `PORT ${config.port} is already in use on ${config.host}. Free that port or set PORT to another one.`,
    )
  } else {
    console.error('Failed to start HTTP server:', err.message)
  }
  process.exit(1)
})

restoreSessions()
  .then(() => {
    scheduler.start()
    webhook.start()
  })
  .catch((err) => {
    console.error('Failed to restore WhatsApp sessions:', err)
    scheduler.start()
    webhook.start()
  })