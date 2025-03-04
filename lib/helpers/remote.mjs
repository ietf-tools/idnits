/* c8 ignore start */
const FILENAME_VERSION_SUFFIX_RE = /-[0-9]{2}$/

/**
 * Fetch document info from Datatracker
 *
 * @param {String} docName Document filename
 * @returns {Object} Document info object
 */
export async function fetchRemoteDocInfo (docName) {
  try {
    const docNameWithoutVersion = FILENAME_VERSION_SUFFIX_RE.test(docName) ? docName.slice(0, -3) : docName
    const resp = await fetch(`https://datatracker.ietf.org/api/v1/doc/document/${docNameWithoutVersion}/`, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'idnits'
      },
      credentials: 'omit'
    })
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
    const resp = await fetch(`https://datatracker.ietf.org/doc/${docNameWithoutVersion}/doc.json`, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'idnits'
      },
      credentials: 'omit'
    })
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
    const resp = await fetch(`https://www.rfc-editor.org/rfc/rfc${rfcNum}.json`, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'idnits'
      },
      credentials: 'omit'
    })
    return resp.ok ? resp.json() : null
  } catch (err) {
    console.warn(err.message)
  }
}
/* c8 ignore end */
