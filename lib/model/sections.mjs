import { findIndex, get, has, isPlainObject } from 'lodash-es'
import { getReferencesSections } from '../helpers/references.mjs'
import { getMiddleSections, getSectionName } from '../helpers/sections.mjs'
import { bodyStartLine, contentLocations, getLooseHeadingLevel } from '../parsers/txt.mjs'
import { CERTAINTY, getIndex } from './indexes.mjs'

// Fewest lines, its heading included, of a text section that isn't empty
const MIN_SECTION_CONTENT_LENGTH = 2

// Names of the XML <middle> sections, by kind of section
const XML_SECTION_NAMES = {
  introduction: ['Introduction', 'Overview', 'Background'],
  securityConsiderations: ['Security Considerations'],
  ianaConsiderations: ['IANA Considerations']
}

// A line of the references section of a text document that reads as a references heading: an optional
// section number, its full stop sometimes left out, then words ending in "Reference" or "References"
// ("9.2.  Informative References", "9 References")
const TEXT_REFERENCES_HEADING_RE = /^(?:\d+(?:\.\d+)?\.?\s+)?(?:[A-Za-z-]+\s+)*References?$/i

// A line of the references section of a text document that reads as a numbered subsection heading
// ("9.1.  Normative References")
const TEXT_REFERENCES_SUBSECTION_RE = /^\d+\.\d+\.\s+(.+)$/i

// A references heading that names the kind of references
const NORMATIVE_OR_INFORMATIVE_RE = /normative|informative/i

// Number of a heading, or of a heading the parser doesn't recognise: a section number or an appendix letter,
// with or without "Appendix", then a full stop, spaces, or a "-" or ":" between spaces ("11.  ", "7 ",
// "Appendix A.  ", "A.1.  ", "Appendix B - ")
const HEADING_NUMBER = String.raw`(?:(?:Appendix\s+)?[A-Z]|\d+)(?:\.\d+)*(?:\.?\s+|\s+[-:–]\s+)`

// Headings of a references section the text parser doesn't recognise, one number or two ("11.  11.  "):
// - words ending in "References", one punctuation mark after it at most ("Appendix A.  References",
//   "21.  Normative and Informative References", "8.  References>");
// - "Bibliography" ("Appendix B.  Bibliography.");
// - numbered, only the kind of references ("14.  Normative").
// Not a title merely ending in "Reference" or holding the word ("Reference Implementation").
const UNRECOGNISED_REFERENCES_HEADING_RES = [
  new RegExp(String.raw`^(?:${HEADING_NUMBER}){0,2}(?:[A-Za-z-]+\s+){0,4}References[^\w\s]?$`, 'i'),
  new RegExp(String.raw`^(?:${HEADING_NUMBER}){0,2}Bibliography[^\w\s]?$`, 'i'),
  new RegExp(String.raw`^(?:${HEADING_NUMBER}){1,2}(?:Normative|Informative)[^\w\s]?$`, 'i')
]

// Longest line read as a heading the parser doesn't recognise
const MAX_HEADING_LENGTH = 72

// An entry of the table of contents, outside it: a title followed by dots and a page number
// (TOC_PATTERN in lib/parsers/txt.mjs)
const TOC_ENTRY_RE = /(?<!\.)\.+\s*\d+$/

/**
 * @typedef {Object} SectionAnswer
 * @property {string} kind Kind of section: abstract, introduction, securityConsiderations,
 *   ianaConsiderations or authors
 * @property {string} certainty How certain the answer is (CERTAINTY): declared for XML, inferred for text
 * @property {boolean} present Whether the document has the section
 * @property {boolean} empty Whether the section has no content (false when it isn't present)
 * @property {{lines: Array<{line: number, pos: number}>|undefined}|{path: string}|{}} location Where the
 *   section is, as the options of a finding: the line of its heading for text, its path for XML. For a
 *   missing XML section, where it would be declared (the <middle> element for a section of <middle>); for a
 *   missing text section, nowhere ({})
 * @property {*} [node] Declared answers only: the parsed element (or for authors, the <author> elements)
 *   the answer was read from, for the checks only XML can make, such as the children a section may have
 */

/**
 * @typedef {Object} HeadingAnswer
 * @property {string} title Heading as written: the line for text, the trimmed <name> (or title) for XML
 * @property {string} certainty How certain the answer is (CERTAINTY)
 * @property {{lines: Array<{line: number, pos: number}>|undefined}|{path: string}} location Where the
 *   heading is, as the options of a finding
 */

/**
 * Lines of a text document, as split into lines at each newline
 *
 * @param {Object} doc Parsed text document
 * @returns {string[]} Lines, empty if the document has no text
 */
function textLines (doc) {
  return getIndex(doc, 'textLines', () => doc.body?.split(/\r?\n/) ?? [])
}

