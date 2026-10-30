import { trimStart } from 'lodash-es'
import { lookupRemoteDocInfo, lookupRemoteDocInfoJson, lookupRemoteRfcInfo } from './common.mjs'

// Remote lookups made for each document being checked, as several checks run
// concurrently over the same references. Keyed by the document, so the
// lookups of a run go away with it and a new run fetches fresh data.
const lookupsByDoc = new WeakMap()

/**
 * Look up remote data once per document being checked
 *
 * @param {Object} doc Document being checked
 * @param {string} key Key of the lookup
 * @param {Function} fetcher Function fetching the data
 * @returns {Promise<*>} Fetched data, shared by all lookups with the same key
 */
function lookupOnce (doc, key, fetcher) {
  if (!doc || typeof doc !== 'object') {
    return fetcher()
  }
  let lookups = lookupsByDoc.get(doc)
  if (!lookups) {
    lookups = new Map()
    lookupsByDoc.set(doc, lookups)
  }
  if (!lookups.has(key)) {
    lookups.set(key, fetcher())
  }
  return lookups.get(key)
}

// Checks that --offline kept from looking something up, for each document being checked, so
// that one finding per document can say which didn't run (see validateLookupFailures)
const skippedByDoc = new WeakMap()

/**
 * Record that --offline kept a check from making the remote lookups it needs for the document
 * being checked. Call it only where the check would have looked something up.
 *
 * @param {Object} doc Document being checked
 * @param {string} check Check that didn't run (one of the keys of SKIPPED_CHECKS, see
 *   lib/modules/lookups.mjs)
 */
export function recordSkippedLookup (doc, check) {
  if (!doc || typeof doc !== 'object') {
    return
  }
  if (!skippedByDoc.has(doc)) {
    skippedByDoc.set(doc, new Set())
  }
  skippedByDoc.get(doc).add(check)
}

/**
 * Get the checks --offline kept from looking something up for a document being checked
 *
 * @param {Object} doc Document being checked
 * @returns {Set<string>} Checks (empty if none)
 */
export function getSkippedLookups (doc) {
  if (!doc || typeof doc !== 'object' || !skippedByDoc.has(doc)) {
    return new Set()
  }
  return skippedByDoc.get(doc)
}

// Lookups that failed for each document being checked (not those that answered "no such
// document"), so that one finding per document can say what couldn't be checked and why
// (see validateLookupFailures)
const failuresByDoc = new WeakMap()

/**
 * @typedef {Object} LookupFailures
 * @property {Map<string, {reason: string, uses: Set<string>}>} rfcs RFCs whose rfc-editor.org
 *   lookup failed, by number (or by the value as written, in quotes, when it isn't a
 *   number): why, and what the RFC is to the document ('reference', 'obsoletes', 'updates')
 * @property {Map<string, {reason: string, checks: Set<string>}>} docs Documents whose
 *   Datatracker document lookup failed, by name: why, and the checks that couldn't run
 * @property {Map<string, {reason: string, uses: Set<string>}>} drafts Drafts cited by the
 *   document whose Datatracker doc.json lookup failed, by name (without revision): why, and what
 *   the draft is to the document ('reference', and 'normative' for a normative reference)
 */

/**
 * Get the lookups that failed for a document being checked
 *
 * @param {Object} doc Document being checked
 * @returns {LookupFailures} Failed lookups (empty if none failed)
 */
export function getLookupFailures (doc) {
  const isDocument = Boolean(doc) && typeof doc === 'object'
  if (isDocument && failuresByDoc.has(doc)) {
    return failuresByDoc.get(doc)
  }
  const failures = { rfcs: new Map(), docs: new Map(), drafts: new Map() }
  if (isDocument) {
    failuresByDoc.set(doc, failures)
  }
  return failures
}

/**
 * Record that an rfc-editor.org lookup failed for a document being checked
 *
 * @param {Object} doc Document being checked
 * @param {string|number} rfcNumber RFC number (any leading zeros or "RFC" prefix are dropped;
 *   another value is kept as written, in quotes)
 * @param {string} use What the RFC is to the document: 'reference', 'obsoletes' or 'updates'
 * @param {string} reason Why the lookup failed
 */
export function recordRfcLookupFailure (doc, rfcNumber, use, reason) {
  // -> A value that isn't an RFC number (e.g. obsoletes="draft-foo-00") is kept as written, in quotes
  const written = String(rfcNumber).trim()
  const numberMatch = written.match(/^(?:RFC\s*)?([0-9]+)$/i)
  let number = `"${written}"`
  if (numberMatch) {
    number = trimStart(numberMatch[1], '0') || '0'
  }
  const { rfcs } = getLookupFailures(doc)
  if (!rfcs.has(number)) {
    rfcs.set(number, { reason, uses: new Set() })
  }
  rfcs.get(number).uses.add(use)
}

/**
 * Get the Datatracker document info (/api/v1/doc/document/<name>/) of a document, recording a
 * failed lookup for the document being checked, with the check that couldn't run
 *
 * @param {Object} doc Document being checked
 * @param {string} docName Name of the document to look up (draft name or rfcNNNN)
 * @param {string} check Name of the check making the lookup, for the finding (e.g. 'revision')
 * @returns {Promise<Object|null|undefined>} Document info, null if Datatracker doesn't have the
 *   document, undefined if the lookup failed
 */
