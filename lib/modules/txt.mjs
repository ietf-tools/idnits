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
 * Validate if document has hyphenated line-breaks
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateHyphenatedLineBreaks(doc, { mode = MODES.NORMAL } = {}) {
  const result = [];

  if (mode === MODES.SUBMISSION) return result;

  if (doc.data.possibleIssues.hyphenatedLines.length) {
    result.push(new ValidationWarning(
      'HYPHENATED_LINE_BREAKS',
      'Document has hyphenated line-breaks.',
      {
        lines: doc.data.possibleIssues.hyphenatedLines.map((obj) => obj),
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }
    ));
  }

  return result;
}

/**
 * Validate document for lines with extra spacing (over-long lines)
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateLineExtraSpacing(doc, { mode = MODES.NORMAL } = {}) {
  const result = [];
  const MAX_DOCUMENT_LINE_WITH_SPACES = 50;

  if (doc.data.possibleIssues.linesWithSpaces.length > MAX_DOCUMENT_LINE_WITH_SPACES) {
    const message = 'The document does not appear to be ragged-right (more than 50 lines of intra-line extra spacing).';

    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('RAGGED_RIGHT', message, {
        lines: doc.data.possibleIssues.linesWithSpaces.map((obj) => obj),
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }));
    } else if (mode === MODES.FORGIVE_CHECKLIST) {
      result.push(new ValidationWarning('RAGGED_RIGHT', message, {
        lines: doc.data.possibleIssues.linesWithSpaces.map((obj) => obj),
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }));
    }
  }

  return result;
}

/**
 * Validate if all detected code blocks contain a license declaration
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateCodeBlockLicenses(doc, { mode = MODES.NORMAL } = {}) {
  const result = [];

  if (mode === MODES.SUBMISSION) return result;

  if (doc.data.contains.codeBlocks && !doc.data.contains.revisedBsdLicense) {
    result.push(new ValidationWarning(
      'CODE_BLOCK_MISSING_LICENSE',
      'A code-block is detected, but the document does not contain a license declaration.',
      {
        ref: 'https://trustee.ietf.org/license-info'
      }
    ));
  }

  return result;
}
