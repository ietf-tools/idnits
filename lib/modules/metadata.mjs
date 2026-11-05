import { ValidationComment, ValidationWarning } from '../helpers/error.mjs'
import { traverseAllValues } from '../helpers/traversal.mjs'
import { getDocInfo, getRfcInfo, prefetchRfcInfo, recordSkippedLookup } from '../remote/lookups.mjs'
import { MODES } from '../config/modes.mjs'
import { fetchDatatrackerStream, getDocumentStream, streamDisplayName } from '../helpers/stream.mjs'
import { difference, get, uniq } from 'lodash-es'
import { DateTime } from 'luxon'

import { rfcStatusHierarchy } from '../config/rfc-status-hierarchy.mjs'
import { getLocations } from '../parsers/txt.mjs'
import { maskCommentsAndCdata } from '../helpers/xml-references.mjs'

// Phrases that name the RFCs a document obsoletes or updates, as abstracts write them
const NUM = '[0-9]{1,5}(?![0-9A-Za-z])'
const RFC = '[Rr][Ff][Cc]'
// A parenthetical or citation after an RFC number: ("iCalendar"), (specifying TLS 1.2), [RFC2289]
const AFTER_ONE = '\\s*(?:\\([^()]*\\)|\\[[^\\[\\]]*\\])'
const AFTER = `(?:${AFTER_ONE})*`
// A list of RFC numbers: "RFC 1234", "[RFC1234]", "RFCs 1234 and 5678", "RFC 1234, RFC 5678, and RFC 9012"
const LIST_SEP = '(?:\\s*,\\s*(?:and\\s+|or\\s+)?|\\s+(?:and|or)\\s+)'
const LIST_FIRST = `\\[?${RFC}s?[\\s-]?${NUM}\\]?`
const LIST_NEXT = `${LIST_SEP}(?:\\[?${RFC}s?[\\s-]?)?${NUM}\\]?`
const RFC_LIST = `${LIST_FIRST}${AFTER}(?:${LIST_NEXT}${AFTER})*`
// Words between the verb and the RFCs it names ("the IANA registry specified by", "BCP 38"): none ends
// the clause, starts another relation or names an RFC. A parenthetical without an RFC is a word.
const STOP_WORDS = `that|which|so|where|when|while|because|thus|thereby|whose|who|${RFC}s?|[Oo]bsolet\\w*|[Uu]pdat\\w*|[Rr]eplac\\w*|[Ss]upersed\\w*`
const token = stopWords => `(?:(?!(?:${stopWords})(?![\\w-]))[^\\s,;:.()\\[\\]]+(?:\\.[^\\s,;:.()\\[\\]]+)*(?![^\\s,;:.()\\[\\]])|\\((?![^()]*${RFC})[^()]*\\))`
const words = stopWords => `(?:${token(stopWords)}\\s*){1,25}`
const WORDS = words(`to|${STOP_WORDS}`)
const WORDS_LOOSE = words(STOP_WORDS)
// A name with the RFCs in parentheses or brackets: "BCP 38 (RFC 2827)", "the S/MIME specification [RFC8551]". Read
// strictly, only parentheses: brackets in a text document cite ("[I-D.foo] supersedes the informational [RFC9180]").
const IN_PARENS = `\\([^()]*?\\b${RFC}s?[\\s-]?${NUM}[^()]*\\)`
const IN_BRACKETS = `(?:${IN_PARENS}|\\[[^\\[\\]]*?\\b${RFC}s?[\\s-]?${NUM}[^\\[\\]]*\\])`
const ITEM_SEP = '(?:\\s*,\\s*(?:and\\s+|or\\s+)?|\\s+(?:and|or)\\s+|\\s*,?\\s+(?:as\\s+well\\s+as|along\\s+with)\\s+)'
// Loose: also any phrase before the RFCs ("updates the registry defined in RFC 9605", "updates BPSec RFC 9172",
// "updates the selection algorithm, originally specified in RFC 6724"), and "to" ("extensions to IPv6 ND (RFC 4861)")
const ITEM_LOOSE = `(?:${RFC_LIST}|${WORDS_LOOSE}${IN_BRACKETS}|${WORDS_LOOSE}(?:,\\s*(?:(?:as|originally|previously|specifically|namely)\\s+)*(?:(?:specified|defined|described)\\s+(?:in|by)\\s+)?)?${RFC_LIST})`
const ITEM_STRICT = `(?:(?:(?:both|the)\\s+)?${RFC_LIST}|${WORDS}(?<!\\b(?:in|of|by|from|on|with|for|to)\\s*)${IN_PARENS})`
// The verb, not negated ("does not update"), not a noun ("the updates", "an update", "updates proposed
// by", "Firmware Updates"), and not someone else's ("includes the updates")
const verb = (stems) => `(?<!\\b(?:not|never|nor|the|an?|these|those|its|their|such|any|of|with|(?:contain|includ)\\w*(?:\\s+the)?)\\s+)(?:\\b|(?<=\\())(?:(?<=(?:^|[.!?:;(]\\s*))(?=[A-Z])|(?<![A-Za-z])(?=[a-z])|(?=[A-Z][a-z]*\\s+\\[?${RFC}))(?:${stems})(?!\\s+(?:is|are|was|were|has|have|had|will|would|can|may|must|should|\\w+ed\\s+(?:in|by|from))\\b)`
const OBSOLETE_STEMS = '[Oo]bsolet(?:e|es|ing)|[Rr]eplac(?:e|es|ing)|[Ss]upersed(?:e|es|ing)'
const UPDATE_STEMS = '[Uu]pdat(?:e|es|ing)'
// What follows the RFCs named before the verb ("RFCs 6096 and 7053 are also obsoleted", "RFC 2205, which defines
// RSVP, is updated"), not someone else's ("is updated by RFC 9999")
const passiveTail = participles => `(?:\\s*,\\s*which\\s[^,.;]*,)?\\s+(?:is|are)\\s+(?:also\\s+)?(?:${participles})\\b(?!\\s+by\\s+(?!this\\b))`
// The phrasings of a relation, tried in this order where several start at the same place (as the alternatives of
// one pattern were): the verb then the RFCs, the RFCs then the verb (read by passiveRelations()), and others
const phrasings = (stems, participles, item, other = null) => ({
  active: new RegExp(`${verb(stems)}\\s+${item}(?:${ITEM_SEP}${item})*`, 'g'),
  passiveTail: new RegExp(passiveTail(participles), 'y'),
  other: other === null ? null : new RegExp(other, 'g')
})
// Mentions that count for a listed RFC; mentions that need it listed are read strictly
const OBSOLETES_RELATION = phrasings(OBSOLETE_STEMS, 'obsoleted|replaced|superseded', ITEM_LOOSE, `\\bmakes\\s+${RFC_LIST}\\s+obsolete\\b`)
const UPDATES_RELATION = phrasings(UPDATE_STEMS, 'updated', ITEM_LOOSE, `(?<!\\b(?:not|never|nor|(?:contain|includ)\\w*(?:\\s+the)?)\\s+)\\b[Uu]pdates?\\s+to\\s+${ITEM_LOOSE}`)
const OBSOLETES_STRICT_RELATION = phrasings(OBSOLETE_STEMS, 'obsoleted|replaced|superseded', ITEM_STRICT, `\\bmakes\\s+${RFC_LIST}\\s+obsolete\\b`)
const UPDATES_STRICT_RELATION = phrasings(UPDATE_STEMS, 'updated', ITEM_STRICT)
const RFC_LIST_RE = new RegExp(RFC_LIST, 'g')
// The parts of an RFC list, read one at a time from where they start (see passiveRelations())
const LIST_START_RE = new RegExp(`(?=\\[?${RFC})`, 'g')
const LIST_FIRST_RE = new RegExp(LIST_FIRST, 'y')
const LIST_NEXT_RE = new RegExp(LIST_NEXT, 'y')
const AFTER_ONE_RE = new RegExp(AFTER_ONE, 'y')
const RFC_NUM_RE_GENERAL = /[0-9]+/
const RFC_NUM_RE = /[0-9]+/g
const VERSION_SUFFIX_RE = /-([0-9]{2})$/
// One value of the <rfc> obsoletes / updates attribute: an RFC number, written "8474", "RFC8474" or "RFC 8474"
const RFC_ATTR_NUMBER_RE = /^(?:RFC\s*)?([0-9]+)$/i
// ... or an Internet-Draft name (RFC 7991, Section 2.45.8)
const RFC_ATTR_DRAFT_RE = /^draft-[a-z0-9-]+$/i
// RFC numbers written otherwise: in brackets, or separated by spaces ("[5652]", "2747 3097")
const RFC_ATTR_MISWRITTEN_RE = /^\[?\s*(?:(?:RFC\s*)?[0-9]+\s*)+\]?$/i
// Whether a number can be an RFC number: 1 to 99999 ("10341035" is RFCs 1034 and 1035 run together)
const isPlausibleRfcNumber = num => Number(num) >= 1 && Number(num) <= 99999
// Invisible characters an editor can leave in an attribute value ("\u200B 4162" in RFC 8996): zero-width
// spaces and joiners, the word joiner and the byte order mark
const RFC_ATTR_INVISIBLE_RE = /[\u200B-\u200D\u2060\uFEFF]/g

