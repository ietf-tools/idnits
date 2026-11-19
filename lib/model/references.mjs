import { isEqual, isNil, isPlainObject, last, sortedLastIndexBy, trimStart, uniq } from 'lodash-es'
import { getReferencesSections, INFORMATIVE_REFERENCES_HEADING_RE, NORMATIVE_REFERENCES_HEADING_RE } from '../helpers/references.mjs'
import { findAllDescendantsWith } from '../helpers/traversal.mjs'
import { listXmlReferences, maskCommentsAndCdata } from '../helpers/xml-references.mjs'
import { getLocations, getLooseHeadingLevel, isAppendixHeading, isLooselyNumbered, pageBreakLineType } from '../parsers/txt.mjs'
import { CERTAINTY, getIndex } from './indexes.mjs'

// Most lines given for a finding about references of a text document
const MAX_REFERENCE_LINES = 20

// Kinds of references, by the subsection of the references section of a text document they are listed in
const TEXT_REFERENCE_KINDS = {
  normative_references: 'normative',
  informative_references: 'informative',
  unclassified_references: 'unclassified'
}

// Headings of the subsections of the references section, as the text parser recognizes them
// (lib/parsers/txt.mjs, subsectionMatchers, SUBSECTION_PATTERN, getLooseHeadingLevel and TOC_PATTERN): a
// numbered subsection heading the parser doesn't recognize ends the subsection before it
const REFERENCE_SUBSECTION_HEADINGS = [
  { name: 'normative_references', regex: NORMATIVE_REFERENCES_HEADING_RE },
  { name: 'informative_references', regex: INFORMATIVE_REFERENCES_HEADING_RE },
  { name: 'unclassified_references', regex: /^\d+\.\d+\.?\s+([a-zA-Z]+\s+)*Reference(s)?$/i },
  // -> A References section's own heading ("7.  References", "7 References", "7.0 References"): its entries
  //    before any subsection heading are unclassified
  { name: 'unclassified_references', regex: /^(?:\d+(?:\.0|\.)?\s+)?References$/i }
]
const NUMBERED_SUBSECTION_HEADING_RE = /^\d+\.\d+\.\s+(.+)$/
// A heading's number standing on a line of its own, the title on the next line ("7." / "Normative References")
const HEADING_NUMBER_LINE_RE = /^\d+(?:\.\d+)*\.?$/
// Tried from the first dot of a run only, so a long line of dots is read once
const TOC_ENTRY_RE = /(?<!\.)\.+\s*\d+$/

/**
 * @typedef {Object} ReferenceAnswer
 * @property {string|null} kind Kind of references it is listed with: normative, informative or unclassified
 *   (any other heading, or none); null for a text reference listed in an appendix
 * @property {string|null} label Its anchor (XML; for an included bibliography entry, the name of the entry) or
 *   the label of its entry, without brackets (text); null when there is none
 * @property {string|null} rfc RFC number it cites, without leading zeros
 * @property {string|null} [rfcAsWritten] Inferred answers only: the RFC number as the text writes it, leading
 *   zeros included ("0791")
 * @property {string|null} draft Internet-Draft it cites, as cited: with its revision if given
 * @property {boolean|null} external Whether it cites a document that is neither an RFC (numbered or not yet),
 *   a BCP, an STD nor an Internet-Draft; null when that can't be told (an included file that isn't a
 *   bibliography entry)
 * @property {string} [source] Declared answers only: how the reference is given, 'reference', 'xi:include',
 *   'entity' or 'pi' (see listXmlReferences)
 * @property {string} certainty How certain the answer is (CERTAINTY): declared for XML, inferred for text
 * @property {{lines: Array<{line: number, pos: number}>|undefined}|{path: string}} location Where the
 *   reference is, as the options of a finding: the lines it is on for text (see readTextReferences), the path
 *   of its element for XML
 */

/**
 * Whether a line starts a paragraph, as the text parser decides where a heading can start (startsParagraph in
 * lib/parsers/txt.mjs): the line before it is blank or holds a page break, or there is none
 *
 * @param {string|undefined} previousLine The line before it, as is
 * @returns {boolean} Whether the line after previousLine starts a paragraph
 */
function startsParagraph (previousLine) {
  if (previousLine === undefined) {
    return true
  }
  return !previousLine.trim() || previousLine.includes('\f')
}

/**
 * Whether a line can start a heading: it starts a paragraph, or the line before it holds only a heading's
 * number and starts one ("7." / "Normative References")
 *
 * @param {string[]} lines Lines of the document, as is
 * @param {number} idx Index of the line
 * @returns {boolean} Whether a heading can start on the line
 */
function startsHeading (lines, idx) {
  const previousLine = lines[idx - 1]
  if (startsParagraph(previousLine)) {
    return true
  }
  const isHeadingNumber = HEADING_NUMBER_LINE_RE.test(previousLine.trim())
  return isHeadingNumber && startsParagraph(lines[idx - 2])
}

/**
 * Read the subsection headings of a text document, outside its table of contents
 *
 * @param {Object} doc Parsed text document
 * @returns {Array<{line: number, name: string|null}>} Headings in document order: the line (1-based) and the
 *   subsection it starts, null for a numbered subsection that is not one of references
 */
