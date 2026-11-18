import { get, uniq } from 'lodash-es'
import { DateTime } from 'luxon'
import { rfcStatusHierarchy } from '../config/rfc-status-hierarchy.mjs'
import { traverseAllValues } from '../helpers/traversal.mjs'
import { maskCommentsAndCdata } from '../helpers/xml-references.mjs'
import { getLocations } from '../parsers/txt.mjs'
import { CERTAINTY, getIndex } from './indexes.mjs'
import { getSection } from './sections.mjs'

// Values of the <rfc> category attribute (RFC 7991, Section 2.45.1)
const XML_CATEGORIES = ['std', 'bcp', 'info', 'exp', 'historic']

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
const RFC_NUM_RE = /[0-9]+/g
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
function parseRfcRelationAttr (value) {
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
 * (31 February) gives null. Shared by the text and XML readers (#328).
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

// Lists of the text parser's extracted elements (doc.data.extractedElements) holding the RFCs of the
// Obsoletes and Updates header lines, by relation
const TEXT_RELATION_LISTS = {
  obsoletes: 'obsoletesRfc',
  updates: 'updatesRfc'
}

// Phrasings of each relation in an abstract: mentions that count for a listed RFC, and statements that
// need it listed (read strictly)
const RELATION_PHRASINGS = {
  obsoletes: { mentioned: OBSOLETES_RELATION, stated: OBSOLETES_STRICT_RELATION },
  updates: { mentioned: UPDATES_RELATION, stated: UPDATES_STRICT_RELATION }
}

/**
 * @typedef {Object} CategoryAnswer
 * @property {string} certainty How certain the answer is (CERTAINTY): declared for XML, inferred for text
 * @property {string|undefined} value The category (or intended status) as written: the category attribute
 *   for XML; for text, the Category: line of an RFC or the Intended status: line of a draft
 * @property {string|undefined} misplacedValue Text only: the status given on the line the other kind of
 *   document uses (a draft's Category: line, an RFC's Intended status: line)
 * @property {boolean} known Whether the value is one of the allowed values: std, bcp, info, exp or historic
 *   for XML; a status name of lib/config/rfc-status-hierarchy.mjs, in any case, for text
 * @property {{lines: Array<{line: number, pos: number}>}|{path: string}|{}} location Where the category is,
 *   as the options of a finding: its path for XML; for text, the line of the value, else the line of the
 *   misplaced value, else nowhere ({})
 */

/**
 * @typedef {Object} DateAnswer
 * @property {string} certainty How certain the answer is (CERTAINTY): declared for XML, inferred for text
 * @property {boolean} present Whether the document gives a date: a <date> element for XML (an empty one
 *   included), a header date for text
 * @property {DateTime|null} date The date, the missing parts taken from today (see buildDocDate), or null
 *   when it is missing or isn't a date
 * @property {{lines: Array<{line: number, pos: number}>}|{path: string}|{}} location Where the date is, as
 *   the options of a finding: its path for XML; for text, the header line that gives it, nowhere ({}) when
 *   none does
 */

/**
 * @typedef {Object} DocNameAnswer
 * @property {string} certainty How certain the answer is (CERTAINTY): declared for XML, inferred for text
 * @property {string|null|undefined} name Name of the document with its revision ("draft-foo-bar-03"): the
 *   docName attribute for XML, the draft name found in the text
 * @property {{lines: Array<{line: number, pos: number}>}|{path: string}|{}} location Where the name is, as
 *   the options of a finding: its path for XML; for text, where the name starts on the first page, nowhere
 *   ({}) when there is no name
 */

/**
 * @typedef {Object} RelationAnswer
 * @property {string} kind Relation: obsoletes or updates
 * @property {string} certainty How certain the answer is (CERTAINTY): declared for XML, inferred for text
 * @property {Array<{rfc: string, location: Object}>} rfcs RFCs the document lists, in order: as the
 *   header line writes each one for text ("0793"), as a plain number for XML ("8474" for "RFC8474"). Each
 *   is located as the options of a finding: its lines on the header line for text (undefined when
 *   unknown), the attribute's path for XML.
 * @property {Array<{value: string, rfcs: Array<string>}>} others XML only (empty for text, whose parser
 *   keeps only numbers): values of the attribute that are neither an RFC number nor an Internet-Draft
 *   name (see parseRfcRelationAttr)
 * @property {{lines: Array<{line: number, pos: number}>}|{path: string}|{}} location Where the document
 *   lists them, as the options of a finding: the first header line of the relation for text ({} when there
 *   is none), the attribute's path for XML
 */

/**
 * @typedef {Object} RelationMentionsAnswer
 * @property {string} kind Relation: obsoletes or updates
 * @property {string} certainty How certain the answer is (CERTAINTY): inferred for both formats, since
 *   both find mentions by matching the abstract's text
 * @property {Array<string>} mentioned RFC numbers the abstract mentions as related ("updates the registry
 *   defined in RFC 9605"): enough for an RFC the document lists
 * @property {Array<string>} stated RFC numbers the abstract states as related, read strictly ("updates
 *   RFC 9605"): enough to expect the document to list them
 * @property {{lines: Array<{line: number, pos: number}>}|{path: string}|{}} location Where the mentions
 *   are, as the options of a finding: the abstract, by its path for XML and by its heading line for text.
 *   A mention itself isn't located: the abstract is read as one text, its spaces collapsed.
 */

/**
 * Location of a line of a text document that the parser kept, as the options of a finding
 *
 * @param {{line: number, pos: number}|null|undefined} location Where the parser found it
 * @returns {{lines: Array<{line: number, pos: number}>}|{}} The options, nowhere ({}) when it found none
 */
function keptLineLocation (location) {
  if (!location) {
    return {}
  }
  return { lines: [location] }
}

/**
 * Read the category of a text document from its header: the Category: line of an RFC, the Intended
 * status: line of a draft
 *
 * @param {Object} doc Parsed text document
 * @returns {CategoryAnswer} The category
 */
function readTextCategory (doc) {
  const { header } = doc.data
  const isRfc = doc.docKind === 'rfc'
  const value = isRfc ? header.category : header.intendedStatus
  const misplacedValue = isRfc ? header.intendedStatus : header.category
  let known = false
  if (value) {
    known = rfcStatusHierarchy.some(item => item.name.toLowerCase() === value.toLowerCase())
  }
  // -> The line of the value, else the line of the status given where the other kind of document gives it
  const lines = header.locations ?? {}
  let line = isRfc ? lines.category : lines.intendedStatus
  if (!line) {
    line = isRfc ? lines.intendedStatus : lines.category
  }
  return { certainty: CERTAINTY.INFERRED, value, misplacedValue, known, location: keptLineLocation(line) }
}

/**
 * Read the category of an XML document from the category attribute of <rfc>
 *
 * @param {Object} doc Parsed XML document
 * @returns {CategoryAnswer} The category
 */
function readXmlCategory (doc) {
  const value = get(doc, 'data.rfc._attr.category')
  const known = XML_CATEGORIES.includes(value)
  return { certainty: CERTAINTY.DECLARED, value, misplacedValue: undefined, known, location: { path: 'rfc.category' } }
}

/**
 * Get the category (status, or intended status) of a document, read once per document
 *
 * @example
 * getCategory(xmlDoc) // { certainty: 'declared', value: 'std', known: true, location: { path: 'rfc.category' }, ... }
 * getCategory(txtDoc) // { certainty: 'inferred', value: 'Standards Track', known: true, location: { lines: [{ line: 4, pos: 1 }] }, ... }
 *
 * @param {Object} doc Parsed document, text or XML
 * @returns {CategoryAnswer} The category
 */
export function getCategory (doc) {
  if (doc.type === 'txt') {
    return getIndex(doc, 'category', readTextCategory)
  }
  return getIndex(doc, 'category', readXmlCategory)
}

/**
 * Read the date of a text document from its header. A date without a month takes today's month, and
 * one without a year this year's.
 *
 * @param {Object} doc Parsed text document
 * @returns {DateAnswer} The date
 */
function readTextDate (doc) {
  const answer = { certainty: CERTAINTY.INFERRED, location: keptLineLocation(doc.data.header.locations?.date) }
  const docDate = doc.data.header.date
  if (!docDate || !Object.keys(docDate).length) {
    return { ...answer, present: false, date: null }
  }
  const month = docDate.month ? parseDocMonth(docDate.month) : today.month
  if (month === null) {
    return { ...answer, present: true, date: null }
  }
  return { ...answer, present: true, date: buildDocDate(docDate.year || today.year, month, docDate.day || null) }
}

/**
 * Read the date of an XML document from the <date> element of <front>. RFC 7991, Section 2.17 fills
 * every missing attribute from the current date, so an empty <date/> (parsed as '' with no _attr) is today.
 *
 * @param {Object} doc Parsed XML document
 * @returns {DateAnswer} The date
 */
function readXmlDate (doc) {
  const answer = { certainty: CERTAINTY.DECLARED, location: { path: 'rfc.front.date' } }
  const dateEl = get(doc, 'data.rfc.front.date')
  if (dateEl === undefined) {
    return { ...answer, present: false, date: null }
  }
  const docDate = get(dateEl, '_attr') || {}
  const year = docDate.year ? parseDocDateNumber(docDate.year, 1000, 9999) : today.year
  const month = docDate.month ? parseDocMonth(docDate.month) : today.month
  const day = docDate.day ? parseDocDateNumber(docDate.day, 1, 31) : null
  let date = null
  if (year !== null && month !== null && (day !== null || !docDate.day)) {
    date = buildDocDate(year, month, day)
  }
  return { ...answer, present: true, date }
}

/**
 * Get the date of a document, read once per document
 *
 * @example
 * getDate(xmlDoc) // { certainty: 'declared', present: true, date: DateTime, location: { path: 'rfc.front.date' } }
 * getDate(txtDoc) // { certainty: 'inferred', present: true, date: DateTime, location: { lines: [{ line: 5, pos: 62 }] } }
 *
 * @param {Object} doc Parsed document, text or XML
 * @returns {DateAnswer} The date
 */
export function getDate (doc) {
  if (doc.type === 'txt') {
    return getIndex(doc, 'date', readTextDate)
  }
  return getIndex(doc, 'date', readXmlDate)
}

/**
 * Get the name of a document with its revision, read once per document: the docName attribute of <rfc>
 * for XML, the draft name the text parser found for text
 *
 * @example
 * getDocName(xmlDoc) // { certainty: 'declared', name: 'draft-foo-bar-03', location: { path: 'rfc.docName' } }
 * getDocName(txtDoc) // { certainty: 'inferred', name: 'draft-foo-bar-03', location: { lines: [{ line: 15, pos: 29 }] } }
 *
 * @param {Object} doc Parsed document, text or XML
 * @returns {DocNameAnswer} The name
 */
export function getDocName (doc) {
  if (doc.type === 'txt') {
    return getIndex(doc, 'docName', () => {
      return { certainty: CERTAINTY.INFERRED, name: doc.data.slug, location: keptLineLocation(doc.data.slugLocation) }
    })
  }
  return getIndex(doc, 'docName', () => {
    return { certainty: CERTAINTY.DECLARED, name: get(doc, 'data.rfc._attr.docName'), location: { path: 'rfc.docName' } }
  })
}

/**
 * Read the RFCs a text document obsoletes or updates from the numbers its parser extracted from the
 * Obsoletes or Updates header line, each located where the parser found it
 *
 * @param {Object} doc Parsed text document
 * @param {string} kind Relation: obsoletes or updates
 * @returns {RelationAnswer} The RFCs
 */
function readTextRelation (doc, kind) {
  const list = TEXT_RELATION_LISTS[kind]
  const rfcs = doc.data.extractedElements[list].map(rfc => {
    const locations = getLocations(doc, list, rfc)
    return { rfc, location: { lines: locations.length ? locations : undefined } }
  })
  // -> The first line starting with the relation's name ("Updates: 7854 (if approved)")
  const lines = doc.body?.split('\n') ?? []
  const lineIdx = lines.findIndex(line => line.trimStart().toLowerCase().startsWith(`${kind}:`))
  let location = {}
  if (lineIdx >= 0) {
    location = { lines: [{ line: lineIdx + 1, pos: 1 }] }
  }
  return { kind, certainty: CERTAINTY.INFERRED, rfcs, others: [], location }
}

/**
 * Read the RFCs an XML document obsoletes or updates from the obsoletes or updates attribute of <rfc>
 *
 * @param {Object} doc Parsed XML document
 * @param {string} kind Relation: obsoletes or updates
 * @returns {RelationAnswer} The RFCs
 */
function readXmlRelation (doc, kind) {
  const values = parseRfcRelationAttr(get(doc, `data.rfc._attr.${kind}`))
  const location = { path: `rfc.${kind}` }
  const rfcs = values.rfcs.map(rfc => {
    return { rfc, location }
  })
  return { kind, certainty: CERTAINTY.DECLARED, rfcs, others: values.others, location }
}

/**
 * Get the RFCs a document lists as obsoleted or updated, read once per document
 *
 * @example
 * getRelations(xmlDoc, 'updates') // { kind: 'updates', certainty: 'declared', rfcs: [{ rfc: '7854', location: { path: 'rfc.updates' } }], ... }
 * getRelations(txtDoc, 'updates') // { kind: 'updates', certainty: 'inferred', rfcs: [{ rfc: '7854', location: { lines: [{ line: 5, pos: 10 }] } }], ... }
 *
 * @param {Object} doc Parsed document, text or XML
 * @param {string} kind Relation: obsoletes or updates
 * @returns {RelationAnswer} The RFCs
 */
export function getRelations (doc, kind) {
  if (doc.type === 'txt') {
    return getIndex(doc, `relations:${kind}`, () => readTextRelation(doc, kind))
  }
  return getIndex(doc, `relations:${kind}`, () => readXmlRelation(doc, kind))
}

/**
 * Read the abstract of a text document as the lines its parser kept, joined together, located at its heading
 *
 * @param {Object} doc Parsed text document
 * @returns {{texts: Array<string>, location: {lines: Array<{line: number, pos: number}>}|{}}} The abstract
 */
function readTextAbstractTexts (doc) {
  return { texts: [doc.data.content.abstract.join(' ') || ''], location: getSection(doc, 'abstract').location }
}

/**
 * Read the abstract of an XML document twice: from its source, where an <xref> can name an RFC (see
 * xmlAbstractSourceText), and as the parsed text runs of <abstract>
 *
 * @param {Object} doc Parsed XML document
 * @returns {Promise<{texts: Array<string>, location: {path: string}}>} The abstract
 */
async function readXmlAbstractTexts (doc) {
  const texts = [xmlAbstractSourceText(doc)]
  await traverseAllValues(get(doc, 'data.rfc.front.abstract', {}), (val) => {
    texts.push(val)
  })
  return { texts, location: { path: 'rfc.front.abstract' } }
}

/**
 * Get the RFCs the abstract of a document mentions as obsoleted or updated, read once per document
 *
 * @example
 * await getRelationMentions(xmlDoc, 'updates') // { kind: 'updates', certainty: 'inferred', mentioned: ['7854'], stated: ['7854'], location: { path: 'rfc.front.abstract' } }
 * await getRelationMentions(txtDoc, 'updates') // { kind: 'updates', certainty: 'inferred', mentioned: ['7854'], stated: ['7854'], location: { lines: [{ line: 20, pos: 1 }] } }
 *
 * @param {Object} doc Parsed document, text or XML
 * @param {string} kind Relation: obsoletes or updates
 * @returns {Promise<RelationMentionsAnswer>} The mentions
 */
export async function getRelationMentions (doc, kind) {
  return getIndex(doc, `relationMentions:${kind}`, async () => {
    let abstract
    if (doc.type === 'txt') {
      abstract = getIndex(doc, 'abstractTexts', readTextAbstractTexts)
    } else {
      abstract = await getIndex(doc, 'abstractTexts', readXmlAbstractTexts)
    }
    const phrasings = RELATION_PHRASINGS[kind]
    const rfcsIn = relation => uniq(abstract.texts.flatMap(text => rfcsAfterVerb(text, relation)))
    return {
      kind,
      certainty: CERTAINTY.INFERRED,
      mentioned: rfcsIn(phrasings.mentioned),
      stated: rfcsIn(phrasings.stated),
      location: abstract.location
    }
  })
}
