import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { traverseAllValues } from '../helpers/traversal.mjs'
import { isInCitedReference } from '../helpers/xml-paths.mjs'
import { CERTAINTY } from '../model/indexes.mjs'
import {
  BCP14_PROSE_TAGS,
  REQ_LEVEL_BOILERPLATE_RE,
  REQ_LEVEL_KEYWORDS_RE,
  getBcp14Boilerplate,
  getBcp14References,
  getKeywords
} from '../model/keywords.mjs'

const REQ_LEVEL_KEYWORDS_ALLOWED = [
  'MUST',
  'MUST NOT',
  'REQUIRED',
  'SHALL',
  'SHALL NOT',
  'SHOULD',
  'SHOULD NOT',
  'RECOMMENDED',
  'NOT RECOMMENDED',
  'MAY',
  'OPTIONAL'
]
// Matches any allowed BCP14 requirement-level keyword as a whole word (uppercase only).
// Longer phrases are listed first so e.g. "MUST NOT" is preferred over "MUST".
const BCP14_KEYWORDS_RE = /\b(MUST NOT|SHALL NOT|SHOULD NOT|NOT RECOMMENDED|MUST|SHALL|SHOULD|RECOMMENDED|REQUIRED|MAY|OPTIONAL)\b/g
// XML blocks whose content is verbatim and must not be checked for BCP14 keyword tagging.
const BCP14_EXCLUDED_BLOCKS = ['artwork', 'sourcecode']

// Most locations given for a finding about many spots of a text document (as for TABS_NOT_ALLOWED)
const MAX_LOCATIONS = 20

/**
 * Where a paragraph starting as a BCP14 boilerplate does ("The key words ") is found in a text document,
 * which is what makes the parser find a boilerplate similar to one (in its text, where lines are joined)
 *
 * @param {Object} doc Parsed text document
 * @returns {Array<{line: number, pos: number}>|undefined} First locations, or undefined when there are none
 */
function txtSimilarBoilerplateLocations (doc) {
  const body = doc.body ?? ''
  const locations = []
  for (const match of body.matchAll(/The\s+key\s+words\s/g)) {
    const lineStart = body.lastIndexOf('\n', match.index - 1) + 1
    locations.push({ line: body.slice(0, lineStart).split('\n').length, pos: match.index - lineStart + 1 })
  }
  return locations.length ? locations.slice(0, MAX_LOCATIONS) : undefined
}

/**
 * Lines of the first answers that a finding is about, in document order: answers of a text document are
 * located by line, those of an XML document by path (see answerPath())
 *
 * @param {Array<{location: Object}>} answers Answers
 * @returns {Array<{line: number, pos: number}>|undefined} First lines (at most MAX_LOCATIONS), or
 *   undefined when there are none
 */
function answerLines (answers) {
  const lines = answers.flatMap(answer => answer.location.lines ?? [])
    .sort((a, b) => a.line - b.line || a.pos - b.pos)
  return lines.length ? lines.slice(0, MAX_LOCATIONS) : undefined
}

/**
 * Path of the first answer that a finding is about: answers of an XML document are located by path,
 * those of a text document by line (see answerLines())
 *
 * @param {Array<{location: Object}>} answers Answers, in document order
 * @returns {string|undefined} Path of the first answer located by path, if any
 */
function answerPath (answers) {
  return answers.find(answer => answer.location.path)?.location.path
}

/**
 * Check that BCP14 is cited the way RFC 8174 prescribes, i.e. "BCP 14 [RFC2119] [RFC8174]"
 *
 * The RFC Editor cites both RFCs rather than [BCP14], as BCP 14 could change after publication.
 *
 * @param {Object[]} references References to BCP 14 (see getBcp14References())
 * @returns {Array} List of warnings
 */
function validateBcp14Citations (references) {
  const result = []
  const rfc2119 = references.find(reference => reference.id === 'RFC2119')
  const rfc8174 = references.find(reference => reference.id === 'RFC8174')
  const bcp14 = references.find(reference => reference.id === 'BCP14' && reference.cited)
  if (bcp14) {
    result.push(new ValidationWarning('BCP14_CITED_INSTEAD_OF_RFCS', 'BCP 14 is cited as [BCP14]. Cite it as "BCP 14 [RFC2119] [RFC8174]", as RFC 8174 prescribes; the RFC Editor will change it to that.', {
      ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2',
      lines: bcp14.location.lines,
      path: bcp14.location.path
    }))
  }
  if (rfc2119 && !rfc8174) {
    result.push(new ValidationWarning('MISSING_RFC8174_REF', 'RFC 2119 is referenced but RFC 8174 is not. BCP 14 should be cited as "BCP 14 [RFC2119] [RFC8174]".', {
      ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2',
      lines: rfc2119.location.lines,
      path: rfc2119.location.path
    }))
  } else if (rfc8174 && !rfc2119) {
    result.push(new ValidationWarning('MISSING_RFC2119_REF', 'RFC 8174 is referenced but RFC 2119 is not. BCP 14 should be cited as "BCP 14 [RFC2119] [RFC8174]".', {
      ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2',
      lines: rfc8174.location.lines,
      path: rfc8174.location.path
    }))
  }
  return result
}