const today = DateTime.now()

const XML_ABSTRACT_START_RE = /<abstract\b/
const XML_ABSTRACT_END_RE = /<\/abstract\s*>/g
// An <xref> start tag ("<xref" ends no longer name: "<xref-a>" is one too, as the pattern this replaces read it)
// and end tag (see replaceXrefs)
const XML_XREF_START_RE = /<xref\b/g
const XML_XREF_END_RE = /<\/xref\s*>/g
const XML_TARGET_ATTR_RE = /\btarget\s*=\s*(?:"([^"]*)"|'([^']*)')/
const XML_TAG_RE = /<[^>]*>/g
const XML_CHAR_REF_RE = /&#(x[0-9a-f]+|[0-9]+);/gi
const XML_NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/**
 * Text of an XML document's abstract read from its source, with each <xref> in its place: its
 * content, or its target when it is empty ("updates <xref target="RFC7854">RFC 7854</xref>" and
 * "updates <xref target="RFC7854"/>"). The parsed document keeps an element's text runs apart from
 * its <xref> children, so a sentence naming an RFC through an <xref> can't be read from it.
 *
 * @param {Object} doc Parsed XML document
 * @returns {string} Abstract text, or '' when the source has no abstract
 */
function xmlAbstractSourceText (doc) {
  const source = String(doc.body ?? '')
  // -> Comments and CDATA sections blanked out in one pass: a "<!--" inside CDATA starts no comment, and a lazy
  //    comment pattern would read on to the end of the source from each "<!--" with no end after it
  const withoutComments = maskCommentsAndCdata(source)
  const abstract = abstractContent(withoutComments)
  if (!abstract) {
    return ''
  }
  const withXrefText = replaceXrefs(abstract, xrefText)
  const text = withXrefText.replace(XML_TAG_RE, '')
  const decoded = text
    .replace(XML_CHAR_REF_RE, (match, code) => decodeCharRef(code))
    .replace(/&([a-z]+);/gi, (match, name) => XML_NAMED_ENTITIES[name] ?? match)
  return decoded.replace(/\s+/g, ' ')
}

/**
 * Replace each <xref> element of an XML text, as replacing the matches of
 * /<xref\b([^>]*?)(?:\/>|>([\s\S]*?)<\/xref\s*>)/g does, in time growing with the length of the text
 *
 * That pattern read from each start tag to the first end tag after it, and to the end of the text when there was
 * none ("<xref-a></xref-a>" many times): the text is read once here instead. A start tag ends at the first ">" after
 * "<xref": empty when "/>" ends it, its content then running to the first "</xref>" after it, and no element starts
 * there when there is none. The first ">" and the end tags are found once for all the start tags.
 *
 * @param {string} text Text
 * @param {function(string, string, (string|undefined)): string} replacer Replacement for an element, given the
 *   element, its attributes (the text between "<xref" and the end of its start tag) and its content (undefined
 *   when empty: "<xref/>")
 * @returns {string} Text with each element replaced
 */
function replaceXrefs (text, replacer) {
  const endTags = [...text.matchAll(XML_XREF_END_RE)]
  let nextEndTag = 0
  let startTagEnd = -1
  let from = 0
  const out = []
  XML_XREF_START_RE.lastIndex = 0
  let start = XML_XREF_START_RE.exec(text)
  while (start !== null) {
    const attrsStart = start.index + start[0].length
    // -> The first ">" after "<xref", found again only once past the last one found
    if (startTagEnd < attrsStart) {
      startTagEnd = text.indexOf('>', attrsStart)
    }
    if (startTagEnd < 0) {
      break
    }
    let end = -1
    let attrs
    let content
    if (startTagEnd > attrsStart && text[startTagEnd - 1] === '/') {
      attrs = text.slice(attrsStart, startTagEnd - 1)
      end = startTagEnd + 1
    } else {
      while (nextEndTag < endTags.length && endTags[nextEndTag].index <= startTagEnd) {
        nextEndTag++
      }
      if (nextEndTag < endTags.length) {
        const endTag = endTags[nextEndTag]
        attrs = text.slice(attrsStart, startTagEnd)
        content = text.slice(startTagEnd + 1, endTag.index)
        end = endTag.index + endTag[0].length
      }
    }
    if (end >= 0) {
      const element = text.slice(start.index, end)
      out.push(text.slice(from, start.index), replacer(element, attrs, content))
      from = end
      XML_XREF_START_RE.lastIndex = end
    }
    start = XML_XREF_START_RE.exec(text)
  }
  out.push(text.slice(from))
  return out.join('')
}

