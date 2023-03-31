import { ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { XML_SCHEMA } from '../config/schema.mjs'
import { get, has } from 'lodash-es'
import { findAllDescendantsWith } from '../helpers/traversal.mjs'

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
