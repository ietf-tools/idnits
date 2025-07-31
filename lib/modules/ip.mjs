import { ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { traverseAllValues } from '../helpers/traversal.mjs'

export const IPV4_LOOSE_RE = /(?<![0-9a-zA-Z]+\.)\b([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]+(\/[0-9]{1,3})?)\b(?!\.[a-zA-Z0-9])/g
const IPV4_RE = /^(\b25[0-5]|\b2[0-4][0-9]|\b[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}(\/([0-9]|[1-2][0-9]|3[0-2]))?$/
export const IPV6_LOOSE_RE = /((?<full>[0-9a-f]+(:[0-9a-f]*){7})|(?<compressed>([0-9a-f]+:)+((:[0-9a-f]+)+|:))|(?<mixv4>[0-9a-f]+(:[0-9a-f]*){5}:([0-9]+\.){3}[0-9]+)|(?<compressedv4>::([0-9a-f]+:)*([0-9]+\.){3}[0-9]+)|(?<loopback>::[0-9]+))(?<cidr>\/[0-9]+)?/gi
const IPV6_RE = /^(([0-9a-f]{1,4}:){7,7}[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,7}:|([0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,5}(:[0-9a-f]{1,4}){1,2}|([0-9a-f]{1,4}:){1,4}(:[0-9a-f]{1,4}){1,3}|([0-9a-f]{1,4}:){1,3}(:[0-9a-f]{1,4}){1,4}|([0-9a-f]{1,4}:){1,2}(:[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:((:[0-9a-f]{1,4}){1,6})|:((:[0-9a-f]{1,4}){1,7}|:)|fe80:(:[0-9a-f]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-f]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))(\/(0|([1-9][0-9]?)|(1[0-1][0-9])|12[0-8]))?$/i

/**
 * Validate document IP address mentions
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateIPs (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  switch (doc.type) {
    case 'txt': {
      const ipv4Addresses = doc.data.extractedElements?.ipv4 || []
      const ipv6Addresses = doc.data.extractedElements?.ipv6 || []

      for (const ipv4Addr of ipv4Addresses) {
        if (!IPV4_RE.test(ipv4Addr)) {
          result.push(new ValidationWarning('INVALID_IPV4_ADDRESS', 'IPv4 address is invalid.', {
            ref: 'https://datatracker.ietf.org/doc/html/rfc791',
            text: ipv4Addr
          }))
        }
      }

      for (const ipv6Addr of ipv6Addresses) {
        if (!IPV6_RE.test(ipv6Addr)) {
          result.push(
            new ValidationWarning(
              'INVALID_IPV6_ADDRESS',
              'IPv6 address is invalid.',
              {
                ref: 'https://datatracker.ietf.org/doc/html/rfc4291',
                text: ipv6Addr
              }
            )
          )
        }
      }

      break
    }
    case 'xml': {
      await traverseAllValues(doc.data, (val, k, p) => {
        const ipv4Matches = val.matchAll(IPV4_LOOSE_RE)
        for (const match of ipv4Matches) {
          if (!IPV4_RE.test(match[0])) {
            result.push(new ValidationWarning('INVALID_IPV4_ADDRESS', 'IPv4 address is invalid.', {
              ref: 'https://datatracker.ietf.org/doc/html/rfc791',
              path: p.join('.'),
              text: match[0]
            }))
          }
        }
        const ipv6Matches = val.matchAll(IPV6_LOOSE_RE)
        for (const match of ipv6Matches) {
          if (!IPV6_RE.test(match[0])) {
            result.push(new ValidationWarning('INVALID_IPV6_ADDRESS', 'IPv6 address is invalid.', {
              ref: 'https://datatracker.ietf.org/doc/html/rfc4291',
              path: p.join('.'),
              text: match[0]
            }))
          }
        }
      })
      break
    }
  }

  return result
}
