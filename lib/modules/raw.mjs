/* eslint-disable no-control-regex */

import { detect } from 'jschardet'
import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { describeCharacter, getCharacterName, toUplus } from '../helpers/unicode.mjs'

const INVALID_CTRL_CHARS_RE = /[\x01-\x08\x0b\x0e-\x1f]+/g
const INVALID_TAB_CHAR_RE = /\t/g
const NON_ASCII_RE = /[^\x00-\x7f]/u
const NON_ASCII_CHARS_RE = /[^\x00-\x7f]/gu
// -> Characters that don't display: bidi controls, zero width space, word joiner and byte order mark
const NON_DISPLAYABLE_CHARS_RE = /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu
const NON_DISPLAYABLE_CHAR_RE = new RegExp(NON_DISPLAYABLE_CHARS_RE.source, 'u')
// -> In XML, zero width space (&zwsp;) and word joiner (&wj;) are xml2rfc's line-break hints: its text
//    renderer breaks lines at the first and not around the second (utils.TextWrapper), then removes both
//    from the text output (TextWriter.process() in writers/text.py)
const XML_LINE_BREAK_HINTS = ['\u200b', '\u2060']
const RFC7997BIS_REF = 'https://datatracker.ietf.org/doc/draft-rswg-rfc7997bis/'

/**
 * Validate string data for invalid ctrl code / chars sequences and non-ASCII characters
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

  result.push(...validateCharacters(data))

  return result
}

/**
 * Validate the non-ASCII characters of a document against draft-rswg-rfc7997bis.
 * These checks apply in every mode.
 *
 * @param {string} data Decoded document contents
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
function validateCharacters (data) {
  const result = []

  if (!NON_ASCII_RE.test(data)) {
    return result
  }

  // -> Only the decoded text is passed in, not the document type: an XML document starts
  //    with an XML declaration, a DOCTYPE or comment, or the <rfc> element
  const isXml = /^\ufeff?\s*<(?:\?xml|!|rfc[\s>])/u.test(data)

  const nonDisplayable = new Map()
  const nonAscii = new Map()
  const nonNfcLines = []
  let lineIdx = 1
  for (const line of data.split('\n')) {
    // Check for characters that don't display
    for (const match of line.matchAll(NON_DISPLAYABLE_CHARS_RE)) {
      // -> A byte order mark is allowed at the very start of the file
      if (lineIdx === 1 && match.index === 0 && match[0] === '\ufeff') {
        continue
      }
      if (isXml && XML_LINE_BREAK_HINTS.includes(match[0])) {
        continue
      }
      const codePoint = match[0].codePointAt(0)
      if (!nonDisplayable.has(codePoint)) {
        nonDisplayable.set(codePoint, [])
      }
      nonDisplayable.get(codePoint).push({ line: lineIdx, pos: match.index })
    }

    // Count the other non-ASCII characters
    for (const match of line.matchAll(NON_ASCII_CHARS_RE)) {
      if (!NON_DISPLAYABLE_CHAR_RE.test(match[0])) {
        const codePoint = match[0].codePointAt(0)
        nonAscii.set(codePoint, (nonAscii.get(codePoint) ?? 0) + 1)
      }
    }

    // Check for text not in NFC, located where it first differs from its NFC form
    if (NON_ASCII_RE.test(line)) {
      const normalized = line.normalize('NFC')
      if (normalized !== line) {
        let pos = 0
        while (line[pos] === normalized[pos]) {
          pos++
        }
        nonNfcLines.push({ line: lineIdx, pos })
      }
    }

    lineIdx++
  }

  for (const [codePoint, lines] of nonDisplayable) {
    const char = `${getCharacterName(codePoint)} (${toUplus(codePoint)})`
    result.push(new ValidationWarning('NON_DISPLAYABLE_CHARACTER', lines.length > 1 ? `Document contains ${lines.length} ${char} characters, which don't display. Remove them or describe them using U+ notation.` : `Document contains a ${char} character, which doesn't display. Remove it or describe it using U+ notation.`, {
      ref: `${RFC7997BIS_REF}#section-3`,
      lines
    }))
  }

  if (nonNfcLines.length > 0) {
    const first = nonNfcLines[0]
    result.push(new ValidationComment('NON_NFC_TEXT', nonNfcLines.length > 1 ? `Text on ${nonNfcLines.length} lines is not in Unicode Normalization Form C (NFC), first on line ${first.line}. Use NFC, or add a note explaining why it is not used.` : `Text on line ${first.line} is not in Unicode Normalization Form C (NFC). Use NFC, or add a note explaining why it is not used.`, {
      ref: `${RFC7997BIS_REF}#section-3`,
      lines: [first]
    }))
  }

  if (nonAscii.size > 0) {
    const chars = [...nonAscii].sort(([a], [b]) => a - b).map(([codePoint, count]) => `${describeCharacter(codePoint)} x${count}`)
    result.push(new ValidationComment('NON_ASCII_CHARACTERS', `Document contains non-ASCII characters: ${chars.join(', ')}. Check that each is needed and displays correctly. Outside of names, describe them using U+ notation and/or their Unicode names.`, {
      ref: `${RFC7997BIS_REF}#section-3`
    }))
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
  // -> Non-ASCII characters in UTF-8 documents are checked by validateContent on the decoded text
  if (!['ascii', 'UTF-8'].includes(detected.encoding)) {
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
