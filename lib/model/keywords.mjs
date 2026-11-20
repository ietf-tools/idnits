import { isPlainObject } from 'lodash-es'
import { findAllDescendantsWith } from '../helpers/traversal.mjs'
import { isInCitedReference } from '../helpers/xml-paths.mjs'
import { getLocations } from '../parsers/txt.mjs'
import { CERTAINTY, getIndex } from './indexes.mjs'

// BCP 14 requirement-level keywords as XML prose uses them, with a "NOT" or "not" before or after
// ("MUST not", "NOT OPTIONAL"), so that invalid combinations are found too. The "NOT" is a whole word, so
// that "SHOULD notify" and "cannot MUST" aren't read as "SHOULD not" and "not MUST". The words can be
// separated by any run of whitespace, as XML prose keeps the line breaks and indentation of its source
// ("MUST\n      NOT"); see normalizeKeyword(). Also read by the XML checks of lib/modules/keywords.mjs.
export const REQ_LEVEL_KEYWORDS_RE = /(\b(NOT|not)\s+)?(MUST|REQUIRED|SHALL|SHOULD|RECOMMENDED|OPTIONAL|MAY)(\s+(NOT|not)\b)?/g

// A BCP 14 boilerplate in XML prose, from "The key words" to the end of its sentence. Its words can be
// separated by any run of whitespace, as XML prose keeps the line breaks and indentation of its source
// ("in this\n      document"). Also read by the XML checks of lib/modules/keywords.mjs.
export const REQ_LEVEL_BOILERPLATE_RE = /The\s+key\s*words\s(.|\n)+?\sin\s+this\s+document\s(.|\n)+?./gi

// NOT RECOMMENDED as a boilerplate lists it, possibly broken across lines
const NOT_RECOMMENDED_RE = /NOT\s+RECOMMENDED/

// XML tags holding prose the author wrote, and so where BCP 14 keywords are meaningful. Also read by the
// XML checks of lib/modules/keywords.mjs.
export const BCP14_PROSE_TAGS = ['t', '#text', 'li', 'dt', 'dd', 'th', 'td', 'blockquote', 'aside', 'cref', 'name', 'strong', 'em']

// Identifiers of the documents making up BCP 14, as normalized by getBcp14RefId()
const BCP14_REF_IDS = ['RFC2119', 'RFC8174', 'BCP14']

// Most locations given for an answer about many spots of a text document
const MAX_LOCATIONS = 20

/**
 * @typedef {Object} KeywordAnswer
 * @property {string} keyword Keyword as written, with each run of whitespace as one space ("MUST NOT");
 *   in XML, possibly an invalid combination ("MUST not")
 * @property {string} certainty How certain the answer is (CERTAINTY): declared inside <bcp14>, inferred
 *   when matched in prose (all of text, the rest of XML)
 * @property {boolean} inBoilerplate Whether it is in the BCP 14 boilerplate, listing what the boilerplate
 *   covers rather than used. Known for XML only: false for text, whose parser doesn't tell the
 *   boilerplate's keywords from the others
 * @property {{lines: Array<{line: number, pos: number}>|undefined}|{path: string}} location Where the
 *   keyword is, as the options of a finding: its line for text, the path of the value holding it for XML
 */

/**
 * @typedef {Object} KeywordsAnswer
 * @property {boolean} used Whether the document uses keywords besides those its BCP 14 boilerplate lists
 * @property {KeywordAnswer[]} keywords Keywords found, in document order: for text, all of them (the
 *   boilerplate's too); for XML, those of the prose outside the text of the boilerplate
 */

/**
 * @typedef {Object} Bcp14BoilerplateAnswer
 * @property {string} certainty How certain the answer is (CERTAINTY): inferred, as the boilerplate is
 *   matched in prose
 * @property {boolean} present Whether the document has a BCP 14 boilerplate
 * @property {boolean} notRecommended Whether the boilerplate lists NOT RECOMMENDED
 * @property {{lines: Array<{line: number, pos: number}>|undefined}|{path: string}|{}} location Where the
 *   boilerplate is, as the options of a finding: the lines of the keywords it lists for text, the path of
 *   the first paragraph holding it for XML; nowhere ({}) when it isn't there
 */