/**
 * Content of the first <abstract> element of an XML source: from the first ">" after its start (an empty
 * "<abstract/>" included) to the first end tag after that
 *
 * When the first start tag has no end tag after it, no later one has either: the source is read once, rather
 * than to its end from every start tag ("<abstract/>" a hundred thousand times with no "</abstract>")
 *
 * @param {string} source XML source, comments and CDATA sections blanked out
 * @returns {string|undefined} Content, undefined when no end tag follows the first start tag
 */
function abstractContent (source) {
  const start = source.search(XML_ABSTRACT_START_RE)
  if (start < 0) {
    return undefined
  }
  const startTagEnd = source.indexOf('>', start)
  if (startTagEnd < 0) {
    return undefined
  }
  const endRe = new RegExp(XML_ABSTRACT_END_RE)
  endRe.lastIndex = startTagEnd + 1
  const end = endRe.exec(source)
  if (!end) {
    return undefined
  }
  return source.slice(startTagEnd + 1, end.index)
}

/**
 * Text standing for an <xref> in the abstract: its content, or its target when it is empty
 *
 * @param {string} match The whole <xref> element
 * @param {string} attrs Its attributes
 * @param {string} [content] Its content
 * @returns {string} Text
 */
function xrefText (match, attrs, content) {
  const text = (content ?? '').replace(XML_TAG_RE, '').trim()
  if (text) {
    return text
  }
  const target = attrs.match(XML_TARGET_ATTR_RE)
  if (!target) {
    return ''
  }
  return target[1] ?? target[2]
}

/**
 * Character of a numeric character reference
 *
 * @param {string} code Reference without "&#" and ";" ("x2014" or "8212")
 * @returns {string} Character
 */
function decodeCharRef (code) {
  let codePoint = parseInt(code, 10)
  if (code[0].toLowerCase() === 'x') {
    codePoint = parseInt(code.slice(1), 16)
  }
  return String.fromCodePoint(codePoint)
}

/**
 * RFC numbers an abstract text names as obsoleted or updated: after the verb ("updates RFC 7854",
 * "obsoletes both RFC 2747 and RFC 3097", "updates BCP 38 (RFC 2827)", "updates the registry defined
 * in RFC 9605"), or before it ("RFCs 6096 and 7053 are also obsoleted"). Numbers elsewhere in the
 * phrase ("Section 8", "TLS 1.2", "BCP 38") are not RFC numbers.
 *
 * @param {string} text Abstract text
 * @param {Object} relation Phrasings of the relation (OBSOLETES_RELATION, UPDATES_RELATION...)
 * @returns {Array<string>} RFC numbers
 */
function rfcsAfterVerb (text, relation) {
  const nums = []
  for (const match of relationMatches(String(text).replace(/\s+/g, ' '), relation)) {
    for (const list of match.matchAll(RFC_LIST_RE)) {
      // -> Not the numbers in a parenthetical or citation that names no RFC ("(specifying TLS 1.2)")
      const listed = list[0].replace(/\([^()]*\)|\[[^[\]]*\]/g, inner => /RFC/i.test(inner) ? inner : ' ')
      const numbers = listed.match(RFC_NUM_RE) ?? []
      nums.push(...numbers.map(num => String(Number(num))))
    }
  }
  return uniq(nums)
}

/**
 * The phrases of a text that state a relation, in order, as matchAll() finds them with one pattern whose
 * alternatives are the relation's phrasings: from where the last phrase ends, the first place where one starts,
 * and there the first phrasing that matches
 *
 * @param {string} text Text, its spaces collapsed
 * @param {Object} relation Phrasings of the relation (see phrasings())
 * @returns {Array<string>} The phrases
 */
function relationMatches (text, relation) {
  const passives = passiveRelations(text, relation.passiveTail)
  const phrases = []
  let from = 0
  let nextPassive = 0
  // -> The first phrase of the other phrasings from where it was last looked for (null: none): still the first
  // from a later place if it starts there or after
  let active
  let other
  const firstFrom = (re, found) => {
    if (re === null || found === null) {
      return null
    }
    if (found !== undefined && found.index >= from) {
      return found
    }
    re.lastIndex = from
    return re.exec(text)
  }
  while (true) {
    active = firstFrom(relation.active, active)
    other = firstFrom(relation.other, other)
    while (nextPassive < passives.length && passives[nextPassive].start < from) {
      nextPassive++
    }
    let phrase = null
    if (active !== null) {
      phrase = { start: active.index, end: active.index + active[0].length }
    }
    const passive = passives[nextPassive]
    if (passive !== undefined && (phrase === null || passive.start < phrase.start)) {
      phrase = passive
    }
    if (other !== null && (phrase === null || other.index < phrase.start)) {
      phrase = { start: other.index, end: other.index + other[0].length }
    }
    if (phrase === null) {
      return phrases
    }
    phrases.push(text.slice(phrase.start, phrase.end))
    from = phrase.end
  }
}

/**
 * The phrases naming RFCs before the verb ("RFCs 6096 and 7053 are also obsoleted"), as the pattern RFC_LIST
 * followed by the tail finds them from each place
 *
 * Tried at each RFC of a list, that pattern read the list on to its end again: the time grew with the square of
 * the number of RFCs listed. Each part of a list (the first RFC, its parentheticals and citations, each further
 * RFC with the separator before it) can match in one way only that the list can go on from, so the list from a
 * place ends where the list from the end of its first part ends, and the tail can only follow that end (it
 * doesn't go on into "is", "are" or ", which"). Where the list from each place ends is kept, so that each part of
 * a list is read once.
 *
 * @param {string} text Text, its spaces collapsed
 * @param {RegExp} tailRe What follows the RFCs (sticky)
 * @returns {Array<{start: number, end: number}>} The phrases, by where they start
 */
