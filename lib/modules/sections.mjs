import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { has, isPlainObject } from 'lodash-es'

/**
 * Validate a document abstract section
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export function validateAbstractSection (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  switch (doc.type) {
    case 'txt': {
      // TODO: Text type validation
      break
    }
    case 'xml': {
      if (!has(doc, 'data.rfc.front.abstract')) {
        result.push(new ValidationError('MISSING_ABSTRACT_SECTION', 'The abstract section is missing.', { ref: 'https://authors.ietf.org/required-content#abstract' }))
      } else if (!isPlainObject(doc.data.rfc.front.abstract) || Object.keys(doc.data.rfc.front.abstract).length < 1) {
        result.push(new ValidationError('INVALID_ABSTRACT_SECTION', 'The abstract section must consist of at least 1 <dl>, <ol>, <t> or <ul> element.', { ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.1' }))
      } else {
        for (const key of Object.keys(doc.data.rfc.front.abstract)) {
          if (!['dl', 'ol', 't', 'ul'].includes(key)) {
            result.push(new ValidationError('INVALID_ABSTRACT_SECTION_CHILD', 'The abstract section must consist of <dl>, <ol>, <t> or <ul> elements only.', { ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.1' }))
            break
          }
        }
      }
      break
    }
  }

  return result
}
