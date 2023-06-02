import { isPlainObject } from 'lodash-es'

/**
 * Matcher Function for findDescendantWith() and findAllDescendantsWith()
 *
 * @callback findChildWithClb
 * @param {string} value Object value
 * @param {string} key Object key
 * @returns {Boolean} Return true on match
 */

/**
 * Find a descendant that matches true for the given matcher function
 *
 * @param {Object} obj Object to traverse
 * @param {findChildWithClb} func Function to call on every child for a match
 * @param {string} [path] Current path array
 * @returns {Object} Result with first descendant found
 */
export function findDescendantWith (obj, func, path = []) {
  for (const [key, value] of Object.entries(obj)) {
    if (func(value, key)) {
      return {
        path: [...path, key],
        key,
        value
      }
    }
    if (Array.isArray(value)) {
      let idx = 0
      for (const entry of value) {
        const result = findDescendantWith(entry, func, [...path, `${key}[${idx}]`])
        if (result) {
          return result
        }
        idx++
      }
    } else if (isPlainObject(value)) {
      const result = findDescendantWith(value, func, [...path, key])
      if (result) {
        return result
      }
    }
  }
}

/**
 * Find all descendants that matches true for the given matcher function
 *
 * @param {Object} obj Object to traverse
 * @param {findChildWithClb} func Function to call on every child for a match
 * @param {string} [path] Current path array
 * @returns {Object[]} Result with all descendants found
 */
export function findAllDescendantsWith (obj, func, path = []) {
  const matches = []
  for (const [key, value] of Object.entries(obj)) {
    if (func(value, key)) {
      matches.push({
        path: [...path, key],
        key,
        value
      })
    }
    if (Array.isArray(value)) {
      let idx = 0
      for (const entry of value) {
        const result = findAllDescendantsWith(entry, func, [...path, `${key}[${idx}]`])
        if (result?.length > 0) {
          matches.push(...result)
        }
        idx++
      }
    } else if (isPlainObject(value)) {
      const result = findAllDescendantsWith(value, func, [...path, key])
      if (result?.length > 0) {
        matches.push(...result)
      }
    }
  }
  return matches
}

/**
 * Traverse an object with the given matcher function
 *
 * @param {Object} obj Object to traverse
 * @param {findChildWithClb} func Function to call on every child
 * @param {string} [path] Current path array
 */
export async function traverseAll (obj, func, path = []) {
  const isAsyncFunc = func.constructor.name === 'AsyncFunction'
  if (typeof obj === 'string') {
    isAsyncFunc ? await func(obj, null, path) : func(obj, null, path)
  } else {
    for (const [key, value] of Object.entries(obj)) {
      if (key === '_attr' || key === '#text') { continue }
      isAsyncFunc ? await func(value, key, path) : func(value, key, path)
      if (Array.isArray(value)) {
        let idx = 0
        for (const entry of value) {
          await traverseAll(entry, func, [...path, `${key}[${idx}]`])
          idx++
        }
      } else if (isPlainObject(value)) {
        await traverseAll(value, func, [...path, key])
      }
    }
  }
}

/**
 * Traverse an object with the given matcher function for every values
 *
 * @param {Object} obj Object to traverse
 * @param {findChildWithClb} func Function to call on every value
 * @param {string} [path] Current path array
 */
export async function traverseAllValues (obj, func, path = []) {
  const isAsyncFunc = func.constructor.name === 'AsyncFunction'
  if (typeof obj === 'string') {
    isAsyncFunc ? await func(obj, null, path) : func(obj, null, path)
  } else {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        isAsyncFunc ? await func(value, key, [...path, key]) : func(value, key, [...path, key])
      } else if (Array.isArray(value)) {
        let idx = 0
        for (const entry of value) {
          await traverseAllValues(entry, func, [...path, `${key}[${idx}]`])
          idx++
        }
      } else if (isPlainObject(value)) {
        await traverseAllValues(value, func, [...path, key])
      }
    }
  }
}