function passiveRelations (text, tailRe) {
  // -> By place: where the parentheticals and citations from there end (AFTER), where the list goes on to from
  // there (after an RFC and its parentheticals), and where the tail from there ends (null: no tail)
  const afterEnds = new Map()
  const listEnds = new Map()
  const tailEnds = new Map()
  const afterEnd = (start) => {
    const passed = []
    let end = start
    while (!afterEnds.has(end)) {
      AFTER_ONE_RE.lastIndex = end
      if (!AFTER_ONE_RE.test(text)) {
        afterEnds.set(end, end)
        break
      }
      passed.push(end)
      end = AFTER_ONE_RE.lastIndex
    }
    const last = afterEnds.get(end)
    for (const place of passed) {
      afterEnds.set(place, last)
    }
    return last
  }
  const listEnd = (itemEnd) => {
    const passed = []
    let end = itemEnd
    while (!listEnds.has(end)) {
      LIST_NEXT_RE.lastIndex = end
      if (!LIST_NEXT_RE.test(text)) {
        listEnds.set(end, end)
        break
      }
      passed.push(end)
      end = afterEnd(LIST_NEXT_RE.lastIndex)
    }
    const last = listEnds.get(end)
    for (const place of passed) {
      listEnds.set(place, last)
    }
    return last
  }
  const tailEnd = (listEndPlace) => {
    if (!tailEnds.has(listEndPlace)) {
      tailRe.lastIndex = listEndPlace
      const found = tailRe.test(text)
      tailEnds.set(listEndPlace, found ? tailRe.lastIndex : null)
    }
    return tailEnds.get(listEndPlace)
  }
  const phrases = []
  for (const { index: start } of text.matchAll(LIST_START_RE)) {
    LIST_FIRST_RE.lastIndex = start
    if (!LIST_FIRST_RE.test(text)) {
      continue
    }
    const end = tailEnd(listEnd(afterEnd(LIST_FIRST_RE.lastIndex)))
    if (end !== null) {
      phrases.push({ start, end })
    }
  }
  return phrases
}

/**
 * Format an RFC list from rfc-editor.org, e.g. ["RFC3261", "RFC9000"], as "RFC 3261, RFC 9000".
 * The values already carry the "RFC" prefix.
 *
 * @param {Array<string>} rfcs RFC names, "RFC3261" or "3261"
 * @returns {string} The list for a message
 */
function formatRfcList (rfcs) {
  return rfcs.map(rfc => `RFC ${String(rfc).replace(/^RFC\s*/i, '')}`).join(', ')
}

/**
 * Values of the <rfc> obsoletes or updates attribute, a comma-separated list of RFC numbers or
 * Internet-Draft names (RFC 7991, Section 2.45.8). RFC numbers are returned as plain numbers, however
 * written ("8474", "RFC8474", "rfc 8474"). A value that is neither, or a number that can't be an RFC
 * number (0, or more than 5 digits: "10341035"), is returned in others, with the RFC numbers it plainly
 * means when it is a miswritten list of them ("[5652]", "2747 3097"); those numbers are in rfcs too. Invisible
 * characters (a zero-width space) are ignored.
 *
 * @param {string} value Attribute value
 * @returns {{rfcs: Array<string>, drafts: Array<string>, others: Array<{value: string, rfcs: Array<string>}>}}
 */
export function parseRfcRelationAttr (value) {
  const values = { rfcs: [], drafts: [], others: [] }
  const items = String(value ?? '').split(',').map(v => v.replace(RFC_ATTR_INVISIBLE_RE, '').trim())
  for (const item of items.filter(v => v)) {
    const num = item.match(RFC_ATTR_NUMBER_RE)?.[1]
    if (num && isPlausibleRfcNumber(num)) {
      values.rfcs.push(String(Number(num)))
    } else if (RFC_ATTR_DRAFT_RE.test(item)) {
      values.drafts.push(item)
    } else {
      const rfcs = []
      if (RFC_ATTR_MISWRITTEN_RE.test(item)) {
        const plausible = item.match(RFC_NUM_RE).filter(isPlausibleRfcNumber)
        rfcs.push(...plausible.map(n => String(Number(n))))
      }
      values.rfcs.push(...rfcs)
      values.others.push({ value: item, rfcs })
    }
  }
  values.rfcs = uniq(values.rfcs)
  return values
}

/**
 * Warnings for the values of the <rfc> obsoletes or updates attribute that are neither an RFC number
 * nor an Internet-Draft name
 *
 * @param {Array<{value: string, rfcs: Array<string>}>} others Values, from parseRfcRelationAttr
 * @param {string} attr Attribute name: 'obsoletes' or 'updates'
 * @returns {Array<ValidationWarning>} Warnings
 */
function notRfcNumberWarnings (others, attr) {
  return others.map(({ value, rfcs }) => {
    let readAs = ''
    if (rfcs.length > 0) {
      readAs = ` (read as ${formatRfcList(rfcs)})`
    }
    const message = `The <rfc> ${attr} attribute lists "${value}", which is not an RFC number${readAs}. The attribute is a comma-separated list of RFC numbers or Internet-Draft names.`
    return new ValidationWarning(`${attr.toUpperCase()}_NOT_RFC_NUMBER`, message, {
      ref: `https://authors.ietf.org/en/rfcxml-vocabulary#${attr}`,
      path: `rfc.${attr}`
    })
  })
}

/**
 * Resolve a document-date month to a number, or null when it is not one.
 *
 * Both callers used to hand the result of DateTime.fromFormat straight to
 * DateTime.fromObject. An unparseable month makes that NaN, and fromObject
 * throws on NaN, so an abbreviated or malformed month aborted the run instead
 * of being reported. The locale is pinned because these are English-language
 * drafts: without it the accepted spellings would follow whichever machine ran
 * the tool.
 *
 * @param {string|number} value Month as it appeared in the document
 * @returns {number|null} Month number 1-12, or null
 */
function parseDocMonth (value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 && value <= 12 ? value : null
  }
  if (typeof value !== 'string') {
    return null
  }
  // Tolerate trailing punctuation ("Sep.", "September,") and the common "Sept"
  const trimmed = value.trim().replace(/[.,]$/, '').replace(/^sept$/i, 'Sep')
  if (/^[0-9]{1,2}$/.test(trimmed)) {
    const asNumber = Number(trimmed)
    return asNumber >= 1 && asNumber <= 12 ? asNumber : null
  }
  for (const format of ['MMMM', 'MMM']) {
    const parsed = DateTime.fromFormat(trimmed, format, { locale: 'en-US' })
    if (parsed.isValid) {
      return parsed.month
    }
  }
  return null
}

/**
 * Resolve a document-date day or year to a number, or null when it is not one.
 *
 * DateTime.fromObject throws on a non-numeric unit, so a malformed attribute
 * must be caught here to be reported rather than abort the run.
 *
 * @param {string|number} value Day or year as it appeared in the document
 * @param {number} min Smallest accepted value
 * @param {number} max Largest accepted value
 * @returns {number|null} The value as an integer, or null
 */
