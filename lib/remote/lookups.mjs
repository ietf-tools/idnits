import { trimStart } from 'lodash-es'
import { isLookupName, lookupRemoteDocInfo, lookupRemoteDocInfoJson, lookupRemoteRfcInfo, ownDocLookupName } from './common.mjs'

// Most remote lookups of other documents made for one document being checked. Of 15,536
// documents checked (drafts, and RFCs in XML and text), the one needing the most is RFC 8996,
// with 199 (the RFCs it cites, obsoletes and updates, on rfc-editor.org and Datatracker); the
// most for a draft is 128. A document needing more gets the first ones, and one finding names the
// others (see getLookupsNotMade), so that no document can make a service answer thousands of
// requests.
export const MAX_LOOKUPS_PER_DOC = 1000

// Most remote lookups of one document in flight at once. The checks go through the references
// one at a time, starting the lookups of the whole list first (see prefetchRfcInfo), so that a
// slow service costs each document a few round trips instead of one per reference.
export const MAX_CONCURRENT_LOOKUPS_PER_DOC = 3

// Remote lookups made for each document being checked, as several checks run concurrently over
// the same references. Keyed by the document, so the lookups of a run go away with it and a new
// run fetches fresh data.
const lookupsByDoc = new WeakMap()

/**
 * @typedef {Object} DocLookups
 * @property {Map<string, Promise>} outcomes Outcome of each lookup, by key (one per key)
 * @property {number} made Number of lookups started (at most MAX_LOOKUPS_PER_DOC)
 * @property {number} active Number of lookups in flight
 * @property {Function[]} waiting Lookups waiting for one in flight to end
 * @property {Map<string, string>} notMade Lookups not made, beyond MAX_LOOKUPS_PER_DOC: their
 *   names, by key
 */

/**
 * Get the lookups of a document being checked
 *
 * @param {Object} doc Document being checked
 * @returns {DocLookups} Its lookups
 */
function docLookups (doc) {
  let lookups = lookupsByDoc.get(doc)
  if (!lookups) {
    lookups = { outcomes: new Map(), made: 0, active: 0, waiting: [], notMade: new Map() }
    lookupsByDoc.set(doc, lookups)
  }
  return lookups
}

/**
 * Run a lookup of a document when fewer than MAX_CONCURRENT_LOOKUPS_PER_DOC are in flight, or as
 * soon as one of them ends
 *
 * @param {DocLookups} lookups Lookups of the document
 * @param {Function} fetcher Function fetching the data, resolving to a LookupOutcome
 * @returns {Promise<Object>} Outcome of the lookup
 */
function runBounded (lookups, fetcher) {
  return new Promise((resolve) => {
    const start = async () => {
      lookups.active++
      try {
        resolve(await fetcher())
      } catch (err) {
        resolve({ error: err.message })
      } finally {
        lookups.active--
        const next = lookups.waiting.shift()
        if (next) {
          next()
        }
      }
    }
    if (lookups.active < MAX_CONCURRENT_LOOKUPS_PER_DOC) {
      start()
    } else {
      lookups.waiting.push(start)
    }
  })
}

/**
 * Look up remote data once per document being checked, with at most
 * MAX_CONCURRENT_LOOKUPS_PER_DOC lookups in flight and MAX_LOOKUPS_PER_DOC in all, not counting
 * the lookups of the document itself. A lookup beyond that isn't made: its outcome has neither
 * value nor error, as for a failed lookup the checks report nothing, and the name is recorded (see
 * getLookupsNotMade).
 *
 * @param {Object} doc Document being checked
 * @param {string} key Key of the lookup
 * @param {string} name Name of what is looked up, for the finding if the lookup isn't made
 * @param {Function} fetcher Function fetching the data, resolving to a LookupOutcome
 * @param {Object} [opts]
 * @param {boolean} [opts.counted=true] Whether the lookup counts towards MAX_LOOKUPS_PER_DOC:
 *   false for the document itself, and for a name that isn't looked up (see isLookupName in
 *   common.mjs), as it makes no request
 * @returns {Promise<Object>} Outcome of the lookup, shared by all lookups with the same key
 */
function lookupOnce (doc, key, name, fetcher, { counted = true } = {}) {
  if (!doc || typeof doc !== 'object') {
    return fetcher()
  }
  const lookups = docLookups(doc)
  if (!lookups.outcomes.has(key)) {
    if (!counted) {
      lookups.outcomes.set(key, runBounded(lookups, fetcher))
    } else if (lookups.made < MAX_LOOKUPS_PER_DOC) {
      lookups.made++
      lookups.outcomes.set(key, runBounded(lookups, fetcher))
    } else {
      lookups.notMade.set(key, name)
      lookups.outcomes.set(key, Promise.resolve({}))
    }
  }
  return lookups.outcomes.get(key)
}

/**
 * Get the names of what wasn't looked up for a document being checked, as it needed more than
 * MAX_LOOKUPS_PER_DOC lookups
 *
 * @param {Object} doc Document being checked
 * @returns {string[]} Names (e.g. "RFC 1234", "draft-foo-bar"), in the order the lookups were
 *   asked for
 */
