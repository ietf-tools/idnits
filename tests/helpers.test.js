import { describe, expect, test } from '@jest/globals'
import { findChildWith } from '../lib/helpers/traversal.mjs'

describe('traversal', () => {
  test('findChildWith() should find a nested child from a matcher', async () => {
    expect(findChildWith({ a: { b: { test: true } } }, (v, k) => k === 'test')).toEqual({
      path: ['a', 'b', 'test'],
      key: 'test',
      value: true
    })
  })
  test('findChildWith() should find a nested child in an array from a matcher', async () => {
    expect(findChildWith({ a: ['123', '456'], b: { c: ['abc', { test: true }] } }, (v, k) => k === 'test')).toEqual({
      path: ['b', 'c[1]', 'test'],
      key: 'test',
      value: true
    })
  })
  test('findChildWith() should not find a nested child from a false matcher', async () => {
    expect(findChildWith({ a: ['123', '456'], b: { c: ['abc', { test: true }] } }, (v, k) => k === 'ietf')).toBeUndefined()
  })
})
