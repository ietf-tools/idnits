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
