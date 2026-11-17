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

// Lists of the text parser's extracted elements (doc.data.extractedElements) holding the mentions, by kind
const TEXT_LISTS = {
  ipv4: 'ipv4',
  ipv6: 'ipv6'
}

// Patterns matching the mentions in the values of an XML document, by kind
const XML_PATTERNS = {
  ipv4: IPV4_LOOSE_RE,
  ipv6: IPV6_LOOSE_RE
}

/**
 * @typedef {Object} Mention
 * @property {string} text The mention as written ("192.0.2.1")
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
 * The list keeps every occurrence of a mention, in document order, as its locations do: the n-th time a
 * mention is in the list, it is at its n-th location.
 *
 * @param {Object} doc Parsed text document
 * @param {string} kind Kind of mention
 * @returns {Mention[]} Mentions, in the order of the list
 */
function readTextMentions (doc, kind) {
  const list = TEXT_LISTS[kind]
  const entries = doc.data.extractedElements?.[list] || []
  const seen = new Map()
  return entries.map(text => {
    const n = seen.get(text) ?? 0
    seen.set(text, n + 1)
    const location = getLocations(doc, list, text)[n]
    return { text, certainty: CERTAINTY.INFERRED, location: { lines: location ? [location] : undefined } }
  })
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
 * Read the mentions of a kind in an XML document by matching each of its values, every time one is found
 *
 * @param {Object} doc Parsed XML document
 * @param {string} kind Kind of mention
 * @returns {Promise<Mention[]>} Mentions, in document order
 */
async function readXmlMentions (doc, kind) {
  const values = await getXmlValues(doc)
  const mentions = []
  values.forEach(({ text, path }, valueIndex) => {
    for (const match of text.matchAll(XML_PATTERNS[kind])) {
      mentions.push({ text: match[0], certainty: CERTAINTY.INFERRED, location: { path }, valueIndex })
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
 *
 * @param {Object} doc Parsed document, text or XML
 * @param {string} kind Kind of mention: ipv4 or ipv6
 * @returns {Promise<Mention[]>} Mentions: for text, in the order the parser extracted them; for XML, in
 *   document order
 */
export async function getMentions (doc, kind) {
  if (doc.type === 'txt') {
    return getIndex(doc, `mentions:${kind}`, () => readTextMentions(doc, kind))
  }
  return getIndex(doc, `mentions:${kind}`, () => readXmlMentions(doc, kind))
}