export async function getDocInfo (doc, docName, check) {
  const { value, error } = await lookupRemoteDocInfo(docName)
  if (error !== undefined && doc && typeof doc === 'object') {
    const name = docName.replace(/-[0-9]{2}$/, '')
    const { docs } = getLookupFailures(doc)
    if (!docs.has(name)) {
      docs.set(name, { reason: error, checks: new Set() })
    }
    docs.get(name).checks.add(check)
  }
  return value
}

/**
 * Record that the Datatracker lookup of a draft cited by the document failed
 *
 * @param {Object} doc Document being checked
 * @param {string} name Draft name, as looked up
 * @param {string} use What the draft is to the document: 'reference' or 'normative'
 * @param {string} reason Why the lookup failed
 */
function recordDraftLookupFailure (doc, name, use, reason) {
  if (!doc || typeof doc !== 'object') {
    return
  }
  const { drafts } = getLookupFailures(doc)
  if (!drafts.has(name)) {
    drafts.set(name, { reason, uses: new Set() })
  }
  drafts.get(name).uses.add(use)
}

/**
 * Get the Datatracker doc.json of a draft cited by the document, once per document being checked.
 * The name is looked up as given: the caller has already taken off the revision the citation gives
 * (see citedDraftName in modules/downref.mjs), and the names of the drafts that replaced it come
 * from Datatracker. A failed lookup is recorded for the document (see getLookupFailures).
 *
 * @param {Object} doc Document being checked
 * @param {string} name Draft name, without revision
 * @param {string|null} [use='reference'] What the draft is to the document, for a failed lookup:
 *   'reference', or 'normative' for a normative reference; null not to record a failed lookup
 * @returns {Promise<Object|null|undefined>} Datatracker doc.json, null if Datatracker doesn't have
 *   the draft, undefined if the lookup failed
 */
export async function getDocInfoJson (doc, name, use = 'reference') {
  const { value, error } = await lookupOnce(doc, `doc:${name}`, () => lookupRemoteDocInfoJson(name))
  if (error !== undefined && use) {
    recordDraftLookupFailure(doc, name, use, error)
  }
  return value
}

/**
 * Get the rfc-editor.org info of an RFC cited by the document, once per document being checked.
 * A failed lookup is recorded for the document (see getLookupFailures).
 *
 * @param {Object} doc Document being checked
 * @param {string|number} rfcNumber RFC number, with or without leading zeros
 * @returns {Promise<Object|null|undefined>} RFC info, null if rfc-editor.org has no such RFC,
 *   undefined if the lookup failed
 */
export async function getRfcInfo (doc, rfcNumber) {
  const number = trimStart(String(rfcNumber), '0')
  const { value, error } = await lookupOnce(doc, `rfc:${number}`, () => lookupRemoteRfcInfo(number))
  if (error !== undefined) {
    recordRfcLookupFailure(doc, number, 'reference', error)
  }
  return value
}

// Longest chain of replacements followed, well above any seen in Datatracker
export const MAX_REPLACEMENT_CHAIN = 10

/**
 * @typedef {Object} DraftChainEnd
 * @property {string} kind 'rfc' when the chain ends in a published RFC, 'draft' when it ends in
 *                         a draft, 'unknown' when the cited draft can't be fetched
 * @property {string} [rfc] RFC number, for kind 'rfc'
 * @property {string} [name] Name of the last draft of the chain, for kind 'draft'
 * @property {string|null} [intendedStatus] Intended status of that draft, for kind 'draft'
 */

/**
 * Follow a draft through the drafts that replaced it, to the RFC it was published as or the
 * last draft of the chain, using Datatracker's doc.json: its state ('Replaced', 'RFC'...) and its
 * revision history, which lists the revisions of the drafts that replaced it and the RFC they
 * were published as, in order of publication.
 *
 * A chain that loops or is longer than MAX_REPLACEMENT_CHAIN ends at the last draft reached.
 *
 * @param {Object} doc Document being checked, for sharing lookups
 * @param {string} draftName Name of the cited draft, without revision
 * @param {string} [use='normative'] What the draft is to the document, for a failed lookup
 * @returns {Promise<{ chain: string[], end: DraftChainEnd }>} Drafts of the chain, starting
 *          with the cited one, and where the chain ends
 */
export async function resolveDraftChain (doc, draftName, use = 'normative') {
  const chain = [draftName]

  while (true) {
    const name = chain[chain.length - 1]
    const info = await getDocInfoJson(doc, name, use)
    if (!info?.state) {
      return chain.length === 1
        ? { chain, end: { kind: 'unknown' } }
        : { chain, end: { kind: 'draft', name, intendedStatus: null } }
    }

    const history = info.rev_history ?? []
    const later = history.slice(history.findLastIndex(entry => entry.name === name) + 1)
    const state = info.state.toLowerCase()

    if (state === 'rfc') {
      const rfc = later.find(entry => /^rfc\d+$/i.test(entry.name ?? ''))?.name
      if (rfc) {
        return { chain, end: { kind: 'rfc', rfc: trimStart(rfc.slice(3), '0') } }
      }
    } else if (state === 'replaced' && chain.length < MAX_REPLACEMENT_CHAIN) {
      const next = later.find(entry => entry.name?.startsWith('draft-') && !chain.includes(entry.name))?.name
      if (next) {
        chain.push(next)
        continue
      }
    }

    return { chain, end: { kind: 'draft', name, intendedStatus: info.intended_std_level || null } }
  }
}
