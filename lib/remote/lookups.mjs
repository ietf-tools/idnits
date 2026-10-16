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

// Longest chain of replacements followed, well above any seen in Datatracker
export const MAX_REPLACEMENT_CHAIN = 10

/**
 * @typedef {Object} DraftChainEnd
 * @property {string} kind 'rfc' when the chain ends in a published RFC, 'draft' when it ends in
 *                         a draft, 'unknown' when the cited draft can't be fetched
 * @property {string} [rfc] RFC number, for kind 'rfc'
 * @property {string} [name] Name of the last draft of the chain, for kind 'draft'
 * @property {string|null} [intendedStatus] Intended status of that draft, for kind 'draft'
 */

/**
 * Follow a draft through the drafts that replaced it, to the RFC it was published as or the
 * last draft of the chain, using Datatracker's doc.json: its state ('Replaced', 'RFC'...) and its
 * revision history, which lists the revisions of the drafts that replaced it and the RFC they
 * were published as, in order of publication.
 *
 * A chain that loops or is longer than MAX_REPLACEMENT_CHAIN ends at the last draft reached.
 *
 * @param {Object} doc Document being checked, for sharing lookups
 * @param {string} draftName Name of the cited draft, with or without its version
 * @returns {Promise<{ chain: string[], end: DraftChainEnd }>} Drafts of the chain, starting
 *          with the cited one (without version), and where the chain ends
 */
export async function resolveDraftChain (doc, draftName) {
  const chain = [draftName.replace(/-[0-9]{2}$/, '')]

  while (true) {
    const name = chain[chain.length - 1]
    const info = await getDocInfoJson(doc, name)
    if (!info?.state) {
      return chain.length === 1
        ? { chain, end: { kind: 'unknown' } }
        : { chain, end: { kind: 'draft', name, intendedStatus: null } }
    }

    const history = info.rev_history ?? []
    const later = history.slice(history.findLastIndex(entry => entry.name === name) + 1)
    const state = info.state.toLowerCase()

    if (state === 'rfc') {
      const rfc = later.find(entry => /^rfc\d+$/i.test(entry.name ?? ''))?.name
      if (rfc) {
        return { chain, end: { kind: 'rfc', rfc: trimStart(rfc.slice(3), '0') } }
      }
    } else if (state === 'replaced' && chain.length < MAX_REPLACEMENT_CHAIN) {
      const next = later.find(entry => entry.name?.startsWith('draft-') && !chain.includes(entry.name))?.name
      if (next) {
        chain.push(next)
        continue
      }
    }

    return { chain, end: { kind: 'draft', name, intendedStatus: info.intended_std_level || null } }
  }
}
