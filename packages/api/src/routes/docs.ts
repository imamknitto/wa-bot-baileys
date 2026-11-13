import { Hono } from 'hono'
import { Scalar } from '@scalar/hono-api-reference'
import { openApiDocument } from '../openapi.js'

const app = new Hono()

/** Raw OpenAPI document; usable by other tools (codegen, Postman import). */
app.get('/openapi.json', (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(openApiDocument)
})

/** Interactive reference (Scalar) rendered from the document above. */
app.get(
  '/',
  Scalar({
    url: '/docs/openapi.json',
    pageTitle: 'wa-bot-service API',
    hideModels: false,
    persistAuth: true,
    defaultHttpClient: { targetKey: 'js', clientKey: 'fetch' },
  }),
)

app.get('/*', (c) => c.redirect('/docs'))

export default app