function readSubsectionHeadings (doc) {
  const headings = []
  const toc = doc.data?.markers?.toc
  const lines = typeof doc.body === 'string' ? doc.body.split('\n') : []
  lines.forEach((line, idx) => {
    const lineNumber = idx + 1
    const trimmed = line.trim()
    if ((toc?.start && lineNumber >= toc.start && lineNumber <= toc.end) || TOC_ENTRY_RE.test(trimmed)) {
      return
    }
    // -> An appendix heading as the parser recognises it, not a wrapped line of an entry starting with "Appendix"
    const indent = line.length - line.trimStart().length
    let heading = REFERENCE_SUBSECTION_HEADINGS.find(({ regex }) => regex.test(trimmed))
    // -> An unnumbered references heading ("Normative References") only where a heading can start, not a
    //    wrapped line of prose ("added RFC 8621 as a" / "normative reference" in a change log) or a running header.
    //    A heading's number may stand on the line before it ("7." / "Normative References").
    const unnumbered = !/^\d/.test(trimmed)
    if (heading && unnumbered && !startsHeading(lines, idx)) {
      heading = undefined
    }
    // -> A heading numbered without its full stop ("7.1 Other References") or "N.0" only where the parser reads one
    const looseHeadingLevel = getLooseHeadingLevel(trimmed, indent, lines[idx - 1])
    if (heading && isLooselyNumbered(trimmed) && !looseHeadingLevel) {
      heading = undefined
    }
    if (isAppendixHeading(trimmed, indent, lines[idx - 1] ?? null)) {
      heading = { name: 'appendix' }
    }
    if (heading || NUMBERED_SUBSECTION_HEADING_RE.test(trimmed) || looseHeadingLevel === 'subsection') {
      headings.push({ line: lineNumber, name: heading?.name ?? null })
    }
  })
  return headings
}

/**
 * Get the subsection headings of a text document, outside its table of contents, read once per document
 *
 * @param {Object} doc Parsed text document
 * @returns {Array<{line: number, name: string|null}>} Headings in document order: the line (1-based) and the
 *   subsection it starts, null for a numbered subsection that is not one of references
 */
export function getSubsectionHeadings (doc) {
  return getIndex(doc, 'subsectionHeadings', readSubsectionHeadings)
}

/**
 * Subsection headings of a text document that start a subsection of references (see getSubsectionHeadings)
 *
 * @param {Object} doc Parsed text document
 * @returns {Array<{line: number, name: string}>} Headings in document order
 */
function getReferenceHeadings (doc) {
  return getIndex(doc, 'referenceSubsectionHeadings', () => getSubsectionHeadings(doc).filter((heading) => heading.name))
}

/**
 * Index of the last heading at or before a line
 *
 * @param {Array<{line: number}>} headings Headings in document order
 * @param {number} line Line (1-based)
 * @returns {number} Index of the heading, -1 when there is none
 */
function headingIndexAt (headings, line) {
  return sortedLastIndexBy(headings, { line }, 'line') - 1
}

/**
 * Sort locations in document order, without duplicates, and keep the first ones
 *
 * Once sorted, equal locations are next to each other: each is compared with the one kept before it only, so
 * that a value the document cites thousands of times takes time growing with the number of citations, not
 * with its square
 *
 * @param {Array<{line: number, pos: number}>} locations Locations
 * @returns {Array<{line: number, pos: number}>|undefined} Locations to give a finding, undefined for none
 */
function findingLines (locations) {
  const sorted = [...locations].sort((a, b) => a.line - b.line || a.pos - b.pos)
  const kept = []
  for (const location of sorted) {
    if (kept.length === 0 || !isEqual(last(kept), location)) {
      kept.push(location)
    }
  }
  return kept.length > 0 ? kept.slice(0, MAX_REFERENCE_LINES) : undefined
}

/**
 * Where an RFC is on the lines of the references section of a text document that hold an [RFCn] label: where
 * the text parser found it in the subsection it records it for.
 *
 * The parser records an RFC (referenceSectionRfc) once, with the subsection of its first entry, but locates it
 * in every subsection that lists it again: the locations kept are those under the same heading as the first one.
 *
 * @param {Object} doc Parsed text document
 * @param {string} value RFC number as extracted, e.g. '2119'
 * @returns {Array<{line: number, pos: number}>} Locations
 */
function labelLineRfcLocations (doc, value) {
  const locations = getLocations(doc, 'referenceSectionRfc', value)
  if (locations.length === 0) {
    return []
  }
  const headings = getSubsectionHeadings(doc)
  const first = headingIndexAt(headings, locations[0].line)
  return locations.filter((location) => headingIndexAt(headings, location.line) === first)
}

/**
 * Where the text parser found links to a draft (or names of a draft) in the references section
 * (draftStatusReferences)
 *
 * The parser records a draft once per subsection, but locates it in each: the locations kept are those under a
 * heading of the subsection, as the parser groups them, or all of them for a draft recorded with no subsection.
 *
 * @param {Object} doc Parsed text document
 * @param {string} value Draft as extracted, with its revision if given
 * @param {string|null} subsection Subsection it is recorded for, e.g. 'normative_references'
 * @returns {Array<{line: number, pos: number}>} Locations
 */
function draftLocations (doc, value, subsection) {
  const locations = getLocations(doc, 'draftStatusReferences', value)
  if (!subsection) {
    return locations
  }
  const headings = getReferenceHeadings(doc)
  return locations.filter((location) => headings[headingIndexAt(headings, location.line)]?.name === subsection)
}

/**
 * Entries of the references section of a text document, each with where its label is
 *
 * @param {Object} doc Parsed text document
 * @returns {Array<{entry: Object, location: {line: number, pos: number}|undefined}>} Entries, in document order
 */
function referenceEntriesWithLocations (doc) {
  const seen = new Map()
  return (doc.data.extractedElements.referenceEntries ?? []).map((entry) => {
    // -> A label listed again is located once for each entry, in document order
    const index = (seen.get(entry.value) ?? -1) + 1
    seen.set(entry.value, index)
    return { entry, location: getLocations(doc, 'referenceEntries', entry.value)[index] }
  })
}

