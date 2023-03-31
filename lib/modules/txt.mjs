import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'

/**
 * Validate a document for over-long lines
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateLineLength (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  let idx = 1
  let longestLineNum = 0
  let longestLineLength = 72
  for (const line of doc.body.split('\n')) {
    if (line.length > longestLineLength) {
      longestLineNum = idx
      longestLineLength = line.length
    }
    idx++
  }

  if (longestLineNum > 0) {
    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('LINE_TOO_LONG', 'The document contains over-long lines of more than 72 characters.', {
        lines: [{ line: longestLineNum, pos: longestLineLength }],
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }))
    } else {
      result.push(new ValidationWarning('LINE_TOO_LONG', 'The document contains over-long lines of more than 72 characters.', {
        lines: [{ line: longestLineNum, pos: longestLineLength }],
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }))
    }
  }

  return result
}
