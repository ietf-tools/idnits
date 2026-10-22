/* eslint-disable no-control-regex */

import { detect } from 'jschardet'
import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { describeCharacter, getCharacterName, toUplus } from '../helpers/unicode.mjs'
import { scanXmlSource } from '../helpers/xml-source.mjs'

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
// -> Numeric character references (&#8238; or &#x202E;)
const XML_CHAR_REF_RE = /&#(?:x([0-9a-fA-F]+)|([0-9]+));/g
// -> Markup whose text isn't character data, so a reference in it isn't decoded
const XML_NO_REF_MARKUP = ['comment', 'cdata', 'pi', 'doctype']
// -> Number of tab positions listed in a finding
const MAX_TAB_LINES = 20
const RFC7997BIS_REF = 'https://datatracker.ietf.org/doc/draft-rswg-rfc7997bis/'

/**
 * Validate string data for invalid ctrl code / chars sequences and non-ASCII characters
 *
 * @param {string} data String data to check
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {string} [opts.type=txt] Document type (txt or xml)
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateContent (data, { mode = MODES.NORMAL, type = 'txt' } = {}) {
  const result = []

  const invalidTabCharLines = []
  const invalidCtrlCharLines = []
  let lineIdx = 1
  for (const line of data.split('\n')) {
    // Check for tabs (in XML, validateTabs reports them with the element they are in)
    if (type !== 'xml') {
      for (const tabMatch of line.matchAll(INVALID_TAB_CHAR_RE)) {
        invalidTabCharLines.push({
          line: lineIdx,
          pos: tabMatch.index + 1
        })
      }
    }

    // Check for invalid control characters
    for (const ctrlMatch of line.matchAll(INVALID_CTRL_CHARS_RE)) {
      invalidCtrlCharLines.push({
        line: lineIdx,
        pos: ctrlMatch.index + 1
      })
    }

    lineIdx++
  }

  if (invalidTabCharLines.length > 0) {
    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('TABS_NOT_ALLOWED', invalidTabCharLines.length > 1 ? `Document contains ${invalidTabCharLines.length} tabs. Remove or replace them with spaces.` : 'Document contains a tab. Remove or replace it with a space.', {
        lines: invalidTabCharLines.slice(0, MAX_TAB_LINES)
      }))
    } else if (mode === MODES.FORGIVE_CHECKLIST) {
      result.push(new ValidationWarning('TABS_NOT_ALLOWED', invalidTabCharLines.length > 1 ? `Document contains ${invalidTabCharLines.length} tabs. Remove or replace them with spaces.` : 'Document contains a tab. Remove or replace it with a space.', {
        lines: invalidTabCharLines.slice(0, MAX_TAB_LINES)
      }))
    }
  }

  if (invalidCtrlCharLines.length > 0) {
    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('INVALID_CTRL_CODES', invalidCtrlCharLines.length > 1 ? `Document contains ${invalidCtrlCharLines.length} control characters other than LF, CR or FF.` : 'Document contains a control character other than LF, CR or FF.'))
    } else if (mode === MODES.FORGIVE_CHECKLIST) {
      result.push(new ValidationWarning('INVALID_CTRL_CODES', invalidCtrlCharLines.length > 1 ? `Document contains ${invalidCtrlCharLines.length} control characters other than LF, CR or FF.` : 'Document contains a control character other than LF, CR or FF.'))
    }
  }

  result.push(...validateCharacters(data, type))

  return result
}

/**
 * Validate the non-ASCII characters of a document against draft-rswg-rfc7997bis.
 * These checks apply in every mode.
 *
 * @param {string} data Decoded document contents
 * @param {string} type Document type (txt or xml)
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
function validateCharacters (data, type) {
  const result = []

  const refs = type === 'xml' ? findXmlCharacterReferences(data) : []
  if (!NON_ASCII_RE.test(data) && !refs.some(ref => NON_ASCII_RE.test(ref.char))) {
    return result
  }

  const nonDisplayable = new Map()
  const nonAscii = new Map()
  const nonNfcLines = []
  let lineIdx = 1
  let lineStart = 0
  let refIdx = 0
  for (const line of data.split('\n')) {
    // -> The line's text with its character references decoded, and the column in the line of
    //    each UTF-16 unit of it (the & of a reference); null when the line has no references
    const lineRefs = []
    while (refIdx < refs.length && refs[refIdx].offset < lineStart + line.length) {
      lineRefs.push(refs[refIdx++])
    }
    let text = line
    let columns = null
    if (lineRefs.length > 0) {
      text = ''
      columns = []
      let from = 0
      for (const ref of lineRefs) {
        const at = ref.offset - lineStart
        for (let idx = from; idx < at; idx++) {
          columns.push(idx + 1)
        }
        text += line.slice(from, at) + ref.char
        for (let idx = 0; idx < ref.char.length; idx++) {
          columns.push(at + 1)
        }
        from = at + ref.length
      }
      for (let idx = from; idx < line.length; idx++) {
        columns.push(idx + 1)
      }
      text += line.slice(from)
    }
    const column = (idx) => columns ? columns[idx] : idx + 1

    // Check for characters that don't display
    for (const match of text.matchAll(NON_DISPLAYABLE_CHARS_RE)) {
      // -> A byte order mark is allowed at the very start of the file
      if (lineIdx === 1 && match.index === 0 && line[0] === '\ufeff') {
        continue
      }
      if (type === 'xml' && XML_LINE_BREAK_HINTS.includes(match[0])) {
        continue
      }
      const codePoint = match[0].codePointAt(0)
      if (!nonDisplayable.has(codePoint)) {
        nonDisplayable.set(codePoint, [])
      }
      nonDisplayable.get(codePoint).push({ line: lineIdx, pos: column(match.index) })
    }

    // Count the other non-ASCII characters, as written literally
    for (const match of line.matchAll(NON_ASCII_CHARS_RE)) {
      if (!NON_DISPLAYABLE_CHAR_RE.test(match[0])) {
        const codePoint = match[0].codePointAt(0)
        nonAscii.set(codePoint, (nonAscii.get(codePoint) ?? 0) + 1)
      }
    }

    // Check for text not in NFC, located where it first differs from its NFC form
    if (NON_ASCII_RE.test(text)) {
      const normalized = text.normalize('NFC')
      if (normalized !== text) {
        let idx = 0
        while (text[idx] === normalized[idx]) {
          idx++
        }
        // -> Where a reference starts the difference, at the reference
        nonNfcLines.push({ line: lineIdx, pos: column(Math.min(idx, text.length - 1)) })
      }
    }

    lineIdx++
    lineStart += line.length + 1
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
 * Find the numeric character references of an XML document that are character data or
 * attribute values, i.e. not in a comment, CDATA section, processing instruction or DOCTYPE
 *
 * @param {string} data Decoded XML document contents
 * @returns {Array<{offset: number, length: number, char: string}>} References in document order:
 *          offset of the &, length of the reference, and the character it stands for
 */
function findXmlCharacterReferences (data) {
  const refs = []
  let source = null
  for (const match of data.matchAll(XML_CHAR_REF_RE)) {
    const codePoint = match[1] !== undefined ? parseInt(match[1], 16) : parseInt(match[2], 10)
    // -> Not a character (surrogates, beyond U+10FFFF): not a well-formed reference
    if (!(codePoint <= 0x10ffff) || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      continue
    }
    source = source ?? scanXmlSource(data)
    const { markup } = source.locate(match.index)
    if (markup && XML_NO_REF_MARKUP.includes(markup.kind)) {
      continue
    }
    refs.push({ offset: match.index, length: match[0].length, char: String.fromCodePoint(codePoint) })
  }
  return refs
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
