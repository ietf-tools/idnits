import { ValidationWarning } from '../helpers/error.mjs'
import { traverseAllValues } from '../helpers/traversal.mjs'
import { MODES } from '../config/modes.mjs'
import { difference, get } from 'lodash-es'
import { DateTime } from 'luxon'

const OBSOLETES_RE = /(?:obsoletes|replaces) ((?:\[?rfcs? ?)?[0-9]+\]?(?:, | and )?)+/gi
const UPDATES_RE = /updates ((?:\[?rfcs? ?)?[0-9]+\]?(?:, | and )?)+/gi
const RFC_NUM_RE = /[0-9]+/g

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

/**
 * Validate that the document updates / obsoletes another document correctly
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateObsoleteUpdateRef (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  switch (doc.type) {
    case 'txt': {
      // TODO: Text type validation
      break
    }
    case 'xml': {
      const obsoletesRef = get(doc, 'data.rfc._attr.obsoletes', '').split(',').map(r => r.trim()).filter(r => r)
      const updatesRef = get(doc, 'data.rfc._attr.updates', '').split(',').map(r => r.trim()).filter(r => r)

      const obsoletesAbs = []
      await traverseAllValues(get(doc, 'data.rfc.front.abstract', {}), (val, key) => {
        const matches = val.replaceAll('\n', ' ').matchAll(OBSOLETES_RE)
        for (const match of matches) {
          const numMatches = match[0].matchAll(RFC_NUM_RE)
          for (const numMatch of numMatches) {
            obsoletesAbs.push(numMatch[0])
          }
        }
      })

      const updatesAbs = []
      await traverseAllValues(get(doc, 'data.rfc.front.abstract', {}), (val, key) => {
        const matches = val.replaceAll('\n', ' ').matchAll(UPDATES_RE)
        for (const match of matches) {
          const numMatches = match[0].matchAll(RFC_NUM_RE)
          for (const numMatch of numMatches) {
            updatesAbs.push(numMatch[0])
          }
        }
      })

      // -> Obsoletes in <rfc> but no in <abstract>
      const obsoletesNotInAbs = difference(obsoletesRef, obsoletesAbs)
      if (obsoletesNotInAbs.length > 0) {
        for (const ref of obsoletesNotInAbs) {
          result.push(new ValidationWarning('OBSOLETES_NOT_IN_ABSTRACT', `The document states that it obsoletes RFC ${ref} but doesn't explicitely mention it in the <abstract> section.`, {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'rfc.front.abstract'
          }))
        }
      }

      // -> Obsoletes in <abstract> but no in <rfc>
      const obsoletesNotInRef = difference(obsoletesAbs, obsoletesRef)
      if (obsoletesNotInRef.length > 0) {
        for (const ref of obsoletesNotInRef) {
          result.push(new ValidationWarning('OBSOLETES_NOT_IN_RFC', `The document abstract states that it obsoletes RFC ${ref} but it's not mentionned in the obsoletes <rfc> field.`, {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'rfc.front.abstract'
          }))
        }
      }

      // -> Updates in <rfc> but no in <abstract>
      const updatesNotInAbs = difference(updatesRef, updatesAbs)
      if (updatesNotInAbs.length > 0) {
        for (const ref of updatesNotInAbs) {
          result.push(new ValidationWarning('UPDATES_NOT_IN_ABSTRACT', `The document states that it updates RFC ${ref} but doesn't explicitely mention it in the <abstract> section.`, {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'rfc.front.abstract'
          }))
        }
      }

      // -> Updates in <abstract> but no in <rfc>
      const updatesNotInRef = difference(updatesAbs, updatesRef)
      if (updatesNotInRef.length > 0) {
        for (const ref of updatesNotInRef) {
          result.push(new ValidationWarning('UPDATES_NOT_IN_RFC', `The document abstract states that it updates RFC ${ref} but it's not mentionned in the updates <rfc> field.`, {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'rfc.front.abstract'
          }))
        }
      }
      break
    }
  }

  return result
}
