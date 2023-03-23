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
    expect(getModeByName('normal')).toEqual({ mode: 0, name: 'normal' })
    expect(getModeByName('Normal')).toEqual({ mode: 0, name: 'normal' })
    expect(getModeByName('norm')).toEqual({ mode: 0, name: 'normal' })
    expect(getModeByName('n')).toEqual({ mode: 0, name: 'normal' })
  })
  test('getModeByName() should return mode number 1 for forgive-checklist', async () => {
    expect(getModeByName('forgive-checklist')).toEqual({ mode: 1, name: 'forgive-checklist' })
    expect(getModeByName('f-c')).toEqual({ mode: 1, name: 'forgive-checklist' })
    expect(getModeByName('fc')).toEqual({ mode: 1, name: 'forgive-checklist' })
    expect(getModeByName('f')).toEqual({ mode: 1, name: 'forgive-checklist' })
  })
  test('getModeByName() should return mode number 2 for submission', async () => {
    expect(getModeByName('submission')).toEqual({ mode: 2, name: 'submission' })
    expect(getModeByName('sub')).toEqual({ mode: 2, name: 'submission' })
    expect(getModeByName('s')).toEqual({ mode: 2, name: 'submission' })
  })
  test('getModeByName() should fail for an invalid mode name', async () => {
    expect(() => { getModeByName('invalid') }).toThrow()
  })
})
