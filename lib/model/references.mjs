import { isEqual, last, sortedLastIndexBy, trimStart, uniq } from 'lodash-es'
import { INFORMATIVE_REFERENCES_HEADING_RE, NORMATIVE_REFERENCES_HEADING_RE } from '../helpers/references.mjs'
import { listXmlReferences } from '../helpers/xml-references.mjs'
import { getLocations, isAppendixHeading } from '../parsers/txt.mjs'
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
// (lib/parsers/txt.mjs, subsectionMatchers, SUBSECTION_PATTERN and TOC_PATTERN): a numbered
// subsection heading the parser doesn't recognize ends the subsection before it
const REFERENCE_SUBSECTION_HEADINGS = [
  { name: 'normative_references', regex: NORMATIVE_REFERENCES_HEADING_RE },
  { name: 'informative_references', regex: INFORMATIVE_REFERENCES_HEADING_RE },
  { name: 'unclassified_references', regex: /^\d+\.\d+\.\s+([a-zA-Z]+\s+)*Reference(s)?$/i },
  // -> A References section's own heading: its entries before any subsection heading are unclassified
  { name: 'unclassified_references', regex: /^(?:\d+\.\s+)?References$/i }
]
const NUMBERED_SUBSECTION_HEADING_RE = /^\d+\.\d+\.\s+(.+)$/
// A numbered heading ("15.1.  Normative References", "15.  References")
const NUMBERED_HEADING_RE = /^\d+\./
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
    const unnumbered = !NUMBERED_HEADING_RE.test(trimmed)
    if (heading && unnumbered && !startsHeading(lines, idx)) {
      heading = undefined
    }
    if (isAppendixHeading(trimmed, indent, lines[idx - 1] ?? null)) {
      heading = { name: 'appendix' }
    }
    if (heading || NUMBERED_SUBSECTION_HEADING_RE.test(trimmed)) {
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
  return listXmlReferences(doc).map(({ section, anchor, rfc, draft, external, path }) => {
    return { kind: section, label: anchor ?? null, rfc, draft, external, certainty: CERTAINTY.DECLARED, location: { path } }
  })
}

/**
 * Get the references of a document: what each cites, the kind of references it is listed with and where it is,
 * read once per document
 *
 * @example
 * getReferences(xmlDoc) // [{ kind: 'normative', label: 'RFC2119', rfc: '2119', draft: null, external: false, certainty: 'declared', location: { path: 'rfc.back.references[0].reference[0]' } }, ...]
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