export function getLookupsNotMade (doc) {
  if (!doc || typeof doc !== 'object' || !lookupsByDoc.has(doc)) {
    return []
  }
  return [...lookupsByDoc.get(doc).notMade.values()]
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
 *   lookup failed, by number: why, and what the RFC is to the document ('reference', 'obsoletes',
 *   'updates')
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
 * @param {string|number} rfcNumber RFC number (any leading zeros are dropped). Only a number that
 *   was looked up can fail (see isLookupName in common.mjs).
 * @param {string} use What the RFC is to the document: 'reference', 'obsoletes' or 'updates'
 * @param {string} reason Why the lookup failed
 */
export function recordRfcLookupFailure (doc, rfcNumber, use, reason) {
  const number = trimStart(String(rfcNumber), '0')
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
 * @param {Object} [opts]
 * @param {boolean} [opts.cited=false] Whether the document looked up is one the document being
 *   checked names (e.g. an RFC it obsoletes), so that the lookup counts towards
 *   MAX_LOOKUPS_PER_DOC; the document itself is always looked up
 * @returns {Promise<Object|null|undefined>} Document info, null if Datatracker doesn't have the
 *   document, undefined if the lookup failed or wasn't made
 */
export async function getDocInfo (doc, docName, check, { cited = false } = {}) {
  const name = ownDocLookupName(docName)
  const counted = cited && isLookupName(name)
  const { value, error } = await lookupOnce(doc, `docinfo:${name}`, name, () => lookupRemoteDocInfo(docName), { counted })
  if (error !== undefined && doc && typeof doc === 'object') {
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
 *   the draft, undefined if the lookup failed or wasn't made
 */
export async function getDocInfoJson (doc, name, use = 'reference') {
  const { value, error } = await lookupDocInfoJson(doc, name)
  if (error !== undefined && use) {
    recordDraftLookupFailure(doc, name, use, error)
  }
  return value
}

/**
 * Look up the Datatracker doc.json of a draft, once per document being checked
 *
 * @param {Object} doc Document being checked
 * @param {string} name Draft name, without revision
 * @returns {Promise<Object>} Outcome of the lookup (see LookupOutcome in common.mjs)
 */
function lookupDocInfoJson (doc, name) {
  const counted = isLookupName(name)
  return lookupOnce(doc, `doc:${name}`, name, () => lookupRemoteDocInfoJson(name), { counted })
}

/**
 * Start the Datatracker lookups of the drafts a check is about to go through one by one, so that
 * up to MAX_CONCURRENT_LOOKUPS_PER_DOC run at once. Only call it with drafts the check then looks
 * up with getDocInfoJson, whatever their outcome: it makes no lookup the check wouldn't.
 *
 * @param {Object} doc Document being checked
 * @param {string[]} names Draft names, without revision
 */
export function prefetchDocInfoJson (doc, names) {
  if (!doc || typeof doc !== 'object') {
    return
  }
  for (const name of names) {
    lookupDocInfoJson(doc, name)
  }
}

/**
 * Look up the rfc-editor.org info of an RFC, once per document being checked
 *
 * @param {Object} doc Document being checked
 * @param {string} number RFC number, without leading zeros
 * @returns {Promise<Object>} Outcome of the lookup (see LookupOutcome in common.mjs)
 */
function lookupRfcInfo (doc, number) {
  const counted = isLookupName(`rfc${number}`)
  return lookupOnce(doc, `rfc:${number}`, `RFC ${number}`, () => lookupRemoteRfcInfo(number), { counted })
}

/**
 * Start the rfc-editor.org lookups of the RFCs a check is about to go through one by one, so that
 * up to MAX_CONCURRENT_LOOKUPS_PER_DOC run at once. Only call it with RFCs the check then looks up
 * with getRfcInfo, whatever their outcome: it makes no lookup the check wouldn't.
 *
 * @param {Object} doc Document being checked
 * @param {Array<string|number>} rfcNumbers RFC numbers, with or without leading zeros
 */
export function prefetchRfcInfo (doc, rfcNumbers) {
  if (!doc || typeof doc !== 'object') {
    return
  }
  for (const rfcNumber of rfcNumbers) {
    lookupRfcInfo(doc, trimStart(String(rfcNumber), '0'))
  }
}

/**
 * Get the rfc-editor.org info of an RFC cited by the document, or listed in its Obsoletes or
 * Updates metadata, once per document being checked. A failed lookup is recorded for the document
 * (see getLookupFailures).
 *
 * @param {Object} doc Document being checked
 * @param {string|number} rfcNumber RFC number, with or without leading zeros
 * @param {string} [use='reference'] What the RFC is to the document, for a failed lookup:
 *   'reference', 'obsoletes' or 'updates'
 * @returns {Promise<Object|null|undefined>} RFC info, null if rfc-editor.org has no such RFC,
 *   undefined if the lookup failed or wasn't made
 */
export async function getRfcInfo (doc, rfcNumber, use = 'reference') {
  const number = trimStart(String(rfcNumber), '0')
  const { value, error } = await lookupRfcInfo(doc, number)
  if (error !== undefined) {
    recordRfcLookupFailure(doc, number, use, error)
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
