import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { findAllDescendantsWith, traverseAllValues } from '../helpers/traversal.mjs'
import { isInCitedReference } from '../helpers/xml-paths.mjs'
import { getLocations } from '../parsers/txt.mjs'

const REQ_LEVEL_KEYWORDS_RE = /((NOT|not)\s)?(MUST|REQUIRED|SHALL|SHOULD|RECOMMENDED|OPTIONAL|MAY)(\s(NOT|not))?/g
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
const REQ_LEVEL_BOILETPLATE_RE = /The key\s?words (.|\n)+? in this document (.|\n)+?./gi
// Matches any allowed BCP14 requirement-level keyword as a whole word (uppercase only).
// Longer phrases are listed first so e.g. "MUST NOT" is preferred over "MUST".
const BCP14_KEYWORDS_RE = /\b(MUST NOT|SHALL NOT|SHOULD NOT|NOT RECOMMENDED|MUST|SHALL|SHOULD|RECOMMENDED|REQUIRED|MAY|OPTIONAL)\b/g
// XML blocks whose content is verbatim and must not be checked for BCP14 keyword tagging.
const BCP14_EXCLUDED_BLOCKS = ['artwork', 'sourcecode']
// XML tags holding prose the author wrote, and so where BCP14 keywords are meaningful.
const BCP14_PROSE_TAGS = ['t', '#text', 'li', 'dt', 'dd', 'th', 'td', 'blockquote', 'aside', 'cref', 'name', 'strong', 'em']
// Identifiers of the documents making up BCP14, as normalized by getBcp14RefId().
const BCP14_REF_IDS = ['RFC2119', 'RFC8174', 'BCP14']

// Most locations given for a finding about many spots of a text document (as for TABS_NOT_ALLOWED)
const MAX_LOCATIONS = 20

/**
 * Where values of one kind extracted from a text document are found, in document order
 *
 * @param {Object} doc Parsed text document
 * @param {string} kind Kind of the values (see getLocations())
 * @param {Array<string>|function(string): boolean} values Values, or which values to take
 * @returns {Array<{line: number, pos: number}>|undefined} First locations (at most MAX_LOCATIONS), or undefined when there are none
 */
function txtLocations (doc, kind, values) {
  const keys = typeof values === 'function'
    ? Object.keys(doc.data.extractedElements?.locations?.[kind] ?? {}).filter(values)
    : values
  const locations = keys.flatMap((value) => getLocations(doc, kind, value))
    .sort((a, b) => a.line - b.line || a.pos - b.pos)
  return locations.length ? locations.slice(0, MAX_LOCATIONS) : undefined
}

/**
 * Where a citation of BCP14 by its label ("[RFC2119]", "[BCP14]") is found in a text document,
 * in the text and in the references section
 *
 * @param {Object} doc Parsed text document
 * @param {string} label Label, e.g. "[RFC2119]" (any case)
 * @returns {Array<{line: number, pos: number}>|undefined} First locations, or undefined when there are none
 */
function txtCitationLocations (doc, label) {
  const isLabel = (value) => value.toUpperCase() === label
  const locations = [
    ...(txtLocations(doc, 'bracketedRfcNonReferences', isLabel) ?? []),
    ...(txtLocations(doc, 'bracketedRfcReferences', isLabel) ?? [])
  ].sort((a, b) => a.line - b.line || a.pos - b.pos)
  return locations.length ? locations.slice(0, MAX_LOCATIONS) : undefined
}

/**
 * Where "[BCP14]" is found in a text document: on the lines the parser reads it from
 * (lines with a form feed are page breaks, which it skips)
 *
 * @param {Object} doc Parsed text document
 * @returns {Array<{line: number, pos: number}>|undefined} First locations, or undefined when there are none
 */
function txtBcp14LabelLocations (doc) {
  const locations = []
  for (const [idx, line] of (doc.body ?? '').split('\n').entries()) {
    if (line.includes('\f')) { continue }
    for (const match of line.matchAll(/\[BCP14\]/gi)) {
      locations.push({ line: idx + 1, pos: match.index + 1 })
    }
  }
  return locations.length ? locations.slice(0, MAX_LOCATIONS) : undefined
}

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
 * Normalize a reference identifier (anchor / xref target, e.g. "RFC2119" or "bcp-14")
 * or a bibxml filename (e.g. "reference.BCP.0014.xml") to one of BCP14_REF_IDS
 *
 * @param {string} str Identifier, filename or URL
 * @returns {string|undefined} Normalized identifier, if it refers to BCP14
 */