/**
 * RFCs that entries of the references section of a text document cite, but that the text parser does not record
 * in referenceSectionRfc: it records the RFCs on the lines holding a bracketed [RFCn] label, not those cited under
 * another label, e.g. RFC 8446 for "[TLS] Rescorla, E., ..., RFC 8446, ...", RFC 2119 for "[1] Bradner, S., ...,
 * BCP 14, RFC 2119" or "[BCP14]". An RFC that referenceSectionRfc has, in any subsection, is left to it, so that no
 * RFC is given twice; like there, an RFC is given once, for the subsection of the first entry that cites it,
 * located at the label of each entry of that subsection citing it.
 *
 * @param {Object} doc Parsed text document
 * @param {Array<{entry: Object, location: Object|undefined}>} entries Entries, from referenceEntriesWithLocations
 * @returns {Array<{number: string, subsection: string|null, locations: Array<{line: number, pos: number}>}>} RFCs,
 *   by number without leading zeros, in document order
 */
function entryOnlyRfcs (doc, entries) {
  const known = new Set(doc.data.extractedElements.referenceSectionRfc.map((el) => trimStart(el.value, '0')))
  const found = new Map()
  for (const { entry, location } of entries) {
    for (const number of entry.rfcs.filter((rfc) => !known.has(rfc))) {
      if (!found.has(number)) {
        found.set(number, { number, subsection: entry.subsection, locations: [] })
      }
      const rfc = found.get(number)
      if (rfc.subsection === entry.subsection && location) {
        rfc.locations.push(location)
      }
    }
  }
  return [...found.values()]
}

/**
 * Read the references of a text document from what the text parser found in its references section, in this
 * order:
 *
 * - each RFC on a line holding a bracketed [RFCn] label (referenceSectionRfc), located where it is in the
 *   subsection the parser records it for;
 * - each RFC that only entries cite, under another label, located at the labels of those entries;
 * - each draft linked to or named, once for each subsection (draftStatusReferences), located where it is in
 *   that subsection;
 * - each entry that cites none of these, located at its label.
 *
 * @param {Object} doc Parsed text document
 * @returns {ReferenceAnswer[]} References
 */
function readTextReferences (doc) {
  const { draftStatusReferences, referenceSectionRfc } = doc.data.extractedElements
  const entries = referenceEntriesWithLocations(doc)
  const answer = { label: null, rfc: null, draft: null, external: false, certainty: CERTAINTY.INFERRED }
  const references = []
  for (const { value, subsection } of referenceSectionRfc) {
    references.push({
      kind: TEXT_REFERENCE_KINDS[subsection] ?? null,
      ...answer,
      rfc: trimStart(value, '0'),
      rfcAsWritten: value,
      location: { lines: findingLines(labelLineRfcLocations(doc, value)) }
    })
  }
  for (const { number, subsection, locations } of entryOnlyRfcs(doc, entries)) {
    references.push({
      kind: TEXT_REFERENCE_KINDS[subsection] ?? null,
      ...answer,
      rfc: number,
      rfcAsWritten: number,
      location: { lines: findingLines(locations) }
    })
  }
  for (const { value, subsection } of draftStatusReferences) {
    references.push({
      kind: TEXT_REFERENCE_KINDS[subsection] ?? null,
      ...answer,
      draft: value,
      location: { lines: findingLines(draftLocations(doc, value, subsection)) }
    })
  }
  for (const { entry, location } of entries) {
    if (entry.external) {
      references.push({
        kind: TEXT_REFERENCE_KINDS[entry.subsection] ?? null,
        ...answer,
        label: entry.value.replace(/^\[|\]$/g, ''),
        external: true,
        location: { lines: location ? [location] : undefined }
      })
    }
  }
  return references
}

/**
 * Read the references of an XML document from its <references> elements (see listXmlReferences): each
 * <reference> element, include, external entity and <?rfc include?>, whatever it cites
 *
 * @param {Object} doc Parsed XML document
 * @returns {ReferenceAnswer[]} References, in document order per section and kind of source
 */
function readXmlReferences (doc) {
  return listXmlReferences(doc).map(({ section, anchor, rfc, draft, external, path, source }) => {
    return { kind: section, label: anchor ?? null, rfc, draft, external, source, certainty: CERTAINTY.DECLARED, location: { path } }
  })
}

/**
 * Get the references of a document: what each cites, the kind of references it is listed with and where it is,
 * read once per document
 *
 * @example
 * getReferences(xmlDoc) // [{ kind: 'normative', label: 'RFC2119', rfc: '2119', draft: null, external: false, source: 'reference', certainty: 'declared', location: { path: 'rfc.back.references[0].reference[0]' } }, ...]
 * getReferences(txtDoc) // [{ kind: 'normative', label: null, rfc: '2119', rfcAsWritten: '2119', draft: null, external: false, certainty: 'inferred', location: { lines: [{ line: 310, pos: 4 }] } }, ...]
 *
 * @param {Object} doc Parsed document, text or XML
 * @returns {ReferenceAnswer[]} References
 */
export function getReferences (doc) {
  if (doc.type === 'txt') {
    return getIndex(doc, 'references', readTextReferences)
  }
  return getIndex(doc, 'references', readXmlReferences)
}

/**
 * Where some references are, for one finding about all of them: the lines of each, in document order, without
 * duplicates, the first MAX_REFERENCE_LINES only
 *
 * @param {ReferenceAnswer[]} references References
 * @returns {Array<{line: number, pos: number}>|undefined} Lines, undefined for none (and for XML references,
 *   which are located by path)
 */
export function getReferencesLines (references) {
  return findingLines(references.flatMap((reference) => reference.location.lines ?? []))
}

/**
 * Where the references to some drafts are, for one finding about all of them, wherever the references section
 * links to them or names them: in a text document, under any heading, where getReferencesLines gives only the
 * lines under a heading of the subsection each reference is listed in
 *
 * @param {Object} doc Parsed document, text or XML
 * @param {ReferenceAnswer[]} references References citing drafts
 * @returns {Array<{line: number, pos: number}>|undefined} Lines, undefined for none (and for XML references,
 *   which are located by path)
 */