function parseDocDateNumber (value, min, max) {
  const asNumber = typeof value === 'string' && /^[0-9]+$/.test(value.trim()) ? Number(value.trim()) : value
  return Number.isInteger(asNumber) && asNumber >= min && asNumber <= max ? asNumber : null
}

/**
 * Build the document date, or null when it doesn't exist
 *
 * Without a day, today's is taken, capped at the month's length so that e.g.
 * "February 2026" checked on the 30th stays valid. An explicit impossible day
 * (31 February) gives null. Shared by the text and XML branches (#328).
 *
 * @param {number} year Year
 * @param {number} month Month 1-12
 * @param {number|null} day Day, or null when the document gives none
 * @returns {DateTime|null} The date, or null
 */
function buildDocDate (year, month, day) {
  const dt = DateTime.fromObject({
    year,
    month,
    day: day ?? Math.min(today.day, DateTime.fromObject({ year, month }).daysInMonth)
  })
  return dt.isValid ? dt : null
}

/**
 * Validate document date
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateDate (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const DATE_THRESHOLD = 3

  switch (doc.type) {
    case 'txt': {
      const docDate = doc.data.header.date

      if (!docDate || !Object.keys(docDate).length) {
        result.push(new ValidationWarning('MISSING_DOC_DATE', 'The document date could not be determined.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date'
        }))
      } else {
        const docDateMonth = docDate.month ? parseDocMonth(docDate.month) : today.month
        if (docDateMonth === null) {
          result.push(new ValidationWarning('MISSING_DOC_DATE', 'The document date could not be determined.', {
            ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date'
          }))
          break
        }
        const dt = buildDocDate(docDate.year || today.year, docDateMonth, docDate.day || null)
        if (!dt) {
          result.push(new ValidationWarning('MISSING_DOC_DATE', 'The document date could not be determined.', {
            ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date'
          }))
          break
        }
        const daysDiff = Math.round(dt.diffNow().as('days'))
        if (daysDiff < -DATE_THRESHOLD) {
          result.push(new ValidationWarning('DOC_DATE_IN_PAST', `The document date is ${daysDiff * -1} days in the past. Is this intentional?`, {
            ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date'
          }))
        } else if (daysDiff > DATE_THRESHOLD) {
          result.push(new ValidationWarning('DOC_DATE_IN_FUTURE', `The document date is ${daysDiff} days in the future. Is this intentional?`, {
            ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date'
          }))
        }
      }
      break
    }
    case 'xml': {
      const dateEl = get(doc, 'data.rfc.front.date')
      if (dateEl === undefined) {
        // RFC 7998 Section 5.2.3: the prep tool inserts a missing <date>
        result.push(new ValidationComment('MISSING_DOC_DATE', 'The document has no <date> element. The current date will be filled in when the document is prepared.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date',
          path: 'rfc.front.date'
        }))
        break
      }
      // An empty <date/> parses as '' with no _attr. RFC 7991 Section 2.17
      // fills every missing attribute from the current date, so it is today.
      const docDate = get(dateEl, '_attr') || {}
      const docDateYear = docDate.year ? parseDocDateNumber(docDate.year, 1000, 9999) : today.year
      const docDateMonth = docDate.month ? parseDocMonth(docDate.month) : today.month
      const docDateDay = docDate.day ? parseDocDateNumber(docDate.day, 1, 31) : null
      let dt = null
      if (docDateYear !== null && docDateMonth !== null && (docDateDay !== null || !docDate.day)) {
        dt = buildDocDate(docDateYear, docDateMonth, docDateDay)
      }
      if (!dt) {
        result.push(new ValidationWarning('MISSING_DOC_DATE', 'The document date could not be determined.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date',
          path: 'rfc.front.date'
        }))
        break
      }
      const daysDiff = Math.round(dt.diffNow().as('days'))
      if (daysDiff < -DATE_THRESHOLD) {
        result.push(new ValidationWarning('DOC_DATE_IN_PAST', `The document date is ${daysDiff * -1} days in the past. Is this intentional?`, {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date',
          path: 'rfc.front.date'
        }))
      } else if (daysDiff > DATE_THRESHOLD) {
        result.push(new ValidationWarning('DOC_DATE_IN_FUTURE', `The document date is ${daysDiff} days in the future. Is this intentional?`, {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date',
          path: 'rfc.front.date'
        }))
      }
      break
    }
  }

  return result
}

/**
 * Validate document category (status / intended status)
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateCategory (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  switch (doc.type) {
    case 'txt': {
      // An RFC states its category on the Category: line, a draft its intended status on the
      // Intended status: line
      const isRfc = doc.docKind === 'rfc'
      const docCategory = isRfc ? doc.data.header.category : doc.data.header.intendedStatus

      if (!docCategory) {
        // A draft that gives its status on a Category: line, as an RFC does, still has no intended status
        const message = isRfc
          ? 'The RFC has no Category: line.'
          : doc.data.header.category
            ? 'The draft gives its status on a Category: line; Internet-Drafts use an Intended status: line.'
            : 'The draft has no Intended status: line.'
        result.push(new ValidationWarning('MISSING_DOC_CATEGORY', message, {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#category'
        }))
      } else if (!rfcStatusHierarchy.find(item => item.name.toLowerCase() === docCategory.toLowerCase())) {
        result.push(new ValidationWarning('INVALID_DOC_CATEGORY', 'The document category has an invalid value. Allowed values are Standards Track, Best Current Practice, Informational, Experimental and Historic.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#category'
        }))
      }
      break
    }
    case 'xml': {
      const docCategory = get(doc, 'data.rfc._attr.category')
      if (!docCategory) {
        result.push(new ValidationWarning('MISSING_DOC_CATEGORY', 'The <rfc> element has no category attribute, which gives the document\'s (intended) status.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#category',
          path: 'rfc.category'
        }))
      } else if (docCategory && !['std', 'bcp', 'info', 'exp', 'historic'].includes(docCategory)) {
        result.push(new ValidationWarning('INVALID_DOC_CATEGORY', 'The document category has an invalid value. Allowed values are std, bcp, info, exp and historic.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#category',
          path: 'rfc.category'
        }))
      }
      break
    }
  }

  return result
}

/**
 * Check whether the RFCs a document obsoletes or updates are in its stream
 *
 * The stream of each RFC comes from Datatracker, the stream of the document
 * from getDocumentStream. RFCs Datatracker doesn't know (or has no stream for)
 * are not checked.
 *
 * | RFC stream | Document stream | Finding |
 * |------------|-----------------|---------|
 * | Legacy     | any             | Comment |
 * | other      | same            | -       |
 * | other      | different       | Warning |
 * | other      | unknown         | Comment |
 *
 * @param {Object} doc Document to validate
 * @param {Object} refs RFC numbers the document obsoletes and updates
 * @param {Array<string>} refs.obsoletes RFC numbers the document obsoletes
 * @param {Array<string>} refs.updates RFC numbers the document updates
 * @returns {Promise<Array>} List of CROSS_STREAM_OBSOLETES_UPDATES findings
 */
