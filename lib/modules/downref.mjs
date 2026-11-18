import { ValidationWarning, ValidationError, ValidationComment } from '../helpers/error.mjs'
import { checkReferencesInDownrefs, DownrefRegistryUnavailableError } from '../remote/downref.mjs'
import { MODES } from '../config/modes.mjs'
import { getStatusCategory } from '../config/rfc-status-hierarchy.mjs'
import { getDocInfoJson, getRfcInfo, prefetchDocInfoJson, prefetchRfcInfo, recordSkippedLookup, resolveDraftChain } from '../remote/lookups.mjs'
import { castArray, findLast, last, trimStart, uniq, uniqBy } from 'lodash-es'
import { CERTAINTY } from '../model/indexes.mjs'
import { getDraftReferencesLines, getReferences, getReferencesLines } from '../model/references.mjs'

const BCP97_REF = 'https://www.rfc-editor.org/info/bcp97'
const DOWNREF_REGISTRY_REF = 'https://datatracker.ietf.org/doc/downref/'
const NORMATIVE_REFERENCES_STATEMENT_REF = 'https://datatracker.ietf.org/doc/statement-iesg-iesg-statement-normative-and-informative-references-20060419/'
const EXTERNAL_SPECIFICATIONS_REF = 'https://www.rfc-editor.org/rfc/rfc2026.html#section-7.1'

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
 * @param {FindingLocation} location Where the reference is
 * @returns {Array} REFERENCE_NOT_ISSUED finding, or none in submission mode
 */
