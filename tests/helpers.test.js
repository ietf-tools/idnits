import { describe, expect, test } from 'vitest'
import { formatEnumeration } from '../lib/helpers/common.mjs'
import { findDescendantWith, findAllDescendantsWith } from '../lib/helpers/traversal.mjs'

describe('common', () => {
  describe('formatEnumeration', () => {
    test('should return empty string for empty array', async () => {
      expect(formatEnumeration([])).toEqual('')
    })
    test('should return empty string for null', async () => {
      expect(formatEnumeration(null)).toEqual('')
    })
    test('should return only item value if only a single item', async () => {
      expect(formatEnumeration(['abcdef'])).toEqual('abcdef')
    })
    test('should return only values joined by "and" when 2 elements', async () => {
      expect(formatEnumeration(['abcdef', 'qwerty'])).toEqual('abcdef and qwerty')
    })
    test('should return only values joined by oxford comma + "and" when more than 2 elements', async () => {
      expect(formatEnumeration(['abcdef', 'qwerty', 'foobar'])).toEqual('abcdef, qwerty, and foobar')
    })
  })
})

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

  // TODO: traverseAll()
  // TODO: traverseAllValues()
})
