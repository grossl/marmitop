import { expect, test } from 'bun:test'
import * as pkg from './index'

test('@mt/core exports are loadable', () => {
  expect(Object.keys(pkg).length).toBeGreaterThan(0)
})
