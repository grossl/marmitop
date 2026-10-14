import { expect, test } from 'bun:test'
import * as pkg from './index'

test('@mt/http exports are loadable', () => {
  expect(Object.keys(pkg).length).toBeGreaterThan(0)
})
