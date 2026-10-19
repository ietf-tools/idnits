import { ValidationComment, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { getReferencesSections } from '../helpers/references.mjs'
import { pageBreakLineType } from '../parsers/txt.mjs'

const RFC_REFERENCE_STYLE_REF = 'https://www.rfc-editor.org/styleguide/part2/#ref_rfcs'

// Most locations given for a finding
const MAX_LINES = 20

// A link to an RFC's text rather than to its info page: the /rfc/ path of rfc-editor.org, with or
// without www, over http or https, to the RFC itself or to one of its formats
const RFC_TEXT_URL_RE = /^(?:https?:\/\/)?(?:www\.)?rfc-editor\.org\/rfc\/rfc0*(\d+)(?:\.(?:txt|html|pdf|xml))?\/?$/i

// Start of a URL in a line of text: bracketed ("<https://...") or bare, with a scheme or starting
// with the RFC Editor's host
const URL_START_RE = /<\s?(?=[a-z][a-z0-9+.-]*:)|(?<![\w.@/<-]|<\s)(?=https?:\/\/|(?:www\.)?rfc-editor\.org\/)/gi
// The rest of a URL, up to the end of its brackets or the first space
const URL_BODY_RE = /[^\s<>]*/y
// A bare URL that runs on to the next line: one broken at a "/" or "-"
const OPEN_BARE_URL_RE = /[-/]$/
// Punctuation that ends a sentence or a parenthesis after a bare URL
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]'"]+$/
// Lines a URL is looked for on after the line it starts on, enough to go over a page break
const MAX_URL_CONTINUATION_LINES = 10
// An appendix heading, which ends the references in the text parser's references section
const APPENDIX_HEADING_RE = /^Appendix\s+[A-Z]\b/

/**
 * URL of the info page of an RFC, where references to it should link to
 *
 * @param {string} rfc RFC number, without leading zeros
 * @returns {string} URL of the info page
 */
function infoUrl (rfc) {
  return `https://www.rfc-editor.org/info/rfc${rfc}`
}

/**
 * Info page URL to give instead of a link to an RFC's text
 *
 * @param {string} url Link
 * @returns {string|null} URL of the info page of the RFC, null when the link is not one to an RFC's text
 */
function expectedInfoUrl (url) {
  const rfc = String(url ?? '').trim().match(RFC_TEXT_URL_RE)?.[1]
  return rfc ? infoUrl(rfc) : null
}

/**
 * Locations of the lines the text parser keeps as the content of the references section, found by
 * matching them in order to the lines of the document after its table of contents (as in
 * lib/modules/sections.mjs)
 *
 * @param {Object} doc Parsed text document
 * @param {string[]} lines Lines of the document
 * @returns {number[]} Index in lines of each line of the references section, in document order
 */
function referenceLineIndexes (doc, lines) {
  const markers = doc.data?.markers ?? {}
  let idx = Math.max(markers.toc?.end ?? 0, markers.header?.end ?? 0)
  const indexes = []
  for (const entry of doc.data?.content?.references ?? []) {
    while (idx < lines.length && lines[idx].trim() !== entry) idx++
    if (idx >= lines.length) break
    indexes.push(idx++)
  }
  return indexes
}

/**
 * Text that continues a URL broken at the end of a line, from the lines after it: xml2rfc breaks
 * a long URL in angle brackets at a "/" or "-" and goes on at the start of the next line, which
 * may be on the next page
 *
 * @param {string[]} lines Lines of the document
 * @param {Set<number>} inSection Index in lines of each line of the references section
 * @param {number} idx Index in lines of the line the URL starts on
 * @param {boolean} bracketed Whether the URL is in angle brackets
 * @param {string} start Text of the URL on its first line
 * @returns {string} The whole URL
 */
function joinWrappedUrl (lines, inSection, idx, bracketed, start) {
  let url = start
  let open = true
  let blank = false
  let pageBreak = false
  for (let next = idx + 1; open && next < lines.length && next <= idx + MAX_URL_CONTINUATION_LINES; next++) {
    const text = lines[next].replace(/\f/g, '')
    if (!text.trim()) {
      blank = true
      continue
    }
    if (pageBreakLineType(text)) {
      pageBreak = true
      continue
    }
    // -> Only a page break separates a URL from its continuation, which is in the references section
    if ((blank && !pageBreak) || !inSection.has(next)) break
    const trimmed = text.trimStart()
    const part = trimmed.match(/^[^\s<>]*/)[0]
    url += part
    // -> The URL goes on if its part fills the line and, unless bracketed, ends with a break character
    const rest = trimmed.slice(part.length)
    open = part !== '' && rest.trim() === '' && !rest.startsWith('>') && (bracketed || OPEN_BARE_URL_RE.test(part))
  }
  return url
}

