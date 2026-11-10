import { getDatatrackerUrl, getRemoteTimeout, getRfcEditorUrl } from '../config/remote.mjs'

const FILENAME_VERSION_SUFFIX_RE = /-[0-9]{2}$/

// Names looked up on Datatracker and rfc-editor.org. A draft name follows Datatracker's naming
// rule (validate_submission_name in ietf/submit/utils.py): lowercase ASCII letters and digits in
// at least three hyphen-separated components, none empty. Its later limits (a letter first, at
// most 50 characters) are left out, as older drafts break them (draft-3gpp-collaboration,
// draft-irtf-iccrg-welzl-congestion-control-open-research), and a component may also hold ".",
// "_" and "+" after its first character, as in older drafts (draft-odell-8+8,
// draft-ietf-pilc-2.5g3g, draft-ietf-oncrpc-rpcsec_gss). An RFC is rfc and its number, without
// leading zeros.
const DRAFT_NAME_RE = /^draft-[a-z0-9][a-z0-9._+]*(?:-[a-z0-9][a-z0-9._+]*)+$/
const RFC_NAME_RE = /^rfc[1-9][0-9]{0,4}$/

/**
 * Tell whether a name taken from a document can be looked up: a draft name (without revision)
 * or an RFC (rfcNNNN) that Datatracker or rfc-editor.org could have. Any other name is answered
 * as "no such document" without asking, so that nothing a document says can change the request
 * made.
 *
 * @param {string} name Name to look up, without revision
 * @returns {boolean} Whether the name can be looked up
 */
export function isLookupName (name) {
  return typeof name === 'string' && (DRAFT_NAME_RE.test(name) || RFC_NAME_RE.test(name))
}

/**
 * Name under which Datatracker has the document being checked: the docName or filename without a
 * file extension (.txt, .xml) or revision (-NN)
 *
 * @param {string} docName Document name, e.g. draft-foo-bar-02 or draft-foo-bar-02.txt
 * @returns {string} Name to look up, e.g. draft-foo-bar
 */
export function ownDocLookupName (docName) {
  return String(docName ?? '').replace(/\.(?:txt|xml)$/i, '').replace(FILENAME_VERSION_SUFFIX_RE, '')
}

/* c8 ignore start */
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
 * the remote timeout
 *
 * @param {string} url URL to fetch
 * @param {Object} [options]
 * @param {string} [options.type] How to read the response body: 'json' or 'text'
 * @param {Object} [options.headers] Other request headers
 * @param {number} [options.timeout] Time allowed, in seconds (by default, see getRemoteTimeout)
 * @returns {Promise<*>} Response body, or null if the server answers that there is no such
 *   document (HTTP 404 or 410)
 * @throws {Error} If the request fails, times out or gets any other unsuccessful response,
 *   naming the host
 */
