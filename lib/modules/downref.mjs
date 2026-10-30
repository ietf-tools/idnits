import { ValidationWarning, ValidationError, ValidationComment } from '../helpers/error.mjs'
import { checkReferencesInDownrefs, DownrefRegistryUnavailableError } from '../remote/downref.mjs'
import { MODES } from '../config/modes.mjs'
import { getStatusCategory } from '../config/rfc-status-hierarchy.mjs'
import { getDocInfoJson, getRfcInfo, recordSkippedLookup, resolveDraftChain } from '../remote/lookups.mjs'
import { collectXmlReferences, getCitedDrafts, getCitedRfcs, listXmlReferences } from '../helpers/xml-references.mjs'
import { castArray, findLast, isEqual, last, trimStart, uniq, uniqWith } from 'lodash-es'
import { getLocations } from '../parsers/txt.mjs'

const BCP97_REF = 'https://www.rfc-editor.org/info/bcp97'
const DOWNREF_REGISTRY_REF = 'https://datatracker.ietf.org/doc/downref/'
const NORMATIVE_REFERENCES_STATEMENT_REF = 'https://datatracker.ietf.org/doc/statement-iesg-iesg-statement-normative-and-informative-references-20060419/'
const EXTERNAL_SPECIFICATIONS_REF = 'https://www.rfc-editor.org/rfc/rfc2026.html#section-7.1'

// Most locations given for a finding about a reference of a text document
const MAX_REFERENCE_LINES = 20

// Headings of the subsections of the references section, as the text parser recognizes them
// (lib/parsers/txt.mjs, subsectionMatchers, SUBSECTION_PATTERN and TOC_PATTERN): a numbered
// subsection heading the parser doesn't recognize ends the subsection before it
const REFERENCE_SUBSECTION_HEADINGS = [
  { name: 'normative_references', regex: /^(?:\d+\.(?:\d+\.?)?\s+)?Normative\s+References$/i },
  { name: 'informative_references', regex: /^(?:\d+\.(?:\d+\.?)?\s+)?Informat(?:ive|ional)\s+References$/i },
  { name: 'unclassified_references', regex: /^\d+\.\d+\.\s+([a-zA-Z]+\s+)*Reference(s)?$/i },
  // -> A References section's own heading: its entries before any subsection heading are unclassified
  { name: 'unclassified_references', regex: /^(?:\d+\.\s+)?References$/i },
  { name: 'appendix', regex: /^Appendix\b/i }
]
const NUMBERED_SUBSECTION_HEADING_RE = /^\d+\.\d+\.\s+(.+)$/
const TOC_ENTRY_RE = /\.+\s*\d+$/

/**
 * Whether rfc-editor.org lists an RFC number as never issued
 *
 * @param {Object} [rfcInfo] RFC info from rfc-editor.org
 * @returns {boolean} true if the status is "NOT ISSUED"
 */
function isNotIssued (rfcInfo) {
  return /^\s*not\s+issued\s*$/i.test(rfcInfo?.status ?? '')
}

/**
 * Message of UNDEFINED_STATUS: rfc-editor.org answered, but has no such RFC (404) or gives it no
 * status. A failed lookup is reported by REFERENCE_STATUS_UNAVAILABLE instead.
 *
 * @param {string} subject How the reference is named in messages, e.g. "RFC 1234"
 * @param {Object|null} rfcInfo RFC info from rfc-editor.org, null if it has no such RFC
 * @returns {string} Message
 */
function undefinedStatusMessage (subject, rfcInfo) {
  return rfcInfo === null
    ? `${subject} wasn't found on rfc-editor.org.`
    : `${subject} has no status on rfc-editor.org.`
}

/**
 * Finding for a reference to an RFC number that was never issued
 *
 * | normal | forgive-checklist | submission |
 * |--------|-------------------|------------|
 * | Error  | Warning           | -          |
 *
 * @param {string} subject How the reference is named in messages, e.g. "RFC 1234"
 * @param {string} rfcNum RFC number, without leading zeros
 * @param {number} mode Validation mode
 * @param {Array<{line: number, pos: number}>} [lines] Where the reference is (text documents)
 * @returns {Array} REFERENCE_NOT_ISSUED finding, or none in submission mode
 */
