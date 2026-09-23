import { ValidationComment } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { traverseAllValues } from '../helpers/traversal.mjs'
import { SPELLING_FORM_INDEX } from '../config/spelling.mjs'

const WORD_RE = /[A-Za-z]+/g

const STYLE_GUIDE_REF = 'https://www.rfc-editor.org/rfc/rfc7322.html#section-3.1'

// Headings whose contents are titles of other people's work, or postal
// addresses, and so are not the author's own prose.
const TXT_SKIPPED_SECTION_RE = /^(?:\d+(?:\.\d+)*\.?\s+)?(?:(?:Normative|Informative|Unclassified)\s+)?References$|^(?:\d+(?:\.\d+)*\.?\s+)?(?:Author|Editor|Contributor)(?:'s|s'|s)?\s+Address(?:es)?$/i
const TXT_SECTION_HEADING_RE = /^(?:\d+(?:\.\d+)*\.?\s+\S|Appendix\s+[A-Z])/

// XML subtrees that are verbatim, cited from elsewhere, or postal data.
const XML_EXCLUDED_BLOCKS = [
  'sourcecode',
  'artwork',
  'reference',
  'references',
  'author',
  'address',
  'postal',
  'organization',
  'seriesInfo'
]

/**
 * Whether a whitespace-delimited token looks like a URL, an address, or a
 * machine identifier rather than English prose.
 *
 * @param {string} token Token containing the match
 * @returns {boolean} True if the token should not be treated as prose
 */
function isNonProseToken (token) {
  return token.includes('@') ||
    token.includes('_') ||
    token.includes('/') ||
    token.includes('\\') ||
    /[A-Za-z]\.[A-Za-z]/.test(token)
}

/**
 * Whether a match is probably part of a proper name (an organisation, a place,
 * the title of a cited document) and so not the author's spelling choice.
 * Only a capitalised match preceded by another capitalised word qualifies, so
 * an ordinary sentence-initial word is still checked.
 *
 * @param {string} text Full line or text node
 * @param {number} index Offset of the match within the text
 * @param {string} matched The matched word
 * @returns {boolean} True if the match looks like part of a proper name
 */
function isLikelyProperName (text, index, matched) {
  if (matched[0] !== matched[0].toUpperCase()) {
    return false
  }
  return /\b[A-Z][a-z]+\s+$/.test(text.slice(Math.max(0, index - 32), index))
}

/**
 * Find every known spelling variant in a chunk of text.
 *
 * Tokenising and looking each word up is markedly faster than matching a
 * single alternation of every known form, and gives the same whole-word
 * semantics.
 *
 * @param {string} text Text to scan
 * @param {function} onMatch Called with (entry, matchedWord, position)
 */
function scanText (text, onMatch) {
  for (const match of text.matchAll(WORD_RE)) {
    const word = match[0]
    const entry = SPELLING_FORM_INDEX.get(word.toLowerCase())
    if (!entry) {
      continue
    }

    // Reject matches that sit inside a URL, an email address or an identifier.
    const tokenStart = text.lastIndexOf(' ', match.index) + 1
    let tokenEnd = text.indexOf(' ', match.index)
    tokenEnd = tokenEnd === -1 ? text.length : tokenEnd
    if (isNonProseToken(text.slice(tokenStart, tokenEnd))) {
      continue
    }

    if (isLikelyProperName(text, match.index, word)) {
      continue
    }

    onMatch(entry, word, match.index)
  }
}

/**
 * Record an occurrence against its variant pair.
 *
 * @param {Map} occurrences Accumulator keyed by pair id
 * @param {Object} entry Form index entry
 * @param {string} word The word as written
 * @param {Object} location Either { line, pos } or { path }
 */
function record (occurrences, entry, word, location) {
  if (!occurrences.has(entry.id)) {
    occurrences.set(entry.id, { pair: entry.pair, us: [], gb: [] })
  }
  occurrences.get(entry.id)[entry.variety].push({ word, ...location })
}