/**
 * Links to an RFC's text rather than to its info page in the references section of a text document
 *
 * @param {Object} doc Parsed text document
 * @returns {Array<{url: string, expected: string, line: number, pos: number}>} Links, in document order
 */
function findTextRfcUrls (doc) {
  const lines = typeof doc.body === 'string' ? doc.body.split(/\r?\n/) : []
  const indexes = referenceLineIndexes(doc, lines)
  const inSection = new Set(indexes)
  const found = []
  for (const idx of indexes) {
    const line = lines[idx]
    // -> The text parser keeps appendices after the references in its references section
    if (APPENDIX_HEADING_RE.test(line)) break
    for (const match of line.matchAll(URL_START_RE)) {
      const bracketed = match[0].startsWith('<')
      const start = match.index + match[0].length
      URL_BODY_RE.lastIndex = start
      const body = URL_BODY_RE.exec(line)[0]
      const after = line.slice(start + body.length)
      const continues = after.trim() === '' && (bracketed ? !after.startsWith('>') : OPEN_BARE_URL_RE.test(body))
      let url = continues ? joinWrappedUrl(lines, inSection, idx, bracketed, body) : body
      if (!bracketed) url = url.replace(TRAILING_PUNCTUATION_RE, '')
      const expected = expectedInfoUrl(url)
      if (expected) {
        found.push({ url, expected, line: idx + 1, pos: start + 1 })
      }
    }
  }
  return found
}

/**
 * Explicit targets of <reference> elements that link to an RFC's text rather than to its info page
 *
 * References included with xi:include or an external entity are not in the document, and are not
 * looked at: the RFC Editor's bibliography entries link to the info page. A reference without a
 * target gets a link to the info page from xml2rfc.
 *
 * @param {Object} doc Parsed XML document
 * @returns {Array<{url: string, expected: string, path: string}>} Targets, in document order
 */
function findXmlRfcUrls (doc) {
  const found = []
  const check = (reference, path) => {
    const url = reference?._attr?.target
    const expected = expectedInfoUrl(url)
    if (expected) {
      found.push({ url: String(url).trim(), expected, path: `${path}._attr.target` })
    }
  }
  for (const section of getReferencesSections(doc)) {
    section.references.forEach((reference, idx) => check(reference, `${section.path}.reference[${idx}]`))
    section.referencegroups.forEach((group, groupIdx) => {
      const references = [group?.reference ?? []].flat()
      references.forEach((reference, idx) => check(reference, `${section.path}.referencegroup[${groupIdx}].reference[${idx}]`))
    })
  }
  return found
}

/**
 * Validate that references to RFCs link to the RFC's info page, https://www.rfc-editor.org/info/rfcN,
 * as published RFCs and the RFC Editor's bibliography entries do, rather than to its text at
 * https://www.rfc-editor.org/rfc/rfcN (with any extension).
 *
 * In an XML document, the explicit target attributes of <reference> elements are checked; in a
 * text document, the URLs in the references section, joined back together when wrapped across lines.
 * One finding is given for the whole document: a Warning for XML, a Comment for text.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateRfcReferenceUrls (doc, { mode = MODES.NORMAL } = {}) {
  if (mode === MODES.SUBMISSION) {
    return []
  }

  const found = doc.type === 'xml' ? findXmlRfcUrls(doc) : findTextRfcUrls(doc)
  if (found.length === 0) {
    return []
  }

  const [first] = found
  const others = found.length > 1 ? ` (and ${found.length - 1} more)` : ''
  const message = `References to RFCs should link to the RFC's info page, https://www.rfc-editor.org/info/rfcN. Found ${found.length} ${found.length > 1 ? 'links' : 'link'} to RFC text instead: ${first.url}${others}; for that one, use ${first.expected}.`
  if (doc.type === 'xml') {
    // -> The author wrote the target
    return [new ValidationWarning('RFC_REFERENCE_URL_FORMAT', message, { ref: RFC_REFERENCE_STYLE_REF, path: first.path })]
  }
  // -> In a text draft these links mostly come from xml2rfc's default for references without a target,
  //    which is /rfc/ until xml2rfc switches to /info/: raise this to a Warning once it renders /info/
  return [new ValidationComment('RFC_REFERENCE_URL_FORMAT', `${message} xml2rfc currently renders references without a target this way and will switch to /info/: if this document was produced by xml2rfc from XML without explicit targets, nothing needs changing in the source.`, {
    ref: RFC_REFERENCE_STYLE_REF,
    lines: found.slice(0, MAX_LINES).map(({ line, pos }) => ({ line, pos }))
  })]
}
