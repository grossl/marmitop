import { expect, test } from 'bun:test'
import { app } from './app'

test('GET /v1/health returns ok', async () => {
  const res = await app.request('/v1/health')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok' })
})