export function getDraftReferencesLines (doc, references) {
  if (doc.type !== 'txt') {
    return undefined
  }
  const drafts = uniq(references.map((reference) => reference.draft))
  return findingLines(drafts.flatMap((draft) => getLocations(doc, 'draftStatusReferences', draft)))
}

// Links to documents in the references section of a text document: where a URL starts in a line, bracketed
// ("<https://...") or bare, with a scheme or starting with the RFC Editor's host
const URL_START_RE = /<\s?(?=[a-z][a-z0-9+.-]*:)|(?<![\w.@/<-]|<\s)(?=https?:\/\/|(?:www\.)?rfc-editor\.org\/)/gi
// The rest of a URL, up to the end of its brackets or the first space
const URL_BODY_RE = /[^\s<>]*/y
// A bare URL that runs on to the next line: one broken at a "/" or "-"
const OPEN_BARE_URL_RE = /[-/]$/
// Punctuation that ends a sentence or a parenthesis after a bare URL
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]'"]+$/
// Lines a URL is looked for on after the line it starts on, enough to go over a page break
const MAX_URL_CONTINUATION_LINES = 10
// An appendix heading, which ends the references in the text parser's references section
const APPENDIX_HEADING_RE = /^Appendix\s+[A-Z]\b/

// Hosts whose links name the documents an entry cites (as in lib/parsers/txt.mjs)
const IETF_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:ietf|rfc-editor)\.org$/i

/**
 * @typedef {Object} LinkAnswer
 * @property {string} url The link, trimmed: a URL of the references section, joined back together when
 *   wrapped across lines (text), the target attribute of a <reference> element (XML)
 * @property {string} certainty How certain the answer is (CERTAINTY)
 * @property {{lines: Array<{line: number, pos: number}>}|{path: string}} location Where the link is, as the
 *   options of a finding: where the URL starts for text, the path of the target attribute for XML
 */

/**
 * @typedef {Object} DraftRevisionMismatchAnswer
 * @property {string|null} label Its anchor (XML) or the label of its entry, without brackets (text); null
 *   when there is none
 * @property {Array<{linked: string, named: string[]}>} drafts For each draft linked to with a revision, the
 *   draft with that revision, and with each other revision the reference names it with
 * @property {string} certainty How certain the answer is (CERTAINTY)
 * @property {{lines: Array<{line: number, pos: number}>}|{path: string}} location Where the reference is, as
 *   the options of a finding: the label of its entry for text, the path of its element for XML
 */

/**
 * The <reference> elements of the references sections of an XML document (see getReferencesSections), those in
 * a <referencegroup> too, with their paths. References included with xi:include or an external entity are not
 * in the document.
 *
 * @param {Object} doc Parsed XML document
 * @returns {Array<{reference: *, path: string}>} References, in document order per section: those of the
 *   section, then those of each group
 */
function listXmlReferenceElements (doc) {
  return getIndex(doc, 'referenceElements', () => {
    const elements = []
    for (const section of getReferencesSections(doc)) {
      section.references.forEach((reference, idx) => {
        elements.push({ reference, path: `${section.path}.reference[${idx}]` })
      })
      section.referencegroups.forEach((group, groupIdx) => {
        const references = [group?.reference ?? []].flat()
        references.forEach((reference, idx) => {
          elements.push({ reference, path: `${section.path}.referencegroup[${groupIdx}].reference[${idx}]` })
        })
      })
    }
    return elements
  })
}

/**
 * Locations of the lines the text parser keeps as the content of the references section, found by matching
 * them in order to the lines of the document after its table of contents
 *
 * @param {Object} doc Parsed text document
 * @param {string[]} lines Lines of the document
 * @returns {number[]} Index in lines of each line of the references section, in document order
 */
function referenceLineIndexes (doc, lines) {
  const markers = doc.data?.markers ?? {}
  let idx = Math.max(markers.toc?.end ?? 0, markers.header?.end ?? 0)
  const indexes = []
  for (const entry of doc.data?.content?.references ?? []) {
    while (idx < lines.length && lines[idx].trim() !== entry) {
      idx++
    }
    if (idx >= lines.length) {
      break
    }
    indexes.push(idx++)
  }
  return indexes
}

/**
 * Text that continues a URL broken at the end of a line, from the lines after it: xml2rfc breaks a long URL in
 * angle brackets at a "/" or "-" and goes on at the start of the next line, which may be on the next page
 *
 * @param {string[]} lines Lines of the document
 * @param {Set<number>} inSection Index in lines of each line of the references section
 * @param {number} idx Index in lines of the line the URL starts on
 * @param {boolean} bracketed Whether the URL is in angle brackets
 * @param {string} start Text of the URL on its first line
 * @returns {string} The whole URL
 */
function joinWrappedUrl (lines, inSection, idx, bracketed, start) {
  let url = start
  let open = true
  let blank = false
  let pageBreak = false
  for (let next = idx + 1; open && next < lines.length && next <= idx + MAX_URL_CONTINUATION_LINES; next++) {
    const text = lines[next].replace(/\f/g, '')
    if (!text.trim()) {
      blank = true
      continue
    }
    if (pageBreakLineType(text)) {
      pageBreak = true
      continue
    }
    // -> Only a page break separates a URL from its continuation, which is in the references section
    if ((blank && !pageBreak) || !inSection.has(next)) {
      break
    }
    const trimmed = text.trimStart()
    const part = trimmed.match(/^[^\s<>]*/)[0]
    url += part
    // -> The URL goes on if its part fills the line and, unless bracketed, ends with a break character
    const rest = trimmed.slice(part.length)
    open = part !== '' && rest.trim() === '' && !rest.startsWith('>') && (bracketed || OPEN_BARE_URL_RE.test(part))
  }
  return url
}

/**
 * Read the links of the references section of a text document: the URLs on its lines, joined back together
 * when wrapped across lines, up to the first appendix
 *
 * @param {Object} doc Parsed text document
 * @returns {LinkAnswer[]} Links, in document order
 */
