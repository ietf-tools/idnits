import { describe, expect, test } from '@jest/globals'
import { findDescendantWith, findAllDescendantsWith } from '../lib/helpers/traversal.mjs'

describe('traversal', () => {
  describe('findDescendantWith()', () => {
    test('should find a nested child from a matcher', async () => {
      expect(findDescendantWith({ a: { b: { test: true } } }, (v, k) => k === 'test')).toEqual({
        path: ['a', 'b', 'test'],
        key: 'test',
        value: true
      })
    })
    test('should find a nested child in an array from a matcher', async () => {
      expect(findDescendantWith({ a: ['123', '456'], b: { c: ['abc', { test: true }] } }, (v, k) => k === 'test')).toEqual({
        path: ['b', 'c[1]', 'test'],
        key: 'test',
        value: true
      })
    })
    test('should not find a nested child from a false matcher', async () => {
      expect(findDescendantWith({ a: ['123', '456'], b: { c: ['abc', { test: true }] } }, (v, k) => k === 'ietf')).toBeUndefined()
    })
  })

  describe('findAllDescendantsWith()', () => {
    test('should find nested children from a matcher', async () => {
      expect(findAllDescendantsWith({ a: { b: { test: true }, c: { test: true } } }, (v, k) => k === 'test')).toEqual([{
        path: ['a', 'b', 'test'],
        key: 'test',
        value: true
      }, {
        path: ['a', 'c', 'test'],
        key: 'test',
        value: true
      }])
    })
    test('should find nested children in an array from a matcher', async () => {
      expect(findAllDescendantsWith({ a: ['123', '456'], b: { c: ['abc', { test: true }] }, d: [{ test: true }] }, (v, k) => k === 'test')).toEqual([{
        path: ['b', 'c[1]', 'test'],
        key: 'test',
        value: true
      }, {
        path: ['d[0]', 'test'],
        key: 'test',
        value: true
      }])
    })
    test('should not find a nested child from a false matcher', async () => {
      expect(findAllDescendantsWith({ a: ['123', '456'], b: { c: ['abc', { test: true }] } }, (v, k) => k === 'ietf')).toEqual([])
    })
  })
})
