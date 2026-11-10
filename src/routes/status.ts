import { Hono } from 'hono'
import { getStatus } from '../wa/socket.js'

const app = new Hono()

app.get('/', (c) => c.json(getStatus()))

export default app
