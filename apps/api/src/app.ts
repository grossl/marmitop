import { Hono } from 'hono'

export const app = new Hono()

app.get('/v1/health', (c) => c.json({ status: 'ok' }))
