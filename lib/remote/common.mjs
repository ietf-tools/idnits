import { getDatatrackerUrl, getRemoteTimeout, getRfcEditorUrl } from '../config/remote.mjs'

/* c8 ignore start */
const FILENAME_VERSION_SUFFIX_RE = /-[0-9]{2}$/

const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined' && !window.DRAFTFORGE

let userAgent = null

/**
 * User-Agent of the requests made outside the browser, naming idnits3 and its version
 *
 * @returns {Promise<string>} User-Agent, e.g. "idnits3/3.0.0 (+https://github.com/ietf-tools/idnits)"
 */
export function getUserAgent () {
  if (!userAgent) {
    userAgent = (async () => {
      let version = ''
      try {
        const { readFile } = await import('node:fs/promises')
        const pkgInfo = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
        version = pkgInfo.version ? `/${pkgInfo.version}` : ''
      } catch (err) {
        // -> Not running from the package (e.g. bundled), name idnits3 without its version
      }
      return `idnits3${version} (+https://github.com/ietf-tools/idnits)`
    })()
  }
  return userAgent
}

/**
 * Fetch a URL outside the browser, with the idnits3 User-Agent, and read its response within
 * the remote timeout (see getRemoteTimeout)
 *
 * @param {string} url URL to fetch
 * @param {Object} [options]
 * @param {string} [options.type] How to read the response body: 'json' or 'text'
 * @param {Object} [options.headers] Other request headers
 * @returns {Promise<*>} Response body, or null if the server answers that there is no such
 *   document (HTTP 404 or 410)
 * @throws {Error} If the request fails, times out or gets any other unsuccessful response,
 *   naming the host
 */
export async function remoteFetch (url, { type = 'json', headers = {} } = {}) {
  const timeout = getRemoteTimeout()
  const host = new URL(url).host
  let resp
  try {
    resp = await fetch(url, {
      headers: {
        ...headers,
        'User-Agent': await getUserAgent()
      },
      credentials: 'omit',
      signal: AbortSignal.timeout(timeout * 1000)
    })
    if (!resp.ok) {
      return notFoundOrThrow(resp, host)
    }
    return type === 'text' ? await resp.text() : await resp.json()
  } catch (err) {
    if (err.name === 'HttpStatusError') {
      throw err
    }
    if (err.name === 'TimeoutError') {
      throw new Error(`Request to ${host} timed out after ${timeout} s`)
    }
    throw new Error(`Request to ${host} failed: ${err.cause?.message ?? err.message}`)
  }
}

/**
 * Read an unsuccessful response: null when the server answers that there is no such document
 * (404 or 410), meaning "doesn't exist"; any other status means the lookup failed
 *
 * @param {Response} resp Unsuccessful response
 * @param {string} where Host or endpoint, for the message
 * @returns {null} null for 404 and 410
 * @throws {Error} For any other status, naming it
 */
function notFoundOrThrow (resp, where) {
  if (resp.status === 404 || resp.status === 410) {
    return null
  }
  const err = new Error(`Request to ${where} failed: HTTP ${resp.status}`)
  err.name = 'HttpStatusError'
  throw err
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/**
 * Post a lookup to an /idnits3/api/ endpoint of the page's server, in the browser
 *
 * @param {string} path Endpoint path
 * @param {Object} body Lookup parameters
 * @returns {Promise<Object|null>} Response body, or null if the server answers that there is no
 *   such document (HTTP 404 or 410)
 * @throws {Error} For any other unsuccessful response, naming the status
 */
async function browserFetch (path, body) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  })
  return resp.ok ? await resp.json() : notFoundOrThrow(resp, path)
}
/* c8 ignore end */

// Datatracker document lookups (/api/v1/doc/document/<name>/) are made by several checks of a run
// (stream, revision, cross-stream, IPR...) that don't share a document-scoped cache, so the
// lookups of each URL are shared here for a short time: long enough to cover a run, short enough
// that a long-running process (a web service checking many documents) sees a new revision soon
// after it is posted. The number of entries is bounded so such a process doesn't grow without end.
export const DOC_INFO_CACHE_TTL = 60 * 1000
export const DOC_INFO_CACHE_SIZE = 500

const docInfoCache = new Map()

/**
 * Share the lookups of a URL made within DOC_INFO_CACHE_TTL
 *
 * @param {string} key Cache key (URL)
 * @param {Function} fetcher Function fetching the data
 * @returns {Promise<*>} Fetched data, shared by the lookups of the same key
 */
export function cachedLookup (key, fetcher) {
  const now = Date.now()
  const hit = docInfoCache.get(key)
  if (hit && now - hit.time < DOC_INFO_CACHE_TTL) {
    return hit.value
  }
  docInfoCache.delete(key)
  // -> Drop expired entries, then the oldest ones beyond the size limit (Map keeps insertion order)
  for (const [k, entry] of docInfoCache) {
    if (docInfoCache.size >= DOC_INFO_CACHE_SIZE || now - entry.time >= DOC_INFO_CACHE_TTL) {
      docInfoCache.delete(k)
    } else {
      break
    }
  }
  const value = fetcher()
  docInfoCache.set(key, { time: now, value })
  return value
}

/**
 * Forget the shared lookups, so the next ones are fetched again
 */
export function clearRemoteCache () {
  docInfoCache.clear()
}