function getBcp14RefId (str) {
  if (typeof str !== 'string') { return }
  const match = str.match(/reference\.(RFC|BCP)\.0*(\d+)\.xml$/i) || str.match(/^(RFC|BCP)[\s_-]?0*(\d+)$/i)
  if (match) {
    const id = `${match[1].toUpperCase()}${match[2]}`
    return BCP14_REF_IDS.includes(id) ? id : undefined
  }
}

/**
 * Find all references to BCP14 documents (RFC2119, RFC8174, BCP14) in an XML document,
 * whether made via external entities, xi:include, <reference> / <referencegroup> anchors,
 * <seriesInfo> or <xref> targets
 *
 * @param {Object} doc XML Document
 * @returns {Set<string>} Set of normalized identifiers found
 */
function findBcp14XmlRefs (doc) {
  const ids = []
  const elementsOf = (obj, tags) => findAllDescendantsWith(obj, (v, k) => tags.includes(k)).flatMap(m => m.value).filter(el => el?._attr)

  for (const entity of doc.externalEntities ?? []) {
    ids.push(getBcp14RefId(entity.name), getBcp14RefId(entity.url))
  }
  for (const el of elementsOf(doc.data, ['xref', 'xi:include'])) {
    ids.push(getBcp14RefId(el._attr.target), getBcp14RefId(el._attr.href))
  }
  for (const el of elementsOf(doc.data?.rfc?.back, ['reference', 'referencegroup'])) {
    ids.push(getBcp14RefId(el._attr.anchor))
    for (const si of [el.seriesInfo].flat()) {
      if (si?._attr?.name && si._attr.value) {
        ids.push(getBcp14RefId(`${si._attr.name}${si._attr.value}`))
      }
    }
  }
  return new Set(ids.filter(Boolean))
}

/**
 * Find the BCP14 documents (RFC2119, RFC8174, BCP14) cited with <xref> in an XML document
 *
 * @param {Object} doc XML Document
 * @returns {Set<string>} Set of normalized identifiers cited
 */
function findBcp14XmlCitations (doc) {
  const xrefs = findAllDescendantsWith(doc.data, (v, k) => k === 'xref').flatMap(m => m.value).filter(el => el?._attr)
  return new Set(xrefs.map(el => getBcp14RefId(el._attr.target)).filter(Boolean))
}

/**
 * Check that BCP14 is cited the way RFC 8174 prescribes, i.e. "BCP 14 [RFC2119] [RFC8174]"
 *
 * The RFC Editor cites both RFCs rather than [BCP14], as BCP 14 could change after publication.
 *
 * @param {Object} refs Which documents the document references
 * @param {boolean} refs.rfc2119 RFC 2119 is referenced
 * @param {boolean} refs.rfc8174 RFC 8174 is referenced
 * @param {boolean} refs.bcp14 BCP 14 is cited as [BCP14]
 * @param {function(string): (Array|undefined)} [locate] Where a citation label ("[RFC2119]", "[RFC8174]", "[BCP14]") is found, if known
 * @returns {Array} List of warnings
 */
