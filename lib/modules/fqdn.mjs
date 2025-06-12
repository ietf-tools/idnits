import { ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { traverseAllValues } from '../helpers/traversal.mjs'

export const FQDN_RE = /(?<=^|\s)(?<domain>(?:[a-z0-9-]{2,}\.)+(?:com|org|net|arpa))\b(?!(@|\.\w))/gi
const FQDN_EXAMPLE_RE = /^(?:[a-z0-9_-]+\.)*example(?:\.(?:com|org|net))?$/i
const FQDN_ARPA_RE = /^(?:[a-z0-9_-]+\.)*(?:urn|uri|in-addr)\.arpa$/i
const FQDN_NUMS_IGNORE_RE = /^[0-9]+\.[0-9]+\./
const FQDN_DOTDOT_IGNORE_RE = /^.\..\../

/**
 * Helping function for domain restriction check
 *
 * @param {string} fqdn
 * @returns {boolean}
 */
export function isRestrictedFQDN (fqdn) {
  if (FQDN_EXAMPLE_RE.test(fqdn)) {
    return true
  }
  if (FQDN_ARPA_RE.test(fqdn)) {
    return true
  }
  if (FQDN_NUMS_IGNORE_RE.test(fqdn)) {
    return true
  }
  if (fqdn === 'www.ietf.org') {
    return true
  }
  if (FQDN_DOTDOT_IGNORE_RE.test(fqdn)) {
    return true
  }
  return false
}

/**
 * Validate a document FQDN mentions
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateFQDNs (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  switch (doc.type) {
    case 'txt': {
      const { fqdnDomains } = doc.data.extractedElements

      for (const domain of fqdnDomains) {
        if (isRestrictedFQDN(domain)) {
          continue
        }

        if (domain.endsWith('.arpa')) {
          result.push(new ValidationWarning('INVALID_ARPA_DOMAIN', `ARPA domain "${domain}" usage is invalid.`, {
            ref: 'https://www.iana.org/domains/arpa',
            text: domain
          }))
        } else {
          result.push(new ValidationWarning('INVALID_DOMAIN_TLD', `Domain "${domain}" is not an allowed reserved domain. Consider using ".example.(com|org|net)" instead.`, {
            ref: 'https://www.rfc-editor.org/rfc/rfc6761',
            text: domain
          }))
        }
      }
      break
    }
    case 'xml': {
      await traverseAllValues(doc.data, async (val, k, p) => {
        if (['t', '#text'].includes(k)) {
          const domainMatches = val.matchAll(FQDN_RE)
          for (const match of domainMatches) {
            if (isRestrictedFQDN(match.groups.domain)) {
              continue
            }

            if (match.groups.domain.endsWith('.arpa')) {
              result.push(new ValidationWarning('INVALID_ARPA_DOMAIN', `ARPA domain "${match.groups.domain}" usage is invalid.`, {
                ref: 'https://www.iana.org/domains/arpa',
                path: p.join('.'),
                text: match.groups.domain
              }))
            } else {
              result.push(new ValidationWarning('INVALID_DOMAIN_TLD', `Domain "${match.groups.domain}" is not an allowed reserved domain. Consider using ".example.(com|org|net)" instead.`, {
                ref: 'https://www.rfc-editor.org/rfc/rfc6761',
                path: p.join('.'),
                text: match.groups.domain
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
