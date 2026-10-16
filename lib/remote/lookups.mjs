import { trimStart } from 'lodash-es'
import { fetchRemoteDocInfoJson, fetchRemoteRfcInfo } from './common.mjs'

// Remote lookups made for each document being checked, as several checks run
// concurrently over the same references. Keyed by the document, so the
// lookups of a run go away with it and a new run fetches fresh data.
const lookupsByDoc = new WeakMap()

/**
 * Look up remote data once per document being checked
 *
 * @param {Object} doc Document being checked
 * @param {string} key Key of the lookup
 * @param {Function} fetcher Function fetching the data
 * @returns {Promise<*>} Fetched data, shared by all lookups with the same key
 */
function lookupOnce (doc, key, fetcher) {
  if (!doc || typeof doc !== 'object') {
    return fetcher()
  }
  let lookups = lookupsByDoc.get(doc)
  if (!lookups) {
    lookups = new Map()
    lookupsByDoc.set(doc, lookups)
  }
  if (!lookups.has(key)) {
    lookups.set(key, fetcher())
  }
  return lookups.get(key)
}

/**
 * Get the Datatracker doc.json of a draft, once per document being checked
 *
 * @param {Object} doc Document being checked
 * @param {string} draftName Draft name, with or without its version
 * @returns {Promise<Object|null>} Datatracker doc.json, or null if it can't be fetched
 */
export function getDocInfoJson (doc, draftName) {
  const name = draftName.replace(/-[0-9]{2}$/, '')
  return lookupOnce(doc, `doc:${name}`, () => fetchRemoteDocInfoJson(name))
}

/**
 * Get the rfc-editor.org info of an RFC, once per document being checked
 *
 * @param {Object} doc Document being checked
 * @param {string|number} rfcNumber RFC number, with or without leading zeros
 * @returns {Promise<Object|null>} RFC info, or null if it can't be fetched
 */
export function getRfcInfo (doc, rfcNumber) {
  const number = trimStart(String(rfcNumber), '0')
  return lookupOnce(doc, `rfc:${number}`, () => fetchRemoteRfcInfo(number))
}
