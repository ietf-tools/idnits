import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { findAllDescendantsWith, traverseAllValues } from '../helpers/traversal.mjs'

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

      if (!hasBoilerplate && doc.data.boilerplate.similar2119boilerplate) {
        result.push(new ValidationError('MISSING_REQLEVEL_BOILERPLATE', 'A BCP14 boilerplate is missing but a similar boilerplate was found.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
        }))
      }

      if (keywords.length && !hasBoilerplate && !hasReferences) {
        if (mode === MODES.NORMAL) {
          result.push(new ValidationError('MISSING_REQLEVEL_BOILERPLATE', 'One or more BCP14 keywords are present but a BCP14 boilerplate and a reference are missing.', {
            ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
          }))
        } else {
          result.push(new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE', 'One or more BCP14 keywords are present but a BCP14 boilerplate and a reference are missing.', {
            ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
          }))
        }
      } else if (keywords.length && hasReferences && !hasBoilerplate) {
        result.push(new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE', 'One or more BCP14 keywords are present but a BCP14 boilerplate is missing.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
        }))
      } else if (hasBoilerplate && !hasNonBoilerplateKeywords) {
        result.push(new ValidationWarning('MISSING_REQLEVEL_KEYWORDS', 'A BCP14 boilerplate is present but no keywords are used in the document.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
        }))
      } else if (keywords.find((word) => word.keyword === 'NOT RECOMMENDED') && !boilerplateKeywords.includes('NOT RECOMMENDED')) {
        result.push(new ValidationWarning('MISSING_NOTRECOMMENDED_IN_BOILERPLATE', 'The keyword NOT RECOMMENDED appears but not included in the BCP14 boilerplate.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
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

      // Warn if BCP14 reference is missing but RFC2119/RFC8174 is used
      if ((doc.data.references.rfc2119 || doc.data.references.rfc8174) && !doc.data.references.bcp14 && (hasBoilerplate || keywords.length)) {
        result.push(new ValidationWarning('PREFER_BCP14_REF', 'Consider referencing BCP14 instead of (or in addition to) RFC2119/RFC8174, as BCP14 encompasses both specifications.', {
          ref: 'https://www.rfc-editor.org/info/bcp14'
        }))
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
      const keywords = []

      await traverseAllValues(doc.data, async (val, k, p) => {
        // Strip array indices (e.g. "bcp14[0]") so path segments can be matched by tag name
        const pathSegments = p.map(seg => seg.replace(/\[\d+\]$/, ''))
        const inBcp14Tag = pathSegments.includes('bcp14')
        const inExcludedBlock = pathSegments.some(seg => BCP14_EXCLUDED_BLOCKS.includes(seg))

        if (BCP14_PROSE_TAGS.includes(k) || inBcp14Tag) {
          if (REQ_LEVEL_KEYWORDS_ALLOWED.includes(val)) {
            keywords.push(val)
          }

          const str = val.replaceAll('\n', ' ')
          // Boilerplate Match
          const blMatch = str.match(REQ_LEVEL_BOILETPLATE_RE)
          if (blMatch) {
            hasBoilerplate = true

            if (blMatch[0].includes('NOT RECOMMENDED') || keywords.includes('NOT RECOMMENDED')) {
              hasNotRecommendedInBoilerplate = true
            }
          } else {
            // Keyword Match
            const kwMatches = str.matchAll(REQ_LEVEL_KEYWORDS_RE)
            for (const match of kwMatches) {
              hasKeywords = true
              if (!REQ_LEVEL_KEYWORDS_ALLOWED.includes(match[0])) {
                result.push(new ValidationComment('INVALID_REQLEVEL_KEYWORD', `${match[0]} is not a valid BCP14 Requirement Level keyword.`, {
                  ref: 'https://www.rfc-editor.org/info/bcp14',
                  path: p.join('.')
                }))
              }
              if (match[0] === 'NOT RECOMMENDED' || keywords.includes('NOT RECOMMENDED')) {
                hasNotRecommended = true
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

      // Warn if BCP14 reference is missing but RFC2119/RFC8174 is used
      if ((hasRFC2119Ref || hasRFC8174Ref) && !hasBCP14Ref && (hasBoilerplate || hasKeywords)) {
        result.push(new ValidationWarning('PREFER_BCP14_REF', 'Consider referencing BCP14 instead of (or in addition to) RFC2119/RFC8174, as BCP14 encompasses both specifications.', {
          ref: 'https://www.rfc-editor.org/info/bcp14'
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
                pos: match.index
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
