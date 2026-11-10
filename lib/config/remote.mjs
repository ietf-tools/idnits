// Base URLs of the services remote lookups are made to, outside the browser (in the browser,
// lookups go through the /idnits3/api/ endpoints of the page's own server).
//
// Each one is taken, in order, from the options of the run (see normalizeRemoteOptions), then
// setRemoteUrls() (the CLI flags), the environment variable, then the public service, so a deployment next to Datatracker (e.g. its celery workers) can
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
 * @param {RemoteOptions} [options] Options of the run
 * @returns {string} Datatracker base URL, without trailing slash
 */
export function getDatatrackerUrl (options = {}) {
  return options.datatrackerUrl ?? overrides.datatracker ?? fromEnv(DATATRACKER_URL_ENV) ?? DEFAULT_DATATRACKER_URL
}

/**
 * @param {RemoteOptions} [options] Options of the run
 * @returns {string} RFC Editor base URL, without trailing slash
 */
export function getRfcEditorUrl (options = {}) {
  return options.rfcEditorUrl ?? overrides.rfcEditor ?? fromEnv(RFCEDITOR_URL_ENV) ?? DEFAULT_RFCEDITOR_URL
}

// Time allowed for each remote request, response body included, after which the lookup fails
// as if the service couldn't be reached. Taken, in order, from the options of the run, then
// setRemoteTimeout() (the CLI flag), the environment variable (in seconds), then the default.
export const DEFAULT_REMOTE_TIMEOUT = 10
export const REMOTE_TIMEOUT_ENV = 'IDNITS_REMOTE_TIMEOUT'
// Longest timeout a timer can be set to (2^31 - 1 ms, about 24 days)
export const MAX_REMOTE_TIMEOUT = 2147483

let timeoutOverride = null

/**
 * Check a timeout given in seconds
 *
 * @param {string|number} value Timeout in seconds, e.g. "2.5"
 * @param {string} [label] What the timeout is for, used in the error message
 * @returns {number} Timeout in seconds
 * @throws {Error} If the value isn't a positive number up to MAX_REMOTE_TIMEOUT
 */
export function normalizeTimeout (value, label = 'Timeout') {
  const seconds = typeof value === 'string' && value.trim() ? Number(value.trim()) : value
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`${label} must be a positive number of seconds, got "${value}"`)
  }
  if (seconds > MAX_REMOTE_TIMEOUT) {
    throw new Error(`${label} must be at most ${MAX_REMOTE_TIMEOUT} seconds, got "${value}"`)
  }
  return seconds
}

/**
 * Set the timeout of remote requests, taking precedence over the environment variable
 *
 * @param {string|number|null} [seconds] Timeout in seconds, null or undefined to use the
 *   environment variable or default
 */
export function setRemoteTimeout (seconds) {
  timeoutOverride = seconds === null || seconds === undefined ? null : normalizeTimeout(seconds, 'Remote timeout')
}

/**
 * @param {RemoteOptions} [options] Options of the run
 * @returns {number} Timeout of remote requests, in seconds
 */
export function getRemoteTimeout (options = {}) {
  if (options.remoteTimeout !== null && options.remoteTimeout !== undefined) {
    return options.remoteTimeout
  }
  if (timeoutOverride !== null) {
    return timeoutOverride
  }
  const value = typeof process !== 'undefined' ? process.env?.[REMOTE_TIMEOUT_ENV] : undefined
  return value?.trim() ? normalizeTimeout(value, REMOTE_TIMEOUT_ENV) : DEFAULT_REMOTE_TIMEOUT
}

/**
 * @typedef {Object} RemoteOptions
 * @property {string|null} [datatrackerUrl] Datatracker base URL, without trailing slash
 * @property {string|null} [rfcEditorUrl] RFC Editor base URL, without trailing slash
 * @property {number|null} [remoteTimeout] Timeout of remote requests, in seconds
 */

/**
 * Check the base URLs and timeout given for one run, which take precedence over setRemoteUrls(),
 * setRemoteTimeout() and the environment variables for that run only
 *
 * @param {Object} [options]
 * @param {string|null} [options.datatrackerUrl] Datatracker base URL, null or undefined to use
 *   the process-wide one
 * @param {string|null} [options.rfcEditorUrl] RFC Editor base URL, null or undefined to use the
 *   process-wide one
 * @param {string|number|null} [options.remoteTimeout] Timeout in seconds, null or undefined to
 *   use the process-wide one
 * @returns {RemoteOptions} Options of the run, null for those not given
 * @throws {Error} If a URL or the timeout given isn't valid
 */
export function normalizeRemoteOptions ({ datatrackerUrl, rfcEditorUrl, remoteTimeout } = {}) {
  const options = { datatrackerUrl: null, rfcEditorUrl: null, remoteTimeout: null }
  if (datatrackerUrl) {
    options.datatrackerUrl = normalizeBaseUrl(datatrackerUrl, 'Datatracker URL')
  }
  if (rfcEditorUrl) {
    options.rfcEditorUrl = normalizeBaseUrl(rfcEditorUrl, 'RFC Editor URL')
  }
  if (remoteTimeout !== null && remoteTimeout !== undefined) {
    options.remoteTimeout = normalizeTimeout(remoteTimeout, 'Remote timeout')
  }
  return options
}
