import { isPlainObject } from 'lodash-es'

/**
 * Matcher Function for findChildWith()
 *
 * @callback findChildWithClb
 * @param {string} value Object value
 * @param {string} key Object key
 * @returns {Boolean} Return true on match
 */

/**
 * Find a child anywhere in the tree that matches true for the given function
 *
 * @param {Object} obj Object to traverse
 * @param {findChildWithClb} func Function to call on every child for a match
 * @param {string} [path] Current path array
 * @returns {Object} Result with first children found
 */
export function findChildWith (obj, func, path = []) {
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
        const result = findChildWith(entry, func, [...path, `${key}[${idx}]`])
        if (result) {
          return result
        }
        idx++
      }
    } else if (isPlainObject(value)) {
      const result = findChildWith(value, func, [...path, key])
      if (result) {
        return result
      }
    }
  }
}
