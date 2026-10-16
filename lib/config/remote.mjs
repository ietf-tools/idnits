// Base URLs of the services remote lookups are made to, outside the browser (in the browser,
// lookups go through the /idnits3/api/ endpoints of the page's own server).
//
// Each one is taken, in order, from setRemoteUrls() (the CLI flags), the environment variable,
// then the public service, so a deployment next to Datatracker (e.g. its celery workers) can
// send the lookups to the in-cluster service rather than out through the public internet.

export const DEFAULT_DATATRACKER_URL = 'https://datatracker.ietf.org'
export const DEFAULT_RFCEDITOR_URL = 'https://www.rfc-editor.org'

export const DATATRACKER_URL_ENV = 'IDNITS_DATATRACKER_URL'
export const RFCEDITOR_URL_ENV = 'IDNITS_RFCEDITOR_URL'

const overrides = {
  datatracker: null,
  rfcEditor: null
}

/**
 * Check a base URL and remove its trailing slashes
 *
 * @param {string} value Base URL, e.g. "https://datatracker.ietf.org/"
 * @param {string} [label] What the URL is for, used in the error message
 * @returns {string} Base URL without trailing slashes, e.g. "https://datatracker.ietf.org"
 * @throws {Error} If the value isn't an absolute http(s) URL
 */
export function normalizeBaseUrl (value, label = 'Base URL') {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  let url
  try {
    url = new URL(trimmed)
  } catch (err) {
    throw new Error(`${label} must be an http(s) URL, got "${value}"`)
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.host || url.search || url.hash) {
    throw new Error(`${label} must be an http(s) URL without query or fragment, got "${value}"`)
  }
  return trimmed.replace(/\/+$/, '')
}

function fromEnv (name) {
  const value = typeof process !== 'undefined' ? process.env?.[name] : undefined
  return value?.trim() ? normalizeBaseUrl(value, name) : null
}

/**
 * Set the base URLs of the remote services, taking precedence over the environment variables
 *
 * @param {Object} urls Base URLs, null or undefined to use the environment variable or default
 * @param {string|null} [urls.datatracker] Datatracker base URL
 * @param {string|null} [urls.rfcEditor] RFC Editor base URL
 */
export function setRemoteUrls ({ datatracker, rfcEditor } = {}) {
  overrides.datatracker = datatracker ? normalizeBaseUrl(datatracker, 'Datatracker URL') : null
  overrides.rfcEditor = rfcEditor ? normalizeBaseUrl(rfcEditor, 'RFC Editor URL') : null
}

/**
 * @returns {string} Datatracker base URL, without trailing slash
 */
export function getDatatrackerUrl () {
  return overrides.datatracker ?? fromEnv(DATATRACKER_URL_ENV) ?? DEFAULT_DATATRACKER_URL
}

/**
 * @returns {string} RFC Editor base URL, without trailing slash
 */
export function getRfcEditorUrl () {
  return overrides.rfcEditor ?? fromEnv(RFCEDITOR_URL_ENV) ?? DEFAULT_RFCEDITOR_URL
}