export async function remoteFetch (url, { type = 'json', headers = {}, timeout = getRemoteTimeout() } = {}) {
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
 * Each call makes its own request: the lookups of a run are shared by the checks of the
 * document being checked (see getDocInfo in lookups.mjs).
 *
 * A name that isn't a draft or RFC name (see isLookupName) is answered as "no such document"
 * without a request.
 *
 * @param {String} docName Document name or filename, with or without revision and extension
 * @param {import('../config/remote.mjs').RemoteOptions} [options] Options of the run
 * @returns {Promise<LookupOutcome>} Outcome of the lookup
 */
export function lookupRemoteDocInfo (docName, options = {}) {
  const docNameWithoutVersion = ownDocLookupName(docName)
  if (!isLookupName(docNameWithoutVersion)) {
    return Promise.resolve({ value: null })
  }
  let url
  try {
    url = isBrowser ? '/idnits3/api/docinfo' : `${getDatatrackerUrl(options)}/api/v1/doc/document/${encodeURIComponent(docNameWithoutVersion)}/`
  } catch (err) {
    console.warn(err.message)
    return Promise.resolve({ error: err.message })
  }
  return lookupOutcome(() => fetchDocInfo(docNameWithoutVersion, url, options))
}

/**
 * Fetch document info from Datatracker, throwing if the lookup fails
 *
 * @param {String} docNameWithoutVersion Document name without its version
 * @param {String} url URL of the Datatracker API for the document
 * @param {import('../config/remote.mjs').RemoteOptions} options Options of the run
 * @returns {Promise<Object|null>} Document info object, null if Datatracker doesn't have the document
 */
function fetchDocInfo (docNameWithoutVersion, url, options) {
  if (isBrowser) {
    return browserFetch('/idnits3/api/docinfo', { name: docNameWithoutVersion })
  }
  return remoteFetch(url, { headers: JSON_HEADERS, timeout: getRemoteTimeout(options) })
}

/**
 * Fetch document info from Datatracker
 *
 * @param {String} docName Document filename
 * @param {import('../config/remote.mjs').RemoteOptions} [options] Options of the run
 * @returns {Promise<Object|null|undefined>} Document info object, null if Datatracker doesn't
 *   have the document, undefined if the lookup failed
 */
export async function fetchRemoteDocInfo (docName, options = {}) {
  return (await lookupRemoteDocInfo(docName, options)).value
}

/**
 * Look up the Datatracker doc.json of a document, telling a failed lookup from an answer
 *
 * A name that isn't a draft or RFC name (see isLookupName) is answered as "no such document"
 * without a request.
 *
 * @param {String} docName Document name, without revision: it is looked up as given, as a draft
 *   may be named with what looks like one (draft-singh-apex-psi-04)
 * @param {import('../config/remote.mjs').RemoteOptions} [options] Options of the run
 * @returns {Promise<LookupOutcome>} Outcome of the lookup
 */
export function lookupRemoteDocInfoJson (docName, options = {}) {
  if (!isLookupName(docName)) {
    return Promise.resolve({ value: null })
  }
  return lookupOutcome(() => fetchDocInfoJson(docName, options))
}

/**
 * Fetch the Datatracker doc.json of a document, throwing if the lookup fails
 *
 * @param {String} docName Document name, without revision, looked up as given
 * @param {import('../config/remote.mjs').RemoteOptions} options Options of the run
 * @returns {Promise<Object|null>} doc.json, null if Datatracker doesn't have the document
 */
function fetchDocInfoJson (docName, options) {
  if (isBrowser) {
    return browserFetch('/idnits3/api/docjson', { name: docName })
  }
  const url = `${getDatatrackerUrl(options)}/doc/${encodeURIComponent(docName)}/doc.json`
  return remoteFetch(url, { headers: JSON_HEADERS, timeout: getRemoteTimeout(options) })
}

/**
 * Fetch document info from Datatracker into json specialized format
 *
 * @param {String} docName Document filename
 * @param {import('../config/remote.mjs').RemoteOptions} [options] Options of the run
 * @returns {Object} Document info object, null if Datatracker doesn't have the document,
 *   undefined if the lookup failed
 */
export async function fetchRemoteDocInfoJson (docName, options = {}) {
  return (await lookupRemoteDocInfoJson(docName, options)).value
}

/**
 * Look up RFC info on rfc-editor.org, telling a failed lookup from an answer
 *
 * A value that isn't an RFC number without leading zeros (see isLookupName) is answered as "no
 * such RFC" without a request.
 *
 * @param {String|Number} rfcNum RFC Number to fetch
 * @param {import('../config/remote.mjs').RemoteOptions} [options] Options of the run
 * @returns {Promise<LookupOutcome>} Outcome of the lookup
 */
export function lookupRemoteRfcInfo (rfcNum, options = {}) {
  const rfc = String(rfcNum)
  if (!isLookupName(`rfc${rfc}`)) {
    return Promise.resolve({ value: null })
  }
  return lookupOutcome(() => fetchRfcInfo(rfc, options))
}

/**
 * Fetch RFC info from rfc-editor.org, throwing if the lookup fails
 *
 * @param {String} rfc RFC number to fetch, checked by isLookupName
 * @param {import('../config/remote.mjs').RemoteOptions} options Options of the run
 * @returns {Promise<Object|null>} RFC info object, null if rfc-editor.org has no such RFC
 */
function fetchRfcInfo (rfc, options) {
  if (isBrowser) {
    return browserFetch('/idnits3/api/rfcjson', { rfc })
  }
  const url = `${getRfcEditorUrl(options)}/rfc/${encodeURIComponent(`rfc${rfc}`)}.json`
  return remoteFetch(url, { headers: JSON_HEADERS, timeout: getRemoteTimeout(options) })
}

/**
 * Fetch RFC info from rfc-editor
 *
 * @param {String|Number} rfcNum RFC Number to fetch
 * @param {import('../config/remote.mjs').RemoteOptions} [options] Options of the run
 * @returns {Object} RFC info object, null if rfc-editor.org has no such RFC, undefined if the
 *   lookup failed
 */
export async function fetchRemoteRfcInfo (rfcNum, options = {}) {
  return (await lookupRemoteRfcInfo(rfcNum, options)).value
}
/* c8 ignore end */