/**
 * @typedef {Object} Bcp14ReferenceAnswer
 * @property {string} id Document of BCP 14 referenced: RFC2119, RFC8174 or BCP14
 * @property {string} certainty How certain the answer is (CERTAINTY): declared for XML (entities,
 *   includes, <reference> anchors, <seriesInfo>, <xref> targets), inferred for text (labels in lines)
 * @property {boolean} cited Whether it is cited by its label: "[BCP14]" in text, an <xref> in XML
 * @property {{lines: Array<{line: number, pos: number}>|undefined}|{path: string}|{}} location Where it
 *   is, as the options of a finding: the lines of its label for text; for XML, the path of the first
 *   <xref> citing it, or else of the first element declaring it (<reference>, <referencegroup>,
 *   xi:include), nowhere ({}) when only an entity declares it
 */

/**
 * A keyword matched in XML prose, with each run of whitespace between its words as one space, so that
 * "MUST\n      NOT" reads "MUST NOT"
 *
 * @param {string} keyword Keyword as matched
 * @returns {string} Keyword with single spaces
 */
export function normalizeKeyword (keyword) {
  return keyword.replace(/\s+/g, ' ')
}

/**
 * Call a function on each string value of a parsed XML element, in document order, the same way as
 * traverseAllValues() does but synchronously, so that an index can be computed on first use
 *
 * @param {*} obj Element, or value
 * @param {function(string, string, string[]): void} func Called with the value, the key owning it and
 *   its path
 * @param {string[]} [path] Path of obj
 * @param {string} [key] Tag owning obj, when obj is a member of an array
 */
function forEachValue (obj, func, path = [], key = null) {
  if (typeof obj === 'string') {
    func(obj, key, path)
    return
  }
  for (const [k, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      func(value, k, [...path, k])
    } else if (Array.isArray(value)) {
      value.forEach((entry, idx) => {
        forEachValue(entry, func, [...path, `${k}[${idx}]`], k)
      })
    } else if (isPlainObject(value)) {
      forEachValue(value, func, [...path, k])
    }
  }
}

/**
 * Path segments of an XML path, without their array indices ("bcp14[0]" is "bcp14")
 *
 * @param {string[]} path Path
 * @returns {string[]} Tag names
 */
function tagNames (path) {
  return path.map(seg => seg.replace(/\[\d+\]$/, ''))
}

/**
 * First locations (at most MAX_LOCATIONS) of answers about a text document, in document order
 *
 * @param {Array<{line: number, pos: number}>} locations Locations
 * @returns {Array<{line: number, pos: number}>|undefined} First locations, or undefined when there are none
 */
function firstLocations (locations) {
  const sorted = [...locations].sort((a, b) => a.line - b.line || a.pos - b.pos)
  return sorted.length ? sorted.slice(0, MAX_LOCATIONS) : undefined
}

/**
 * Read the prose of an XML document that BCP 14 keywords can be in: the values of BCP14_PROSE_TAGS and of
 * <bcp14>, outside cited references, with where each value is and whether it holds a boilerplate, read
 * in one pass with the values reading "NOT RECOMMENDED"
 *
 * @param {Object} doc Parsed XML document
 * @returns {{prose: Array<{text: string, path: string[], key: string, inBcp14Tag: boolean, boilerplate: string[]|null}>, notRecommended: string[][]}}
 *   Prose values, in document order (text with its newlines as spaces, key the tag owning it,
 *   boilerplate the boilerplate matches), and the paths of the values reading "NOT RECOMMENDED"
 */
function readXmlProse (doc) {
  return getIndex(doc, 'bcp14Prose', () => {
    const prose = []
    const notRecommended = []
    forEachValue(doc.data, (val, k, p) => {
      // Text of cited references isn't written by the author
      if (isInCitedReference(p)) {
        return
      }
      if (val.replace(/\s+/g, ' ').trim() === 'NOT RECOMMENDED') {
        notRecommended.push(p)
      }
      const inBcp14Tag = tagNames(p).includes('bcp14')
      if (BCP14_PROSE_TAGS.includes(k) || inBcp14Tag) {
        const text = val.replaceAll('\n', ' ')
        prose.push({ text, path: p, key: k, inBcp14Tag, boilerplate: text.match(REQ_LEVEL_BOILERPLATE_RE) })
      }
    })
    return { prose, notRecommended }
  })
}

/**
 * Read the BCP 14 boilerplates of an XML document: the paragraphs holding one, and whether each lists
 * NOT RECOMMENDED
 *
 * A paragraph is the element owning a text holding a boilerplate, or the value itself for a text-only
 * element. A tagged boilerplate lists its keywords as values of its <bcp14> children.
 *
 * @param {Object} doc Parsed XML document
 * @returns {Map<string, boolean>} Whether each lists NOT RECOMMENDED, by the path of its paragraph
 *   (ending with a ".")
 */
