/**
 * Formats an array of strings into a human-readable enumeration.
 *
 * - For an empty array or falsy value, returns an empty string.
 * - For arrays with 1 or 2 elements, joins them with ' and '.
 * - For arrays with 3 or more elements, joins all but the last with ', ', then adds ', and ' before the last element.
 *
 * @param {string[]} arr - The array of strings to format.
 * @returns {string} The formatted enumeration string.
 */
export function formatEnumeration (arr) {
  if (!arr || arr.length === 0) {
    return ''
  } else if (arr.length < 3) {
    return arr.join(' and ')
  } else {
    return arr
      .slice(0, arr.length - 1)
      .join(', ') + `, and ${arr.at(-1)}`
  }
}

/**
 *
 * Split draft name into base name and version.
 *
 * @param {String} value
 * @returns {Object} - Object with baseName and version properties.
 */
export function splitDraftName (value) {
  const m = value.match(/^(.+)-(\d+)$/)
  return { baseName: m?.[1] ?? value, version: m?.[2] ?? '' }
}
