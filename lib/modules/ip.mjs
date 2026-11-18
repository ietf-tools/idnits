import { ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { getMentions } from '../model/mentions.mjs'

// The text parser and the tests take the patterns of a mention from here
export { IPV4_LOOSE_RE, IPV6_LOOSE_RE } from '../model/mentions.mjs'

const IPV4_RE = /^(\b25[0-5]|\b2[0-4][0-9]|\b[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}(\/([0-9]|[1-2][0-9]|3[0-2]))?$/
const IPV6_RE = /^(([0-9a-f]{1,4}:){7,7}[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,7}:|([0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,5}(:[0-9a-f]{1,4}){1,2}|([0-9a-f]{1,4}:){1,4}(:[0-9a-f]{1,4}){1,3}|([0-9a-f]{1,4}:){1,3}(:[0-9a-f]{1,4}){1,4}|([0-9a-f]{1,4}:){1,2}(:[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:((:[0-9a-f]{1,4}){1,6})|:((:[0-9a-f]{1,4}){1,7}|:)|fe80:(:[0-9a-f]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-f]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))(\/(0|([1-9][0-9]?)|(1[0-1][0-9])|12[0-8]))?$/i

// What makes an address of each kind valid, and the finding for one that isn't
const ADDRESS_KINDS = {
  ipv4: {
    valid: IPV4_RE,
    code: 'INVALID_IPV4_ADDRESS',
    message: 'IPv4 address is invalid.',
    ref: 'https://datatracker.ietf.org/doc/html/rfc791'
  },
  ipv6: {
    valid: IPV6_RE,
    code: 'INVALID_IPV6_ADDRESS',
    message: 'IPv6 address is invalid.',
    ref: 'https://datatracker.ietf.org/doc/html/rfc4291'
  }
}

/**
 * Validate document IP address mentions
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateIPs (doc, { mode = MODES.NORMAL } = {}) {
  if (mode === MODES.SUBMISSION) {
    return []
  }

  const invalid = []
  for (const [kind, { valid }] of Object.entries(ADDRESS_KINDS)) {
    for (const mention of await getMentions(doc, kind)) {
      if (!valid.test(mention.text)) {
        invalid.push({ kind, mention })
      }
    }
  }
  // -> Text lists the IPv4 addresses, then the IPv6 ones; XML lists the addresses of each value in turn,
  //    its IPv4 addresses before its IPv6 ones (a stable sort keeps that order within a value)
  if (doc.type === 'xml') {
    invalid.sort((a, b) => a.mention.valueIndex - b.mention.valueIndex)
  }

  return invalid.map(({ kind, mention }) => {
    const { code, message, ref } = ADDRESS_KINDS[kind]
    return new ValidationWarning(code, message, { ref, ...mention.location, text: mention.text })
  })
}
