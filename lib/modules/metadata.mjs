import { ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { get } from 'lodash-es'
import { DateTime } from 'luxon'

const today = DateTime.now()

/**
 * Validate document date
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateDate (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  switch (doc.type) {
    case 'txt': {
      // TODO: Text type validation
      break
    }
    case 'xml': {
      const docDate = get(doc, 'data.rfc.front.date._attr')
      if (!docDate) {
        result.push(new ValidationWarning('MISSING_DOC_DATE', 'The document date could not be determined.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date'
        }))
      } else {
        const dt = DateTime.fromObject({
          year: docDate.year || today.year,
          month: docDate.month ? DateTime.fromFormat(docDate.month, 'MMMM').month : today.month,
          day: docDate.day || today.day
        })
        const daysDiff = Math.round(dt.diffNow().as('days'))
        if (daysDiff < -3) {
          result.push(new ValidationWarning('DOC_DATE_IN_PAST', `The document date is ${daysDiff * -1} days in the past. Is this intentional?`, {
            ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date',
            path: 'rfc.front.date'
          }))
        } else if (daysDiff > 3) {
          result.push(new ValidationWarning('DOC_DATE_IN_FUTURE', `The document date is ${daysDiff} days in the future. Is this intentional?`, {
            ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date',
            path: 'rfc.front.date'
          }))
        }
      }
      break
    }
  }

  return result
}