function notIssuedFinding (subject, rfcNum, mode, lines) {
  const message = `${subject} was never issued: rfc-editor.org lists RFC ${rfcNum} as "NOT ISSUED".`
  const opts = { ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`, lines }
  if (mode === MODES.NORMAL) {
    return [new ValidationError('REFERENCE_NOT_ISSUED', message, opts)]
  } else if (mode === MODES.FORGIVE_CHECKLIST) {
    return [new ValidationWarning('REFERENCE_NOT_ISSUED', message, opts)]
  }
  return []
}

const subsectionHeadingsByDoc = new WeakMap()

/**
 * Subsection headings of a text document, outside its table of contents
 *
 * @param {Object} doc - Text document being checked
 * @returns {Array<{line: number, name: string|null}>} - Headings in document order: the line (1-based)
 *   and the subsection it starts, null for a numbered subsection that is not one of references
 */
function getSubsectionHeadings (doc) {
  if (!subsectionHeadingsByDoc.has(doc)) {
    const headings = []
    const toc = doc.data?.markers?.toc
    const lines = typeof doc.body === 'string' ? doc.body.split('\n') : []
    lines.forEach((line, idx) => {
      const lineNumber = idx + 1
      const trimmed = line.trim()
      if ((toc?.start && lineNumber >= toc.start && lineNumber <= toc.end) || TOC_ENTRY_RE.test(trimmed)) {
        return
      }
      const heading = REFERENCE_SUBSECTION_HEADINGS.find(({ regex }) => regex.test(trimmed))
      if (heading || NUMBERED_SUBSECTION_HEADING_RE.test(trimmed)) {
        headings.push({ line: lineNumber, name: heading?.name ?? null })
      }
    })
    subsectionHeadingsByDoc.set(doc, headings)
  }
  return subsectionHeadingsByDoc.get(doc)
}

/**
 * Index of the last heading at or before a line
 *
 * @param {Array<{line: number}>} headings - Headings in document order
 * @param {number} line - Line (1-based)
 * @returns {number} - Index of the heading, -1 when there is none
 */
function headingIndexAt (headings, line) {
  return headings.findLastIndex((heading) => heading.line <= line)
}

/**
 * Sort locations in document order, without duplicates, and keep the first ones
 *
 * @param {Array<{line: number, pos: number}>} locations - Locations
 * @returns {Array<{line: number, pos: number}>|undefined} - Locations to give a finding, undefined for none
 */
function findingLines (locations) {
  const sorted = uniqWith([...locations].sort((a, b) => a.line - b.line || a.pos - b.pos), isEqual)
  return sorted.length > 0 ? sorted.slice(0, MAX_REFERENCE_LINES) : undefined
}

/**
 * Where an entry of the references section of a text document is, for the reference it lists:
 * where the text parser found it in the subsection it records for it.
 *
 * The parser records an RFC (referenceSectionRfc) once, with the subsection of its first entry, but
 * locates it in every subsection that lists it again: the locations kept are those under the same
 * heading as the first one.
 *
 * @param {Object} doc - Text document being checked
 * @param {string} kind - 'referenceSectionRfc'
 * @param {string} value - Value as extracted, e.g. '2119'
 * @returns {Array<{line: number, pos: number}>} - Locations
 */
function entryLocations (doc, kind, value) {
  const locations = getLocations(doc, kind, value)
  if (locations.length === 0) {
    return []
  }
  const headings = getSubsectionHeadings(doc)
  const first = headingIndexAt(headings, locations[0].line)
  return locations.filter((location) => headingIndexAt(headings, location.line) === first)
}

/**
 * Where the text parser found RFCs in the references section, for the RFCs of a subsection
 *
 * @param {Object} doc - Text document being checked
 * @param {string} subsection - Subsection, e.g. 'normative_references'
 * @param {string} rfcNumber - RFC number, without leading zeros
 * @returns {Array<{line: number, pos: number}>|undefined} - Locations for a finding
 */
function rfcEntryLines (doc, subsection, rfcNumber) {
  return findingLines(doc.data.extractedElements.referenceSectionRfc
    .filter((el) => el.subsection === subsection && trimStart(el.value, '0') === rfcNumber)
    .flatMap((el) => entryLocations(doc, 'referenceSectionRfc', el.value)))
}

const entryOnlyRfcsByDoc = new WeakMap()

/**
 * RFCs that entries of the references section of a text document cite, but that the text parser does
 * not record in referenceSectionRfc: it records the RFCs on the lines holding a bracketed [RFCn] label,
 * not those cited under another label, e.g. RFC 8446 for "[TLS] Rescorla, E., ..., RFC 8446, ...", RFC 2119
 * for "[1] Bradner, S., ..., BCP 14, RFC 2119" or "[BCP14]". An RFC that referenceSectionRfc has, in any
 * subsection, is left to it, so that no RFC is checked twice; like there, an RFC is given once, for the
 * subsection of the first entry that cites it, located at the label of each entry of that subsection citing it.
 *
 * @param {Object} doc - Text document being checked
 * @returns {Array<{number: string, subsection: string|null, lines: Array<{line: number, pos: number}>|undefined}>} - RFCs,
 *   by number without leading zeros, in document order
 */
function getEntryOnlyRfcs (doc) {
  if (!entryOnlyRfcsByDoc.has(doc)) {
    const known = new Set(doc.data.extractedElements.referenceSectionRfc.map((el) => trimStart(el.value, '0')))
    const found = new Map()
    for (const { entry, location } of referenceEntriesWithLocations(doc)) {
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
    entryOnlyRfcsByDoc.set(doc, [...found.values()].map(({ locations, ...rfc }) => ({ ...rfc, lines: findingLines(locations) })))
  }
  return entryOnlyRfcsByDoc.get(doc)
}

/**
 * RFCs of a subsection of the references section of a text document that only its entries give (see getEntryOnlyRfcs())
 *
 * @param {Object} doc - Text document being checked
 * @param {string} subsection - Subsection, e.g. 'normative_references'
 * @returns {Array<string>} - RFC numbers, without leading zeros
 */
function entryOnlyRfcs (doc, subsection) {
  return getEntryOnlyRfcs(doc).filter((rfc) => rfc.subsection === subsection).map((rfc) => rfc.number)
}

/**
 * Where an RFC that only the entries of the references section of a text document give is (see getEntryOnlyRfcs())
 *
 * @param {Object} doc - Text document being checked
 * @param {string} rfcNumber - RFC number, as extracted
 * @returns {Array<{line: number, pos: number}>|undefined|null} - Locations for a finding, null for an RFC that
 *   referenceSectionRfc gives
 */
function entryOnlyRfcLines (doc, rfcNumber) {
  const rfc = getEntryOnlyRfcs(doc).find((entryRfc) => entryRfc.number === rfcNumber)
  return rfc ? rfc.lines : null
}

/**
 * Where the text parser found links to drafts in the references section (draftStatusReferences)
 *
 * The parser records a draft once per subsection, but locates it in each: unless all subsections are
 * wanted, the locations kept are those under a heading of the subsection, as the parser groups them.
 *
 * @param {Object} doc - Text document being checked
 * @param {function(string): boolean} isDraft - Whether a draft, as extracted (with its revision), is wanted
 * @param {string} [subsection] - Subsection, e.g. 'normative_references'; all of them when not given
 * @returns {Array<{line: number, pos: number}>|undefined} - Locations for a finding
 */
function draftLinkLines (doc, isDraft, subsection) {
  const headings = getSubsectionHeadings(doc).filter((heading) => heading.name)
  const values = uniq(doc.data.extractedElements.draftStatusReferences
    .filter((el) => (!subsection || el.subsection === subsection) && isDraft(el.value))
    .map((el) => el.value))
  return findingLines(values.flatMap((value) => getLocations(doc, 'draftStatusReferences', value)
    .filter((location) => !subsection || headings[headingIndexAt(headings, location.line)]?.name === subsection)))
}

/**
 * @typedef {Object} NormativeDraftReference
 * @property {string} reference Draft as cited, with its version if the reference gives one
 * @property {string} name Draft name, without version
 * @property {string[]} chain Drafts from the cited one to the last one that replaced it
 * @property {import('../remote/lookups.mjs').DraftChainEnd} end Where the chain ends
 */

const normativeDraftsByDoc = new WeakMap()

/**
 * Classify the normative references to Internet-Drafts of a document, for text and XML alike:
 * each cited draft is followed through the drafts that replaced it, to the RFC it was published
 * as or to the last draft of the chain. Shared by the checks of a run.
 *
 * A published RFC is not classified: a draft it cites may well have been published since, and
 * the RFC can't change anyway.
 *
 * With offline, nothing is looked up: each draft is its own chain, whose end is unknown.
 *
 * @param {Object} doc - Document being checked
 * @param {Object} [opts] - Options
 * @param {boolean} [opts.offline=false] - Don't look the drafts up on Datatracker
 * @returns {Promise<NormativeDraftReference[]>} - Normative draft references, one per draft
 */
export function classifyNormativeDraftReferences (doc, { offline = false } = {}) {
  if (!normativeDraftsByDoc.has(doc)) {
    normativeDraftsByDoc.set(doc, resolveNormativeDraftReferences(doc, { offline }))
  }
  return normativeDraftsByDoc.get(doc)
}

/**
 * Resolve the normative references to Internet-Drafts of a document
 *
 * @param {Object} doc - Document being checked
 * @param {Object} opts - Options
 * @param {boolean} opts.offline - Don't look the drafts up on Datatracker
 * @returns {Promise<NormativeDraftReference[]>} - Normative draft references, one per draft
 */
async function resolveNormativeDraftReferences (doc, { offline }) {
  if (isPublishedRfc(doc)) {
    return []
  }

  const cited = doc.type === 'xml'
    ? getCitedDrafts(collectXmlReferences(doc), ['normative'])
    : doc.data.extractedElements.draftStatusReferences
      .filter((extracted) => extracted.subsection === 'normative_references')
      .map((extracted) => extracted.value)

  const references = []
  const seen = new Set()
  for (const reference of cited) {
    const { name } = citedDraftName(reference)
    if (!/^draft-/i.test(name) || seen.has(name)) {
      continue
    }
    seen.add(name)
    let resolved
    if (offline) {
      resolved = { chain: [name], end: { kind: 'unknown' } }
    } else {
      resolved = await resolveDraftChain(doc, name)
    }
    references.push({ reference, name, ...resolved })
  }
  return references
}

/**
 * Describe a normative reference to a draft for messages, naming the end of its chain of
 * replacements, e.g. "the Internet-Draft draft-a-03, which was replaced by draft-c"
 *
 * @param {NormativeDraftReference} draft - Normative draft reference
 * @returns {string} - Description
 */
function describeDraftReference ({ reference, chain, end }) {
  return chain.length > 1
    ? `the Internet-Draft ${reference}, which was replaced by ${end.name}`
    : `the Internet-Draft ${reference}`
}

/**
 * Where a normative draft reference of a text document is: its links in the normative references,
 * whatever revision of the draft they give
 *
 * @param {Object} doc - Text document being checked
 * @param {NormativeDraftReference} draft - Normative draft reference
 * @returns {Array<{line: number, pos: number}>|undefined} - Locations for a finding
 */
function normativeDraftLines (doc, { name }) {
  return draftLinkLines(doc, (value) => citedDraftName(value).name === name, 'normative_references')
}

/**
 * Name the RFC a normative draft reference ended up as, e.g. "RFC 9000 (cited as draft-ietf-quic-transport-34)"
 *
 * @param {NormativeDraftReference} draft - Normative draft reference whose chain ends in an RFC
 * @returns {string} - Description
 */
function describeDraftRfc ({ reference, end }) {
  return `RFC ${end.rfc} (cited as ${reference})`
}

/**
 * Get the status category of the document being checked (2 for Standards Track and BCP)
 *
 * @param {Object} doc - Document being checked
 * @returns {number|null} - Status category, or null if unknown
 */
function getDocStatusCategory (doc) {
  return doc.type === 'xml'
    ? getStatusCategory(doc.data.rfc?._attr?.category ?? doc.data.rfc?._attr?.status)
    : getStatusCategory(doc.data.header.intendedStatus ?? doc.data.header.category)
}

/**
 * Describe the status of the document being checked, for downref messages
 *
 * @param {Object} doc - Document being checked
 * @returns {string} - "this RFC" or "this draft's intended status"
 */
function describeDocStatus (doc) {
  return doc.docKind === 'rfc' ? 'this RFC' : "this draft's intended status"
}

/**
 * Check a normative reference to an RFC for a downref: an RFC of a lower status than the
 * document being checked, which is fine if it is in the Downref Registry.
 *
 * @param {Object} doc - Document being checked
 * @param {string} rfcNumber - RFC number, without leading zeros
 * @param {string} subject - How the reference is named in messages, e.g. "RFC 1234"
 * @param {number} mode - Validation mode
 * @param {Array<{line: number, pos: number}>} [lines] - Where the reference is (text documents)
 * @param {Object} registry - State of the Downref Registry lookup for the document: its
 *                            `unavailable` property is set to the reason it can't be fetched
 * @returns {Promise<Array>} - Findings
 */
async function checkRfcDownref (doc, rfcNumber, subject, mode, lines, registry) {
  // -> Only Standards Track and BCP documents can have downrefs
  const docStatus = getDocStatusCategory(doc)
  if (docStatus !== 2) {
    return []
  }

  const rfcInfo = await getRfcInfo(doc, rfcNumber)
  // -> Lookup failed: REFERENCE_STATUS_UNAVAILABLE says so; no status (no such RFC):
  //    UNDEFINED_STATUS says so; a number never
  //    issued: REFERENCE_NOT_ISSUED says so
  if (!rfcInfo?.status || isNotIssued(rfcInfo)) {
    return []
  }
  const refStatus = getStatusCategory(rfcInfo.status)

  if (refStatus === null) {
    const message = `${subject} has the status "${rfcInfo.status}" on rfc-editor.org, so it may be a downref.`
    return mode === MODES.SUBMISSION ? [] : [new ValidationWarning('POSSIBLE_DOWNREF', message, { ref: BCP97_REF, lines })]
  }

  if (refStatus >= docStatus) {
    return []
  }

  const docType = describeDocStatus(doc)
  let isDownref
  try {
    isDownref = await checkReferencesInDownrefs([`RFC ${rfcNumber}`])
  } catch (err) {
    if (!(err instanceof DownrefRegistryUnavailableError)) {
      throw err
    }
    // -> Reported as a downref, without telling whether it is in the registry
    //    (DOWNREF_REGISTRY_UNAVAILABLE says why)
    registry.unavailable = err.reason
  }
  if (isDownref?.length > 0) {
    return [new ValidationWarning('DOWNREF_TO_LOWER_STATUS_IN_REGISTRY', `Reference to ${subject}, which has a lower status than ${docType} and is listed in the Downref Registry.`, { ref: BCP97_REF, lines })]
  }
  const message = isDownref
    ? `Reference to ${subject}, which has a lower status than ${docType}. This reference is not in the Downref Registry.`
    : `Reference to ${subject}, which has a lower status than ${docType}. The Downref Registry couldn't be checked for it.`
  // -> A downref the registry couldn't be checked for may well be registered: like any check that a
  //    failed lookup leaves undecided, it is no Error (DOWNREF_REGISTRY_UNAVAILABLE says why)
  const isError = mode === MODES.NORMAL && Boolean(isDownref)
  return isError
    ? [new ValidationError('DOWNREF_TO_LOWER_STATUS', message, { ref: BCP97_REF, lines })]
    : [new ValidationWarning('DOWNREF_TO_LOWER_STATUS', message, { ref: BCP97_REF, lines })]
}

/**
 * Validate the normative references of a document for downrefs.
 *
 * - An RFC of a lower status than the document is a downref, unless it is in the Downref Registry.
 * - An RFC whose status rfc-editor.org gives but isn't recognised is a possible downref; one whose
 *   lookup failed is left to REFERENCE_STATUS_UNAVAILABLE (see validateLookupFailures).
 * - When the Downref Registry can't be fetched, a downref is reported as a Warning, without telling
 *   whether it is in the registry, and a comment says the registry couldn't be checked.
 * - An Internet-Draft has no status yet, so it is never a downref. It is followed through the
 *   drafts that replaced it: one published as an RFC is judged as that RFC, otherwise the
 *   reference is reported as a normative reference to a draft, and as a downref in the making
 *   when the document is Standards Track or BCP and the draft's intended status is lower.
 * - A reference to a document that is neither an RFC, a BCP, an STD nor an Internet-Draft is
 *   commented on when the document is Standards Track or BCP, and not a published RFC: it should be
 *   stable and available.
 * - With offline, nothing is looked up: the RFCs aren't checked (their status comes from
 *   rfc-editor.org), and a draft is reported as a normative reference to a draft without being
 *   followed to what replaced it. The checks needing no lookup still run.
 *
 * @param {Object} doc - Document to validate
 * @param {Object} [opts] - Additional options
 * @param {number} [opts.mode=0] - Validation mode to use
 * @param {boolean} [opts.offline=false] - Make no remote lookups
 * @returns {Array} - List of errors/warnings/comments
 */
export async function validateDownrefs (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  let rfcs = []
  switch (doc.type) {
    case 'txt': {
      const { referenceSectionRfc } = doc.data.extractedElements
      rfcs = uniq([
        ...referenceSectionRfc.filter((extracted) => extracted.subsection === 'normative_references').map((extracted) => trimStart(extracted.value, '0')),
        ...entryOnlyRfcs(doc, 'normative_references')
      ])
      break
    }
    case 'xml': {
      rfcs = getCitedRfcs(collectXmlReferences(doc), ['normative'])
      break
    }
  }

  // -> The status of an RFC is looked up on rfc-editor.org, and only a Standards Track or BCP
  //    document can have downrefs (see checkRfcDownref)
  const normativeDrafts = await classifyNormativeDraftReferences(doc, { offline })
  if (offline) {
    if (getDocStatusCategory(doc) === 2 && (rfcs.length > 0 || normativeDrafts.length > 0)) {
      recordSkippedLookup(doc, 'downrefs')
    }
    if (normativeDrafts.length > 0) {
      recordSkippedLookup(doc, 'cited drafts')
    }
    rfcs = []
  }

  const registry = { unavailable: null }
  for (const rfcNumber of rfcs) {
    const lines = doc.type === 'txt' ? entryOnlyRfcLines(doc, rfcNumber) ?? rfcEntryLines(doc, 'normative_references', rfcNumber) : undefined
    result.push(...await checkRfcDownref(doc, rfcNumber, `RFC ${rfcNumber}`, mode, lines, registry))
  }

  const docStatus = getDocStatusCategory(doc)
  const checkedRfcs = new Set(rfcs)
  const lowerStatusDrafts = new Set()
  for (const draft of normativeDrafts) {
    const { end } = draft
    const lines = doc.type === 'txt' ? normativeDraftLines(doc, draft) : undefined

    // -> A draft published as an RFC is judged as that RFC (the stale reference checks tell
    //    the author to update the reference)
    if (end.kind === 'rfc') {
      if (!checkedRfcs.has(end.rfc)) {
        checkedRfcs.add(end.rfc)
        result.push(...await checkRfcDownref(doc, end.rfc, describeDraftRfc(draft), mode, lines, registry))
      }
      continue
    }

    const subject = describeDraftReference(draft)
    result.push(new ValidationWarning(
      'NORMATIVE_REFERENCE_TO_DRAFT',
      `Normative reference to ${subject}. A document is not published as an RFC before the drafts it references normatively.`,
      { ref: NORMATIVE_REFERENCES_STATEMENT_REF, lines }
    ))

    // -> A draft has no status until it is published, so a lower intended status is only a
    //    downref in the making, and no intended status says nothing yet
    const draftStatus = end.kind === 'draft' && end.intendedStatus ? getStatusCategory(end.intendedStatus) : null
    if (docStatus !== null && draftStatus !== null && draftStatus < docStatus && !lowerStatusDrafts.has(end.name)) {
      lowerStatusDrafts.add(end.name)
      result.push(new ValidationWarning(
        'NORMATIVE_REFERENCE_TO_LOWER_STATUS_DRAFT',
        `Normative reference to ${subject}: the intended status of ${end.name} (${end.intendedStatus}) is lower than ${describeDocStatus(doc)}, so the reference will be a downref if ${end.name} is published with that status.`,
        { ref: BCP97_REF, lines }
      ))
    }
  }

  if (registry.unavailable) {
    result.push(new ValidationComment(
      'DOWNREF_REGISTRY_UNAVAILABLE',
      `The Downref Registry couldn't be checked (${registry.unavailable}), so downrefs are reported without telling whether they are listed in it.`,
      { ref: DOWNREF_REGISTRY_REF }
    ))
  }

  // -> A document from elsewhere has no status to compare, but must be stable and available for a
  //    Standards Track or BCP document to rely on, as idnits2 reminded ("Non-RFC (?) normative reference").
  //    A published RFC can't change anyway, as for its draft references; an RFC Editor working copy is checked
  if (docStatus === 2 && !isPublishedRfc(doc)) {
    for (const { name, lines, path } of getExternalNormativeReferences(doc)) {
      result.push(new ValidationComment(
        'NORMATIVE_REFERENCE_EXTERNAL',
        `Normative reference to a document that is not an RFC or Internet-Draft: ref. '${name}'. Check that it is stable and available.`,
        { ref: EXTERNAL_SPECIFICATIONS_REF, lines, path }
      ))
    }
  }

  return result
}

/**
 * Normative references of a document to documents from elsewhere: references that cite no RFC (numbered
 * or not yet), BCP, STD or Internet-Draft, e.g. [FIPS203] or [W3C.REC-xml-20081126]
 *
 * In a text document, they are the entries of the normative references that cite none of these
 * (see the referenceEntries of lib/parsers/txt.mjs). In an XML document, they are the normative
 * <reference> elements whose <seriesInfo>, anchor or link name none of these, and the bibliography
 * entries of other series included (reference.W3C.*, reference.IEEE.*).
 *
 * @param {Object} doc - Document being checked
 * @returns {Array<{name: string, lines?: Array<{line: number, pos: number}>, path?: string}>} - References,
 *   in document order: their label (without brackets) or anchor, and where they are
 */
function getExternalNormativeReferences (doc) {
  if (doc.type === 'xml') {
    return listXmlReferences(doc)
      .filter((reference) => reference.section === 'normative' && reference.external)
      .map(({ anchor, path }) => ({ name: anchor ?? path, path }))
  }
  return referenceEntriesWithLocations(doc)
    .filter(({ entry }) => entry.subsection === 'normative_references' && entry.external)
    .map(({ entry, location }) => ({ name: entry.value.replace(/^\[|\]$/g, ''), lines: location ? [location] : undefined }))
}

/**
 * Entries of the references section of a text document, each with where its label is
 *
 * @param {Object} doc - Text document being checked
 * @returns {Array<{entry: Object, location: {line: number, pos: number}|undefined}>} - Entries, in document order
 */
function referenceEntriesWithLocations (doc) {
  const seen = {}
  return (doc.data.extractedElements.referenceEntries ?? []).map((entry) => {
    // -> A label listed again is located once for each entry, in document order
    const index = seen[entry.value] = (seen[entry.value] ?? -1) + 1
    return { entry, location: getLocations(doc, 'referenceEntries', entry.value)[index] }
  })
}

/**
 * The draft a citation names, and the revision it gives. This is the one place a cited draft's
 * revision is taken off: the name is looked up as it is returned. A name ending in "-NN" is taken
 * to end in a revision (Datatracker revisions have two digits); any other number is part of the
 * name (draft-ietf-v6ops-nat64-wkp-1918).
 *
 * This deliberately doesn't try to tell a name ending in "-NN" from a revision the way Datatracker
 * can, by knowing which names exist. A draft whose name itself ends in two digits, cited without a
 * revision (draft-singh-apex-psi-04), is therefore looked up without them and reported as not
 * found. Retrying the whole name on a 404 would fix that rare case, but would send a second
 * request for every nonexistent cited draft that carries a revision.
 *
 * @param {string} value - Draft as cited, possibly in brackets or with an "I-D." prefix
 * @returns {{name: string, revision: string}} - Name without revision, and the revision ('' if none)
 */
function citedDraftName (value) {
  const cited = value.replace(/^\[|\]$/g, '').replace(/^I-D\./i, '')
  const m = cited.match(/^(.+)-([0-9]{2})$/)
  if (!m) {
    return { name: cited, revision: '' }
  }
  return { name: m[1], revision: m[2] }
}

/**
 * Normalize references by removing brackets, versions, and checking for drafts.
 *
 * @param {Array} references - Array of textual references.
 * @returns {Array} - Array of normalized references containing "draft".
 */
function normalizeDraftReferences (references) {
  return references
    .map((ref) => citedDraftName(ref).name)
    .filter((ref) => ref.toLowerCase().includes('draft'))
}

/**
 * Format the obsoleted_by list of an RFC, e.g. "RFC9000, RFC9001".
 *
 * @param {Array} obsoletedBy - Obsoleting RFCs, either "RFC9000" or "9000".
 * @returns {string} - Comma-separated list of RFCs.
 */
function formatObsoletedByList (obsoletedBy) {
  return obsoletedBy.map(rfc => `RFC${rfc.replace(/^RFC\s*/i, '')}`).join(', ')
}

/**
 * Get the RFC number of the document being checked, from the "Request for Comments:"
 * header line (TXT) or the number attribute / RFC <seriesInfo> of <rfc> (XML).
 *
 * @param {Object} doc - Document being checked
 * @returns {string|null} - RFC number without leading zeros, or null for a draft
 */
function getOwnRfcNumber (doc) {
  const number = doc.type === 'xml'
    ? doc.data.rfc?._attr?.number ?? castArray(doc.data.rfc?.front?.seriesInfo ?? []).find(info => info?._attr?.name === 'RFC')?._attr?.value
    : doc.data.header?.rfcNumber
  const digits = /^\s*(?:RFC\s*)?0*(\d+)\s*$/i.exec(number ?? '')?.[1]
  return digits ?? null
}

/**
 * Whether the document being checked is a published RFC: a text RFC, or an XML document with an
 * RFC number that has been through xml2rfc's prep tool (prepTime), as RFC Editor working copies
 * carry their RFC number before publication.
 *
 * @param {Object} doc - Document being checked
 * @returns {boolean} - True for a published RFC
 */
function isPublishedRfc (doc) {
  if (!getOwnRfcNumber(doc)) {
    return false
  }
  return doc.type !== 'xml' || Boolean(doc.data.rfc?._attr?.prepTime)
}

/**
 * Whether an RFC is obsoleted by the document being checked, e.g. RFC 3901 cited by
 * RFC 10001, which replaces it. Such a reference is not worth reporting as obsolete.
 *
 * @param {Array} obsoletedBy - Obsoleting RFCs, either "RFC9000" or "9000".
 * @param {string|null} ownRfcNumber - RFC number of the document being checked
 * @returns {boolean} - True if the document being checked is one of the obsoleting RFCs
 */
function isObsoletedBySelf (obsoletedBy, ownRfcNumber) {
  return Boolean(ownRfcNumber) && obsoletedBy.some(rfc => trimStart(rfc.replace(/^RFC\s*/i, ''), '0') === ownRfcNumber)
}

/**
 * Validates normative references within a document by checking the status of referenced RFCs.
 *
 * This function processes both text (`txt`) and XML (`xml`) documents, identifying RFCs within
 * normative references and validating their status using remote data fetched from the RFC editor.
 *
 * - For TXT documents, it looks for normative references in the `referenceSectionRfc` field.
 * - For XML documents, it extracts references from the back references section.
 *
 * Steps:
 * 1. Extract normative references for both TXT and XML documents.
 * 2. Fetch metadata for each RFC using `getRfcInfo`.
 * 3. Validate the fetched status:
 *    - If rfc-editor.org gives no status, a `UNDEFINED_STATUS` comment is added. An RFC whose
 *      lookup failed is left to REFERENCE_STATUS_UNAVAILABLE (see validateLookupFailures).
 *    - If the status is unrecognized, an `UNKNOWN_STATUS` comment is added.
 * 4. Do the same for the RFC that a draft cited normatively was published as, directly or
 *    through the drafts that replaced it.
 * 5. Return a list of validation comments highlighting issues.
 *
 * @param {Object} doc - The document to validate.
 * @param {Object} [opts] - Additional options.
 * @param {number} [opts.mode=MODES.NORMAL] - Validation mode (e.g., NORMAL, SUBMISSION).
 * @param {boolean} [opts.offline=false] - Make no remote lookups, and so no check.
 * @returns {Promise<Array>} - A list of validation results, including warnings or comments.
 */
export async function validateNormativeReferences (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []
  const RFC_NUMBER_REG = /^\d+$/

  if (mode === MODES.SUBMISSION) {
    return result
  }

  const ownRfcNumber = getOwnRfcNumber(doc)
  const normativeReferences = doc.type === 'xml'
    ? getCitedRfcs(collectXmlReferences(doc), ['normative'])
    : uniq([
      ...doc.data.extractedElements.referenceSectionRfc
        .filter((el) => el.subsection === 'normative_references' && RFC_NUMBER_REG.test(el.value))
        .map((el) => trimStart(el.value, '0')),
      ...entryOnlyRfcs(doc, 'normative_references')
    ])

  // -> Every finding comes from rfc-editor.org (the drafts are left to validateDownrefs)
  if (offline) {
    if (normativeReferences.length > 0) {
      recordSkippedLookup(doc, 'reference status')
    }
    return result
  }

  for (const rfcNum of normativeReferences) {
    const lines = doc.type === 'txt' ? entryOnlyRfcLines(doc, rfcNum) ?? rfcEntryLines(doc, 'normative_references', rfcNum) : undefined
    result.push(...await checkNormativeRfc(doc, rfcNum, `RFC ${rfcNum}`, mode, ownRfcNumber, lines))
  }

  // -> A draft published as an RFC, directly or through the drafts that replaced it, is judged as that RFC
  const checkedRfcs = new Set(normativeReferences)
  for (const draft of await classifyNormativeDraftReferences(doc)) {
    if (draft.end.kind === 'rfc' && !checkedRfcs.has(draft.end.rfc)) {
      checkedRfcs.add(draft.end.rfc)
      const lines = doc.type === 'txt' ? normativeDraftLines(doc, draft) : undefined
      result.push(...await checkNormativeRfc(doc, draft.end.rfc, describeDraftRfc(draft), mode, ownRfcNumber, lines))
    }
  }

  return result
}

/**
 * Check the status of an RFC cited normatively: whether it is defined and known, and whether
 * the RFC is obsolete.
 *
 * @param {Object} doc - Document being checked
 * @param {string} rfcNum - RFC number, without leading zeros
 * @param {string} subject - How the RFC is named in messages, e.g. "RFC 1234"
 * @param {number} mode - Validation mode
 * @param {string|null} ownRfcNumber - RFC number of the document being checked
 * @param {Array<{line: number, pos: number}>} [lines] - Where the reference is (text documents)
 * @returns {Promise<Array>} - Findings
 */
async function checkNormativeRfc (doc, rfcNum, subject, mode, ownRfcNumber, lines) {
  const rfcInfo = await getRfcInfo(doc, rfcNum)

  // -> Lookup failed: REFERENCE_STATUS_UNAVAILABLE lists the RFC
  if (rfcInfo === undefined) {
    return []
  }
  if (!rfcInfo || !rfcInfo.status) {
    return [new ValidationComment('UNDEFINED_STATUS', undefinedStatusMessage(subject, rfcInfo), {
      ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`,
      lines
    })]
  }

  if (isNotIssued(rfcInfo)) {
    return notIssuedFinding(subject, rfcNum, mode, lines)
  }

  const result = []
  if (getStatusCategory(rfcInfo.status) === null) {
    result.push(new ValidationComment('UNKNOWN_STATUS', `${subject} has an unrecognized status: "${rfcInfo.status}".`, {
      ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`,
      lines
    }))
  }

  if (rfcInfo.obsoleted_by?.length > 0 && !isObsoletedBySelf(rfcInfo.obsoleted_by, ownRfcNumber)) {
    const message = `${subject} is obsolete and has been replaced by: ${formatObsoletedByList(rfcInfo.obsoleted_by)}.`
    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('OBSOLETE_REFERENCE', message, { ref: 'https://authors.ietf.org/en/required-content#references', lines }))
    } else if (mode === MODES.FORGIVE_CHECKLIST) {
      result.push(new ValidationWarning('OBSOLETE_REFERENCE', message, { ref: 'https://authors.ietf.org/en/required-content#references', lines }))
    }
  }

  return result
}

