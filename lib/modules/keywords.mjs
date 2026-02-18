import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { traverseAllValues } from '../helpers/traversal.mjs'

const REQ_LEVEL_KEYWORDS_RE = /((NOT|not)\s)?(MUST|REQUIRED|SHALL|RECOMMENDED|OPTIONAL|MAY)(\s(NOT|not))?/g
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
      const hasRFC2119Ref = doc.externalEntities.some(e => e.name === 'RFC2119')
      const hasRFC8174Ref = doc.externalEntities.some(e => e.name === 'RFC8174')
      const hasBCP14Ref = doc.externalEntities.some(e => e.name === 'BCP14')
      const hasRef = hasRFC2119Ref || hasRFC8174Ref || hasBCP14Ref
      let hasKeywords = false
      let hasBoilerplate = false
      let hasNotRecommended = false
      let hasNotRecommendedInBoilerplate = false
      const keywords = []

      await traverseAllValues(doc.data, async (val, k, p) => {
        if (['t', '#text', null].includes(k)) {
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
      if (hasBoilerplate && !hasRef && !keywords.length) {
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