/**
 * Location of a line of a text document, where its text starts
 *
 * @param {Object} doc Parsed text document
 * @param {number} line Line (1-based), 0 when unknown
 * @returns {Array<{line: number, pos: number}>|undefined} The location, or undefined when unknown
 */
function textLineLocation (doc, line) {
  const text = line ? textLines(doc)[line - 1] : undefined
  if (text === undefined) {
    return undefined
  }
  return [{ line, pos: text.length - text.trimStart().length + 1 }]
}

/**
 * Read a section of a text document from the headings the text parser recognised (doc.data.markers) and
 * the lines it kept under them (doc.data.content)
 *
 * The parser recognises the abstract by its heading and the other sections by a numbered heading, and the
 * authors' addresses by an "Authors' Addresses" heading. A section is empty when the parser kept fewer than
 * MIN_SECTION_CONTENT_LENGTH lines of it, its heading included; the IANA considerations section, when it
 * has no line besides its heading that isn't blank.
 *
 * @param {Object} doc Parsed text document
 * @param {string} kind Kind of section
 * @returns {SectionAnswer} The section
 */
function readTextSection (doc, kind) {
  const { markers } = doc.data
  const key = kind === 'authors' ? 'authorAddress' : kind
  const answer = { kind, certainty: CERTAINTY.INFERRED }
  // -> The parser keeps the lines of a section only under a heading it recognised, so the IANA
  //    considerations section is there when it has lines
  const present = key === 'ianaConsiderations'
    ? Boolean(doc.data.content.ianaConsiderations?.length)
    : Boolean(markers[key].start)
  if (!present) {
    return { ...answer, present: false, empty: false, location: {} }
  }
  const lines = doc.data.content[key]
  let empty
  if (key === 'abstract') {
    empty = !lines || lines.length < MIN_SECTION_CONTENT_LENGTH
  } else if (key === 'ianaConsiderations') {
    empty = lines.filter(text => text.trim() !== '').slice(1).length < 1
  } else {
    empty = lines?.length < MIN_SECTION_CONTENT_LENGTH
  }
  return { ...answer, present: true, empty, location: { lines: textLineLocation(doc, markers?.[key]?.start) } }
}

/**
 * Read a section of an XML document from its elements: <abstract>, the <author> elements of <front>, or a
 * top-level <section> of <middle> by its name. A section is empty when it has no child element (besides
 * its <name>).
 *
 * @param {Object} doc Parsed XML document
 * @param {string} kind Kind of section
 * @returns {SectionAnswer} The section
 */
function readXmlSection (doc, kind) {
  const answer = { kind, certainty: CERTAINTY.DECLARED }
  if (kind === 'abstract') {
    const node = get(doc, 'data.rfc.front.abstract')
    const children = isPlainObject(node) ? Object.keys(node).filter(k => k !== '_attr') : []
    const present = has(doc, 'data.rfc.front.abstract')
    return { ...answer, present, empty: present && children.length < 1, location: { path: 'rfc.front.abstract' }, node }
  }
  if (kind === 'authors') {
    let authors = get(doc, 'data.rfc.front.author', [])
    // -> A single author isn't an array
    if (isPlainObject(authors)) {
      authors = [authors]
    }
    const missing = !authors || authors.length < 1
    return { ...answer, present: !missing, empty: false, location: { path: 'rfc.front.author' }, node: authors }
  }
  const sections = getMiddleSections(doc)
  const idx = findIndex(sections, s => XML_SECTION_NAMES[kind].includes(getSectionName(s)))
  if (idx < 0) {
    // -> At <middle> itself: rfc.middle.section would resolve to the only section when there is just one
    return { ...answer, present: false, empty: false, location: { path: 'rfc.middle' } }
  }
  const node = sections[idx]
  const children = Object.keys(node).filter(k => k !== 'name' && k !== '_attr')
  return { ...answer, present: true, empty: children.length < 1, location: { path: `rfc.middle.section[${idx}]` }, node }
}

/**
 * Get a section of a document, whether it is there and empty, and where, read once per document
 *
 * @example
 * getSection(xmlDoc, 'introduction') // { certainty: 'declared', present: true, empty: false, location: { path: 'rfc.middle.section[0]' }, ... }
 * getSection(txtDoc, 'introduction') // { certainty: 'inferred', present: true, empty: false, location: { lines: [{ line: 80, pos: 1 }] }, ... }
 *
 * @param {Object} doc Parsed document, text or XML
 * @param {string} kind Kind of section: abstract, introduction, securityConsiderations, ianaConsiderations
 *   or authors (the "Authors' Addresses" section of text, the <author> elements of XML)
 * @returns {SectionAnswer} The section
 */