/**
 * Validates unclassified references within a document.
 *
 * This function checks for issues in unclassified references from the document's
 * extracted elements. Specifically, it identifies if:
 * 1. The reference is obsolete (i.e., replaced by other documents).
 * 2. The reference does not have a defined status or cannot be fetched.
 *
 * - For each unclassified reference, the function fetches its metadata using
 *   `getRfcInfo`.
 * - If the reference is obsolete, it generates a validation error or warning
 *   based on the provided mode.
 * - If the reference has no status or cannot be fetched, a validation comment is generated.
 *
 * Modes:
 * - `NORMAL`: Produces `ValidationError` for obsolete references.
 * - `FORGIVE_CHECKLIST`: Produces `ValidationWarning` for obsolete references.
 *
 * @param {Object} doc - The document object to validate.
 * @param {Object} [opts] - Additional options.
 * @param {number} [opts.mode=MODES.NORMAL] - Validation mode (`NORMAL` or `FORGIVE_CHECKLIST`).
 * @param {boolean} [opts.offline=false] - Make no remote lookups, and so no check.
 * @returns {Promise<Array>} - A list of validation results, including errors, warnings, or comments.
 *
 */
export async function validateUnclassifiedReferences (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  // -> Every finding comes from rfc-editor.org
  if (offline) {
    let cited
    if (doc.type === 'xml') {
      cited = getCitedRfcs(collectXmlReferences(doc), ['unclassified'])
    } else {
      const extracted = doc.data.extractedElements.referenceSectionRfc
      const inSubsection = extracted.filter(el => el.subsection === 'unclassified_references')
      cited = [...inSubsection, ...entryOnlyRfcs(doc, 'unclassified_references')]
    }
    if (cited.length > 0) {
      recordSkippedLookup(doc, 'reference status')
    }
    return result
  }

  const ownRfcNumber = getOwnRfcNumber(doc)

  switch (doc.type) {
    case 'txt': {
      const unclassifiedReferences = [
        ...doc.data.extractedElements.referenceSectionRfc
          .filter(el => el.subsection === 'unclassified_references')
          .map(el => el.value),
        ...entryOnlyRfcs(doc, 'unclassified_references')
      ]

      for (const ref of unclassifiedReferences) {
        const rfcInfo = await getRfcInfo(doc, ref)
        const lines = entryOnlyRfcLines(doc, ref) ?? findingLines(entryLocations(doc, 'referenceSectionRfc', ref))

        // -> Lookup failed: REFERENCE_STATUS_UNAVAILABLE lists the RFC
        if (rfcInfo === undefined) {
          continue
        }
        if (!rfcInfo || !rfcInfo.status) {
          result.push(new ValidationComment(
            'UNDEFINED_STATUS',
            undefinedStatusMessage(`The unclassified reference RFC ${ref}`, rfcInfo),
            { ref: `https://www.rfc-editor.org/info/rfc${ref}`, lines }
          ))
          continue
        }
        if (isNotIssued(rfcInfo)) {
          result.push(...notIssuedFinding(`RFC ${ref}`, ref, mode, lines))
          continue
        }

        if (rfcInfo.obsoleted_by?.length > 0 && !isObsoletedBySelf(rfcInfo.obsoleted_by, ownRfcNumber)) {
          const obsoletedByList = formatObsoletedByList(rfcInfo.obsoleted_by)
          const message = `RFC ${ref} is obsolete and has been replaced by: ${obsoletedByList}.`

          if (mode === MODES.NORMAL) {
            result.push(new ValidationError(
              'OBSOLETE_REFERENCE',
              message,
              { ref: 'https://authors.ietf.org/en/required-content#references', lines }
            ))
          } else if (mode === MODES.FORGIVE_CHECKLIST) {
            result.push(new ValidationWarning(
              'OBSOLETE_REFERENCE',
              message,
              { ref: 'https://authors.ietf.org/en/required-content#references', lines }
            ))
          }
        }
      }
      break
    }
    case 'xml': {
      const unclassifiedReferences = getCitedRfcs(collectXmlReferences(doc), ['unclassified'])

      for (const rfcNum of unclassifiedReferences) {
        const rfcInfo = await getRfcInfo(doc, rfcNum)

        // -> Lookup failed: REFERENCE_STATUS_UNAVAILABLE lists the RFC
        if (rfcInfo === undefined) {
          continue
        }
        if (!rfcInfo?.status) {
          result.push(new ValidationComment(
            'UNDEFINED_STATUS',
            undefinedStatusMessage(`RFC ${rfcNum}`, rfcInfo),
            { ref: `https://www.rfc-editor.org/info/rfc${rfcNum}` }
          ))
          continue
        }
        if (isNotIssued(rfcInfo)) {
          result.push(...notIssuedFinding(`RFC ${rfcNum}`, rfcNum, mode))
          continue
        }

        if (rfcInfo.obsoleted_by?.length > 0 && !isObsoletedBySelf(rfcInfo.obsoleted_by, ownRfcNumber)) {
          const obsoletedByList = formatObsoletedByList(rfcInfo.obsoleted_by)
          const message = `RFC ${rfcNum} is obsolete and has been replaced by: ${obsoletedByList}.`

          result.push(
            mode === MODES.NORMAL
              ? new ValidationError('OBSOLETE_REFERENCE', message, { ref: 'https://authors.ietf.org/en/required-content#references' })
              : new ValidationWarning('OBSOLETE_REFERENCE', message, { ref: 'https://authors.ietf.org/en/required-content#references' })
          )
        }
      }
      break
    }
  }

  return result
}

