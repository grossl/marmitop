import { expect, test } from 'bun:test'
import { healthResponse } from './health'

test('health response is ok', async () => {
  expect(await healthResponse().json()).toEqual({ status: 'ok' })
})
