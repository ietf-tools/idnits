/* eslint-disable no-control-regex */

import { detect } from 'jschardet'
import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'

const INVALID_CTRL_CHARS_RE = /[\x01-\x08\x0b\x0e-\x1f]+/g
const INVALID_TAB_CHAR_RE = /\t/g

/**
 * Validate string data for invalid ctrl code / chars sequences
 *
 * @param {string} data String data to check
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateContent (data, { mode = MODES.NORMAL } = {}) {
  const result = []

  const invalidTabCharLines = []
  const invalidCtrlCharLines = []
  let lineIdx = 1
  for (const line of data.split('\n')) {
    // Check for tabs
    for (const tabMatch of line.matchAll(INVALID_TAB_CHAR_RE)) {
      invalidTabCharLines.push({
        line: lineIdx,
        pos: tabMatch.index
      })
    }

    // Check for invalid control characters
    for (const ctrlMatch of line.matchAll(INVALID_CTRL_CHARS_RE)) {
      invalidCtrlCharLines.push({
        line: lineIdx,
        pos: ctrlMatch.index
      })
    }

    lineIdx++
  }

  if (invalidTabCharLines.length > 0) {
    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('TABS_NOT_ALLOWED', invalidTabCharLines.length > 1 ? `Document contains ${invalidTabCharLines.length} tabs. Remove or replace them with spaces.` : 'Document contains a tab. Remove or replace it with a space.'))
    } else if (mode === MODES.FORGIVE_CHECKLIST) {
      result.push(new ValidationWarning('TABS_NOT_ALLOWED', invalidTabCharLines.length > 1 ? `Document contains ${invalidTabCharLines.length} tabs. Remove or replace them with spaces.` : 'Document contains a tab. Remove or replace it with a space.'))
    }
  }

  if (invalidCtrlCharLines.length > 0) {
    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('INVALID_CTRL_CODES', invalidCtrlCharLines.length > 1 ? `Document contains ${invalidCtrlCharLines.length} control characters other than LF, CR or FF.` : 'Document contains a control character other than LF, CR or FF.'))
    } else if (mode === MODES.FORGIVE_CHECKLIST) {
      result.push(new ValidationWarning('INVALID_CTRL_CODES', invalidCtrlCharLines.length > 1 ? `Document contains ${invalidCtrlCharLines.length} control characters other than LF, CR or FF.` : 'Document contains a control character other than LF, CR or FF.'))
    }
  }

  return result
}

/**
 * Validate if a buffer is of encoding UTF-8
 *
 * @param {Buffer|ArrayBuffer|string} raw Buffer to check for UTF8 encoding
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateEncoding (raw, { mode = MODES.NORMAL } = {}) {
  const result = []

  const detected = detect(raw)
  if (detected.encoding === 'ascii') {
    // valid
  } else if (detected.encoding === 'UTF-8') {
    if ([MODES.NORMAL, MODES.FORGIVE_CHECKLIST].includes(mode)) {
      result.push(new ValidationComment('NON_ASCII_UTF8', 'Review RFC7997 to ensure your document respects UTF-8 rules for non-ASCII.', { ref: 'https://datatracker.ietf.org/doc/html/rfc7997#section-3' }))
    }
  } else {
    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('INVALID_ENCODING', `Document should be encoded using UTF-8, but detected ${detected.encoding}.`, { ref: 'https://datatracker.ietf.org/doc/html/rfc7997' }))
    } else if (mode === MODES.FORGIVE_CHECKLIST) {
      result.push(new ValidationWarning('INVALID_ENCODING', `Document should be encoded using UTF-8, but detected ${detected.encoding}.`, { ref: 'https://datatracker.ietf.org/doc/html/rfc7997' }))
    }
  }

  return result
}

/**
 * Decode a buffer to an UTF8 string
 *
 * @param {Buffer|ArrayBuffer} raw Buffer to decode
 * @returns {string} Decoded string
 */
export async function decodeBufferToUTF8 (raw) {
  const decoder = new TextDecoder()
  return decoder.decode(raw)
}
