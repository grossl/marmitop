import { expect, test } from 'bun:test'
import * as pkg from './index'

test('@mt/config exports are loadable', () => {
  expect(Object.keys(pkg).length).toBeGreaterThan(0)
})
