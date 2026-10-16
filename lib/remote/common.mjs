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
 * @returns {Promise<*>} Response body, or null if the response isn't successful
 * @throws {Error} If the request fails or times out, naming the host
 */
export async function remoteFetch (url, { type = 'json', headers = {} } = {}) {
  const timeout = getRemoteTimeout()
  try {
    const resp = await fetch(url, {
      headers: {
        ...headers,
        'User-Agent': await getUserAgent()
      },
      credentials: 'omit',
      signal: AbortSignal.timeout(timeout * 1000)
    })
    if (!resp.ok) {
      return null
    }
    return type === 'text' ? await resp.text() : await resp.json()
  } catch (err) {
    const host = new URL(url).host
    if (err.name === 'TimeoutError') {
      throw new Error(`Request to ${host} timed out after ${timeout} s`)
    }
    throw new Error(`Request to ${host} failed: ${err.cause?.message ?? err.message}`)
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/**
 * Post a lookup to an /idnits3/api/ endpoint of the page's server, in the browser
 *
 * @param {string} path Endpoint path
 * @param {Object} body Lookup parameters
 * @returns {Promise<Object|null>} Response body, or null if the response isn't successful
 */
async function browserFetch (path, body) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  })
  return resp.ok ? await resp.json() : null
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
 * Fetch document info from Datatracker
 *
 * Lookups of the same document within a short time share one request (see cachedLookup).
 *
 * @param {String} docName Document filename
 * @returns {Promise<Object|null>} Document info object
 */
export function fetchRemoteDocInfo (docName) {
  const docNameWithoutVersion = FILENAME_VERSION_SUFFIX_RE.test(docName) ? docName.slice(0, -3) : docName
  let url
  try {
    url = isBrowser ? '/idnits3/api/docinfo' : `${getDatatrackerUrl()}/api/v1/doc/document/${docNameWithoutVersion}/`
  } catch (err) {
    console.warn(err.message)
    return Promise.resolve(undefined)
  }
  return cachedLookup(isBrowser ? `${url}#${docNameWithoutVersion}` : url, () => fetchDocInfo(docNameWithoutVersion, url))
}

async function fetchDocInfo (docNameWithoutVersion, url) {
  try {
    return isBrowser
      ? await browserFetch('/idnits3/api/docinfo', { name: docNameWithoutVersion })
      : await remoteFetch(url, { headers: JSON_HEADERS })
  } catch (err) {
    console.warn(err.message)
  }
}

/**
 * Fetch document info from Datatracker into json specialized format
 *
 * @param {String} docName Document filename
 * @returns {Object} Document info object
 */
export async function fetchRemoteDocInfoJson (docName) {
  try {
    const docNameWithoutVersion = FILENAME_VERSION_SUFFIX_RE.test(docName) ? docName.slice(0, -3) : docName
    return isBrowser
      ? await browserFetch('/idnits3/api/docjson', { name: docNameWithoutVersion })
      : await remoteFetch(`${getDatatrackerUrl()}/doc/${docNameWithoutVersion}/doc.json`, { headers: JSON_HEADERS })
  } catch (err) {
    console.warn(err.message)
  }
}

/**
 * Fetch RFC info from rfc-editor
 *
 * @param {String|Number} rfcNum RFC Number to fetch
 * @returns {Object} RFC info object
 */
export async function fetchRemoteRfcInfo (rfcNum) {
  try {
    return isBrowser
      ? await browserFetch('/idnits3/api/rfcjson', { rfc: rfcNum.toString() })
      : await remoteFetch(`${getRfcEditorUrl()}/rfc/rfc${rfcNum}.json`, { headers: JSON_HEADERS })
  } catch (err) {
    console.warn(err.message)
  }
}
/* c8 ignore end */
