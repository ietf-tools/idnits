import { ValidationComment, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { traverseAllValues } from '../helpers/traversal.mjs'
import { isInCitedReference } from '../helpers/xml-paths.mjs'
import { getLocations } from '../parsers/txt.mjs'
import { ALLOWED_DOMAINS_DEFAULT } from '../config/externals.mjs'

export const FQDN_RE = /(?<=^|\s)(?<domain>(?:[a-z0-9-]{2,}\.)+(?:com|org|net|arpa))\b(?!(@|\.\w))/gi
const FQDN_EXAMPLE_RE = /^(?:[a-z0-9_-]+\.)*example(?:\.(?:com|org|net))?$/i
const FQDN_ARPA_RE = /^(?:[a-z0-9_-]+\.)*(?:6tisch|as112|e164|eap-noob|home|in-addr-servers|in-addr|ip6-servers|ip6|ipv4only|iris|ns|resolver|service|uri|urn)\.arpa$/i
const FQDN_COMMENT_RE = /^(?:[a-z0-9_-]+\.)*(?:github\.com|github\.io|gitlab\.com|gitlab\.io)$/i
const FQDN_NUMS_IGNORE_RE = /^[0-9]+\.[0-9]+\./
const FQDN_DOTDOT_IGNORE_RE = /^.\..\../

// Most occurrences of a domain listed in a finding
const MAX_LOCATIONS = 20

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
 * Whether a domain is one the author may use: a listed domain or a subdomain of one
 *
 * @param {string} fqdn
 * @param {string[]} allowedDomains
 * @returns {boolean}
 */
export function isAllowedFQDN (fqdn, allowedDomains = []) {
  const name = fqdn.toLowerCase()
  return allowedDomains.some(d => {
    const allowed = d.toLowerCase()
    return name === allowed || name.endsWith(`.${allowed}`)
  })
}

/**
 * Validate a document FQDN mentions
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {string[]} [opts.allowedDomains] Domains (and their subdomains) the author may use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateFQDNs (doc, { mode = MODES.NORMAL, offline = false, allowedDomains = ALLOWED_DOMAINS_DEFAULT } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  switch (doc.type) {
    case 'txt': {
      const { fqdnDomains, splitEmailAddresses = [] } = doc.data.extractedElements

      // xml2rfc broke the address mid-word to fit the line: its second part is no domain of its own
      for (const { address, parts, line, pos } of splitEmailAddresses) {
        result.push(new ValidationWarning('TOKEN_SPLIT_ACROSS_LINES', `Email address "${address}" is broken mid-word across lines ${line} and ${line + 1} ("${parts[0]}" / "${parts[1]}"). Avoid putting the address where it cannot fit on the line: in XML, for example, use <dl newline="true"> so that it starts a line of its own.`, {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#dl',
          lines: [{ line, pos }],
          text: address
        }))
      }

      for (const domain of fqdnDomains) {
        if (isRestrictedFQDN(domain) || isAllowedFQDN(domain, allowedDomains)) {
          continue
        }
        const locations = getLocations(doc, 'fqdnDomains', domain)
        const lines = locations.length > 0 ? locations.slice(0, MAX_LOCATIONS) : undefined

        if (domain.endsWith('.arpa')) {
          result.push(new ValidationWarning('INVALID_ARPA_DOMAIN', `ARPA domain "${domain}" usage is invalid.`, {
            ref: 'https://www.iana.org/domains/arpa',
            lines,
            text: domain
          }))
        } else if (FQDN_COMMENT_RE.test(domain)) {
          result.push(new ValidationComment('POSSIBLE_INVALID_TLD', `Ensure "${domain}" isn't used as a example. For example domains, consider using ".example.(com|org|net)" instead.`, {
            ref: 'https://www.rfc-editor.org/rfc/rfc6761',
            lines,
            text: domain
          }))
        } else {
          result.push(new ValidationWarning('INVALID_DOMAIN_TLD', `Domain "${domain}" is not an allowed reserved domain. Consider using ".example.(com|org|net)" instead.`, {
            ref: 'https://www.rfc-editor.org/rfc/rfc6761',
            lines,
            text: domain
          }))
        }
      }
      break
    }
    case 'xml': {
      await traverseAllValues(doc.data, async (val, k, p) => {
        // Text of cited references isn't written by the author
        if (isInCitedReference(p)) { return }
        if (['t', '#text'].includes(k)) {
          const domainMatches = val.matchAll(FQDN_RE)
          for (const match of domainMatches) {
            if (isRestrictedFQDN(match.groups.domain) || isAllowedFQDN(match.groups.domain, allowedDomains)) {
              continue
            }

            if (match.groups.domain.endsWith('.arpa')) {
              result.push(new ValidationWarning('INVALID_ARPA_DOMAIN', `ARPA domain "${match.groups.domain}" usage is invalid.`, {
                ref: 'https://www.iana.org/domains/arpa',
                path: p.join('.'),
                text: match.groups.domain
              }))
            } else if (FQDN_COMMENT_RE.test(match.groups.domain)) {
              result.push(new ValidationComment('POSSIBLE_INVALID_TLD', `Ensure "${match.groups.domain}" isn't used as a example. For example domains, consider using ".example.(com|org|net)" instead.`, {
                ref: 'https://www.rfc-editor.org/rfc/rfc6761',
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
