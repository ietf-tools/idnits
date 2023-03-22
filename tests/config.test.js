import { describe, expect, test } from '@jest/globals'
import { toThrowWithErrorName } from '../lib/helpers/error.mjs'
import { allowedDomainsDefault } from '../lib/config/externals.mjs'

expect.extend({
  toThrowWithErrorName
})

describe('externals', () => {
  test('allowedDomainsDefault is an array of domains', async () => {
    expect(Array.isArray(allowedDomainsDefault)).toBe(true)
    expect(allowedDomainsDefault.length > 0).toBe(true)
    expect(allowedDomainsDefault.every(d => typeof d === 'string')).toBe(true)
  })
})
