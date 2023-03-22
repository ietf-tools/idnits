/* eslint-disable no-control-regex */

import { ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'

const invalidControlCodesRgx = /[\x01-\x09\x0b\x0e-\x1f]+/g

/**
 * Validate raw data for invalid ctrl code / chars sequences
 *
 * @param {string} data Raw string data to check
 * @returns List of errors/warnings/comments or empty if fully valid
 */
export function validateRawContent (data, { mode = MODES.NORMAL } = {}) {
  const result = []

  const invalidCtrlCharLines = []
  let lineIdx = 1
  for (const line of data.split('\n')) {
    // Check for invalid control characters
    for (const ctrlMatch of line.matchAll(invalidControlCodesRgx)) {
      invalidCtrlCharLines.push({
        line: lineIdx,
        pos: ctrlMatch.index
      })
    }

    // TODO: Check for byte sequences that are not valid UTF-8

    // TODO: Check for non-ascii UTF-8

    lineIdx++
  }

  if (invalidCtrlCharLines.length > 0) {
    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('INVALID_CTRL_CODES', 'Input contains control characters other than LF, CR or FF.', { lines: invalidCtrlCharLines }))
    } else if (mode === MODES.FORGIVE_CHECKLIST) {
      result.push(new ValidationWarning('INVALID_CTRL_CODES', 'Input contains control characters other than LF, CR or FF.', { lines: invalidCtrlCharLines }))
    }
  }

  return result
}
