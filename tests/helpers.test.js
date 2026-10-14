import { describe, expect, test } from 'vitest'
import { formatEnumeration } from '../lib/helpers/common.mjs'
import { findDescendantWith, findAllDescendantsWith, traverseAll, traverseAllValues } from '../lib/helpers/traversal.mjs'

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

  describe('traverseAllValues()', () => {
    /**
     * Collect every (value, key, path) triple a traversal reports.
     *
     * @param {Function} fn Traversal function under test
     * @param {Object} obj Object to traverse
     * @returns {Promise<Object[]>} Reported triples
     */
    async function collect (fn, obj) {
      const seen = []
      await fn(obj, (value, key, path) => {
        seen.push({ value, key, path: path.join('.') })
      })
      return seen
    }

    test('should report the owning key for a lone string child', async () => {
      expect(await collect(traverseAllValues, { section: { t: 'abc' } })).toEqual([
        { value: 'abc', key: 't', path: 'section.t' }
      ])
    })

    // fast-xml-parser collapses repeated sibling tags into an array of strings,
    // so <t>a</t><t>b</t> arrives as { t: ['a', 'b'] }. Callers filter on the
    // key to decide whether a value is prose, so the owning tag has to survive.
    test('should report the owning key for members of an array of strings', async () => {
      expect(await collect(traverseAllValues, { section: { t: ['abc', 'def'] } })).toEqual([
        { value: 'abc', key: 't', path: 'section.t[0]' },
        { value: 'def', key: 't', path: 'section.t[1]' }
      ])
    })

    test('should report the owning key for strings mixed with objects in an array', async () => {
      expect(await collect(traverseAllValues, { section: { t: ['abc', { '#text': 'def' }] } })).toEqual([
        { value: 'abc', key: 't', path: 'section.t[0]' },
        { value: 'def', key: '#text', path: 'section.t[1].#text' }
      ])
    })

    test('should await an async callback for every value', async () => {
      const seen = []
      await traverseAllValues({ section: { t: ['abc', 'def'] } }, async (value, key) => {
        await Promise.resolve()
        seen.push([key, value])
      })
      expect(seen).toEqual([['t', 'abc'], ['t', 'def']])
    })
  })

  describe('traverseAll()', () => {
    test('should report the owning key for members of an array of strings', async () => {
      const seen = []
      await traverseAll({ section: { t: ['abc', 'def'] } }, (value, key, path) => {
        if (typeof value === 'string') {
          seen.push({ value, key, path: path.join('.') })
        }
      })
      expect(seen).toEqual([
        { value: 'abc', key: 't', path: 'section.t[0]' },
        { value: 'def', key: 't', path: 'section.t[1]' }
      ])
    })
  })
})