/**
 * Validates informative references within a document.
 *
 * This function checks for issues in informative references from the document's
 * extracted elements (TXT) or its informative references sections (XML). Specifically, it identifies if:
 * 1. The reference is obsolete (i.e., replaced by other documents).
 * 2. The reference does not have a defined status or cannot be fetched.
 *
 *
 * @param {Object} doc - The document object to validate.
 * @param {Object} [opts] - Additional options.
 * @param {number} [opts.mode=MODES.NORMAL] - Validation mode (`NORMAL` or `FORGIVE_CHECKLIST`).
 * @param {boolean} [opts.offline=false] - Make no remote lookups, and so no check.
 * @returns {Promise<Array>} - A list of validation results, including errors, warnings, or comments.
 */
export async function validateInformativeReferences (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  const informativeReferences = doc.type === 'xml'
    ? getCitedRfcs(collectXmlReferences(doc), ['informative'])
    : [
        ...doc.data.extractedElements.referenceSectionRfc
          .filter(el => el.subsection === 'informative_references')
          .map(el => el.value),
        ...entryOnlyRfcs(doc, 'informative_references')
      ]

  // -> Every finding comes from rfc-editor.org
  if (offline) {
    if (informativeReferences.length > 0) {
      recordSkippedLookup(doc, 'reference status')
    }
    return result
  }

  const ownRfcNumber = getOwnRfcNumber(doc)

  for (const ref of informativeReferences) {
    const rfcInfo = await getRfcInfo(doc, ref)
    const lines = doc.type === 'txt' ? entryOnlyRfcLines(doc, ref) ?? findingLines(entryLocations(doc, 'referenceSectionRfc', ref)) : undefined

    // -> Lookup failed: REFERENCE_STATUS_UNAVAILABLE lists the RFC
    if (rfcInfo === undefined) {
      continue
    }
    if (!rfcInfo || !rfcInfo.status) {
      result.push(new ValidationComment(
        'UNDEFINED_STATUS',
        undefinedStatusMessage(`The informative reference RFC ${ref}`, rfcInfo),
        { ref: `https://www.rfc-editor.org/info/rfc${ref}`, lines }
      ))
      continue
    }
    if (isNotIssued(rfcInfo)) {
      result.push(...notIssuedFinding(`RFC ${ref}`, ref, mode, lines))
      continue
    }

    // -> Citing an obsolete RFC informatively is often deliberate (history, what changed),
    //    so it is a question rather than a problem, as in idnits2
    if (rfcInfo.obsoleted_by?.length > 0 && !isObsoletedBySelf(rfcInfo.obsoleted_by, ownRfcNumber)) {
      const obsoletedByList = formatObsoletedByList(rfcInfo.obsoleted_by)
      const message = `Obsolete informative reference: RFC ${ref} has been replaced by ${obsoletedByList}. Is this intentional?`

      if (mode === MODES.NORMAL) {
        result.push(new ValidationWarning(
          'OBSOLETE_INFORMATIVE_REFERENCE',
          message,
          { ref: 'https://authors.ietf.org/en/required-content#references', lines }
        ))
      } else if (mode === MODES.FORGIVE_CHECKLIST) {
        result.push(new ValidationComment(
          'OBSOLETE_INFORMATIVE_REFERENCE',
          message,
          { ref: 'https://authors.ietf.org/en/required-content#references', lines }
        ))
      }
    }
  }

  return result
}

