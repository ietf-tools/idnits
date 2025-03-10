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
 * Validate copyright date
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {number} opts.year Expect the given year in the boilerplate
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateCopyrightDate (doc, { mode = MODES.NORMAL, year } = {}) {
  const result = []

  const yearToCheck = Number(year) || new Date().getFullYear()

  if (!doc.data.extractedElements.copyrightDates.includes(yearToCheck)) {
    result.push(new ValidationWarning(
      'COPYRIGHT_DATE_NOT_VALID',
      'The copyright date indicated is not valid in this document.',
      {
        ref: 'https://trustee.ietf.org/wp-content/uploads/IETF-TLP-4.pdf'
      }))
  }

  return result
}

/**
 * Validate if TLP-4 6.b.i copyright line is not present
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors or empty if fully valid
 */
export async function validateCopyrightSection (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (!doc.data.contains.copyrightSection6_b_i) {
    result.push(new ValidationError(
      'COPYRIGHT_LINE_MISSING',
      'Cannot find the required boilerplate sections (Copyright, IPR, etc.) in this document.',
      {
        ref: 'https://trustee.ietf.org/wp-content/uploads/IETF-TLP-4.pdf'
      }))
  }

  if (doc.data.possibleIssues.copyrightLines6_i.length > 1) {
    result.push(new ValidationWarning(
      'COPYRIGHT_LINE_MORE_THAN_ONE',
      'Copyright text meets more than one instance.',
      {
        ref: 'https://trustee.ietf.org/wp-content/uploads/IETF-TLP-4.pdf'
      }))
  }

  return result
}

/**
 * Validate document license declarations
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors or empty if fully valid
 */
export async function validateLicenseDeclarations (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (doc.data.extractedElements.license6_b_ii.length === 0 && !doc.data.contains.revisedBsdLicense6_i) {
    result.push(new ValidationError(
      'TLP4_LICENSE_NOTICE_MISSING',
      'The document does not contain a required TLP-4 license notice (6.b.i or 6.b.ii).',
      {
        ref: 'https://trustee.ietf.org/license-info'
      }
    ))
  }

  if (doc.data.slug.startsWith('draft-ietf-')) {
    if (doc.data.contains.license6_c_i) {
      result.push(new ValidationWarning(
        'TLP4_LICENSE_NOTICE',
        'The document has an IETF Trust Provisions of 28 Dec 2009, Section 6.c(i) Publication Limitation clause.',
        {
          ref: 'https://trustee.ietf.org/license-info'
        }
      ))
    }
    if (doc.data.contains.license6_c_ii) {
      result.push(new ValidationError(
        'TLP4_LICENSE_NOTICE',
        'The document has an IETF Trust Provisions, 28 Dec 2009, Section 6.c(ii) Publication Limitation clause.',
        {
          ref: 'https://trustee.ietf.org/license-info'
        }
      ))
    }
  }

  if (doc.data.extractedElements.license6_b_i.length > 1 || doc.data.extractedElements.license6_b_ii.length > 1) {
    result.push(new ValidationWarning(
      'TLP4_LICENSE_NOTICE_REPEATED',
      'The document has multiple instances of the TLP-4 license notice (6.b.i or 6.b.ii).',
      {
        ref: 'https://trustee.ietf.org/license-info'
      }
    ))
  }

  return result
}