function validateBcp14Citations ({ rfc2119, rfc8174, bcp14 }, locate = () => undefined) {
  const result = []
  if (bcp14) {
    result.push(new ValidationWarning('BCP14_CITED_INSTEAD_OF_RFCS', 'BCP 14 is cited as [BCP14]. Cite it as "BCP 14 [RFC2119] [RFC8174]", as RFC 8174 prescribes; the RFC Editor will change it to that.', {
      ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2',
      lines: locate('[BCP14]')
    }))
  }
  if (rfc2119 && !rfc8174) {
    result.push(new ValidationWarning('MISSING_RFC8174_REF', 'RFC 2119 is referenced but RFC 8174 is not. BCP 14 should be cited as "BCP 14 [RFC2119] [RFC8174]".', {
      ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2',
      lines: locate('[RFC2119]')
    }))
  } else if (rfc8174 && !rfc2119) {
    result.push(new ValidationWarning('MISSING_RFC2119_REF', 'RFC 8174 is referenced but RFC 2119 is not. BCP 14 should be cited as "BCP 14 [RFC2119] [RFC8174]".', {
      ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2',
      lines: locate('[RFC8174]')
    }))
  }
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

  switch (doc.type) {
    case 'txt': {
      const keywords = doc.data.extractedElements.keywords2119
      const boilerplateKeywords = doc.data.extractedElements.boilerplate2119Keywords
      const hasNonBoilerplateKeywords = keywords.length > boilerplateKeywords.length
      const hasBoilerplate = doc.data.boilerplate.rfc2119 || doc.data.boilerplate.rfc8174 || doc.data.boilerplate.bcp14
      const hasReferences = doc.data.references.rfc2119 || doc.data.references.rfc8174 || doc.data.references.bcp14
      const invalidKeywords = doc.data.possibleIssues.misspeled2119Keywords
      // Where the keywords used are, first to last
      const keywordLines = txtLocations(doc, 'keywords2119', () => true)

      if (!hasBoilerplate && doc.data.boilerplate.similar2119boilerplate) {
        result.push(new ValidationError('MISSING_REQLEVEL_BOILERPLATE', 'A BCP14 boilerplate is missing but a similar boilerplate was found.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2',
          lines: txtSimilarBoilerplateLocations(doc)
        }))
      }

      if (keywords.length && !hasBoilerplate && !hasReferences) {
        if (mode === MODES.NORMAL) {
          result.push(new ValidationError('MISSING_REQLEVEL_BOILERPLATE', 'One or more BCP14 keywords are present but a BCP14 boilerplate and a reference are missing.', {
            ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2',
            lines: keywordLines
          }))
        } else {
          result.push(new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE', 'One or more BCP14 keywords are present but a BCP14 boilerplate and a reference are missing.', {
            ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2',
            lines: keywordLines
          }))
        }
      } else if (keywords.length && hasReferences && !hasBoilerplate) {
        result.push(new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE', 'One or more BCP14 keywords are present but a BCP14 boilerplate is missing.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2',
          lines: keywordLines
        }))
      } else if (hasBoilerplate && !hasNonBoilerplateKeywords) {
        // The boilerplate, through the keywords it lists
        result.push(new ValidationWarning('MISSING_REQLEVEL_KEYWORDS', 'A BCP14 boilerplate is present but no keywords are used in the document.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2',
          lines: txtLocations(doc, 'boilerplate2119Keywords', boilerplateKeywords)
        }))
      } else if (keywords.find((word) => word.keyword === 'NOT RECOMMENDED') && !boilerplateKeywords.includes('NOT RECOMMENDED')) {
        result.push(new ValidationWarning('MISSING_NOTRECOMMENDED_IN_BOILERPLATE', 'The keyword NOT RECOMMENDED appears but not included in the BCP14 boilerplate.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2',
          lines: txtLocations(doc, 'keywords2119', ['NOT RECOMMENDED'])
        }))
      }

      if (invalidKeywords.length > 0) {
        for (const keyword of invalidKeywords) {
          result.push(new ValidationComment('INCORRECT_KEYWORD_SPELLING', `The keyword "${keyword.invalidKeyword}" is misspelled.`, {
            ref: 'https://www.rfc-editor.org/info/bcp14',
            lines: [{ line: keyword.line, pos: keyword.pos }]
          }))
        }
      }

      if (hasBoilerplate || keywords.length) {
        result.push(...validateBcp14Citations({
          rfc2119: doc.data.references.rfc2119,
          rfc8174: doc.data.references.rfc8174,
          bcp14: doc.data.references.bcp14
        }, (label) => label === '[BCP14]' ? txtBcp14LabelLocations(doc) : txtCitationLocations(doc, label)))
      }
      break
    }
    case 'xml': {
      const bcp14Refs = findBcp14XmlRefs(doc)
      const hasRFC2119Ref = bcp14Refs.has('RFC2119')
      const hasRFC8174Ref = bcp14Refs.has('RFC8174')
      const hasBCP14Ref = bcp14Refs.has('BCP14')
      const hasRef = hasRFC2119Ref || hasRFC8174Ref || hasBCP14Ref
      let hasKeywords = false
      let hasBoilerplate = false
      let hasNotRecommended = false
      let hasNotRecommendedInBoilerplate = false

      // The paragraphs holding a BCP14 boilerplate, and whether each lists NOT RECOMMENDED. A
      // tagged boilerplate's keywords are values of its <bcp14> children: they list what the
      // boilerplate covers and are not uses of the keywords.
      const boilerplates = new Map()
      await traverseAllValues(doc.data, async (val, k, p) => {
        if (isInCitedReference(p) || !(BCP14_PROSE_TAGS.includes(k) || p.some(seg => seg.replace(/\[\d+\]$/, '') === 'bcp14'))) { return }
        const blMatch = val.replaceAll('\n', ' ').match(REQ_LEVEL_BOILETPLATE_RE)
        if (blMatch) {
          // The paragraph is the element owning the text, or the value itself for a text-only element
          const para = (k === '#text' ? p.slice(0, -1) : p).join('.') + '.'
          boilerplates.set(para, boilerplates.get(para) || blMatch[0].includes('NOT RECOMMENDED'))
        }
      })
      const boilerplateOf = (p) => {
        const path = p.join('.') + '.'
        return [...boilerplates.keys()].find(para => path.startsWith(para))
      }
      await traverseAllValues(doc.data, async (val, k, p) => {
        if (isInCitedReference(p) || val.replace(/\s+/g, ' ').trim() !== 'NOT RECOMMENDED') { return }
        const para = boilerplateOf(p)
        if (para) { boilerplates.set(para, true) }
      })

      await traverseAllValues(doc.data, async (val, k, p) => {
        // Text of cited references isn't written by the author
        if (isInCitedReference(p)) { return }
        const inBoilerplate = Boolean(boilerplateOf(p))
        // Strip array indices (e.g. "bcp14[0]") so path segments can be matched by tag name
        const pathSegments = p.map(seg => seg.replace(/\[\d+\]$/, ''))
        const inBcp14Tag = pathSegments.includes('bcp14')
        const inExcludedBlock = pathSegments.some(seg => BCP14_EXCLUDED_BLOCKS.includes(seg))

        if (BCP14_PROSE_TAGS.includes(k) || inBcp14Tag) {
          const str = val.replaceAll('\n', ' ')
          // Boilerplate Match
          const blMatch = str.match(REQ_LEVEL_BOILETPLATE_RE)
          if (blMatch) {
            hasBoilerplate = true
            // Keywords in the same text outside the boilerplate are uses, as in a YANG module
            // whose description repeats the boilerplate
            for (const match of str.replace(REQ_LEVEL_BOILETPLATE_RE, ' ').matchAll(REQ_LEVEL_KEYWORDS_RE)) {
              hasKeywords = true
              if (match[0] === 'NOT RECOMMENDED') {
                hasNotRecommended = true
              }
            }
          } else {
            // Keyword Match
            const kwMatches = str.matchAll(REQ_LEVEL_KEYWORDS_RE)
            for (const match of kwMatches) {
              // The boilerplate's own keywords aren't uses
              if (!inBoilerplate) {
                hasKeywords = true
                if (match[0] === 'NOT RECOMMENDED') {
                  hasNotRecommended = true
                }
              }
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
          }
        }
      })

      hasNotRecommendedInBoilerplate = [...boilerplates.values()].some(Boolean)

      // Keywords found but no boilerplate
      if (hasKeywords && !hasBoilerplate) {
        if (hasRef) {
          result.push(new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE', 'One or more BCP14 keywords are present and a reference to BCP14 exists but a BCP14 boilerplate is missing.', {
            ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
          }))
        } else {
          if (mode === MODES.NORMAL) {
            result.push(new ValidationError('MISSING_REQLEVEL_BOILERPLATE', 'One or more BCP14 keywords are present but a BCP14 boilerplate and a reference are missing.', {
              ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
            }))
          } else {
            result.push(new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE', 'One or more BCP14 keywords are present but a BCP14 boilerplate and a reference are missing.', {
              ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
            }))
          }
        }
      // Boilerplate found but no keywords
      } else if (!hasKeywords && hasBoilerplate) {
        result.push(new ValidationWarning('MISSING_REQLEVEL_KEYWORDS', 'A BCP14 boilerplate is present but no keywords are used in the document.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
        }))
      // NOT RECOMMENDED appears but not in boilerplate
      } else if (hasNotRecommended && !hasNotRecommendedInBoilerplate) {
        result.push(new ValidationWarning('MISSING_NOTRECOMMENDED_IN_BOILERPLATE', 'The keyword NOT RECOMMENDED appears but not included in the BCP14 boilerplate.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
        }))
      }

      // Has boilerplate but no reference
      if (hasBoilerplate && !hasRef) {
        result.push(new ValidationError('MISSING_REQLEVEL_REF', 'A BCP14 boilerplate is present but no reference to BCP14 was found.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
        }))
      }

      if (hasBoilerplate || hasKeywords) {
        result.push(...validateBcp14Citations({
          rfc2119: hasRFC2119Ref,
          rfc8174: hasRFC8174Ref,
          bcp14: findBcp14XmlCitations(doc).has('BCP14')
        }))
      }
      break
    }
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