export function getSection (doc, kind) {
  if (doc.type === 'txt') {
    return getIndex(doc, `section:${kind}`, () => readTextSection(doc, kind))
  }
  return getIndex(doc, `section:${kind}`, () => readXmlSection(doc, kind))
}

/**
 * Read the headings of the references sections of a text document: the lines of its references section
 * that read as a references heading
 *
 * @param {Object} doc Parsed text document
 * @returns {HeadingAnswer[]} Headings, in document order
 */
function readTextReferencesHeadings (doc) {
  const content = doc.data.content.references ?? []
  if (!doc.data.markers.references.start || content.length === 0) {
    return []
  }
  const locations = contentLocations(doc, content, bodyStartLine(doc))
  const headings = []
  content.forEach((line, idx) => {
    if (TEXT_REFERENCES_HEADING_RE.test(line)) {
      const location = locations[idx]
      headings.push({ title: line, certainty: CERTAINTY.INFERRED, location: { lines: location ? [location] : undefined } })
    }
  })
  return headings
}

/**
 * Read the headings of the references sections of an XML document: the names of the <references>
 * elements that hold references (see getReferencesSections)
 *
 * @param {Object} doc Parsed XML document
 * @returns {HeadingAnswer[]} Headings, in document order
 */
function readXmlReferencesHeadings (doc) {
  return getReferencesSections(doc).map(({ path, name, nameKey }) => {
    return { title: String(name ?? '').trim(), certainty: CERTAINTY.DECLARED, location: { path: `${path}.${nameKey}` } }
  })
}

/**
 * Get the headings of the references sections of a document, read once per document
 *
 * @param {Object} doc Parsed document, text or XML
 * @returns {HeadingAnswer[]} Headings, in document order
 */
export function getReferencesHeadings (doc) {
  if (doc.type === 'txt') {
    return getIndex(doc, 'referencesHeadings', readTextReferencesHeadings)
  }
  return getIndex(doc, 'referencesHeadings', readXmlReferencesHeadings)
}

/**
 * Read the heading of a references section that the text parser didn't recognise: the first line at the margin,
 * starting a paragraph outside the table of contents, that reads as such a heading (see
 * UNRECOGNISED_REFERENCES_HEADING_RES)
 *
 * @param {Object} doc Parsed text document
 * @returns {HeadingAnswer|null} The heading, or null when there is none
 */
function readTextUnrecognisedReferencesHeading (doc) {
  const toc = doc.data.markers?.toc
  const lines = textLines(doc)
  for (const [idx, line] of lines.entries()) {
    const lineNumber = idx + 1
    const inToc = Boolean(toc?.start) && lineNumber >= toc.start && lineNumber <= toc.end
    const previousLine = lines[idx - 1]
    const startsParagraph = previousLine === undefined || !previousLine.trim() || previousLine.includes('\f')
    // -> A heading sits at the margin and is short: an indented line is body text or an entry of the table
    //    of contents
    const title = line.trim()
    const atMargin = title !== '' && !/^\s/.test(line) && title.length <= MAX_HEADING_LENGTH
    if (inToc || !startsParagraph || !atMargin || TOC_ENTRY_RE.test(title)) {
      continue
    }
    if (UNRECOGNISED_REFERENCES_HEADING_RES.some(regex => regex.test(title))) {
      return { title, certainty: CERTAINTY.INFERRED, location: { lines: textLineLocation(doc, lineNumber) } }
    }
  }
  return null
}

/**
 * Get the heading of a references section that the text parser didn't recognise, read once per document. Only
 * a text document has one: the references section of XML is the <references> element, whatever its name.
 *
 * Used when the parser found no references section: the heading is then the first that reads as one, whether
 * in an appendix ("Appendix A.  References"), numbered twice ("11.  11.  References"), with other words
 * ("21.  Normative and Informative References", "B.  Bibliography.") or naming only the kind of references
 * ("14.  Normative").
 *
 * @example
 * getUnrecognisedReferencesHeading(txtDoc) // { title: 'Appendix A.  References', certainty: 'inferred', location: { lines: [{ line: 733, pos: 1 }] } }
 *
 * @param {Object} doc Parsed text document
 * @returns {HeadingAnswer|null} The heading, or null when there is none
 */
export function getUnrecognisedReferencesHeading (doc) {
  return getIndex(doc, 'unrecognisedReferencesHeading', readTextUnrecognisedReferencesHeading)
}

/**
 * @typedef {Object} ReferencesSubsectionAnswer
 * @property {string|null} title Heading as written: the line for text, the trimmed <name> (or title) for XML;
 *   null for an XML section without one
 * @property {boolean} classified Whether the heading names the references normative or informative: it holds
 *   either word, in any case
 * @property {string} certainty How certain the answer is (CERTAINTY)
 * @property {{lines: Array<{line: number, pos: number}>|undefined}|{path: string}} location Where the
 *   heading is, as the options of a finding. For an XML section without a name, where it would be declared
 */

