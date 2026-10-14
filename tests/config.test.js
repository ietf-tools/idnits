import { describe, expect, test } from 'vitest'
import { ALLOWED_DOMAINS_DEFAULT } from '../lib/config/externals.mjs'
import { getModeByName } from '../lib/config/modes.mjs'
import { getStatusCategory, rfcStatusHierarchy } from '../lib/config/rfc-status-hierarchy.mjs'

describe('externals', () => {
  test('allowedDomainsDefault is an array of domains', async () => {
    expect(Array.isArray(ALLOWED_DOMAINS_DEFAULT)).toBe(true)
    expect(ALLOWED_DOMAINS_DEFAULT.length > 0).toBe(true)
    expect(ALLOWED_DOMAINS_DEFAULT.every(d => typeof d === 'string')).toBe(true)
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

describe('rfc-status-hierarchy', () => {
  test('status regexes are not global, so repeated .test() calls agree', async () => {
    for (const status of rfcStatusHierarchy) {
      expect(status.regex.global).toBe(false)
    }
  })

  test('getStatusCategory gives the same result on repeated calls', async () => {
    expect(getStatusCategory('Informational')).toBe(getStatusCategory('Informational'))
    expect(getStatusCategory('Standards Track')).toBe(getStatusCategory('Standards Track'))
  })
})