/**
 * Drafts cited, once per draft, by name without revision
 *
 * @param {string[]} references - Draft references as extracted
 * @returns {string[]} - Names without revision
 */
function citedDraftNames (references) {
  return uniq(normalizeDraftReferences(references))
}

/**
 * Check the Datatracker state of a cited draft. A failed lookup gives nothing: the draft is listed
 * in REFERENCE_STATUS_UNAVAILABLE instead (see validateLookupFailures).
 *
 * @param {Object} doc - Document being checked
 * @param {string} name - Draft name, without revision
 * @param {Array<{line: number, pos: number}>} [lines] - Where the draft is cited (text documents)
 * @returns {Promise<Array>} - Findings
 */
async function checkDraftState (doc, name, lines) {
  const draftInfo = await getDocInfoJson(doc, name)
  if (draftInfo === undefined) {
    return []
  }
  if (!draftInfo?.state) {
    return [new ValidationWarning(
      'UNDEFINED_STATE',
      `The draft reference ${name} wasn't found on Datatracker, or has no state there.`,
      { ref: `https://datatracker.ietf.org/doc/${name}`, lines }
    )]
  }
  if (draftInfo.state.toLowerCase() === 'rfc') {
    return [new ValidationWarning(
      'INVALID_STATE_FOR_DRAFT',
      `The draft reference ${name} is already published as an RFC and should not be referenced as a draft.`,
      { ref: `https://datatracker.ietf.org/doc/${name}`, lines }
    )]
  }
  return []
}