function readTextReferenceLinks (doc) {
  const lines = typeof doc.body === 'string' ? doc.body.split(/\r?\n/) : []
  const indexes = referenceLineIndexes(doc, lines)
  const inSection = new Set(indexes)
  const links = []
  for (const idx of indexes) {
    const line = lines[idx]
    // -> The text parser keeps appendices after the references in its references section
    if (APPENDIX_HEADING_RE.test(line)) {
      break
    }
    for (const match of line.matchAll(URL_START_RE)) {
      const bracketed = match[0].startsWith('<')
      const start = match.index + match[0].length
      URL_BODY_RE.lastIndex = start
      const body = URL_BODY_RE.exec(line)[0]
      const after = line.slice(start + body.length)
      const continues = after.trim() === '' && (bracketed ? !after.startsWith('>') : OPEN_BARE_URL_RE.test(body))
      let url = continues ? joinWrappedUrl(lines, inSection, idx, bracketed, body) : body
      if (!bracketed) {
        url = url.replace(TRAILING_PUNCTUATION_RE, '')
      }
      links.push({ url, certainty: CERTAINTY.INFERRED, location: { lines: [{ line: idx + 1, pos: start + 1 }] } })
    }
  }
  return links
}

/**
 * Read the links of the references of an XML document: the target attributes of its <reference> elements
 * (see listXmlReferenceElements)
 *
 * @param {Object} doc Parsed XML document
 * @returns {LinkAnswer[]} Links, in document order per section
 */
function readXmlReferenceLinks (doc) {
  const links = []
  for (const { reference, path } of listXmlReferenceElements(doc)) {
    const url = reference?._attr?.target
    if (!isNil(url)) {
      links.push({ url: String(url).trim(), certainty: CERTAINTY.DECLARED, location: { path: `${path}._attr.target` } })
    }
  }
  return links
}

/**
 * Get the links of the references of a document, read once per document: the URLs of the references section
 * of a text document, the target attributes of the <reference> elements of an XML document
 *
 * @example
 * getReferenceLinks(xmlDoc) // [{ url: 'https://www.rfc-editor.org/info/rfc2119', certainty: 'declared', location: { path: 'rfc.back.references[0].reference[0]._attr.target' } }, ...]
 * getReferenceLinks(txtDoc) // [{ url: 'https://www.rfc-editor.org/info/rfc2119', certainty: 'inferred', location: { lines: [{ line: 312, pos: 16 }] } }, ...]
 *
 * @param {Object} doc Parsed document, text or XML
 * @returns {LinkAnswer[]} Links
 */
export function getReferenceLinks (doc) {
  if (doc.type === 'txt') {
    return getIndex(doc, 'referenceLinks', readTextReferenceLinks)
  }
  return getIndex(doc, 'referenceLinks', readXmlReferenceLinks)
}

/**
 * Revision of a draft a link to an IETF host names, as part of the name ("draft-foo-17", ".txt" and the like
 * after it) or as the path segment after it ("draft-foo/17/")
 *
 * @param {string} url Link
 * @param {string} draft Draft name, without revision
 * @returns {string|null} Revision, null when the link names none or isn't to an IETF host
 */
