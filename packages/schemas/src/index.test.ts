import { expect, test } from 'bun:test'
import * as pkg from './index'

test('@mt/schemas exports are loadable', () => {
  expect(Object.keys(pkg).length).toBeGreaterThan(0)
})
