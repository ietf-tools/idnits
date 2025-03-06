import { ValidationError, ValidationWarning, ValidationComment } from '../helpers/error.mjs'
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

/**
 * Validate document reference type
 * Validate if Updates or Obsoletes line on first page has more than just numbers of RFCs
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateReferenceStyle (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const NUMERIC_REFERENCE_RE = /^\[\d{1,2}\]$/

  if (mode === MODES.SUBMISSION) return result

  const reference = [...doc.data.extractedElements.referenceSectionRfc, ...doc.data.extractedElements.referenceSectionDraftReferences]

  if (reference.length && NUMERIC_REFERENCE_RE.test(reference[0].value)) {
    const ref = doc.data.extractedElements.nonReferenceSectionDraftReferences.filter((val) => !NUMERIC_REFERENCE_RE.test(val))
    if (ref.length) {
      ref.forEach((ref) => {
        result.push(new ValidationComment(
          'DOCUMENT_USE_NUMERIC_REFERENCES',
        `The document text uses an numeric references, but contains ${ref}`,
        { ref: 'https://authors.ietf.org/en/required-content#references' }
        ))
      })
    }
  } else {
    const ref = doc.data.extractedElements.nonReferenceSectionDraftReferences.filter((val) => NUMERIC_REFERENCE_RE.test(val))
    if (ref.length) {
      ref.forEach((ref) => {
        result.push(new ValidationComment(
          'DOCUMENT_USE_STRING_REFERENCES',
          `The document text uses an string references, but contains ${ref}`,
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        ))
      })
    }
  }

  return result
}
