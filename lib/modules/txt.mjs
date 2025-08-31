import { ValidationError, ValidationWarning, ValidationComment } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { PAGE_THRESHOLD_REQUIRING_TOC } from '../config/consts.mjs'

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
  let numberOfOverLongLine = 0
  const LONGEST = 72
  const lines = doc.body.split('\n')
  // eslint-disable-next-line no-control-regex
  const nonAsciiRe = /[^\x01-\x7f]/
  const overLongLines = []
  for (const line of lines) {
    const lengthTrimmed = line.trim().length
    if (lengthTrimmed > LONGEST && !nonAsciiRe.test(line)) {
      overLongLines.push({ line: idx, pos: line.length })
      numberOfOverLongLine++
    }
    idx++
  }

  if (overLongLines.length > 0) {
    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('LINE_TOO_LONG', `The document contains ${numberOfOverLongLine} over-long line${overLongLines.length === 1 ? '' : 's'} of more than ${LONGEST} characters.`, {
        lines: overLongLines,
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }))
    } else {
      result.push(new ValidationWarning('LINE_TOO_LONG', `The document contains ${numberOfOverLongLine} over-long line${overLongLines.length === 1 ? '' : 's'} of more than ${LONGEST} characters.`, {
        lines: overLongLines,
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
 * @returns {Array} List of errors/warnings or empty if fully valid
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
 * Acceptable paragraph calling out 6 month validity
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings or empty if fully valid
 */
export async function validateAcceptableParagraphCallingOutSixMonthValidity (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (!doc.data.contains.draftParagraphOutSixMonthValidity) {
    result.push(new ValidationError(
      'ACCEPTABLE_PARAGRAPH_PROVIDING_FOR_PERIOD_OF_VALIDITY_MISSING',
      'Document does not contain acceptable paragraph providing for a period of validity.',
      {
        ref: 'https://authors.ietf.org/required-content'
      }
    ))
  }

  return result
}

/**
 * Validate if TLP-5 6.b.i copyright line is not present
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
        ref: 'https://trustee.ietf.org/wp-content/uploads/Corrected-TLP-5.0-legal-provsions.pdf'
      }
    ))
  }

  if (doc.data.possibleIssues.copyrightLines6_i.length > 1) {
    result.push(new ValidationWarning(
      'COPYRIGHT_MORE_THAN_ONE_LINE',
      'More than one copyright line is present.',
      {
        ref: 'https://trustee.ietf.org/wp-content/uploads/Corrected-TLP-5.0-legal-provsions.pdf'
      }))
  }

  return result
}

/**
 * Validate separated formfeeds
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateSeparatedFormfeeds (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) return result

  if (doc.data.pageCount !== doc.data.contains.pagesFound) {
    result.push(new ValidationWarning(
      'PAGES_NOT_SEPARATED_BY_FORMFEEDS',
      'Pages are not separated by formfeeds.',
      {
        ref: 'https://datatracker.ietf.org/doc/rfc7994/'
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
      'COPYRIGHT_YEAR_MISMATCH',
      'The copyright year in the IETF Trust and authors Copyright Line does not match the current year',
      {
        ref: 'https://trustee.ietf.org/wp-content/uploads/Corrected-TLP-5.0-legal-provsions.pdf'
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
      'TLP5_LICENSE_RESTRICTION_NOTICE_MISSING',
      'The document does not contain a required TLP-5 license notice (6.b.i or 6.b.ii).',
      {
        ref: 'https://trustee.ietf.org/license-info'
      }
    ))
  }

  if (doc.data.slug?.startsWith('draft-ietf-')) {
    if (doc.data.contains.license6_c_i) {
      result.push(new ValidationWarning(
        'TLP5_LICENSE_RESTRICTION_NOTICE',
        'The document has an IETF Trust Provisions of 28 Dec 2009, Section 6.c(i) Publication Limitation clause.',
        {
          ref: 'https://trustee.ietf.org/license-info'
        }
      ))
    }
    if (doc.data.contains.license6_c_ii) {
      result.push(new ValidationError(
        'TLP5_LICENSE_RESTRICTION_NOTICE',
        'The document has an IETF Trust Provisions, 28 Dec 2009, Section 6.c(ii) Publication Limitation clause.',
        {
          ref: 'https://trustee.ietf.org/license-info'
        }
      ))
    }
  }

  if (doc.data.extractedElements.license6_b_i.length > 1 || doc.data.extractedElements.license6_b_ii.length > 1) {
    result.push(new ValidationWarning(
      'TLP5_LICENSE_RESTRICTION_NOTICE_REPEATED',
      'The document has multiple instances of the TLP-5 license notice (6.b.i or 6.b.ii).',
      {
        ref: 'https://trustee.ietf.org/license-info'
      }
    ))
  }

  return result
}

/**
 * Validate page length in the document
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validatePages (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) return result

  const overLongPages = doc.data.possibleIssues.tooLongPages

  if (overLongPages.length) {
    result.push(...overLongPages.map((page) => new ValidationWarning(
      'PAGE_TOO_LONG',
      `Page ${page.page} is too long (${page.lines} lines).`,
      {
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }
    )))
  }

  return result
}

/**
 * Validate internet draft indication in the document
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateIDIndicator (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (!doc.data.contains.idIndication) {
    result.push(new ValidationError(
      'ID_INDICATOR_MISSING',
      'Document does not contain an ID indication.',
      {
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }
    ))
  }

  return result
}

/**
 * Validate expires line in the document
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings or empty if fully valid
 */
export async function validateExpiresLine (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (!doc.data.header.expires || !doc.data.extractedElements.lastPageExpiration) {
    result.push(new ValidationError(
      'EXPIRES_LINE_MISSING',
      'Document does not have expiration date on first and last page or it is invalid.',
      {
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }
    ))
  } else if (doc.data.header.expires.toMillis() !== doc.data.extractedElements.lastPageExpiration.toMillis()) {
    result.push(new ValidationError(
      'EXPIRES_LINE_MISMATCH',
      'Document has different expiration date on first and last page.',
      {
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }
    ))
  }
  return result
}

/**
 * Validate acceptable paragraph noting that the document is a draft
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings or empty if fully valid
 */
export async function validateSaysWorkingDocuments (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (!doc.data.contains.acceptableParagraphNotingThatDraft) {
    result.push(new ValidationError(
      'ACCEPTABLE_PARAGRAPH_NOTING_THAT_DRAFT_MISSING',
      'Document does not contain acceptable paragraph or it is invalid.',
      {
        ref: 'https://authors.ietf.org/required-content'
      }
    ))
  }

  return result
}

/**
 * Validate if the document name (slug) is present on the first page
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
      'Document\'s name not found on the first page',
      {
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext'
      }))
  }

  return result
}

/**
 * Validate acceptable paragraph pointing the list of current I-Ds
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings or empty if fully valid
 */
export async function validateParagraphLinkingToIdsList (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (!doc.data.possibleIssues.paragraphPointingToTheListOfCurrentId.length) {
    result.push(new ValidationError(
      'ACCEPTABLE_PARAGRAPH_POINTING_LIST_ID_MISSING',
      'Document does not contain acceptable paragraph pointing to the list of current I-Ds',
      {
        ref: 'https://authors.ietf.org/required-content'
      }
    ))
  }

  return result
}

/**
 * Document has multiple occurrences of current id text
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings or empty if fully valid
 */
export async function validateMultipleAcceptableParagraphPointingListId (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (doc.data.possibleIssues.paragraphPointingToTheListOfCurrentId.length > 1) {
    result.push(new ValidationError(
      'ACCEPTABLE_PARAGRAPH_POINTING_LIST_ID_REPEATED_IN_THE_TEXT',
      'The document has multiple occurrences acceptable paragraph pointing to the list of current id.'
    ))
  }

  return result
}

/**
 * Validate if document meets specific structural requirements
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings or empty if fully valid
 */
export async function validateTableOfContentsAndDocumentPages (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  const lacksTableOfContents = !doc.data.possibleIssues.isTableOfContentsExists
  const isTooLong = doc.data.pageCount - 1 >= PAGE_THRESHOLD_REQUIRING_TOC

  if (lacksTableOfContents && isTooLong) {
    if (mode === MODES.SUBMISSION) {
      result.push(new ValidationWarning(
        `DOCUMENT_HAVE_MORE_${PAGE_THRESHOLD_REQUIRING_TOC}_PAGES_OR_MISS_TABLE_OF_CONTENTS`,
        `The document is more than ${PAGE_THRESHOLD_REQUIRING_TOC} pages and seems to lack a Table of Contents.`,
        {
          ref: 'https://datatracker.ietf.org/doc/html/rfc7322'
        }
      ))
    } else {
      result.push(new ValidationError(
        `DOCUMENT_HAVE_MORE_${PAGE_THRESHOLD_REQUIRING_TOC}_PAGES_OR_MISS_TABLE_OF_CONTENTS`,
        `The document is more than ${PAGE_THRESHOLD_REQUIRING_TOC} pages and seems to lack a Table of Contents.`,
        {
          ref: 'https://datatracker.ietf.org/doc/html/rfc7322'
        }
      ))
    }
  }

  return result
}

/**
 * Validate submission compliance line
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateSubmissionComplianceLine (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (!doc.data.contains.submissionCompliance) {
    result.push(new ValidationError(
      'SUBMISSION_COMPLIANCE_LINE_MISSING',
      'Missing notice of Compliance with BCP 78 and BCP 79 according to IETF Trust Provisions of 28 Dec 2009, Section 6.a or Provisions of 12 Sep 2009, Section 6.a',
      {
        ref: 'https://trustee.ietf.org/wp-content/uploads/Corrected-TLP-5.0-legal-provsions.pdf'
      }
    ))
  }

  return result
}

/**
 * Validate submission compliance line page
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateSubmissionComplianceLinePage (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (!doc.data.possibleIssues.submissionCompliancePage || doc.data.possibleIssues.submissionCompliancePage > 3) {
    result.push(new ValidationError(
      'SUBMISSION_COMPLIANCE_LINE_NOT_EARLY_IN_DOC',
      'Notice of conformance to BCP 78 and BCP 79 in accordance with IETF Trust Statements, December 28, 2009, Section 6.a or Trust Statements, September 12, 2009, Section 6.a does not appear early in the document',
      {
        ref: 'https://trustee.ietf.org/wp-content/uploads/Corrected-TLP-5.0-legal-provsions.pdf'
      }
    ))
  }

  return result
}

/**
 * Validate if document have Formfeed on separate line
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateFormFeedOnSeparateLine (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (doc.data.possibleIssues.pageLineWithFormFeed.length) {
    result.push(...doc.data.possibleIssues.pageLineWithFormFeed.map((page) => new ValidationComment(
      'DOCUMENT_CONTAINS_FORM_FEED_NOT_ON_SEPARATE_LINE',
      `Page ${page.page} have formfeeds and [Page N] on line (${page.lines}).`,
      {
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }
    )))
  }

  return result
}

/**
 * Validate if title has unexpected indentation
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateTitleUnexpectedIndentation (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) return result

  if (doc.data.possibleIssues.unexpectedIndentation.length) {
    doc.data.possibleIssues.unexpectedIndentation.forEach(({ name, line, pos }) => {
      result.push(new ValidationWarning(
        'SECTION_TITLE_HAS_UNEXPECTED_INDENTATION',
        `Document has unexpected indentation in ${name}.`,
        {
          lines: [{ line, pos }],
          ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
        }))
    })
  }
  return result
}

/**
 * Validate previous copyright section
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validatePreviousCopyrightSection (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (doc.data.contains.previous6_b_i_copyright && !doc.data.contains.copyrightSection6_b_i) {
    result.push(new ValidationError(
      'OBSELETE_COPYRIGHT_LINE',
      'This document contains an obsolete 6.b.i copyright line.',
      {
        ref: 'https://trustee.ietf.org/wp-content/uploads/Corrected-TLP-5.0-legal-provsions.pdf'
      }))
  }

  return result
}

/**
 * Validate if document missing page numbering
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validatePageNumbering (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (doc.data.possibleIssues.missingPageNumbering.length) {
    result.push(...doc.data.possibleIssues.missingPageNumbering.map((page) => new ValidationComment(
      'DOCUMENT_NOT_CONTAINS_PAGE_NUMBERING',
      `Page ${page.page} don't have numbering`,
      {
        ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
      }
    )))
  }

  return result
}
