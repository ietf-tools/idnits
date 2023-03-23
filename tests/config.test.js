import { describe, expect, test } from '@jest/globals'
import { allowedDomainsDefault } from '../lib/config/externals.mjs'
import { getModeByName } from '../lib/config/modes.mjs'

describe('externals', () => {
  test('allowedDomainsDefault is an array of domains', async () => {
    expect(Array.isArray(allowedDomainsDefault)).toBe(true)
    expect(allowedDomainsDefault.length > 0).toBe(true)
    expect(allowedDomainsDefault.every(d => typeof d === 'string')).toBe(true)
  })
})

describe('modes', () => {
  test('getModeByName() should return mode number 0 for normal', async () => {
    expect(getModeByName('normal')).toBe(0)
    expect(getModeByName('Normal')).toBe(0)
    expect(getModeByName('norm')).toBe(0)
    expect(getModeByName('n')).toBe(0)
  })
  test('getModeByName() should return mode number 1 for forgive-checklist', async () => {
    expect(getModeByName('forgive-checklist')).toBe(1)
    expect(getModeByName('f-c')).toBe(1)
    expect(getModeByName('fc')).toBe(1)
    expect(getModeByName('f')).toBe(1)
  })
  test('getModeByName() should return mode number 2 for submission', async () => {
    expect(getModeByName('submission')).toBe(2)
    expect(getModeByName('sub')).toBe(2)
    expect(getModeByName('s')).toBe(2)
  })
  test('getModeByName() should fail for an invalid mode name', async () => {
    expect(() => { getModeByName('invalid') }).toThrow()
  })
})
