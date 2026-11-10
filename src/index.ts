import { serve } from '@hono/node-server'
import app from './app.js'
import { startWhatsApp } from './wa/socket.js'

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

const port = Number(process.env.PORT ?? 3000)

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)
  },
)

startWhatsApp().catch((err) => {
  console.error('Failed to start WhatsApp socket:', err)
  process.exit(1)
})