/**
 * Validate draft references in a document to ensure their states are valid.
 *
 * This function checks all draft references in a document, ensuring:
 * - The referenced draft exists and has a state. This is the only check that reports a draft
 *   Datatracker doesn't have (validateReferenceForStale skips it); one whose lookup failed is left
 *   to REFERENCE_STATUS_UNAVAILABLE (see validateLookupFailures).
 * - A draft is not already published as an RFC (and thus should not be referenced as a draft).
 *
 * A published RFC is not checked: a draft it cites may well have been published since, and
 * the RFC can't change anyway. RFC Editor working copies, which may already carry their RFC
 * number but haven't been through xml2rfc's prep tool (no prepTime), are still checked.
 *
 * @param {Object} doc - The document to validate. Should contain `type` and `data` properties.
 * @param {Object} [opts] - Additional options for validation.
 * @param {number} [opts.mode] - The validation mode (e.g., SUBMISSION mode skips validation).
 * @param {boolean} [opts.offline=false] - Make no remote lookups, and so no check.
 *
 * @returns {Array} A list of `ValidationWarning` objects containing information about invalid references.
 */

export async function validatePublishedDraftReferences (doc, { mode, offline = false } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION || isPublishedRfc(doc)) {
    return result
  }

  // -> Every finding comes from Datatracker
  if (offline) {
    let cited
    if (doc.type === 'xml') {
      cited = getCitedDrafts(collectXmlReferences(doc))
    } else {
      cited = doc.data.extractedElements.draftStatusReferences
    }
    if (cited.length > 0) {
      recordSkippedLookup(doc, 'cited drafts')
    }
    return result
  }

  switch (doc.type) {
    case 'txt': {
      const cited = doc.data.extractedElements.draftStatusReferences.map((el) => el.value)
      for (const name of citedDraftNames(cited)) {
        // -> Every link to the draft, in any subsection and whatever its revision
        const lines = draftLinkLines(doc, (value) => normalizeDraftReferences([value])[0] === name)
        const findings = await checkDraftState(doc, name, lines)
        result.push(...findings)
      }
      break
    }
    case 'xml': {
      const cited = getCitedDrafts(collectXmlReferences(doc))
      for (const name of citedDraftNames(cited)) {
        const findings = await checkDraftState(doc, name)
        result.push(...findings)
      }
      break
    }
  }

  return result
}

