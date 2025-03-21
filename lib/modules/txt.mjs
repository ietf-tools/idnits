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
 * Validate if document starts with PK or BM
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validatePKorBM (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) return result

  if (doc.data.possibleIssues.isPKorBM) {
    result.push(new ValidationComment(
      'FIRST_LINE_STARTS_WITH_PK_OR_BM',
      'Document starts with PK or BM'))
  }

  return result
}

/**
 * Validate if Updates or Obsoletes line on first page has more than just numbers of RFCs
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateUpdatesAndObsoletesLines (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) return result

  if (doc.data.possibleIssues.updatesRfcWithLetter.length) {
    result.push(new ValidationWarning(
      'UPDATE_CONTAINS_INVALID_CHARACTERS',
      `"Updates" line contains invalid characters: ${doc.data.possibleIssues.updatesRfcWithLetter}`,
      {
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }))
  }

  if (doc.data.possibleIssues.obsoletesWithLetter.length) {
    result.push(new ValidationWarning(
      'OBSOLETES_CONTAINS_INVALID_CHARACTERS',
      `"Obsoletes" line contains invalid characters: ${doc.data.possibleIssues.obsoletesWithLetter}`,
      {
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }))
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
  const MAX_DOCUMENT_LINE_WITH_SPACES = 50

  if (doc.data.possibleIssues.linesWithSpaces.length > MAX_DOCUMENT_LINE_WITH_SPACES) {
    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('RAGGED_RIGHT', 'The document does not appear to be ragged-right (more than 50 lines of intra-line extra spacing).', {
        lines: doc.data.possibleIssues.linesWithSpaces.map((obj) => obj),
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }))
    } else if (mode === MODES.FORGIVE_CHECKLIST) {
      result.push(new ValidationWarning('RAGGED_RIGHT', 'The document does not appear to be ragged-right (more than 50 lines of intra-line extra spacing).', {
        lines: doc.data.possibleIssues.linesWithSpaces.map((obj) => obj),
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }))
    }
  }

  return result
}

/**
 * Validate if all detected code blocks contain a license declaration
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateCodeBlockLicenses (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) return result

  if (doc.data.contains.codeBlocks && !doc.data.contains.revisedBsdLicense) {
    result.push(new ValidationWarning(
      'CODE_BLOCK_MISSING_LICENSE',
      'A code-block is detected, but the document does not contain a license declaration.',
      {
        ref: 'https://trustee.ietf.org/license-info'
      }
    ))
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
export async function validateHyphenatedLineBreaks (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) return result

  if (doc.data.possibleIssues.hyphenatedLines.length) {
    result.push(new ValidationWarning(
      'HYPHENATED_LINE_BREAKS',
      'Document has hyphenated line-breaks.',
      {
        lines: doc.data.possibleIssues.hyphenatedLines.map((obj) => obj),
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }
    ))
  }

  return result
}

/**
 * Validate document reference type
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
          `The document text uses a numeric reference, but contains ${ref}`,
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
          `The document text uses string references, but contains ${ref}`,
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        ))
      })
    }
  }

  return result
}

/**
 * Validate if document has reference appears but does not occur in any reference section
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateLinksInText (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  const uniqueReferences = new Set([...doc.data.extractedElements.bracketedRfcReferences, ...doc.data.extractedElements.referenceSectionRfc.map(item => `[RFC${item.value}]`), ...doc.data.extractedElements.referenceSectionDraftReferences.map(item => item.value)])
  const valueNonReferencesSection = [...new Set([...doc.data.extractedElements.nonReferenceSectionDraftReferences, ...doc.data.extractedElements.bracketedRfcNonReferences])]

  valueNonReferencesSection.forEach((ref) => {
    if (!uniqueReferences.has(ref)) {
      result.push(new ValidationWarning(
        'REFERENCE_MISSING_IN_REFERENCE_SECTION',
        `Document has ${ref} but does not occur in any reference section.`,
        {
          ref: 'https://authors.ietf.org/en/required-content#references'
        }))
    }
  })

  return result
}

/**
 * Validate if Abstract section is numbered
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateAbstractSectionIsNumbered (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (doc.data.possibleIssues.isAbstractNumbered) {
    result.push(new ValidationError(
      'ABSTRACT_SECTION_IS_NUMBERED',
      'Abstract section should not be numbered',
      {
        ref: 'https://www.rfc-editor.org/old/policy.html'
      }
    ))
  }

  return result
}

/**
 * Validate if Status of this memo section is numbered
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateStatusOfThisMemoSectionIsNumbered (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (doc.data.possibleIssues.isStatusOfThisMemoNumbered) {
    result.push(new ValidationError(
      'STATUS_OF_THIS_MEMO_SECTION_IS_NUMBERED',
      'Status of this memo section should not be numbered',
      {
        ref: 'https://www.rfc-editor.org/old/policy.html'
      }
    ))
  }

  return result
}

/**
 * Validate if Copyright notice section is numbered
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateCopyrightNoticeSectionIsNumbered (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (doc.data.possibleIssues.isCopyrightNoticeNumbered) {
    result.push(new ValidationError(
      'COPYRIGHT_NOTICE_SECTION_IS_NUMBERED',
      'Copyright Notice section should not be numbered',
      {
        ref: 'https://www.rfc-editor.org/old/copyright.17Feb04.html'
      }
    ))
  }

  return result
}

/**
 * Validate document name
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateDocumentName (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (!doc.data.slug) {
    result.push(new ValidationError(
      'DOCUMENT_NAME_MISSING',
      'Document name missing or invalid.',
      {
        ref: 'https://ietf.github.io/id-guidelines/'
      }))
  }

  return result
}
