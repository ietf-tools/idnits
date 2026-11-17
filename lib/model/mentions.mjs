import { traverseAllValues } from '../helpers/traversal.mjs'
import { isInCitedReference } from '../helpers/xml-paths.mjs'
import { getLocations } from '../parsers/txt.mjs'
import { CERTAINTY, getIndex } from './indexes.mjs'

// Text that reads as an IPv4 address, valid or not: four dot-separated numbers, with an optional prefix
// length ("192.0.2.1", "198.51.100.0/24", "1.2.156.10197")
export const IPV4_LOOSE_RE = /(?<![0-9a-zA-Z]+\.)\b([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]+(\/[0-9]{1,3})?)\b(?!\.[a-zA-Z0-9])/g

// Text that reads as an IPv6 address, valid or not: full, compressed, with an embedded IPv4 address or the
// loopback, with an optional prefix length ("2001:db8::1", "::ffff:192.0.2.1", "2001:db8::/32")
export const IPV6_LOOSE_RE = /(?<![0-9a-f:])((?<full>[0-9a-f]+(:[0-9a-f]*){7})|(?<compressed>([0-9a-f]+:)+((:[0-9a-f]+)+|:))|(?<mixv4>[0-9a-f]+(:[0-9a-f]*){5}:([0-9]+\.){3}[0-9]+)|(?<compressedv4>::([0-9a-f]+:)*([0-9]+\.){3}[0-9]+)|(?<loopback>::[0-9]+))(?<cidr>\/[0-9]+)?(?![0-9a-f]|:[0-9a-f:])/gi

// Text that reads as a domain name ending in .com, .org, .net or .arpa ("www.example.com"): the domain is
// the "domain" group
export const FQDN_RE = /(?<=^|\s)(?<domain>(?:[a-z0-9-]{2,}\.)+(?:com|org|net|arpa))\b(?!(@|\.\w))/gi

/**
 * @typedef {Object} MentionKind
 * @property {string} list List of the text parser's extracted elements (doc.data.extractedElements)
 *   holding the mentions
 * @property {boolean} [distinct=false] Whether that list keeps each mention once, however many times it is
 *   found (its locations still list every time)
 * @property {RegExp} pattern Pattern matching the mentions in the values of an XML document
 * @property {function(RegExpMatchArray): string} [value] The mention a match is (the whole match when not
 *   given)
 * @property {string[]} [keys] Keys of the values of an XML document searched (see XmlValue): all values,
 *   attributes included, when not given
 */

/** @type {Object<string, MentionKind>} How the mentions of each kind are found */
const KINDS = {
  ipv4: {
    list: 'ipv4',
    pattern: IPV4_LOOSE_RE
  },
  ipv6: {
    list: 'ipv6',
    pattern: IPV6_LOOSE_RE
  },
  fqdn: {
    list: 'fqdnDomains',
    distinct: true,
    pattern: FQDN_RE,
    value: match => match.groups.domain,
    // Only prose: domains in attributes (targets of links...) aren't searched
    keys: ['t', '#text']
  }
}

/**
 * @typedef {Object} Mention
 * @property {string} text The mention as written ("192.0.2.1", "foo.com"), except for domain names in
 *   text, which the text parser lowercases
 * @property {string} certainty How certain the answer is (CERTAINTY): inferred for both formats, since
 *   both find mentions by matching text
 * @property {{lines: Array<{line: number, pos: number}>|undefined}|{path: string}} location Where the
 *   mention is, as the options of a finding: its line for text (undefined when unknown), the path of the
 *   value it is in for XML
 * @property {number} [valueIndex] XML only: the number of the value the mention is in, counting the values
 *   of the document in order (see getXmlValues), so that mentions of different kinds can be put in order
 */

/**
 * @typedef {Object} XmlValue
 * @property {string} text The value: text of an element or value of an attribute
 * @property {string} key Name of the element or attribute the value belongs to
 * @property {string} path Path of the value
 */

