import { ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { traverseAllValues } from '../helpers/traversal.mjs'
import { isValidDomainTLD, isValidArpaDomain } from '../remote/iana.mjs'

const FQDN_RE = /(?<domain>(?:[a-z0-9-]+\.)+(?:[a-z0-9]{2,}))\.?(?![a-z0-9-_]+)/gi

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
      // TODO: Text type validation
      break
    }
    case 'xml': {
      await traverseAllValues(doc.data, async (val, k, p) => {
        if (['t', '#text'].includes(k)) {
          const domainMatches = val.matchAll(FQDN_RE)
          for (const match of domainMatches) {
            if (!offline && !(await isValidDomainTLD(match.groups.domain))) {
              result.push(new ValidationWarning('INVALID_DOMAIN_TLD', 'Domain has an invalid TLD.', {
                ref: 'https://www.iana.org/domains/root/db',
                path: p.join('.'),
                text: match.groups.domain
              }))
            } else if (!offline && match.groups.domain.endsWith('.arpa') && !(await isValidArpaDomain(match.groups.domain))) {
              result.push(new ValidationWarning('INVALID_ARPA_DOMAIN', 'ARPA domain usage is invalid.', {
                ref: 'https://www.iana.org/domains/arpa',
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