async function checkCrossStream (doc, { obsoletes, updates }) {
  const result = []
  const lines = doc.body?.split('\n') ?? []
  let ownStream

  for (const [verb, refs] of [['obsolete', obsoletes], ['update', updates]]) {
    const attr = `${verb}s`
    for (const ref of refs) {
      const target = (await fetchDatatrackerStream(`rfc${ref}`, { doc, check: 'cross-stream', cited: true }))?.stream
      if (!target) {
        continue
      }
      const findingOpts = { ref: `https://authors.ietf.org/en/rfcxml-vocabulary#${attr}` }
      if (doc.type === 'xml') {
        findingOpts.path = `rfc.${attr}`
      } else {
        const lineIdx = lines.findIndex(line => line.trimStart().toLowerCase().startsWith(`${attr}:`))
        if (lineIdx >= 0) {
          findingOpts.lines = [{ line: lineIdx + 1, pos: 1 }]
        }
      }

      // -> Legacy RFCs predate the streams: nothing to compare with
      if (target === 'legacy') {
        result.push(new ValidationComment('CROSS_STREAM_OBSOLETES_UPDATES', `This document attempts to ${verb} RFC ${ref}, which is in the Legacy stream (published before the current RFC streams were defined). Check whether specific rules apply to this process.`, findingOpts))
        continue
      }

      if (ownStream === undefined) {
        ownStream = await getDocumentStream(doc, { check: 'cross-stream' })
      }
      // -> Stream of this document unknown
      if (!ownStream) {
        result.push(new ValidationComment('CROSS_STREAM_OBSOLETES_UPDATES', `This document attempts to ${verb} RFC ${ref}, which is in the ${streamDisplayName(target)} stream. If this document is not in that stream, specific rules may apply to this process, and you will need sign-off from both stream heads before this document can proceed.`, findingOpts))
      // -> Different streams
      } else if (ownStream !== target) {
        result.push(new ValidationWarning('CROSS_STREAM_OBSOLETES_UPDATES', `This document (${streamDisplayName(ownStream)} stream) attempts to ${verb} RFC ${ref}, an RFC from another stream (${streamDisplayName(target)}). Specific rules may apply to this process, and you will need sign-off from both stream heads before this document can proceed.`, findingOpts))
      }
    }
  }

  return result
}