/**
 * Finding for BCP14 keywords used without a BCP14 boilerplate
 *
 * With a reference to BCP14 the document only lacks the boilerplate, a lesser problem
 * that has its own code.
 *
 * @param {number} mode Validation mode
 * @param {boolean} hasReference Whether the document references RFC 2119, RFC 8174 or BCP 14
 * @param {string} message Message of the finding
 * @param {Object} opts Options of the finding (ref, lines or path)
 * @returns {ValidationError|ValidationWarning} The finding
 */
function missingBoilerplateFinding (mode, hasReference, message, opts) {
  if (hasReference) {
    return new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE_REFERENCED', message, opts)
  }
  if (mode === MODES.NORMAL) {
    return new ValidationError('MISSING_REQLEVEL_BOILERPLATE', message, opts)
  }
  return new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE', message, opts)
}

/**
 * Check how the keywords of the prose of an XML document are written: invalid combinations
 * ("MUST not"), and keywords not enclosed in <bcp14>
 *
 * Texts holding a boilerplate aren't checked, nor are keywords in verbatim <artwork> or <sourcecode>
 * blocks for their <bcp14> tags.
 *
 * @param {Object} doc Parsed XML document
 * @returns {Promise<Array>} List of comments, for each text in document order
 */
async function validateXmlKeywordMarkup (doc) {
  const result = []
  await traverseAllValues(doc.data, async (val, k, p) => {
    // Text of cited references isn't written by the author
    if (isInCitedReference(p)) {
      return
    }
    // Strip array indices (e.g. "bcp14[0]") so path segments can be matched by tag name
    const pathSegments = p.map(seg => seg.replace(/\[\d+\]$/, ''))
    const inBcp14Tag = pathSegments.includes('bcp14')
    const inExcludedBlock = pathSegments.some(seg => BCP14_EXCLUDED_BLOCKS.includes(seg))
    if (!BCP14_PROSE_TAGS.includes(k) && !inBcp14Tag) {
      return
    }
    const str = val.replaceAll('\n', ' ')
    if (str.match(REQ_LEVEL_BOILERPLATE_RE)) {
      return
    }
    for (const match of str.matchAll(REQ_LEVEL_KEYWORDS_RE)) {
      if (!REQ_LEVEL_KEYWORDS_ALLOWED.includes(match[0])) {
        result.push(new ValidationComment('INVALID_REQLEVEL_KEYWORD', `${match[0]} is not a valid BCP14 Requirement Level keyword.`, {
          ref: 'https://www.rfc-editor.org/info/bcp14',
          path: p.join('.')
        }))
      }
    }
    // Flag BCP14 keywords that aren't wrapped in <bcp14> tags. Keywords already
    // inside a <bcp14> tag, or within verbatim <artwork>/<sourcecode> blocks, are exempt.
    if (!inBcp14Tag && !inExcludedBlock) {
      for (const match of str.matchAll(BCP14_KEYWORDS_RE)) {
        result.push(new ValidationComment('MISSING_BCP14_TAGS', `The BCP14 keyword "${match[0]}" should be enclosed in <bcp14></bcp14> tags.`, {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#bcp14',
          path: p.join('.')
        }))
      }
    }
  })
  return result
}