function linkedDraftRevision (url, draft) {
  const host = url.replace(/^https?:\/\//i, '').split(/[/\s:?#]/)[0]
  if (!IETF_HOST_RE.test(host)) {
    return null
  }
  const revisionRe = new RegExp(`/${draft}(?:-([0-9]{2})|/([0-9]{2}))(?=$|[/.?#])`, 'i')
  const match = revisionRe.exec(url)
  if (!match) {
    return null
  }
  return match[1] ?? match[2]
}

/**
 * Read the entries of the references section of a text document that link to one revision of a draft while
 * their text names another, as the text parser found them (draftRevisionMismatches)
 *
 * @param {Object} doc Parsed text document
 * @returns {DraftRevisionMismatchAnswer[]} Entries, in document order
 */
function readTextDraftRevisionMismatches (doc) {
  return (doc.data?.extractedElements?.draftRevisionMismatches ?? []).map(({ entry, line, pos, drafts }) => {
    return { label: entry.replace(/^\[|\]$/g, ''), drafts, certainty: CERTAINTY.INFERRED, location: { lines: [{ line, pos }] } }
  })
}

/**
 * Read the <reference> elements of an XML document whose target links to one revision of a draft, on an IETF
 * host, while their Internet-Draft <seriesInfo> names another
 *
 * @param {Object} doc Parsed XML document
 * @returns {DraftRevisionMismatchAnswer[]} References, in document order per section
 */
function readXmlDraftRevisionMismatches (doc) {
  const mismatches = []
  for (const { reference, path } of listXmlReferenceElements(doc)) {
    const url = String(reference?._attr?.target ?? '').trim()
    const seriesInfo = [reference?.seriesInfo, reference?.front?.seriesInfo].flat().filter((si) => si?._attr)
    const draftInfo = seriesInfo.find((si) => /^internet-draft$/i.test(String(si._attr.name ?? '').trim()))
    const named = String(draftInfo?._attr.value ?? '').trim()
    const [, draft, revision] = /^(?:I-D\.)?(draft-[a-z0-9-]+)-([0-9]{2})$/i.exec(named) ?? []
    if (!url || !draft) {
      continue
    }
    const linkedRevision = linkedDraftRevision(url, draft)
    if (linkedRevision && linkedRevision !== revision) {
      const anchor = String(reference._attr.anchor ?? '').trim()
      mismatches.push({
        label: anchor || null,
        drafts: [{ linked: `${draft}-${linkedRevision}`, named: [`${draft}-${revision}`] }],
        certainty: CERTAINTY.DECLARED,
        location: { path }
      })
    }
  }
  return mismatches
}

/**
 * Get the references that link to one revision of a draft while they name another, read once per document: in
 * their text (text document) or Internet-Draft <seriesInfo> (XML document). Only links to IETF hosts are looked
 * at.
 *
 * @example
 * getDraftRevisionMismatches(xmlDoc) // [{ label: 'I-D.foo', drafts: [{ linked: 'draft-foo-17', named: ['draft-foo-23'] }], certainty: 'declared', location: { path: 'rfc.back.references[0].reference[3]' } }]
 *
 * @param {Object} doc Parsed document, text or XML
 * @returns {DraftRevisionMismatchAnswer[]} References
 */
export function getDraftRevisionMismatches (doc) {
  if (doc.type === 'txt') {
    return getIndex(doc, 'draftRevisionMismatches', readTextDraftRevisionMismatches)
  }
  return getIndex(doc, 'draftRevisionMismatches', readXmlDraftRevisionMismatches)
}

// An [RFCn] label of a text references entry ("[RFC0791]"), in the form the parser declares (BRACKETED_RFC_REFERENCE_RE)
const TEXT_RFC_LABEL_RE = /^\[RFC0*(\d+)\]$/
// An [I-D.…] or [draft-…] label of a text references entry, spaces allowed ("[I-D. foo-bar]")
const TEXT_DRAFT_LABEL_RE = /^\[\s*(?:I-D\.|draft-)/i

// The start of a <referencegroup> element, and the end tag of one
const REFERENCEGROUP_START_RE = /<referencegroup\b/g
const REFERENCEGROUP_END_RE = /<\/referencegroup\s*>/g

/**
 * RFC 8792 folding header, e.g. "===== NOTE: '\' line wrapping per RFC 8792 =====",
 * for either the single (\) or the double (\\) backslash strategy
 */
const RFC8792_FOLDING_HEADER = /^[ \t=]*NOTE: '\\\\?' line wrapping per RFC 8792[ \t=\r]*$/m

/**
 * @typedef {Object} UncitedReferenceAnswer
 * @property {string} label Its anchor (XML; for an included RFC or draft, RFCnnnn or I-D. and the draft's name)
 *   or the label of its entry, without brackets (text)
 * @property {boolean} citedAsText Whether the text mentions it as typed text, without citing it (XML only: in
 *   text, that is how references are cited)
 * @property {string} [source] Declared answers only: how the reference is given, 'reference', 'referencegroup',
 *   'xi:include', 'entity' or 'pi'
 * @property {string} certainty How certain the answer is (CERTAINTY)
 * @property {{lines: Array<{line: number, pos: number}>|undefined}|{path: string}} location Where the reference
 *   is, as the options of a finding: the labels of its entries for text, the path of its element for XML (for an
 *   external entity or <?rfc include?>, that of its <references> element)
 */

/**
 * Draft name without its I-D. or draft- prefix and its version, to compare references to a draft
 *
 * @param {string} name Draft name or anchor ("I-D.ietf-foo-bar", "draft-ietf-foo-bar-05")
 * @returns {string} Comparable name ("ietf-foo-bar")
 */
function comparableDraftName (name) {
  return String(name).trim().replace(/^I-D\./i, '').replace(/^draft-/i, '').replace(/-\d\d$/, '').toLowerCase()
}

/**
 * Read the references of a text document that its text doesn't cite: one per label of an entry of the
 * references section, outside an appendix. An RFC number mentioned inside an entry ("STD 5, RFC 791" in the
 * [RFC0791] entry, "RFC 1700" in a title) is not one.
 *
 * - An [RFCn] entry is cited if the text cites RFC n.
 * - An [I-D.…] or [draft-…] entry is cited if the text cites its label, spaces aside ("[I-D. foo-bar]"), or
 *   names its draft.
 * - Another label the references section declares is cited if the text cites it.
 * - Any other label is not looked at.
 *
 * @param {Object} doc Parsed text document
 * @returns {UncitedReferenceAnswer[]} References, in document order
 */
function readTextUncitedReferences (doc) {
  const { referenceEntries, nonReferenceSectionRfc, referenceSectionDraftReferences, nonReferenceSectionDraftReferences } = doc.data.extractedElements
  const { nonReferenceSectionDraftLabels = [], nonReferenceSectionDraftNames = [] } = doc.data.extractedElements
  const citedRfcs = new Set(nonReferenceSectionRfc.map(rfc => String(rfc).replace(/^0+/, '')))
  const declaredLabels = new Set(referenceSectionDraftReferences.map(el => el.value))
  const checked = new Set()
  const uncited = []
  for (const entry of referenceEntries) {
    if (entry.subsection === 'appendix' || checked.has(entry.value)) {
      continue
    }
    checked.add(entry.value)
    const rfc = TEXT_RFC_LABEL_RE.exec(entry.value)?.[1]
    let cited
    if (rfc) {
      cited = citedRfcs.has(rfc)
    } else if (TEXT_DRAFT_LABEL_RE.test(entry.value)) {
      // (the drafts the entry names, or failing that its label: [I-D.foo-bar] is draft-foo-bar)
      const label = entry.value.replace(/\s+/g, '')
      const fromLabel = `draft-${comparableDraftName(label.slice(1, -1))}`
      cited = nonReferenceSectionDraftLabels.includes(label) ||
        [...(entry.drafts ?? []), fromLabel].some(draft => nonReferenceSectionDraftNames.includes(draft.toLowerCase().replace(/-\d\d$/, '')))
    } else if (declaredLabels.has(entry.value)) {
      cited = nonReferenceSectionDraftReferences.includes(entry.value)
    } else {
      continue
    }
    if (!cited) {
      const lines = getLocations(doc, 'referenceEntries', entry.value).slice(0, MAX_REFERENCE_LINES)
      uncited.push({
        label: entry.value.replace(/^\[|\]$/g, ''),
        citedAsText: false,
        certainty: CERTAINTY.INFERRED,
        location: { lines: lines.length > 0 ? lines : undefined }
      })
    }
  }
  return uncited
}

/**
 * The raw text of the <referencegroup> elements of an XML text, each from its start tag to the first
 * end tag after it, read in one pass: once a start tag has no end tag after it, neither has any later one
 *
 * @param {string} text XML text, comments and CDATA sections masked
 * @returns {string[]} Raw text of each element, in order
 */
function referenceGroupTexts (text) {
  const groups = []
  REFERENCEGROUP_START_RE.lastIndex = 0
  while (true) {
    const start = REFERENCEGROUP_START_RE.exec(text)
    if (start === null) {
      break
    }
    REFERENCEGROUP_END_RE.lastIndex = start.index
    const end = REFERENCEGROUP_END_RE.exec(text)
    if (end === null) {
      break
    }
    const groupEnd = end.index + end[0].length
    groups.push(text.slice(start.index, groupEnd))
    REFERENCEGROUP_START_RE.lastIndex = groupEnd
  }
  return groups
}

/**
 * The RFCs and drafts an XML document includes inside a <referencegroup> through its raw text
 * (<?rfc include?> or an external entity), which the parser drops, so the group stays the reference
 *
 * @param {Object} doc Parsed XML document
 * @returns {{ rfcs: Set<string>, drafts: Set<string> }} RFC numbers and comparable draft names
 */
function getGroupedRawIncludes (doc) {
  const rfcs = new Set()
  const drafts = new Set()
  const entities = new Map((doc.externalEntities ?? []).map(entity => [entity.name, entity.url]))
  const masked = maskCommentsAndCdata(doc.body ?? '')
  for (const group of referenceGroupTexts(masked)) {
    const targets = [
      ...[...group.matchAll(/<\?rfc\s+include\s*=\s*["']?([^"'\s?]+)/g)].map(match => match[1]),
      ...[...group.matchAll(/&([^;\s&]+);/g)].map(match => entities.get(match[1])).filter(Boolean)
    ]
    for (const target of targets) {
      const rfc = target.match(/reference\.RFC\.0*(\d+)/i)?.[1]
      const draft = target.match(/reference\.I-D\.([a-z0-9._-]+?)(?:\.xml)?$/i)?.[1]
      if (rfc) {
        rfcs.add(rfc)
      }
      if (draft) {
        drafts.add(comparableDraftName(draft))
      }
    }
  }
  return { rfcs, drafts }
}

/**
 * @typedef {Object} TypedMentions
 * @property {Set<string>} rfcs RFC numbers, without leading zeros
 * @property {Set<string>} labels Bracketed labels, without spaces, in lower case
 * @property {Set<string>} drafts Draft names, see comparableDraftName()
 */

/**
 * What the text of an XML document mentions as typed text, outside its <references> sections:
 * RFC numbers ("RFC 4782", "[RFC7641]"), bracketed labels ("[TLS13]") and draft names, as the text
 * check counts them. Mentions in prose are kept apart from those in <artwork> and <sourcecode>, where
 * an <xref> can't be placed, and in the updates and obsoletes attributes; other attribute values don't count.
 *
 * @param {Object} doc Parsed XML document
 * @returns {{ prose: TypedMentions, code: TypedMentions }} Typed mentions in prose, and in code or attributes
 */
function getTypedMentions (doc) {
  const prose = []
  const code = []
  const walk = (value, path, inCode) => {
    if (path === 'rfc.back.references') {
      return
    }
    if (typeof value === 'string' || typeof value === 'number') {
      if (inCode) {
        code.push(String(value))
      } else {
        prose.push(String(value))
      }
    } else if (Array.isArray(value)) {
      value.forEach(item => walk(item, path, inCode))
    } else if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (key === '_attr') {
          continue
        }
        // -> An element's own text belongs to the element; everything inside <artwork> or
        //    <sourcecode> is code
        const childPath = key === '#text' ? path : `${path}.${key}`
        const childInCode = inCode || key === 'artwork' || key === 'sourcecode'
        walk(child, childPath, childInCode)
      }
    }
  }
  walk(doc.data.rfc, 'rfc', false)
  // -> The RFCs the document updates or obsoletes, which the text header names
  code.push(String(doc.data.rfc?._attr?.updates ?? ''), String(doc.data.rfc?._attr?.obsoletes ?? ''))
  const mentions = texts => {
    const text = texts.join('\n')
    return {
      rfcs: new Set([...text.matchAll(/\bRFC\s?0*(\d+)\b/gi)].map(match => match[1])),
      labels: new Set([...text.matchAll(/\[([^[\]]{1,100})\]/g)].map(match => match[1].replace(/\s+/g, '').toLowerCase())),
      drafts: new Set([...text.matchAll(/\bdraft-[a-z0-9]+(?:-[a-z0-9]+)+/gi)].map(match => comparableDraftName(match[0])))
    }
  }
  return { prose: mentions(prose), code: mentions(code) }
}

/**
 * Whether typed mentions name a reference, by its anchor
 *
 * @param {TypedMentions} mentions Typed mentions, from getTypedMentions()
 * @param {string} anchor Anchor of the reference ("RFC8174", "I-D.ietf-foo-bar", "TLS13")
 * @returns {boolean} True if the reference is mentioned
 */
function isTypedMention (mentions, anchor) {
  const name = String(anchor).trim()
  const rfc = name.match(/^RFC0*(\d+)$/i)?.[1]
  return mentions.labels.has(name.replace(/\s+/g, '').toLowerCase()) ||
    Boolean(rfc && mentions.rfcs.has(rfc)) ||
    (/^I-D\./i.test(name) && mentions.drafts.has(comparableDraftName(name)))
}

/**
 * Get the trimmed text content of a parsed XML element: an element with attributes is parsed to an object,
 * whose text (if any) is under '#text', and a numeric text content is parsed to a number
 *
 * @param {*} value Parsed element value
 * @returns {string} Trimmed text content, empty if there is none
 */
function getElementText (value) {
  const text = isPlainObject(value) ? value['#text'] : value
  return text === undefined || text === null ? '' : String(text).trim()
}

/**
 * Whether a parsed <reference> is RFC 8792, by its anchor or its RFC seriesInfo
 *
 * @param {Object} ref Parsed <reference> element
 * @returns {boolean} True if the reference is RFC 8792
 */
function isRfc8792Reference (ref) {
  if (!ref?._attr?.anchor) {
    return false
  }
  if (/^RFC0*8792$/i.test(ref._attr.anchor)) {
    return true
  }
  return [ref.seriesInfo, ref.front?.seriesInfo]
    .flat()
    .some(info => info?._attr?.name === 'RFC' && String(info._attr.value).trim() === '8792')
}

/**
 * The targets of the <xref> elements of an XML document
 *
 * @param {Object} doc Parsed XML document
 * @returns {Array<string>} Targets, in document order
 */
function xrefTargets (doc) {
  return findAllDescendantsWith(doc.data.rfc, (value, key) => {
    if (key !== 'xref') {
      return false
    }
    if (Array.isArray(value)) {
      return value.some(item => item._attr?.target)
    }
    return value._attr?.target
  }).flatMap(match => {
    if (Array.isArray(match.value)) {
      return match.value.map(item => item._attr?.target).filter(Boolean)
    }
    return match.value._attr?.target ? [match.value._attr.target] : []
  })
}

/**
 * Read the references of an XML document that its text doesn't cite with an <xref>, nor mentions as typed text
 * where an <xref> can't be placed: in <artwork> or <sourcecode>, or in the updates or obsoletes attribute.
 *
 * - A <reference> or <referencegroup> with an anchor is cited by an <xref> to its anchor. A <reference> in a
 *   group is cited through the group.
 * - A reference to an RFC or a draft brought in by xi:include, an external entity or <?rfc include?> is named
 *   by the anchor of its bibliography entry and cited by an <xref> to that RFC or draft. Members of a
 *   <referencegroup> are cited through the group.
 * - An RFC 8792 folding header in <artwork> or <sourcecode> cites RFC 8792, as an <xref> cannot be placed there.
 *
 * @param {Object} doc Parsed XML document
 * @returns {UncitedReferenceAnswer[]} References: those listed in the document, then those included, in
 *   document order per section
 */
function readXmlUncitedReferences (doc) {
  const listed = getReferencesSections(doc).flatMap(({ path, references, referencegroups }) => [
    ...references.map((element, idx) => ({ element, source: 'reference', path: `${path}.reference[${idx}]` })),
    ...referencegroups.map((element, idx) => ({ element, source: 'referencegroup', path: `${path}.referencegroup[${idx}]` }))
  ])
  const usedReferences = xrefTargets(doc)

  const hasFoldingHeader = findAllDescendantsWith(doc.data.rfc, (value, key) => key === 'artwork' || key === 'sourcecode')
    .flatMap(match => [match.value].flat())
    .some(value => RFC8792_FOLDING_HEADER.test(getElementText(value)))
  if (hasFoldingHeader) {
    usedReferences.push(...listed.filter(({ element }) => isRfc8792Reference(element)).map(({ element }) => element._attr.anchor))
  }

  // -> Mentioned as typed text only in prose, a reference is cited as text; mentioned in code, it is cited
  const typed = getTypedMentions(doc)
  const uncited = []
  const checkUncited = (label, source, path) => {
    if (isTypedMention(typed.code, label)) {
      return
    }
    uncited.push({ label, citedAsText: isTypedMention(typed.prose, label), source, certainty: CERTAINTY.DECLARED, location: { path } })
  }
  const used = new Set(usedReferences)
  for (const { element, source, path } of listed) {
    const anchor = element?._attr?.anchor
    if (anchor && !used.has(anchor)) {
      checkUncited(anchor, source, path)
    }
  }

  const xrefRfcs = new Set(usedReferences.map(target => String(target).match(/^RFC0*(\d+)$/i)?.[1]).filter(Boolean))
  const xrefDrafts = new Set(usedReferences.filter(target => /^(I-D\.|draft-)/i.test(target)).map(comparableDraftName))
  const grouped = getGroupedRawIncludes(doc)
  for (const include of getReferences(doc)) {
    if (include.source === 'reference' || include.location.path.includes('.referencegroup[')) {
      continue
    }
    if (include.source !== 'xi:include' && (grouped.rfcs.has(include.rfc) || grouped.drafts.has(comparableDraftName(include.draft ?? '')))) {
      continue
    }
    if (include.rfc) {
      if (!xrefRfcs.has(include.rfc) && !(include.rfc === '8792' && hasFoldingHeader)) {
        checkUncited(`RFC${include.rfc.padStart(4, '0')}`, include.source, include.location.path)
      }
    } else if (include.draft) {
      if (!xrefDrafts.has(comparableDraftName(include.draft))) {
        checkUncited(`I-D.${comparableDraftName(include.draft)}`, include.source, include.location.path)
      }
    }
  }
  return uncited
}

/**
 * Get the references of a document that its text doesn't cite, read once per document
 *
 * @example
 * getUncitedReferences(xmlDoc) // [{ label: 'RFC8174', citedAsText: true, source: 'reference', certainty: 'declared', location: { path: 'rfc.back.references[0].reference[1]' } }]
 * getUncitedReferences(txtDoc) // [{ label: 'TLS', citedAsText: false, certainty: 'inferred', location: { lines: [{ line: 320, pos: 4 }] } }]
 *
 * @param {Object} doc Parsed document, text or XML
 * @returns {UncitedReferenceAnswer[]} References
 */
export function getUncitedReferences (doc) {
  if (doc.type === 'txt') {
    return getIndex(doc, 'uncitedReferences', readTextUncitedReferences)
  }
  return getIndex(doc, 'uncitedReferences', readXmlUncitedReferences)
}