function readXmlBoilerplates (doc) {
  return getIndex(doc, 'bcp14Boilerplates', () => {
    const { prose, notRecommended } = readXmlProse(doc)
    const boilerplates = new Map()
    for (const { path, key, boilerplate } of prose) {
      if (boilerplate) {
        const para = (key === '#text' ? path.slice(0, -1) : path).join('.') + '.'
        boilerplates.set(para, boilerplates.get(para) || NOT_RECOMMENDED_RE.test(boilerplate[0]))
      }
    }
    for (const path of notRecommended) {
      const para = xmlBoilerplateOf(boilerplates, path)
      if (para) {
        boilerplates.set(para, true)
      }
    }
    return boilerplates
  })
}

/**
 * The paragraph holding a BCP 14 boilerplate that a value of an XML document is in
 *
 * @param {Map<string, boolean>} boilerplates Boilerplates, by the path of their paragraph
 * @param {string[]} path Path of the value
 * @returns {string|undefined} Path of the paragraph, if the value is in one
 */
function xmlBoilerplateOf (boilerplates, path) {
  const valuePath = path.join('.') + '.'
  return [...boilerplates.keys()].find(para => valuePath.startsWith(para))
}

/**
 * Read the BCP 14 keywords of a text document from those its parser found on each line
 * (doc.data.extractedElements.keywords2119) and where it found them
 *
 * The parser finds the boilerplate's keywords among the others, so keywords are used besides the
 * boilerplate's when it found more than the boilerplate lists.
 *
 * @param {Object} doc Parsed text document
 * @returns {KeywordsAnswer} The keywords
 */
function readTextKeywords (doc) {
  const { keywords2119, boilerplate2119Keywords } = doc.data.extractedElements
  // How many times each keyword was located so far, to take its next location
  const seen = new Map()
  const keywords = keywords2119.map(({ keyword }) => {
    const idx = seen.get(keyword) ?? 0
    seen.set(keyword, idx + 1)
    const location = getLocations(doc, 'keywords2119', keyword)[idx]
    return { keyword, certainty: CERTAINTY.INFERRED, inBoilerplate: false, location: { lines: location ? [location] : undefined } }
  })
  return { used: keywords2119.length > boilerplate2119Keywords.length, keywords }
}

/**
 * Read the BCP 14 keywords of an XML document from its prose
 *
 * In a text holding a boilerplate, the keywords outside the boilerplate are used, as in a YANG module
 * whose description repeats it. Elsewhere, a keyword in a paragraph holding a boilerplate is one the
 * boilerplate lists.
 *
 * @param {Object} doc Parsed XML document
 * @returns {KeywordsAnswer} The keywords
 */
function readXmlKeywords (doc) {
  const boilerplates = readXmlBoilerplates(doc)
  const keywords = []
  for (const { text, path, inBcp14Tag, boilerplate } of readXmlProse(doc).prose) {
    const answer = {
      certainty: inBcp14Tag ? CERTAINTY.DECLARED : CERTAINTY.INFERRED,
      inBoilerplate: !boilerplate && Boolean(xmlBoilerplateOf(boilerplates, path)),
      location: { path: path.join('.') }
    }
    const used = boilerplate ? text.replace(REQ_LEVEL_BOILERPLATE_RE, ' ') : text
    for (const match of used.matchAll(REQ_LEVEL_KEYWORDS_RE)) {
      keywords.push({ keyword: normalizeKeyword(match[0]), ...answer })
    }
  }
  return { used: keywords.some(kw => !kw.inBoilerplate), keywords }
}

/**
 * Get the BCP 14 keywords of a document, and whether it uses any besides those its boilerplate lists,
 * read once per document
 *
 * @example
 * getKeywords(xmlDoc) // { used: true, keywords: [{ keyword: 'MUST', certainty: 'declared', inBoilerplate: false, location: { path: 'rfc.middle.section[0].t[2].bcp14' } }] }
 * getKeywords(txtDoc) // { used: true, keywords: [{ keyword: 'MUST', certainty: 'inferred', inBoilerplate: false, location: { lines: [{ line: 120, pos: 9 }] } }] }
 *
 * @param {Object} doc Parsed document, text or XML
 * @returns {KeywordsAnswer} The keywords
 */
export function getKeywords (doc) {
  if (doc.type === 'txt') {
    return getIndex(doc, 'keywords', readTextKeywords)
  }
  return getIndex(doc, 'keywords', readXmlKeywords)
}