/* c8 ignore start */
/**
 * @typedef {Object} LookupOutcome
 * @property {*} [value] Fetched data (null if the service answers that there is no such
 *   document); undefined if the lookup failed
 * @property {string} [error] Why the lookup failed (e.g. "Request to www.rfc-editor.org failed:
 *   HTTP 503"), already printed as a console warning
 */

/**
 * Run a lookup, telling a failure from an answer: the failure is warned about once and its
 * reason returned, so the checks using the lookup can say why they couldn't run
 *
 * @param {Function} fetcher Function fetching the data, throwing if the lookup fails
 * @returns {Promise<LookupOutcome>} Outcome of the lookup
 */
async function lookupOutcome (fetcher) {
  try {
    return { value: await fetcher() }
  } catch (err) {
    console.warn(err.message)
    return { error: err.message }
  }
}

/**
 * Look up document info on Datatracker, telling a failed lookup from an answer
 *
 * Lookups of the same document within a short time share one request (see cachedLookup).
 *
 * @param {String} docName Document filename
 * @returns {Promise<LookupOutcome>} Outcome of the lookup
 */
export function lookupRemoteDocInfo (docName) {
  const docNameWithoutVersion = FILENAME_VERSION_SUFFIX_RE.test(docName) ? docName.slice(0, -3) : docName
  let url
  try {
    url = isBrowser ? '/idnits3/api/docinfo' : `${getDatatrackerUrl()}/api/v1/doc/document/${docNameWithoutVersion}/`
  } catch (err) {
    console.warn(err.message)
    return Promise.resolve({ error: err.message })
  }
  let cacheKey = url
  if (isBrowser) {
    cacheKey = `${url}#${docNameWithoutVersion}`
  }
  return cachedLookup(cacheKey, () => lookupOutcome(() => fetchDocInfo(docNameWithoutVersion, url)))
}

/**
 * Fetch document info from Datatracker, throwing if the lookup fails
 *
 * @param {String} docNameWithoutVersion Document name without its version
 * @param {String} url URL of the Datatracker API for the document
 * @returns {Promise<Object|null>} Document info object, null if Datatracker doesn't have the document
 */
function fetchDocInfo (docNameWithoutVersion, url) {
  if (isBrowser) {
    return browserFetch('/idnits3/api/docinfo', { name: docNameWithoutVersion })
  }
  return remoteFetch(url, { headers: JSON_HEADERS })
}

/**
 * Fetch document info from Datatracker
 *
 * @param {String} docName Document filename
 * @returns {Promise<Object|null|undefined>} Document info object, null if Datatracker doesn't
 *   have the document, undefined if the lookup failed
 */
export async function fetchRemoteDocInfo (docName) {
  return (await lookupRemoteDocInfo(docName)).value
}

/**
 * Look up the Datatracker doc.json of a document, telling a failed lookup from an answer
 *
 * @param {String} docName Document name, without revision: it is looked up as given, as a draft
 *   may be named with what looks like one (draft-singh-apex-psi-04)
 * @returns {Promise<LookupOutcome>} Outcome of the lookup
 */
export function lookupRemoteDocInfoJson (docName) {
  return lookupOutcome(() => fetchDocInfoJson(docName))
}

/**
 * Fetch the Datatracker doc.json of a document, throwing if the lookup fails
 *
 * @param {String} docName Document name, without revision, looked up as given
 * @returns {Promise<Object|null>} doc.json, null if Datatracker doesn't have the document
 */
function fetchDocInfoJson (docName) {
  if (isBrowser) {
    return browserFetch('/idnits3/api/docjson', { name: docName })
  }
  const url = `${getDatatrackerUrl()}/doc/${docName}/doc.json`
  return remoteFetch(url, { headers: JSON_HEADERS })
}

/**
 * Fetch document info from Datatracker into json specialized format
 *
 * @param {String} docName Document filename
 * @returns {Object} Document info object, null if Datatracker doesn't have the document,
 *   undefined if the lookup failed
 */
export async function fetchRemoteDocInfoJson (docName) {
  return (await lookupRemoteDocInfoJson(docName)).value
}

/**
 * Look up RFC info on rfc-editor.org, telling a failed lookup from an answer
 *
 * @param {String|Number} rfcNum RFC Number to fetch
 * @returns {Promise<LookupOutcome>} Outcome of the lookup
 */
export function lookupRemoteRfcInfo (rfcNum) {
  return lookupOutcome(() => fetchRfcInfo(rfcNum))
}

/**
 * Fetch RFC info from rfc-editor.org, throwing if the lookup fails
 *
 * @param {String|Number} rfcNum RFC Number to fetch
 * @returns {Promise<Object|null>} RFC info object, null if rfc-editor.org has no such RFC
 */
function fetchRfcInfo (rfcNum) {
  if (isBrowser) {
    return browserFetch('/idnits3/api/rfcjson', { rfc: rfcNum.toString() })
  }
  const url = `${getRfcEditorUrl()}/rfc/rfc${rfcNum}.json`
  return remoteFetch(url, { headers: JSON_HEADERS })
}

/**
 * Fetch RFC info from rfc-editor
 *
 * @param {String|Number} rfcNum RFC Number to fetch
 * @returns {Object} RFC info object, null if rfc-editor.org has no such RFC, undefined if the
 *   lookup failed
 */
export async function fetchRemoteRfcInfo (rfcNum) {
  return (await lookupRemoteRfcInfo(rfcNum)).value
}
/* c8 ignore end */
