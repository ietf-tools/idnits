import { ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { XML_SCHEMA } from '../config/schema.mjs'
import { get, has, last } from 'lodash-es'
import { findAllDescendantsWith, traverseAll } from '../helpers/traversal.mjs'
import { fetchRemoteDocInfo } from '../helpers/remote.mjs'

const TEXT_REFS_RE = /\[(?:RFC)?[0-9]+\]/gi

/**
 * Ensure that the document doesn't contain deprecated elements
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function detectDeprecatedElements (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const deprecatedElements = Object.keys(XML_SCHEMA._deprecated)

  const entriesFound = findAllDescendantsWith(doc.data.rfc, (v, k) => { return deprecatedElements.includes(k) })

  if (entriesFound.length > 0) {
    for (const entry of entriesFound) {
      const schemaElement = XML_SCHEMA._deprecated[entry.key]
      result.push(new ValidationWarning('DEPRECATED_ELEMENT', `The <${entry.key}> element is deprecated. ${schemaElement.suggestion}`, {
        ref: schemaElement.ref,
        path: `rfc.${entry.path.join('.')}`
      }))
    }
  }

  return result
}

/**
 * Validate a document introduction section
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateIprAttribute (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const allowedValues = [
    'trust200902',
    'pre5378Trust200902',
    'noModificationTrust200902',
    'noDerivativesTrust200902'
  ]

  if (!has(doc, 'data.rfc._attr.ipr')) {
    result.push(new ValidationError('MISSING_IPR_ATTRIBUTE', 'The ipr attribute is missing from the <rfc> element.', { ref: 'https://authors.ietf.org/en/required-content#copyright-notice' }))
  } else if (!allowedValues.includes(doc.data.rfc._attr.ipr)) {
    result.push(new ValidationWarning('INVALID_IPR_VALUE', 'The ipr attribute should be one of "trust200902", "noModificationTrust200902", "noDerivativesTrust200902", or "pre5378Trust200902".', { ref: 'https://authors.ietf.org/en/required-content#copyright-notice' }))
  } else if (get(doc, 'data.rfc._attr.submissionType') && ['noDerivativesTrust200902', 'noModificationTrust200902'].includes(doc.data.rfc._attr.ipr)) {
    result.push(new ValidationError('FORBIDDEN_IPR_VALUE_FOR_STREAM', 'The ipr attribute cannot be "noDerivativesTrust200902" or "noModificationTrust200902" when document is a stream.', { ref: 'https://authors.ietf.org/en/required-content#copyright-notice' }))
  }

  return result
}

/**
 * Validate a document code blocks
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateCodeBlocks (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  await traverseAll(doc.data, (v, k, p) => {
    if (typeof v === 'string' && v.toLowerCase().includes('<code begins>')) {
      if (k === 'sourcecode') {
        result.push(new ValidationWarning('UNNECESSARY_CODE_BEGINS', 'The text inside a <sourcecode> tag contains the string <CODE BEGINS>. This is unnecessary and may duplicate what a presentation format converter will produce.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#sourcecode',
          path: `rfc.${[...p, k].join('.')}`
        }))
      } else {
        result.push(new ValidationWarning('MISSING_SOURCECODE_TAG', 'Consider using the <sourcecode> tag instead of <CODE BEGINS> for code blocks.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#sourcecode',
          path: `rfc.${[...p, k].join('.')}`
        }))
      }
    }
  })

  return result
}

/**
 * Validate a document for text-like refs
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateTextLikeRefs (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  await traverseAll(doc.data, (v, k, p) => {
    if (typeof v === 'string' && v.match(TEXT_REFS_RE)) {
      result.push(new ValidationWarning('TEXT_DOC_REF', 'Text occurs that looks like a text-document reference (e.g. [1] or [RFC...]). A reference should instead use an <eref> tag.', {
        ref: 'https://authors.ietf.org/en/references-in-rfcxml',
        path: `rfc.${[...p, k].join('.')}`
      }))
    }
  })

  return result
}

/**
 * Validate a document submission type
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateSubmissionType (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []

  const submissionType = get(doc, 'data.rfc._attr.submissionType').toLowerCase()
  const filenameStream = doc.filename?.split('.')[0]?.split('-')?.[1]
  const docName = get(doc, 'data.rfc._attr.docName')

  // -> Check submissionType value
  if (submissionType && !['ietf', 'iab', 'irtf', 'independent', 'editorial'].includes(submissionType)) {
    result.push(new ValidationError('SUBMISSION_TYPE_INVALID', 'The document stream specified in the rfc tag is invalid. Should be either IETF, IAB, IRTF, independent or editorial.', {
      ref: 'https://www.rfc-editor.org/rfc/rfc7841.html',
      path: 'rfc.submissionType'
    }))
  // -> Check filename stream === submissionType (if not independent / editorial)
  } else if (['iab', 'irtf'].includes(filenameStream) && submissionType !== filenameStream) {
    result.push(new ValidationError('SUBMISSION_TYPE_MISMATCH', 'The document stream specified in the rfc tag doesn\'t match the stream from the filename.', {
      ref: 'https://www.rfc-editor.org/rfc/rfc7841.html',
      path: 'rfc.submissionType'
    }))
  // -> Check for existing doc stream mismatch
  } else if (!offline && docName) {
    const docInfo = await fetchRemoteDocInfo(docName)

    // -> Existing version on Datatracker
    if (docInfo) {
      const existingStream = docInfo.stream && last(docInfo.stream.split('/').filter(p => p))
      // -> Existing has no stream but doc specifies one
      if (!existingStream && ['ietf', 'iab', 'irtf'].includes(submissionType)) {
        result.push(new ValidationError('SUBMISSION_TYPE_UNEXPECTED', 'A document stream is specified in the rfc tag but the existing version has no stream on Datatracker. Is this intentional?', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7841.html',
          path: 'rfc.submissionType'
        }))
      // -> Existing stream doesn't match submission type
      } else if (existingStream && ['ietf', 'iab', 'irtf'].includes(submissionType) && submissionType !== existingStream) {
        result.push(new ValidationError('SUBMISSION_TYPE_UNEXPECTED', 'The document stream specified in the rfc tag does not match the existing version on Datatracker.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7841.html',
          path: 'rfc.submissionType'
        }))
      }
    }
  }

  return result
}
