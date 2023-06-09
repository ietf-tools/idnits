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
 * Validate a document usage of RFC 2119 keywords
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
      // TODO: Text type validation
      break
    }
    case 'xml': {
      const hasRef = doc.externalEntities.some(e => e.name === 'RFC2119')
      let hasKeywords = false
      let hasBoilerplate = false
      let hasNotRecommended = false
      let hasNotRecommendedInBoilerplate = false

      await traverseAllValues(doc.data, async (val, k, p) => {
        if (['t', '#text', null].includes(k)) {
          // Boilerplate Match
          const blMatch = val.match(REQ_LEVEL_BOILETPLATE_RE)
          if (blMatch) {
            hasBoilerplate = true

            if (blMatch[0].includes('NOT RECOMMENDED')) {
              hasNotRecommendedInBoilerplate = true
            }
          } else {
            // Keyword Match
            const kwMatches = val.matchAll(REQ_LEVEL_KEYWORDS_RE)
            for (const match of kwMatches) {
              hasKeywords = true
              if (!REQ_LEVEL_KEYWORDS_ALLOWED.includes(match[0])) {
                result.push(new ValidationComment('INVALID_REQLEVEL_KEYWORD', `${match[0]} is not a valid RFC2119 Requirement Level keyword.`, {
                  ref: 'https://datatracker.ietf.org/doc/html/rfc2119',
                  path: p.join('.')
                }))
              }
              if (match[0] === 'NOT RECOMMENDED') {
                hasNotRecommended = true
              }
            }
          }
        }
      })

      // Keywords found but no boilerplate
      if (hasKeywords && !hasBoilerplate) {
        if (hasRef) {
          result.push(new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE', 'One or more RFC2119 keywords are present and a reference to RFC2119 exists but an RFC2119 boilerplate is missing.', {
            ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
          }))
        } else {
          if (mode === MODES.NORMAL) {
            result.push(new ValidationError('MISSING_REQLEVEL_BOILERPLATE', 'One or more RFC2119 keywords are present but an RFC2119 boilerplate and a reference are missing.', {
              ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
            }))
          } else {
            result.push(new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE', 'One or more RFC2119 keywords are present but an RFC2119 boilerplate and a reference are missing.', {
              ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
            }))
          }
        }
      // Boilerplate found but no keywords
      } else if (!hasKeywords && hasBoilerplate) {
        result.push(new ValidationWarning('MISSING_REQLEVEL_KEYWORDS', 'An RFC2119 boilerplate is present but no keywords are used in the document.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
        }))
      // NOT RECOMMENDED appears but not in boilerplate
      } else if (hasNotRecommended && !hasNotRecommendedInBoilerplate) {
        result.push(new ValidationWarning('MISSING_NOTRECOMMENDED_IN_BOILERPLATE', 'The keyword NOT RECOMMENDED appears but not included in the RFC2119 boilerplate.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
        }))
      }

      // Has boilerplate but no reference
      if (hasBoilerplate && !hasRef) {
        result.push(new ValidationError('MISSING_REQLEVEL_REF', 'An RFC2119 boilerplate is present but no reference to the RFC2119 was found.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
        }))
      }
      break
    }
  }

  return result
}

// --------------------------------------------------------------------

const INVALID_TERMS_RE = /demultiplexor|diffserv|e[-\s]mail|internet\sdraft|ipsec|on[-\s]line|pseudo[-\s]wire|public-key|sub-domain|sub-options|time-stamp|us-ascii/gi
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
