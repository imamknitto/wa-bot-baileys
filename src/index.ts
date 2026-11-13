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

try {
  process.loadEnvFile()
} catch {
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

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)
    console.log(`Demo UI: http://localhost:${info.port}/demo`)
  },
)

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