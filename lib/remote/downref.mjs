import { getDatatrackerUrl, getRemoteTimeout } from '../config/remote.mjs'
import { remoteFetch } from './common.mjs'
import { getRemoteOptions } from './lookups.mjs'

/* c8 ignore start */
const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined' && !window.DRAFTFORGE
/* c8 ignore end */
const rfcRegex = /<a href="\/doc\/rfc(\d+)\/">([^<]+)<\/a>/g
const referenceRegex = /<a href="\/doc\/(?:rfc|draft-[^/]+)\/">([^<]+)<\/a>/g

// The registry is fetched at most once for each document being checked, when a check first needs
// it, and kept for its run, a failed fetch included: the checks of a run, which may need it for
// many RFCs, share one request and don't each wait for it to fail again. Keyed by the document,
// so a new run fetches it again.
const registryByDoc = new WeakMap()

/**
 * Error thrown when the Downref Registry can't be fetched
 */
export class DownrefRegistryUnavailableError extends Error {
  constructor (reason) {
    super(`Failed to fetch Downref Registry: ${reason}`)
    this.name = 'DownrefRegistryUnavailableError'
    this.reason = reason
  }
}

/**
 * Get the Downref Registry for a document being checked, fetching it the first time
 *
 * @param {Object} doc Document being checked
 * @returns {Promise<Set<string>>} - A set of references from the Downref Registry.
 * @throws {DownrefRegistryUnavailableError} If the registry can't be fetched
 */
function getDownrefRegistry (doc) {
  if (!doc || typeof doc !== 'object') {
    return fetchDownrefRegistry({})
  }
  // -> Checks running concurrently share the request in progress
  if (!registryByDoc.has(doc)) {
    registryByDoc.set(doc, fetchDownrefRegistry(getRemoteOptions(doc)))
  }
  return registryByDoc.get(doc)
}

/**
 * Fetch and parse the Downref Registry HTML to extract references, warning once if it fails
 *
 * @param {import('../config/remote.mjs').RemoteOptions} options Options of the run
 * @returns {Promise<Set<string>>} - A set of references from the Downref Registry.
 * @throws {DownrefRegistryUnavailableError} If the registry can't be fetched
 */
async function fetchDownrefRegistry (options) {
  try {
    return await loadDownrefRegistry(options)
  } catch (err) {
    const error = err instanceof DownrefRegistryUnavailableError ? err : new DownrefRegistryUnavailableError(err.message)
    console.warn(error.message)
    throw error
  }
}

/* c8 ignore start */
async function fetchRegistryHtml (options) {
  if (isBrowser) {
    const resp = await fetch('/idnits3/api/downref')
    if (!resp.ok) {
      throw new DownrefRegistryUnavailableError(`Request to the downref API failed with HTTP status ${resp.status}`)
    }
    return resp.text()
  }
  const url = `${getDatatrackerUrl(options)}/doc/downref/`
  const html = await remoteFetch(url, { type: 'text', timeout: getRemoteTimeout(options) })
  if (html === null) {
    throw new DownrefRegistryUnavailableError(`Request to ${new URL(url).host} returned an HTTP error`)
  }
  return html
}
/* c8 ignore end */

async function loadDownrefRegistry (options) {
  const html = await fetchRegistryHtml(options)
  const registry = new Set()
  let match

  while ((match = rfcRegex.exec(html)) !== null) {
    registry.add(`RFC ${match[1].trim()}`)
  }

  while ((match = referenceRegex.exec(html)) !== null) {
    registry.add(match[1].trim())
  }

  if (registry.size === 0) {
    throw new DownrefRegistryUnavailableError('no documents found in the registry page')
  }
  return registry
}

/**
 * Validate references against the Downref Registry, fetched once for the document being checked.
 * @param {Object} doc - Document being checked.
 * @param {string[]} references - List of references to validate.
 * @returns {Promise<string[]>} - A list of references found in the Downref Registry.
 * @throws {DownrefRegistryUnavailableError} If the registry can't be fetched
 */
export async function checkReferencesInDownrefs (doc, references) {
  const downrefRegistry = await getDownrefRegistry(doc)

  const foundDownrefs = []

  references.forEach(ref => {
    const refRegex = new RegExp(`\\b${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')

    for (const downref of downrefRegistry) {
      if (refRegex.test(downref)) {
        foundDownrefs.push(ref)
        break
      }
    }
  })

  return foundDownrefs
}
