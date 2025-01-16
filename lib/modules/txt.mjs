import { ValidationError, ValidationWarning } from '../helpers/error.mjs'
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

/**
 * Validate a document for over-long lines
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateLineExtraSpacing (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  let spacingCount = 0
  const linesWithSpaces = []
  const extraSpacingRegex = /[A-Za-z][a-z] ? ?[a-z]/

  doc.body.split('\n').forEach((line, index) => {
    if (line.trim().startsWith('Internet.Draft') || line.trim().startsWith('INTERNET.DRAFT')) return

    if (extraSpacingRegex.test(line)) {
      spacingCount++
      linesWithSpaces.push({ line: index + 1, pos: line.length })
    }
  })

  if (spacingCount > 50) {
    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('RAGGED_RIGHT', 'The document does not appear to be ragged-right (more than 50 lines of intra-line extra spacing).', {
        lines: linesWithSpaces.map((obj) => obj),
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }))
    } else if (mode === MODES.FORGIVE_CHECKLIST) {
      result.push(new ValidationWarning('RAGGED_RIGHT', 'The document does not appear to be ragged-right (more than 50 lines of intra-line extra spacing).', {
        lines: linesWithSpaces.map((obj) => obj),
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }))
    }
  }

  return result
}

/**
 * Validate a document comments that are out of code blocks
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateCodeComments (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  const outOfBlockInlineComments = doc.data.possibleIssues.inlineCode

  if (doc.data.possibleIssues.inlineCode.length > 0) {
    result.push(new ValidationWarning('COMMENT_OUT_OF_CODE_BLOCK', 'Found something which looks like a code comment -- if you have code sections in the document, please surround them with \'<CODE BEGINS>\' and \'<CODE ENDS>\' lines.', {
      lines: outOfBlockInlineComments.map((obj) => ({ line: obj.line, pos: obj.pos })),
      ref: 'https://datatracker.ietf.org/doc/rfc8879'
    }))
  }

  return result
}