/**
 * Turn recorded occurrences into nits.
 *
 * @param {Map} occurrences Accumulator keyed by pair id
 * @returns {Array} List of comments
 */
function report (occurrences) {
  const result = []
  const usEvidence = new Map()
  const gbEvidence = new Map()

  for (const [id, { pair, us, gb }] of occurrences) {
    // The same word spelled both ways in one document is always a nit,
    // whichever convention the author intended.
    if (us.length > 0 && gb.length > 0) {
      const usSample = us[0].word
      const gbSample = gb[0].word
      const lines = [...us, ...gb]
        .filter(occ => occ.line !== undefined)
        .map(occ => ({ line: occ.line, pos: occ.pos }))
        .sort((a, b) => a.line - b.line)
      const paths = [...new Set([...us, ...gb].map(occ => occ.path).filter(Boolean))]

      result.push(new ValidationComment(
        'INCONSISTENT_SPELLING_VARIANT',
        `Both "${gbSample}" and "${usSample}" appear in the document. Use one spelling consistently.`,
        {
          ref: STYLE_GUIDE_REF,
          ...(lines.length > 0 ? { lines } : {}),
          ...(paths.length > 0 ? { path: paths.join(', ') } : {})
        }
      ))
      continue
    }

    // Only forms that are unambiguous in their variety count toward the
    // document-wide verdict.
    if (us.length > 0 && !pair.usFormAmbiguous) {
      usEvidence.set(id, us[0].word.toLowerCase())
    }
    if (gb.length > 0 && !pair.gbFormAmbiguous) {
      gbEvidence.set(id, gb[0].word.toLowerCase())
    }
  }

  if (usEvidence.size > 0 && gbEvidence.size > 0) {
    result.push(new ValidationComment(
      'MIXED_SPELLING_CONVENTION',
      `The document mixes British spellings (${[...gbEvidence.values()].sort().slice(0, 5).join(', ')}) with American spellings (${[...usEvidence.values()].sort().slice(0, 5).join(', ')}). Pick one convention; the RFC Editor uses American spelling.`,
      { ref: STYLE_GUIDE_REF }
    ))
  }

  return result
}

/**
 * Validate that a document does not mix British and American spellings
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateSpellingConsistency (doc, { mode = MODES.NORMAL } = {}) {
  if (mode === MODES.SUBMISSION) {
    return []
  }

  const occurrences = new Map()

  switch (doc.type) {
    case 'txt': {
      let lineIdx = 1
      let inCodeBlock = false
      let inSkippedSection = false

      for (const line of doc.body.split('\n')) {
        const trimmedLine = line.trim()

        if (/<CODE BEGINS>/i.test(trimmedLine)) {
          inCodeBlock = true
        } else if (/<CODE ENDS>/i.test(trimmedLine)) {
          inCodeBlock = false
          lineIdx++
          continue
        }

        if (TXT_SKIPPED_SECTION_RE.test(trimmedLine)) {
          inSkippedSection = true
        } else if (inSkippedSection && TXT_SECTION_HEADING_RE.test(trimmedLine)) {
          inSkippedSection = false
        }

        if (!inCodeBlock && !inSkippedSection) {
          scanText(line, (entry, word, pos) => {
            record(occurrences, entry, word, { line: lineIdx, pos })
          })
        }

        lineIdx++
      }
      break
    }
    case 'xml': {
      await traverseAllValues(doc.data, async (val, k, p) => {
        const pathSegments = p.map(seg => seg.replace(/\[\d+\]$/, ''))
        // Members of an array of strings are reported with a null key, so the
        // owning tag has to come from the last path segment instead.
        const tag = k ?? pathSegments.at(-1)
        if (!['t', '#text'].includes(tag)) {
          return
        }
        if (pathSegments.some(seg => XML_EXCLUDED_BLOCKS.includes(seg))) {
          return
        }
        scanText(val, (entry, word) => {
          record(occurrences, entry, word, { path: p.join('.') })
        })
      })
      break
    }
  }

  return report(occurrences)
}