/**
 * Read the BCP 14 boilerplate of a text document from the boilerplates its parser matched
 * (doc.data.boilerplate) and the keywords it found in them (doc.data.extractedElements.boilerplate2119Keywords)
 *
 * @param {Object} doc Parsed text document
 * @returns {Bcp14BoilerplateAnswer} The boilerplate
 */
function readTextBoilerplate (doc) {
  const { rfc2119, rfc8174, bcp14 } = doc.data.boilerplate
  const listed = doc.data.extractedElements.boilerplate2119Keywords
  const answer = { certainty: CERTAINTY.INFERRED, notRecommended: listed.includes('NOT RECOMMENDED') }
  if (!(rfc2119 || rfc8174 || bcp14)) {
    return { ...answer, present: false, location: {} }
  }
  const locations = listed.flatMap(keyword => getLocations(doc, 'boilerplate2119Keywords', keyword))
  return { ...answer, present: true, location: { lines: firstLocations(locations) } }
}

/**
 * Read the BCP 14 boilerplate of an XML document from its prose
 *
 * @param {Object} doc Parsed XML document
 * @returns {Bcp14BoilerplateAnswer} The boilerplate
 */
function readXmlBoilerplate (doc) {
  const boilerplates = readXmlBoilerplates(doc)
  const answer = { certainty: CERTAINTY.INFERRED, notRecommended: [...boilerplates.values()].some(Boolean) }
  if (boilerplates.size < 1) {
    return { ...answer, present: false, location: {} }
  }
  const [para] = boilerplates.keys()
  return { ...answer, present: true, location: { path: para.slice(0, -1) } }
}

/**
 * Get the BCP 14 boilerplate of a document, whether it is there and lists NOT RECOMMENDED, and where,
 * read once per document
 *
 * @param {Object} doc Parsed document, text or XML
 * @returns {Bcp14BoilerplateAnswer} The boilerplate
 */
export function getBcp14Boilerplate (doc) {
  if (doc.type === 'txt') {
    return getIndex(doc, 'bcp14Boilerplate', readTextBoilerplate)
  }
  return getIndex(doc, 'bcp14Boilerplate', readXmlBoilerplate)
}

/**
 * Where a label ("[RFC2119]") is cited in a text document, in the text and in the references section
 *
 * @param {Object} doc Parsed text document
 * @param {string} label Label, in uppercase
 * @returns {Array<{line: number, pos: number}>|undefined} First locations, or undefined when there are none
 */
function textCitationLocations (doc, label) {
  const locations = ['bracketedRfcNonReferences', 'bracketedRfcReferences'].flatMap((kind) => {
    const values = Object.keys(doc.data.extractedElements?.locations?.[kind] ?? {})
    return values.filter(value => value.toUpperCase() === label).flatMap(value => getLocations(doc, kind, value))
  })
  return firstLocations(locations)
}

/**
 * Where "[BCP14]" is in a text document: on the lines the parser reads it from (lines with a form feed
 * are page breaks, which it skips)
 *
 * @param {Object} doc Parsed text document
 * @returns {Array<{line: number, pos: number}>|undefined} First locations, or undefined when there are none
 */
function textBcp14LabelLocations (doc) {
  const locations = []
  for (const [idx, line] of (doc.body ?? '').split('\n').entries()) {
    if (line.includes('\f')) {
      continue
    }
    for (const match of line.matchAll(/\[BCP14\]/gi)) {
      locations.push({ line: idx + 1, pos: match.index + 1 })
    }
  }
  return locations.length ? locations.slice(0, MAX_LOCATIONS) : undefined
}

/**
 * Read the references of a text document to BCP 14, from the labels its parser found in lines
 * (doc.data.references): each is cited by its label
 *
 * @param {Object} doc Parsed text document
 * @returns {Bcp14ReferenceAnswer[]} References, in the order of BCP14_REF_IDS
 */
function readTextBcp14References (doc) {
  const { rfc2119, rfc8174, bcp14 } = doc.data.references
  const answers = []
  if (rfc2119) {
    answers.push({ id: 'RFC2119', lines: textCitationLocations(doc, '[RFC2119]') })
  }
  if (rfc8174) {
    answers.push({ id: 'RFC8174', lines: textCitationLocations(doc, '[RFC8174]') })
  }
  if (bcp14) {
    answers.push({ id: 'BCP14', lines: textBcp14LabelLocations(doc) })
  }
  return answers.map(({ id, lines }) => {
    return { id, certainty: CERTAINTY.INFERRED, cited: true, location: { lines } }
  })
}