function notIssuedFinding (subject, rfcNum, mode, location) {
  const message = `${subject} was never issued: rfc-editor.org lists RFC ${rfcNum} as "NOT ISSUED".`
  const opts = { ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`, ...location }
  if (mode === MODES.NORMAL) {
    return [new ValidationError('REFERENCE_NOT_ISSUED', message, opts)]
  } else if (mode === MODES.FORGIVE_CHECKLIST) {
    return [new ValidationWarning('REFERENCE_NOT_ISSUED', message, opts)]
  }
  return []
}

/**
 * Group references by a key, in the order each key first comes
 *
 * @param {import('../model/references.mjs').ReferenceAnswer[]} references - References
 * @param {function(Object): string} keyOf - Key of a reference
 * @returns {Map<string, Array<Object>>} - References, by key
 */
function groupReferences (references, keyOf) {
  const groups = new Map()
  for (const reference of references) {
    const key = keyOf(reference)
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key).push(reference)
  }
  return groups
}

/**
 * @typedef {{lines: Array<{line: number, pos: number}>|undefined}|{path: string}} FindingLocation Where a finding
 *   is, as the options of a finding: lines in a text document, a path in an XML document
 */

/**
 * Where some references are, for one finding about all of them: in a text document, the lines of each (see
 * getReferencesLines); in an XML document, the path of the first one, as a finding has one path only. The first
 * one is the first that getReferences lists: in the first <references> element that cites the value, and within
 * it in the order of listXmlReferences. Its path is that of a <reference> or include element, labelled with its
 * <references> element (and its anchor), or of the <references> element itself for an external entity or an
 * <?rfc include?>
 *
 * @param {import('../model/references.mjs').ReferenceAnswer[]} references - References, at least one
 * @returns {FindingLocation} - Where they are
 */
function locateReferences (references) {
  const { path } = references[0].location
  if (path === undefined) {
    return { lines: getReferencesLines(references) }
  }
  return { path }
}

/**
 * Where the references to some drafts are, for one finding about all of them: in a text document, wherever the
 * references section links to them or names them (see getDraftReferencesLines); in an XML document, the path of
 * the first one, as for locateReferences
 *
 * @param {Object} doc - Document being checked
 * @param {import('../model/references.mjs').ReferenceAnswer[]} references - References citing drafts, at least one
 * @returns {FindingLocation} - Where they are
 */
function locateDraftReferences (doc, references) {
  const { path } = references[0].location
  if (path === undefined) {
    return { lines: getDraftReferencesLines(doc, references) }
  }
  return { path }
}

/**
 * RFCs that the references of a kind cite, once per RFC, each located at all the references citing it
 *
 * @param {Object} doc - Document being checked
 * @param {string} kind - Kind of references: normative, informative or unclassified
 * @returns {Array<{number: string, location: FindingLocation}>} - RFCs, by number without leading zeros, in
 *   document order, and where they are (see locateReferences)
 */
function citedRfcs (doc, kind) {
  const references = getReferences(doc).filter((reference) => reference.kind === kind && reference.rfc !== null)
  const byNumber = groupReferences(references, (reference) => reference.rfc)
  return [...byNumber].map(([number, group]) => ({ number, location: locateReferences(group) }))
}

/**
 * RFCs that the references of a kind cite, once for each way a number is written ("0791" and "791" in a text
 * document), each located at its own reference
 *
 * @param {Object} doc - Document being checked
 * @param {string} kind - Kind of references: informative or unclassified
 * @returns {Array<{number: string, certainty: string, location: FindingLocation}>} - RFCs, by number as
 *   written, in document order, and where they are
 */
function citedRfcsAsWritten (doc, kind) {
  const references = getReferences(doc).filter((reference) => reference.kind === kind && reference.rfc !== null)
  return uniqBy(references, (reference) => reference.rfcAsWritten ?? reference.rfc).map((reference) => {
    return { number: reference.rfcAsWritten ?? reference.rfc, certainty: reference.certainty, location: reference.location }
  })
}

/**
 * References of a document that cite an Internet-Draft
 *
 * @param {Object} doc - Document being checked
 * @param {string} [kind] - Kind of references: normative, informative or unclassified; all of them when not given
 * @returns {import('../model/references.mjs').ReferenceAnswer[]} - References, in document order
 */
function draftReferences (doc, kind) {
  return getReferences(doc).filter((reference) => reference.draft !== null && (!kind || reference.kind === kind))
}

/**
 * @typedef {Object} NormativeDraftReference
 * @property {string} reference Draft as cited, with its version if the reference gives one
 * @property {string} name Draft name, without version
 * @property {string[]} chain Drafts from the cited one to the last one that replaced it
 * @property {import('../remote/lookups.mjs').DraftChainEnd} end Where the chain ends
 * @property {FindingLocation} location Where the draft is cited in the normative references, whatever revision
 *   they give (see locateReferences)
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

  // -> A draft is located at its links in the normative references, whatever revision they give
  const normative = draftReferences(doc, 'normative')
  const byName = groupReferences(normative, (reference) => citedDraftName(reference.draft).name)
  const drafts = []
  const seen = new Set()
  for (const { draft: reference } of normative) {
    const { name } = citedDraftName(reference)
    if (!/^draft-/i.test(name) || seen.has(name)) {
      continue
    }
    seen.add(name)
    drafts.push({ reference, name, location: locateReferences(byName.get(name)) })
  }

  if (!offline) {
    // -> The chain of each draft starts with its own lookup
    const names = drafts.map(draft => draft.name)
    prefetchDocInfoJson(doc, names)
  }
  const references = []
  for (const { reference, name, location } of drafts) {
    let resolved
    if (offline) {
      resolved = { chain: [name], end: { kind: 'unknown' } }
    } else {
      resolved = await resolveDraftChain(doc, name)
    }
    references.push({ reference, name, ...resolved, location })
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
 * @param {FindingLocation} location - Where the reference is
 * @param {Object} registry - State of the Downref Registry lookup for the document: its
 *                            `unavailable` property is set to the reason it can't be fetched
 * @returns {Promise<Array>} - Findings
 */
async function checkRfcDownref (doc, rfcNumber, subject, mode, location, registry) {
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
    return mode === MODES.SUBMISSION ? [] : [new ValidationWarning('POSSIBLE_DOWNREF', message, { ref: BCP97_REF, ...location })]
  }

  if (refStatus >= docStatus) {
    return []
  }

  const docType = describeDocStatus(doc)
  let isDownref
  try {
    isDownref = await checkReferencesInDownrefs(doc, [`RFC ${rfcNumber}`])
  } catch (err) {
    if (!(err instanceof DownrefRegistryUnavailableError)) {
      throw err
    }
    // -> Reported as a downref, without telling whether it is in the registry
    //    (DOWNREF_REGISTRY_UNAVAILABLE says why)
    registry.unavailable = err.reason
  }
  if (isDownref?.length > 0) {
    return [new ValidationWarning('DOWNREF_TO_LOWER_STATUS_IN_REGISTRY', `Reference to ${subject}, which has a lower status than ${docType} and is listed in the Downref Registry.`, { ref: BCP97_REF, ...location })]
  }
  const message = isDownref
    ? `Reference to ${subject}, which has a lower status than ${docType}. This reference is not in the Downref Registry.`
    : `Reference to ${subject}, which has a lower status than ${docType}. The Downref Registry couldn't be checked for it.`
  // -> A downref the registry couldn't be checked for may well be registered: like any check that a
  //    failed lookup leaves undecided, it is no Error, and has its own code (DOWNREF_REGISTRY_UNAVAILABLE says why)
  if (!isDownref) {
    return [new ValidationWarning('DOWNREF_TO_LOWER_STATUS_UNCHECKED', message, { ref: BCP97_REF, ...location })]
  }
  if (mode === MODES.NORMAL) {
    return [new ValidationError('DOWNREF_TO_LOWER_STATUS', message, { ref: BCP97_REF, ...location })]
  }
  return [new ValidationWarning('DOWNREF_TO_LOWER_STATUS', message, { ref: BCP97_REF, ...location })]
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

  let rfcs = citedRfcs(doc, 'normative')

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
  for (const { number, location } of rfcs) {
    result.push(...await checkRfcDownref(doc, number, `RFC ${number}`, mode, location, registry))
  }

  const docStatus = getDocStatusCategory(doc)
  const checkedRfcs = new Set(rfcs.map((rfc) => rfc.number))
  const lowerStatusDrafts = new Set()
  for (const draft of normativeDrafts) {
    const { end, location } = draft

    // -> A draft published as an RFC is judged as that RFC (the stale reference checks tell
    //    the author to update the reference)
    if (end.kind === 'rfc') {
      if (!checkedRfcs.has(end.rfc)) {
        checkedRfcs.add(end.rfc)
        result.push(...await checkRfcDownref(doc, end.rfc, describeDraftRfc(draft), mode, location, registry))
      }
      continue
    }

    const subject = describeDraftReference(draft)
    result.push(new ValidationWarning(
      'NORMATIVE_REFERENCE_TO_DRAFT',
      `Normative reference to ${subject}. A document is not published as an RFC before the drafts it references normatively.`,
      { ref: NORMATIVE_REFERENCES_STATEMENT_REF, ...location }
    ))

    // -> A draft has no status until it is published, so a lower intended status is only a
    //    downref in the making, and no intended status says nothing yet
    const draftStatus = end.kind === 'draft' && end.intendedStatus ? getStatusCategory(end.intendedStatus) : null
    if (docStatus !== null && draftStatus !== null && draftStatus < docStatus && !lowerStatusDrafts.has(end.name)) {
      lowerStatusDrafts.add(end.name)
      result.push(new ValidationWarning(
        'NORMATIVE_REFERENCE_TO_LOWER_STATUS_DRAFT',
        `Normative reference to ${subject}: the intended status of ${end.name} (${end.intendedStatus}) is lower than ${describeDocStatus(doc)}, so the reference will be a downref if ${end.name} is published with that status.`,
        { ref: BCP97_REF, ...location }
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
  return getReferences(doc)
    .filter((reference) => reference.kind === 'normative' && reference.external)
    .map(({ label, location }) => ({ name: label ?? location.path, ...location }))
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
 * normative references (see getReferences) and validating their status using remote data fetched from
 * the RFC editor.
 *
 * Steps:
 * 1. Get the RFCs the normative references cite.
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

  if (mode === MODES.SUBMISSION) {
    return result
  }

  const ownRfcNumber = getOwnRfcNumber(doc)
  const normativeReferences = citedRfcs(doc, 'normative')

  // -> Every finding comes from rfc-editor.org (the drafts are left to validateDownrefs)
  if (offline) {
    if (normativeReferences.length > 0) {
      recordSkippedLookup(doc, 'reference status')
    }
    return result
  }

  prefetchRfcInfo(doc, normativeReferences.map((rfc) => rfc.number))
  for (const { number, location } of normativeReferences) {
    result.push(...await checkNormativeRfc(doc, number, `RFC ${number}`, mode, ownRfcNumber, location))
  }

  // -> A draft published as an RFC, directly or through the drafts that replaced it, is judged as that RFC
  const checkedRfcs = new Set(normativeReferences.map((rfc) => rfc.number))
  for (const draft of await classifyNormativeDraftReferences(doc)) {
    if (draft.end.kind === 'rfc' && !checkedRfcs.has(draft.end.rfc)) {
      checkedRfcs.add(draft.end.rfc)
      result.push(...await checkNormativeRfc(doc, draft.end.rfc, describeDraftRfc(draft), mode, ownRfcNumber, draft.location))
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
 * @param {FindingLocation} location - Where the reference is
 * @returns {Promise<Array>} - Findings
 */
async function checkNormativeRfc (doc, rfcNum, subject, mode, ownRfcNumber, location) {
  const rfcInfo = await getRfcInfo(doc, rfcNum)

  // -> Lookup failed: REFERENCE_STATUS_UNAVAILABLE lists the RFC
  if (rfcInfo === undefined) {
    return []
  }
  if (!rfcInfo || !rfcInfo.status) {
    return [new ValidationComment('UNDEFINED_STATUS', undefinedStatusMessage(subject, rfcInfo), {
      ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`,
      ...location
    })]
  }

  if (isNotIssued(rfcInfo)) {
    return notIssuedFinding(subject, rfcNum, mode, location)
  }

  const result = []
  if (getStatusCategory(rfcInfo.status) === null) {
    result.push(new ValidationComment('UNKNOWN_STATUS', `${subject} has an unrecognized status: "${rfcInfo.status}".`, {
      ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`,
      ...location
    }))
  }

  if (rfcInfo.obsoleted_by?.length > 0 && !isObsoletedBySelf(rfcInfo.obsoleted_by, ownRfcNumber)) {
    const message = `${subject} is obsolete and has been replaced by: ${formatObsoletedByList(rfcInfo.obsoleted_by)}.`
    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('OBSOLETE_REFERENCE', message, { ref: 'https://authors.ietf.org/en/required-content#references', ...location }))
    } else if (mode === MODES.FORGIVE_CHECKLIST) {
      result.push(new ValidationWarning('OBSOLETE_REFERENCE', message, { ref: 'https://authors.ietf.org/en/required-content#references', ...location }))
    }
  }

  return result
}

/**
 * Validates unclassified references within a document.
 *
 * This function checks for issues in the RFCs that unclassified references cite (see getReferences).
 * Specifically, it identifies if:
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

  const unclassifiedReferences = citedRfcsAsWritten(doc, 'unclassified')

  // -> Every finding comes from rfc-editor.org
  if (offline) {
    if (unclassifiedReferences.length > 0) {
      recordSkippedLookup(doc, 'reference status')
    }
    return result
  }

  const ownRfcNumber = getOwnRfcNumber(doc)

  prefetchRfcInfo(doc, unclassifiedReferences.map((rfc) => rfc.number))
  for (const { number, certainty, location } of unclassifiedReferences) {
    const rfcInfo = await getRfcInfo(doc, number)

    // -> Lookup failed: REFERENCE_STATUS_UNAVAILABLE lists the RFC
    if (rfcInfo === undefined) {
      continue
    }
    if (!rfcInfo?.status) {
      // -> A reference found in text is named as unclassified, one declared in XML isn't (as before)
      const subject = certainty === CERTAINTY.INFERRED ? `The unclassified reference RFC ${number}` : `RFC ${number}`
      result.push(new ValidationComment(
        'UNDEFINED_STATUS',
        undefinedStatusMessage(subject, rfcInfo),
        { ref: `https://www.rfc-editor.org/info/rfc${number}`, ...location }
      ))
      continue
    }
    if (isNotIssued(rfcInfo)) {
      result.push(...notIssuedFinding(`RFC ${number}`, number, mode, location))
      continue
    }

    if (rfcInfo.obsoleted_by?.length > 0 && !isObsoletedBySelf(rfcInfo.obsoleted_by, ownRfcNumber)) {
      const obsoletedByList = formatObsoletedByList(rfcInfo.obsoleted_by)
      const message = `RFC ${number} is obsolete and has been replaced by: ${obsoletedByList}.`

      if (mode === MODES.NORMAL) {
        result.push(new ValidationError(
          'OBSOLETE_REFERENCE',
          message,
          { ref: 'https://authors.ietf.org/en/required-content#references', ...location }
        ))
      } else if (mode === MODES.FORGIVE_CHECKLIST) {
        result.push(new ValidationWarning(
          'OBSOLETE_REFERENCE',
          message,
          { ref: 'https://authors.ietf.org/en/required-content#references', ...location }
        ))
      }
    }
  }

  return result
}

/**
 * Validates informative references within a document.
 *
 * This function checks for issues in the RFCs that informative references cite (see getReferences).
 * Specifically, it identifies if:
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

  const informativeReferences = citedRfcsAsWritten(doc, 'informative')

  // -> Every finding comes from rfc-editor.org
  if (offline) {
    if (informativeReferences.length > 0) {
      recordSkippedLookup(doc, 'reference status')
    }
    return result
  }

  const ownRfcNumber = getOwnRfcNumber(doc)

  prefetchRfcInfo(doc, informativeReferences.map((rfc) => rfc.number))
  for (const { number: ref, location } of informativeReferences) {
    const rfcInfo = await getRfcInfo(doc, ref)

    // -> Lookup failed: REFERENCE_STATUS_UNAVAILABLE lists the RFC
    if (rfcInfo === undefined) {
      continue
    }
    if (!rfcInfo || !rfcInfo.status) {
      result.push(new ValidationComment(
        'UNDEFINED_STATUS',
        undefinedStatusMessage(`The informative reference RFC ${ref}`, rfcInfo),
        { ref: `https://www.rfc-editor.org/info/rfc${ref}`, ...location }
      ))
      continue
    }
    if (isNotIssued(rfcInfo)) {
      result.push(...notIssuedFinding(`RFC ${ref}`, ref, mode, location))
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
          { ref: 'https://authors.ietf.org/en/required-content#references', ...location }
        ))
      } else if (mode === MODES.FORGIVE_CHECKLIST) {
        result.push(new ValidationComment(
          'OBSOLETE_INFORMATIVE_REFERENCE',
          message,
          { ref: 'https://authors.ietf.org/en/required-content#references', ...location }
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
 * @param {FindingLocation} location - Where the draft is cited
 * @returns {Promise<Array>} - Findings
 */
async function checkDraftState (doc, name, location) {
  const draftInfo = await getDocInfoJson(doc, name)
  if (draftInfo === undefined) {
    return []
  }
  if (!draftInfo?.state) {
    return [new ValidationWarning(
      'UNDEFINED_STATE',
      `The draft reference ${name} wasn't found on Datatracker, or has no state there.`,
      { ref: `https://datatracker.ietf.org/doc/${name}`, ...location }
    )]
  }
  if (draftInfo.state.toLowerCase() === 'rfc') {
    return [new ValidationWarning(
      'INVALID_STATE_FOR_DRAFT',
      `The draft reference ${name} is already published as an RFC and should not be referenced as a draft.`,
      { ref: `https://datatracker.ietf.org/doc/${name}`, ...location }
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

  const cited = draftReferences(doc)

  // -> Every finding comes from Datatracker
  if (offline) {
    if (cited.length > 0) {
      recordSkippedLookup(doc, 'cited drafts')
    }
    return result
  }

  // -> Every link to the draft, in any subsection and whatever its revision
  const byName = groupReferences(cited, (reference) => normalizeDraftReferences([reference.draft])[0])
  const names = citedDraftNames(cited.map((reference) => reference.draft))
  prefetchDocInfoJson(doc, names)
  for (const name of names) {
    const findings = await checkDraftState(doc, name, locateDraftReferences(doc, byName.get(name)))
    result.push(...findings)
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

  // -> A text document reports a draft once for each subsection that links to it, located where it is there; an
  //    XML document reports it once
  let cited = draftReferences(doc)
  if (doc.type === 'xml') {
    cited = uniqBy(cited, 'draft')
  }
  const parsedDrafts = cited.map(({ draft, location }) => ({ ...citedDraftName(draft), location }))

  // -> Every finding comes from Datatracker
  if (offline) {
    if (parsedDrafts.length > 0) {
      recordSkippedLookup(doc, 'cited drafts')
    }
    return result
  }

  const draftNames = parsedDrafts.map(draft => draft.name)
  prefetchDocInfoJson(doc, draftNames)
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
        { ref: `https://datatracker.ietf.org/doc/${draftName}`, ...parsedDrafts[i].location }
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