/**
 * Validate that the document updates / obsoletes another document correctly
 *
 * In submission mode, only the cross-stream check (see checkCrossStream) runs.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {boolean} [opts.offline=false] Disable checks that require an internet connection
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateObsoleteUpdateRef (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []

  // -> Obsoletes / updates an RFC of another stream
  let crossStream = []
  const rfcNumbers = refs => uniq(refs.flatMap(ref => String(ref).match(RFC_NUM_RE) ?? []).map(Number))
  const listed = doc.type === 'xml'
    ? {
        obsoletes: parseRfcRelationAttr(get(doc, 'data.rfc._attr.obsoletes')).rfcs.map(Number),
        updates: parseRfcRelationAttr(get(doc, 'data.rfc._attr.updates')).rfcs.map(Number)
      }
    : {
        obsoletes: rfcNumbers(doc.data.extractedElements.obsoletesRfc),
        updates: rfcNumbers(doc.data.extractedElements.updatesRfc)
      }
  if (!offline) {
    crossStream = await checkCrossStream(doc, listed)
  } else if (listed.obsoletes.length > 0 || listed.updates.length > 0) {
    // -> The streams of the RFCs come from Datatracker (in every mode), their status from
    //    rfc-editor.org (not in submission)
    recordSkippedLookup(doc, 'cross-stream')
    if (mode !== MODES.SUBMISSION) {
      recordSkippedLookup(doc, 'obsoletes-updates')
    }
  }

  if (mode === MODES.SUBMISSION) {
    return crossStream
  }

  switch (doc.type) {
    case 'txt': {
      const abstract = doc.data.content.abstract.join(' ') || ''
      const obsoletesRfc = doc.data.extractedElements.obsoletesRfc
      const updatesRfc = doc.data.extractedElements.updatesRfc
      // -> Where the Obsoletes / Updates header line lists an RFC
      const headerLines = (kind, rfc) => {
        const locations = getLocations(doc, kind, rfc)
        return locations.length ? locations : undefined
      }

      const mentionedObsoletesRfcs = rfcsAfterVerb(abstract, OBSOLETES_RELATION)
      const mentionedUpdatesRfcs = rfcsAfterVerb(abstract, UPDATES_RELATION)
      const statedObsoletesRfcs = rfcsAfterVerb(abstract, OBSOLETES_STRICT_RELATION)
      const statedUpdatesRfcs = rfcsAfterVerb(abstract, UPDATES_STRICT_RELATION)
      // -> Compared by number: the abstract's "RFC 0793" and the header's "793" name the same RFC
      const sameRfc = (list, rfc) => list.some(num => Number(num) === Number(rfc))

      // RFCs in obsoletes/updates but not mentioned in abstract
      const obsoletesNotInAbstract = obsoletesRfc.filter(rfc => !sameRfc(mentionedObsoletesRfcs, rfc))
      const updatesNotInAbstract = updatesRfc.filter(rfc => !sameRfc(mentionedUpdatesRfcs, rfc))

      obsoletesNotInAbstract.forEach(rfc => {
        result.push(new ValidationComment(
          'OBSOLETES_NOT_IN_ABSTRACT',
          `RFC ${rfc} is listed as "obsoleted" in metadata but is not mentioned in the abstract.`,
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            lines: headerLines('obsoletesRfc', rfc)
          }
        ))
      })

      updatesNotInAbstract.forEach(rfc => {
        result.push(new ValidationComment(
          'UPDATES_NOT_IN_ABSTRACT',
          `RFC ${rfc} is listed as "updated" in metadata but is not mentioned in the abstract.`,
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            lines: headerLines('updatesRfc', rfc)
          }
        ))
      })

      const mentionedButNotObsoletes = statedObsoletesRfcs.filter(rfc => !sameRfc(obsoletesRfc, rfc))
      const mentionedButNotUpdates = statedUpdatesRfcs.filter(rfc => !sameRfc(updatesRfc, rfc))

      mentionedButNotObsoletes.forEach(rfc => {
        result.push(new ValidationComment(
          'MENTIONED_NOT_IN_OBSOLETES',
          `RFC ${rfc} is mentioned as "obsoleted" or "replaced" in the abstract but not listed in metadata.`,
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract'
          }
        ))
      })

      mentionedButNotUpdates.forEach(rfc => {
        result.push(new ValidationComment(
          'MENTIONED_NOT_IN_UPDATES',
          `RFC ${rfc} is mentioned as "updated" in the abstract but not listed in metadata.`,
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract'
          }
        ))
      })

      if (!offline) {
        // -> Obsoletes an already obsoleted rfc
        if (mode !== MODES.SUBMISSION && obsoletesRfc.length > 0) {
          const obsoletesRfcLookups = obsoletesRfc.filter(ref => RFC_NUM_RE_GENERAL.test(ref))
          prefetchRfcInfo(doc, obsoletesRfcLookups)
          for (const ref of obsoletesRfc) {
            if (RFC_NUM_RE_GENERAL.test(ref)) {
              const rfcInfo = await getRfcInfo(doc, ref, 'obsoletes')
              if (rfcInfo === undefined) {
                // -> Lookup failed or not made: nothing known about this RFC (REFERENCE_STATUS_UNAVAILABLE
                //    or LOOKUP_LIMIT_REACHED says so)
              } else if (!rfcInfo) {
                result.push(
                  new ValidationWarning(
                    'OBSOLETES_RFC_NOT_FOUND',
                    `The Obsoletes header line lists RFC ${ref} but no matching RFC could be found on rfc-editor.org.`,
                    {
                      ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#obsoletes'
                    }
                  )
                )
              } else if (rfcInfo.obsoleted_by?.length > 0) {
                result.push(
                  new ValidationWarning(
                    'OBSOLETES_OBSOLETED_RFC',
                    `The Obsoletes header line lists RFC ${ref} but it's already obsoleted by ${formatRfcList(rfcInfo.obsoleted_by)}.`,
                    {
                      ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#obsoletes'
                    }
                  )
                )
              }
            }
          }
        }

        // -> Updates an already obsoleted rfc
        if (mode !== MODES.SUBMISSION && updatesRfc.length > 0) {
          const updatesRfcLookups = updatesRfc.filter(ref => RFC_NUM_RE_GENERAL.test(ref))
          prefetchRfcInfo(doc, updatesRfcLookups)
          for (const ref of updatesRfc) {
            if (RFC_NUM_RE_GENERAL.test(ref)) {
              const rfcInfo = await getRfcInfo(doc, ref, 'updates')
              if (rfcInfo === undefined) {
                // -> Lookup failed or not made: nothing known about this RFC (REFERENCE_STATUS_UNAVAILABLE
                //    or LOOKUP_LIMIT_REACHED says so)
              } else if (!rfcInfo) {
                result.push(
                  new ValidationWarning(
                    'UPDATES_RFC_NOT_FOUND',
                    `The Updates header line lists RFC ${ref} but no matching RFC could be found on rfc-editor.org.`,
                    {
                      ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates'
                    }
                  )
                )
              } else if (rfcInfo.obsoleted_by?.length > 0) {
                result.push(
                  new ValidationWarning(
                    'UPDATES_OBSOLETED_RFC',
                    `The Updates header line lists RFC ${ref} but it's already obsoleted by ${formatRfcList(rfcInfo.obsoleted_by)}.`,
                    {
                      ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates'
                    }
                  )
                )
              }
            }
          }
        }
      }

      break
    }
    case 'xml': {
      const obsoletesAttr = parseRfcRelationAttr(get(doc, 'data.rfc._attr.obsoletes'))
      const updatesAttr = parseRfcRelationAttr(get(doc, 'data.rfc._attr.updates'))
      // -> Compared and looked up by number: an attribute written "RFC8474" names RFC 8474
      const obsoletesRefNums = obsoletesAttr.rfcs
      const updatesRefNums = updatesAttr.rfcs

      // -> Values that are neither an RFC number nor an Internet-Draft name
      result.push(...notRfcNumberWarnings(obsoletesAttr.others, 'obsoletes'))
      result.push(...notRfcNumberWarnings(updatesAttr.others, 'updates'))

      // -> Read from the parsed text runs, and from the source, where an <xref> can name the RFC
      const abstractTexts = [xmlAbstractSourceText(doc)]
      await traverseAllValues(get(doc, 'data.rfc.front.abstract', {}), (val) => {
        abstractTexts.push(val)
      })
      const abstractRfcs = relation => uniq(abstractTexts.flatMap(text => rfcsAfterVerb(text, relation)))
      // -> Mentions that count for a listed RFC, and statements that need one listed
      const obsoletesAbs = abstractRfcs(OBSOLETES_RELATION)
      const updatesAbs = abstractRfcs(UPDATES_RELATION)
      const obsoletesStated = abstractRfcs(OBSOLETES_STRICT_RELATION)
      const updatesStated = abstractRfcs(UPDATES_STRICT_RELATION)

      // -> Obsoletes in <rfc> but no in <abstract>
      const obsoletesNotInAbs = difference(obsoletesRefNums, obsoletesAbs)
      if (obsoletesNotInAbs.length > 0) {
        for (const ref of obsoletesNotInAbs) {
          result.push(new ValidationWarning('OBSOLETES_NOT_IN_ABSTRACT', `The document states that it obsoletes RFC ${ref} but doesn't explicitely mention it in the <abstract> section.`, {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'rfc.front.abstract'
          }))
        }
      }

      // -> Obsoletes in <abstract> but no in <rfc>
      const obsoletesNotInRef = difference(obsoletesStated, obsoletesRefNums)
      if (obsoletesNotInRef.length > 0) {
        for (const ref of obsoletesNotInRef) {
          result.push(new ValidationWarning('OBSOLETES_NOT_IN_RFC', `The document abstract states that it obsoletes RFC ${ref} but it's not mentionned in the obsoletes <rfc> field.`, {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'rfc.front.abstract'
          }))
        }
      }

      // -> Updates in <rfc> but no in <abstract>
      const updatesNotInAbs = difference(updatesRefNums, updatesAbs)
      if (updatesNotInAbs.length > 0) {
        for (const ref of updatesNotInAbs) {
          result.push(new ValidationWarning('UPDATES_NOT_IN_ABSTRACT', `The document states that it updates RFC ${ref} but doesn't explicitely mention it in the <abstract> section.`, {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'rfc.front.abstract'
          }))
        }
      }

      // -> Updates in <abstract> but no in <rfc>
      const updatesNotInRef = difference(updatesStated, updatesRefNums)
      if (updatesNotInRef.length > 0) {
        for (const ref of updatesNotInRef) {
          result.push(new ValidationWarning('UPDATES_NOT_IN_RFC', `The document abstract states that it updates RFC ${ref} but it's not mentionned in the updates <rfc> field.`, {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'rfc.front.abstract'
          }))
        }
      }

      if (!offline) {
        // -> Obsoletes an already obsoleted rfc
        if (mode !== MODES.SUBMISSION && obsoletesRefNums.length > 0) {
          prefetchRfcInfo(doc, obsoletesRefNums)
          for (const ref of obsoletesRefNums) {
            const rfcInfo = await getRfcInfo(doc, ref, 'obsoletes')
            if (rfcInfo === undefined) {
              // -> Lookup failed or not made: nothing known about this RFC (REFERENCE_STATUS_UNAVAILABLE
              //    or LOOKUP_LIMIT_REACHED says so)
            } else if (!rfcInfo) {
              result.push(new ValidationWarning('OBSOLETES_RFC_NOT_FOUND', `The <rfc> field states that it obsoletes RFC ${ref} but no matching RFC could be found on rfc-editor.org.`, {
                ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#obsoletes',
                path: 'rfc.obsoletes'
              }))
            } else if (rfcInfo.obsoleted_by?.length > 0) {
              result.push(new ValidationWarning('OBSOLETES_OBSOLETED_RFC', `The <rfc> field states that it obsoletes RFC ${ref} but it's already obsoleted by ${formatRfcList(rfcInfo.obsoleted_by)}.`, {
                ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#obsoletes',
                path: 'rfc.obsoletes'
              }))
            }
          }
        }

        // -> Updates an already obsoleted rfc
        if (mode !== MODES.SUBMISSION && updatesRefNums.length > 0) {
          prefetchRfcInfo(doc, updatesRefNums)
          for (const ref of updatesRefNums) {
            const rfcInfo = await getRfcInfo(doc, ref, 'updates')
            if (rfcInfo === undefined) {
              // -> Lookup failed or not made: nothing known about this RFC (REFERENCE_STATUS_UNAVAILABLE
              //    or LOOKUP_LIMIT_REACHED says so)
            } else if (!rfcInfo) {
              result.push(new ValidationWarning('UPDATES_RFC_NOT_FOUND', `The <rfc> field states that it updates RFC ${ref} but no matching RFC could be found on rfc-editor.org.`, {
                ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates',
                path: 'rfc.updates'
              }))
            } else if (rfcInfo.obsoleted_by?.length > 0) {
              result.push(new ValidationWarning('UPDATES_OBSOLETED_RFC', `The <rfc> field states that it updates RFC ${ref} but it's already obsoleted by ${formatRfcList(rfcInfo.obsoleted_by)}.`, {
                ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates',
                path: 'rfc.updates'
              }))
            } else if (rfcInfo.updated_by?.length > 0) {
              result.push(new ValidationWarning('UPDATES_UPDATED_RFC', `This document updates RFC ${ref}. That RFC is already updated by ${formatRfcList(rfcInfo.updated_by)}. Verify that this document does not conflict with those.`, {
                ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates',
                path: 'rfc.updates'
              }))
            }
          }
        }
      }
      break
    }
  }

  result.push(...crossStream)
  return result
}

/**
 * Validate document version
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {boolean} [opts.offline=false] Disable checks that require an internet connection
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateVersion (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []

  if (mode !== MODES.SUBMISSION) {
    return result
  }
  if (offline) {
    // -> Only a name with a revision is looked up
    const docName = doc.type === 'xml' ? get(doc, 'data.rfc._attr.docName') : doc.data.slug
    if (VERSION_SUFFIX_RE.test(docName ?? '')) {
      recordSkippedLookup(doc, 'revision')
    }
    return result
  }

  switch (doc.type) {
    case 'txt': {
      const docName = doc.data.slug
      const versionMatch = docName?.match(VERSION_SUFFIX_RE)
      if (versionMatch?.[1]) {
        const docInfo = await getDocInfo(doc, docName, 'revision')
        if (docInfo && docInfo.rev) {
          const latestVersion = parseInt(docInfo.rev)
          const docVersion = parseInt(versionMatch[1])
          if (latestVersion === docVersion) {
            result.push(new ValidationWarning('DUPLICATE_DOC_VERSION', 'A document with this name and version already exists in the Internet-Draft repository.', {
              ref: `https://datatracker.ietf.org/doc/${docInfo.name}`
            }))
          } else if (latestVersion > docVersion) {
            result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version in the Internet-Draft repository is ${latestVersion} but your document is ${docVersion}.`, {
              ref: `https://datatracker.ietf.org/doc/${docInfo.name}`
            }))
          } else if (docVersion > latestVersion + 1) {
            result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version in the Internet-Draft repository is ${latestVersion} but your document is ${docVersion} and leaves a gap.`, {
              ref: `https://datatracker.ietf.org/doc/${docInfo.name}`
            }))
          }
        } else if (docInfo === null && versionMatch[1] !== '00') {
          result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', 'The document version is unexpected. As no document with this name exists in the Internet-Draft repository, it should be version 00.'))
        }
      }
      break
    }
    case 'xml': {
      const docName = get(doc, 'data.rfc._attr.docName')
      const versionMatch = docName?.match(VERSION_SUFFIX_RE)
      if (versionMatch?.[1]) {
        const docInfo = await getDocInfo(doc, docName, 'revision')
        if (docInfo && docInfo.rev) {
          const latestVersion = parseInt(docInfo.rev)
          const docVersion = parseInt(versionMatch[1])
          if (latestVersion === docVersion) {
            result.push(new ValidationWarning('DUPLICATE_DOC_VERSION', 'A document with this version already exists in the Internet-Draft repository.', {
              path: 'rfc.docName',
              ref: `https://datatracker.ietf.org/doc/${docInfo.name}`
            }))
          } else if (latestVersion > docVersion) {
            result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version in the Internet-Draft repository is ${latestVersion} but your document is ${docVersion}.`, {
              path: 'rfc.docName',
              ref: `https://datatracker.ietf.org/doc/${docInfo.name}`
            }))
          } else if (docVersion > latestVersion + 1) {
            result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version in the Internet-Draft repository is ${latestVersion} but your document is ${docVersion} and leaves a gap.`, {
              path: 'rfc.docName',
              ref: `https://datatracker.ietf.org/doc/${docInfo.name}`
            }))
          }
        } else if (docInfo === null && versionMatch[1] !== '00') {
          result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', 'The document version is unexpected. As no document with this name exists in the Internet-Draft repository, it should be version 00.', {
            path: 'rfc.docName'
          }))
        }
      }
      break
    }
  }

  return result
}