/**
 * Whether a references heading names normative or informative references
 *
 * @param {string} title Heading
 * @returns {boolean} Whether it holds "normative" or "informative", in any case
 */
function isClassifiedReferencesTitle (title) {
  return NORMATIVE_OR_INFORMATIVE_RE.test(title)
}

/**
 * Whether a line of the references section of a text document reads as a numbered subsection heading: numbered
 * "N.N." ("9.1.  Normative References"), or "N.N" where the text parser reads such a heading
 * (getLooseHeadingLevel: "9.1 Other References" at the margin, starting a paragraph)
 *
 * @param {string} line Line, trimmed
 * @param {string[]} lines Lines of the document, as is
 * @param {{line: number, pos: number}|undefined} location Where the line is
 * @returns {boolean} Whether it is a subsection heading
 */
function isTextReferencesSubsectionHeading (line, lines, location) {
  if (TEXT_REFERENCES_SUBSECTION_RE.test(line)) {
    return true
  }
  if (!location) {
    return false
  }
  return getLooseHeadingLevel(line, location.pos - 1, lines[location.line - 2]) === 'subsection'
}

/**
 * Read the subsections of the references section of a text document: the lines the text parser kept in its
 * references section that read as a numbered subsection heading (see isTextReferencesSubsectionHeading).
 *
 * The parser keeps the appendices after the references in its references section. In an appendix, a line of
 * prose wrapped before a section number ("11.2.  Partial-failure semantics ...") is no subsection: it is
 * indented further than the References heading and continues the line above, as the parser decides.
 *
 * @param {Object} doc Parsed text document
 * @returns {ReferencesSubsectionAnswer[]} Subsections, in document order
 */
function readTextReferencesSubsections (doc) {
  const { markers, content } = doc.data
  if (!markers.references.start) {
    return []
  }
  const locations = contentLocations(doc, content.references, bodyStartLine(doc))
  const lines = textLines(doc)
  const indentOf = (text) => text.length - text.trimStart().length
  const headingIndent = indentOf(lines[markers.references.start - 1] ?? '')
  const isWrappedLine = (location) => {
    if (!location) {
      return false
    }
    const lineIndent = indentOf(lines[location.line - 1])
    const previousLine = lines[location.line - 2] ?? ''
    return lineIndent > headingIndent && previousLine.trim() !== ''
  }
  const subsections = []
  let inAppendix = false
  for (const [idx, line] of content.references.entries()) {
    if (/^Appendix\b/i.test(line)) {
      inAppendix = true
    }
    const isWrappedProse = inAppendix && isWrappedLine(locations[idx])
    if (isTextReferencesSubsectionHeading(line, lines, locations[idx]) && !isWrappedProse) {
      inAppendix = false
      const location = locations[idx]
      subsections.push({
        title: line,
        classified: isClassifiedReferencesTitle(line),
        certainty: CERTAINTY.INFERRED,
        location: { lines: location ? [location] : undefined }
      })
    }
  }
  return subsections
}

/**
 * Read the references sections of an XML document: the <references> elements that hold references (see
 * getReferencesSections), each with its name
 *
 * @param {Object} doc Parsed XML document
 * @returns {ReferencesSubsectionAnswer[]} Sections, in document order
 */
function readXmlReferencesSubsections (doc) {
  return getReferencesSections(doc).map(({ path, name, nameKey }) => {
    return {
      title: name ? name.trim() : null,
      classified: isClassifiedReferencesTitle(name),
      certainty: CERTAINTY.DECLARED,
      location: { path: `${path}.${nameKey}` }
    }
  })
}

/**
 * Get the sections that list references, each with its heading and whether the heading says what kind of
 * references they are, read once per document: the numbered subsections of the references section of a text
 * document, the <references> elements holding references of an XML document
 *
 * @example
 * getReferencesSubsections(xmlDoc) // [{ title: 'Normative References', classified: true, certainty: 'declared', location: { path: 'rfc.back.references[0].name' } }, ...]
 * getReferencesSubsections(txtDoc) // [{ title: '9.1.  Normative References', classified: true, certainty: 'inferred', location: { lines: [{ line: 310, pos: 1 }] } }, ...]
 *
 * @param {Object} doc Parsed document, text or XML
 * @returns {ReferencesSubsectionAnswer[]} Sections, in document order
 */
export function getReferencesSubsections (doc) {
  if (doc.type === 'txt') {
    return getIndex(doc, 'referencesSubsections', readTextReferencesSubsections)
  }
  return getIndex(doc, 'referencesSubsections', readXmlReferencesSubsections)
}