/**
 * Read the mentions of a kind in a text document from the list its parser extracted, where each mention
 * is found (doc.data.extractedElements.locations)
 *
 * Most lists keep every occurrence of a mention, in document order, as its locations do: the n-th time a
 * mention is in the list, it is at its n-th location. A distinct list keeps each mention once, and it is
 * then found at each of its locations in turn.
 *
 * @param {Object} doc Parsed text document
 * @param {string} kind Kind of mention
 * @returns {Mention[]} Mentions, in the order of the list (for a distinct list, the occurrences of each
 *   mention in document order, the mention at least once)
 */
function readTextMentions (doc, kind) {
  const { list, distinct } = KINDS[kind]
  const entries = doc.data.extractedElements?.[list] || []
  if (distinct) {
    return entries.flatMap(text => {
      const locations = getLocations(doc, list, text)
      if (locations.length === 0) {
        return [textMention(text, undefined)]
      }
      return locations.map(location => textMention(text, location))
    })
  }
  const seen = new Map()
  return entries.map(text => {
    const n = seen.get(text) ?? 0
    seen.set(text, n + 1)
    return textMention(text, getLocations(doc, list, text)[n])
  })
}

/**
 * Mention in a text document
 *
 * @param {string} text The mention
 * @param {{line: number, pos: number}|undefined} location Where it is, undefined when unknown
 * @returns {Mention} Mention
 */
function textMention (text, location) {
  return { text, certainty: CERTAINTY.INFERRED, location: { lines: location ? [location] : undefined } }
}

/**
 * Get the values of an XML document that its author wrote, read once per document: the text of its
 * elements and the values of their attributes, leaving out those of cited references (the text of
 * a cited reference isn't written by the author)
 *
 * @param {Object} doc Parsed XML document
 * @returns {Promise<XmlValue[]>} Values, in document order
 */
function getXmlValues (doc) {
  return getIndex(doc, 'xmlValues', async () => {
    const values = []
    await traverseAllValues(doc.data, (text, key, path) => {
      if (!isInCitedReference(path)) {
        values.push({ text, key, path: path.join('.') })
      }
    })
    return values
  })
}

/**
 * Read the mentions of a kind in an XML document by matching each of its values searched, every time
 * one is found
 *
 * @param {Object} doc Parsed XML document
 * @param {string} kind Kind of mention
 * @returns {Promise<Mention[]>} Mentions, in document order
 */
async function readXmlMentions (doc, kind) {
  const { pattern, value = match => match[0], keys } = KINDS[kind]
  const values = await getXmlValues(doc)
  const mentions = []
  values.forEach(({ text, key, path }, valueIndex) => {
    if (keys && !keys.includes(key)) {
      return
    }
    for (const match of text.matchAll(pattern)) {
      mentions.push({ text: value(match), certainty: CERTAINTY.INFERRED, location: { path }, valueIndex })
    }
  })
  return mentions
}

/**
 * Get the mentions of a kind in a document, every time one is found, read once per document
 *
 * Mentions are found by matching text, valid or not: a check tells whether each one is valid.
 *
 * @example
 * await getMentions(xmlDoc, 'ipv4') // [{ text: '192.0.2.1', certainty: 'inferred', location: { path: 'rfc.middle.section[0].t[1]' }, valueIndex: 12 }]
 * await getMentions(txtDoc, 'ipv4') // [{ text: '192.0.2.1', certainty: 'inferred', location: { lines: [{ line: 80, pos: 7 }] } }]
 * await getMentions(txtDoc, 'fqdn') // [{ text: 'foo.com', ..., location: { lines: [{ line: 120, pos: 14 }] } }, { text: 'foo.com', ..., location: { lines: [{ line: 342, pos: 3 }] } }]
 *
 * @param {Object} doc Parsed document, text or XML
 * @param {string} kind Kind of mention: ipv4, ipv6 or fqdn (domain names)
 * @returns {Promise<Mention[]>} Mentions: for text, in the order the parser extracted them; for XML, in
 *   document order
 */
export async function getMentions (doc, kind) {
  if (doc.type === 'txt') {
    return getIndex(doc, `mentions:${kind}`, () => readTextMentions(doc, kind))
  }
  return getIndex(doc, `mentions:${kind}`, () => readXmlMentions(doc, kind))
}