/**
 * Validate a document usage of BCP14 keywords
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validate2119Keywords (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  const { used, keywords } = getKeywords(doc)
  const boilerplate = getBcp14Boilerplate(doc)
  const references = getBcp14References(doc)
  // NOT RECOMMENDED where it is used, not where the boilerplate lists it
  const notRecommended = keywords.filter(kw => kw.keyword === 'NOT RECOMMENDED' && !kw.inBoilerplate)

  // -> Only the text parser matches a boilerplate similar to a BCP14 boilerplate
  if (doc.type === 'txt' && !boilerplate.present && doc.data.boilerplate.similar2119boilerplate) {
    result.push(new ValidationError('REQLEVEL_BOILERPLATE_MISMATCH', 'A BCP14 boilerplate is missing but a similar boilerplate was found.', {
      ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2',
      lines: txtSimilarBoilerplateLocations(doc)
    }))
  }

  if (doc.type === 'xml') {
    result.push(...await validateXmlKeywordMarkup(doc))
  }

  if (used && !boilerplate.present) {
    if (references.length) {
      // -> Declared references (XML) are named in the message
      const message = references[0].certainty === CERTAINTY.DECLARED
        ? 'One or more BCP14 keywords are present and a reference to BCP14 exists but a BCP14 boilerplate is missing.'
        : 'One or more BCP14 keywords are present but a BCP14 boilerplate is missing.'
      result.push(missingBoilerplateFinding(mode, true, message, {
        ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2',
        lines: answerLines(keywords),
        path: answerPath(keywords)
      }))
    } else {
      result.push(missingBoilerplateFinding(mode, false, 'One or more BCP14 keywords are present but a BCP14 boilerplate and a reference are missing.', {
        ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2',
        lines: answerLines(keywords),
        path: answerPath(keywords)
      }))
    }
  } else if (boilerplate.present && !used) {
    // The boilerplate, through the keywords it lists
    result.push(new ValidationWarning('MISSING_REQLEVEL_KEYWORDS', 'A BCP14 boilerplate is present but no keywords are used in the document.', {
      ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2',
      lines: boilerplate.location.lines,
      path: boilerplate.location.path
    }))
  } else if (notRecommended.length && !boilerplate.notRecommended) {
    result.push(new ValidationWarning('MISSING_NOTRECOMMENDED_IN_BOILERPLATE', 'The keyword NOT RECOMMENDED appears but not included in the BCP14 boilerplate.', {
      ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2',
      lines: answerLines(notRecommended),
      path: answerPath(notRecommended)
    }))
  }

  // -> Only the text parser finds misspelled keywords ("MUST not") as such
  if (doc.type === 'txt') {
    for (const keyword of doc.data.possibleIssues.misspeled2119Keywords) {
      result.push(new ValidationComment('INCORRECT_KEYWORD_SPELLING', `The keyword "${keyword.invalidKeyword}" is misspelled.`, {
        ref: 'https://www.rfc-editor.org/info/bcp14',
        lines: [{ line: keyword.line, pos: keyword.pos }]
      }))
    }
  }

  // -> Only XML documents are checked for a reference along with their boilerplate
  if (doc.type === 'xml' && boilerplate.present && !references.length) {
    result.push(new ValidationError('MISSING_REQLEVEL_REF', 'A BCP14 boilerplate is present but no reference to BCP14 was found.', {
      ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2',
      path: boilerplate.location.path
    }))
  }

  if (boilerplate.present || used) {
    result.push(...validateBcp14Citations(references))
  }

  return result
}

// --------------------------------------------------------------------

const INVALID_TERMS_RE = /(?:(?<![A-Za-z0-9])demultiplexor(?![A-Za-z0-9])|diffserv|(?<!\S)(?:e[-\s]mail|on[-\s]line)(?![A-Za-z0-9])|(?<![A-Za-z])internet\sdraft(?![A-Za-z])|ipsec|(?<![A-Za-z])(?:pseudo[-\s]wire|public-key|sub-domain|sub-options|time-stamp|us-ascii)(?![A-Za-z]))/gi
const INVALID_TERMS_ASSOC = {
  demultiplexor: 'demultiplexer',
  diffserv: 'Diffserv',
  email: 'email (no hyphen)',
  internetdraft: 'Internet-Draft (with hyphen)',
  ipsec: 'IPsec',
  online: 'online (no hyphen)',
  pseudowire: 'pseudowire (no space or hyphen)',
  publickey: 'public key (no hyphen)',
  subdomain: 'subdomain (no hyphen)',
  suboptions: 'suboptions (no hyphen)',
  timestamp: 'timestamp (no hyphen)',
  usascii: 'ASCII'
}

/**
 * Validate a document terms for a consistent usage
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateTermsStyle (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  switch (doc.type) {
    case 'txt': {
      let lineIdx = 1
      for (const line of doc.body.split('\n')) {
        for (const match of line.matchAll(INVALID_TERMS_RE)) {
          // Skip valid spellings of captured matches
          if (['Diffserv', 'IPsec'].includes(match[0])) {
            continue
          }
          // Add warning with proper spelling
          const normalizedTerm = match[0].replaceAll(/\s|-/gi, '').toLowerCase()
          if (INVALID_TERMS_ASSOC[normalizedTerm]) {
            result.push(new ValidationComment('INCORRECT_TERM_SPELLING', `"${match[0]}" should be spelled as ${INVALID_TERMS_ASSOC[normalizedTerm]}.`, {
              ref: 'https://www.rfc-editor.org/materials/terms-online.txt',
              lines: [{
                line: lineIdx,
                pos: match.index + 1
              }]
            }))
          }
        }
        lineIdx++
      }
      break
    }
    case 'xml': {
      await traverseAllValues(doc.data, async (val, k, p) => {
        // Text of cited references isn't written by the author
        if (isInCitedReference(p)) { return }
        if (['t', '#text'].includes(k)) {
          const termMatches = val.matchAll(INVALID_TERMS_RE)
          for (const match of termMatches) {
            // Skip valid spellings of captured matches
            if (['Diffserv', 'IPsec'].includes(match[0])) {
              continue
            }
            // Add warning with proper spelling
            const normalizedTerm = match[0].replaceAll(/\s|-/gi, '').toLowerCase()
            if (INVALID_TERMS_ASSOC[normalizedTerm]) {
              result.push(new ValidationComment('INCORRECT_TERM_SPELLING', `"${match[0]}" should be spelled as ${INVALID_TERMS_ASSOC[normalizedTerm]}.`, {
                ref: 'https://www.rfc-editor.org/materials/terms-online.txt',
                path: p.join('.')
              }))
            }
          }
        }
      })
      break
    }
  }

  return result
}