/**
 * Normalize a reference identifier (anchor / xref target, e.g. "RFC2119" or "bcp-14") or a bibxml
 * filename (e.g. "reference.BCP.0014.xml") to one of BCP14_REF_IDS
 *
 * @param {string} str Identifier, filename or URL
 * @returns {string|undefined} Normalized identifier, if it refers to BCP 14
 */
function getBcp14RefId (str) {
  if (typeof str !== 'string') {
    return
  }
  const match = str.match(/reference\.(RFC|BCP)\.0*(\d+)\.xml$/i) || str.match(/^(RFC|BCP)[\s_-]?0*(\d+)$/i)
  if (match) {
    const id = `${match[1].toUpperCase()}${match[2]}`
    return BCP14_REF_IDS.includes(id) ? id : undefined
  }
}

/**
 * Elements of an XML element with one of the given tags, at any depth, that have attributes, with their
 * paths
 *
 * Each element of an array gets its index in its path, so that the path points to that element.
 *
 * @param {Object} obj Element
 * @param {string[]} tags Tags
 * @param {string[]} path Path of obj
 * @returns {Array<{el: Object, tag: string, path: string}>} Elements, their tags and their paths, in
 *   document order
 */
function elementsOf (obj, tags, path) {
  const matches = findAllDescendantsWith(obj, (v, k) => tags.includes(k), path)
  return matches.flatMap(({ key, value, path: matchPath }) => {
    if (!Array.isArray(value)) {
      return [{ el: value, tag: key, path: matchPath.join('.') }]
    }
    const parentPath = matchPath.slice(0, -1)
    return value.map((el, idx) => {
      return { el, tag: key, path: [...parentPath, `${key}[${idx}]`].join('.') }
    })
  }).filter(({ el }) => el?._attr)
}

/**
 * Keep the first value given for a key, when there is a key
 *
 * @param {Map} map Values, by key
 * @param {*} key Key, if any
 * @param {*} value Value
 */
function setFirst (map, key, value) {
  if (key && !map.has(key)) {
    map.set(key, value)
  }
}

/**
 * Read the references of an XML document to BCP 14: by external entities, xi:include, <reference> /
 * <referencegroup> anchors, <seriesInfo> or <xref> targets. Those cited are the targets of an <xref>.
 *
 * Each is located at the first <xref> citing it or, when none does, at the first element declaring it.
 *
 * @param {Object} doc Parsed XML document
 * @returns {Bcp14ReferenceAnswer[]} References, in the order of BCP14_REF_IDS
 */
function readXmlBcp14References (doc) {
  const ids = []
  // Path of the first element declaring each, and of the first <xref> citing each
  const declaredAt = new Map()
  const citedAt = new Map()
  for (const entity of doc.externalEntities ?? []) {
    ids.push(getBcp14RefId(entity.name), getBcp14RefId(entity.url))
  }
  for (const { el, tag, path } of elementsOf(doc.data, ['xref', 'xi:include'], [])) {
    const target = getBcp14RefId(el._attr.target)
    const href = getBcp14RefId(el._attr.href)
    ids.push(target, href)
    setFirst(declaredAt, href, path)
    if (tag === 'xref') {
      setFirst(citedAt, target, path)
    }
  }
  for (const { el, path } of elementsOf(doc.data?.rfc?.back, ['reference', 'referencegroup'], ['rfc', 'back'])) {
    const refIds = [getBcp14RefId(el._attr.anchor)]
    for (const si of [el.seriesInfo].flat()) {
      if (si?._attr?.name && si._attr.value) {
        refIds.push(getBcp14RefId(`${si._attr.name}${si._attr.value}`))
      }
    }
    ids.push(...refIds)
    for (const id of refIds) {
      setFirst(declaredAt, id, path)
    }
  }
  return BCP14_REF_IDS.filter(id => ids.includes(id)).map((id) => {
    const path = citedAt.get(id) ?? declaredAt.get(id)
    return { id, certainty: CERTAINTY.DECLARED, cited: citedAt.has(id), location: path ? { path } : {} }
  })
}

/**
 * Get the references of a document to the documents making up BCP 14 (RFC 2119, RFC 8174, BCP 14),
 * read once per document
 *
 * @param {Object} doc Parsed document, text or XML
 * @returns {Bcp14ReferenceAnswer[]} References, one for each document referenced, in the order of
 *   BCP14_REF_IDS
 */
export function getBcp14References (doc) {
  if (doc.type === 'txt') {
    return getIndex(doc, 'bcp14References', readTextBcp14References)
  }
  return getIndex(doc, 'bcp14References', readXmlBcp14References)
}
