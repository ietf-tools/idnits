import { getDatatrackerUrl, getRfcEditorUrl } from '../config/remote.mjs'

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
 * Fetch a URL outside the browser, with the idnits3 User-Agent
 *
 * @param {string} url URL to fetch
 * @param {Object} [headers] Other request headers
 * @returns {Promise<Response>} Response
 */
export async function remoteFetch (url, headers = {}) {
  return fetch(url, {
    headers: {
      ...headers,
      'User-Agent': await getUserAgent()
    },
    credentials: 'omit'
  })
}

/**
 * Fetch document info from Datatracker
 *
 * @param {String} docName Document filename
 * @returns {Object} Document info object
 */
export async function fetchRemoteDocInfo (docName) {
  try {
    const docNameWithoutVersion = FILENAME_VERSION_SUFFIX_RE.test(docName) ? docName.slice(0, -3) : docName
    const resp = isBrowser
      ? await fetch('/idnits3/api/docinfo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: docNameWithoutVersion
        })
      })
      : await remoteFetch(`${getDatatrackerUrl()}/api/v1/doc/document/${docNameWithoutVersion}/`, { 'Content-Type': 'application/json' })
    return resp.ok ? resp.json() : null
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
    const resp = isBrowser
      ? await fetch('/idnits3/api/docjson', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: docNameWithoutVersion
        })
      })
      : await remoteFetch(`${getDatatrackerUrl()}/doc/${docNameWithoutVersion}/doc.json`, { 'Content-Type': 'application/json' })
    return resp.ok ? resp.json() : null
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
    const resp = isBrowser
      ? await fetch('/idnits3/api/rfcjson', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          rfc: rfcNum.toString()
        })
      })
      : await remoteFetch(`${getRfcEditorUrl()}/rfc/rfc${rfcNum}.json`, { 'Content-Type': 'application/json' })
    return resp.ok ? resp.json() : null
  } catch (err) {
    console.warn(err.message)
  }
}
/* c8 ignore end */
