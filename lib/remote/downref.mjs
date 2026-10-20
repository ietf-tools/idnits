import { getDatatrackerUrl } from '../config/remote.mjs'
import { DOC_INFO_CACHE_TTL, remoteFetch } from './common.mjs'

/* c8 ignore start */
const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined' && !window.DRAFTFORGE
/* c8 ignore end */
const rfcRegex = /<a href="\/doc\/rfc(\d+)\/">([^<]+)<\/a>/g
const referenceRegex = /<a href="\/doc\/(?:rfc|draft-[^/]+)\/">([^<]+)<\/a>/g

// The registry is fetched once and kept for the life of the process. A failed fetch is
// remembered for as long as the document lookups are shared (DOC_INFO_CACHE_TTL): the checks of
// a run, which may need it for many RFCs, don't each wait for it to fail again, and a
// long-running process (a web service checking many documents) tries it again soon after.
export const DOWNREF_REGISTRY_FAILURE_TTL = DOC_INFO_CACHE_TTL

let cachedDownrefRegistry = null
let failedDownrefRegistry = null
let pendingDownrefRegistry = null

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
 * Fetch and parse the Downref Registry HTML to extract references.
 * Caches the result to avoid redundant network requests.
 * @returns {Promise<Set<string>>} - A set of references from the Downref Registry.
 * @throws {DownrefRegistryUnavailableError} If the registry can't be fetched
 */
async function fetchDownrefRegistry () {
  if (cachedDownrefRegistry) {
    return cachedDownrefRegistry
  }
  if (failedDownrefRegistry && Date.now() - failedDownrefRegistry.time < DOWNREF_REGISTRY_FAILURE_TTL) {
    throw failedDownrefRegistry.error
  }
  // -> Checks running concurrently share the request in progress
  if (!pendingDownrefRegistry) {
    pendingDownrefRegistry = loadDownrefRegistry().then(registry => {
      cachedDownrefRegistry = registry
      failedDownrefRegistry = null
      return registry
    }, err => {
      const error = err instanceof DownrefRegistryUnavailableError ? err : new DownrefRegistryUnavailableError(err.message)
      failedDownrefRegistry = { time: Date.now(), error }
      console.warn(error.message)
      throw error
    }).finally(() => {
      pendingDownrefRegistry = null
    })
  }
  return pendingDownrefRegistry
}

/* c8 ignore start */
async function fetchRegistryHtml () {
  if (isBrowser) {
    const resp = await fetch('/idnits3/api/downref')
    if (!resp.ok) {
      throw new DownrefRegistryUnavailableError(`Request to the downref API failed with HTTP status ${resp.status}`)
    }
    return resp.text()
  }
  const url = `${getDatatrackerUrl()}/doc/downref/`
  const html = await remoteFetch(url, { type: 'text' })
  if (html === null) {
    throw new DownrefRegistryUnavailableError(`Request to ${new URL(url).host} returned an HTTP error`)
  }
  return html
}
/* c8 ignore end */

async function loadDownrefRegistry () {
  const html = await fetchRegistryHtml()
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
 * Forget the Downref Registry, and a failure to fetch it, so it is fetched again when needed
 */
export function clearDownrefRegistryCache () {
  cachedDownrefRegistry = null
  failedDownrefRegistry = null
}

/**
 * Validate references against the Downref Registry.
 * @param {string[]} references - List of references to validate.
 * @returns {Promise<string[]>} - A list of references found in the Downref Registry.
 * @throws {DownrefRegistryUnavailableError} If the registry can't be fetched
 */
export async function checkReferencesInDownrefs (references) {
  const downrefRegistry = await fetchDownrefRegistry()

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