/**
 *
 * Validate references for stale. If document has newer version, it will be marked as stale and
 * output validation warning. Drafts that can't be fetched are left to validatePublishedDraftReferences.
 *
 * @param {Object} doc - The document to validate. Should contain `type` and `data` properties.
 * @param {Object} [opts] - Additional options for validation.
 * @param {number} [opts.mode] - The validation mode (e.g., SUBMISSION mode skips validation).
 * @param {boolean} [opts.offline=false] - Make no remote lookups, and so no check.
 */
export async function validateReferenceForStale (doc, { mode, offline = false } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  let parsedDrafts = []

  switch (doc.type) {
    case 'txt': {
      const referenceSectionDraftReferences = doc.data.extractedElements.draftStatusReferences
      parsedDrafts = referenceSectionDraftReferences.map(r => {
        const { name, revision } = citedDraftName(r.value)
        return {
          name,
          revision,
          subsection: r.subsection,
          // -> The draft as linked to (with its revision), in the subsection it is reported for
          lines: draftLinkLines(doc, (value) => value === r.value, r.subsection)
        }
      })
      break
    }
    case 'xml': {
      const drafts = getCitedDrafts(collectXmlReferences(doc))
      parsedDrafts = drafts.map(r => {
        const { name, revision } = citedDraftName(r)
        return {
          name,
          revision
        }
      })
      break
    }
  }

  // -> Every finding comes from Datatracker
  if (offline) {
    if (parsedDrafts.length > 0) {
      recordSkippedLookup(doc, 'cited drafts')
    }
    return result
  }

  for (let i = 0; i < parsedDrafts.length; i++) {
    const { name: draftName, revision: draftVersion } = parsedDrafts[i]
    // -> The same lookup as validatePublishedDraftReferences', which reports a failed one
    const draftInfo = await getDocInfoJson(doc, draftName, null)
    const lastVersion = last(draftInfo?.rev_history)
    // -> A draft that can't be fetched is reported by validatePublishedDraftReferences
    if (!draftInfo || !draftInfo.rev_history || !lastVersion) {
      continue
    }

    const message = describeStaleDraftReference(draftName, draftVersion, draftInfo)
    if (message) {
      result.push(new ValidationWarning(
        'OUTDATED_DRAFT',
        message,
        { ref: `https://datatracker.ietf.org/doc/${draftName}`, lines: parsedDrafts[i].lines }
      ))
    }
  }

  return result
}

/**
 * Describe why a draft reference is stale, based on the end of its Datatracker
 * revision history (which follows replaced-by relationships and RFC publication).
 *
 * @param {string} draftName - Referenced draft name, without version
 * @param {string} draftVersion - Referenced draft version ('' when the reference has none)
 * @param {Object} draftInfo - Datatracker doc.json for the referenced draft
 * @returns {string|null} Warning message, or null if the reference is not stale
 */
function describeStaleDraftReference (draftName, draftVersion, draftInfo) {
  const latest = last(draftInfo.rev_history)
  const latestName = latest.name ?? draftName
  const reference = draftVersion ? `${draftName}-${draftVersion}` : draftName

  if (/^rfc\d+$/i.test(latestName)) {
    // A draft that was itself published as an RFC is reported as INVALID_STATE_FOR_DRAFT
    if (draftInfo.state?.toLowerCase() === 'rfc') {
      return null
    }
    const rfc = `RFC ${latestName.slice(3)}`
    const lastDraftName = findLast(draftInfo.rev_history, (entry) => entry.name?.startsWith('draft-'))?.name
    if (!lastDraftName || lastDraftName === draftName) {
      return `The draft reference ${reference} is stale. ${draftName} has been published as ${rfc}.`
    }
    return `The draft reference ${reference} is stale. ${draftName} was replaced by ${lastDraftName}, which has been published as ${rfc}.`
  }

  if (latestName !== draftName) {
    return `The draft reference ${reference} is stale. ${draftName} was replaced by ${latestName}, whose latest revision is -${latest.rev}.`
  }

  if (draftVersion && Number(latest.rev) > Number(draftVersion)) {
    return `The draft reference ${reference} is stale. Its latest revision is -${latest.rev}.`
  }

  return null
}
