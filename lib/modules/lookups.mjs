import { ValidationComment } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { getLookupFailures, getSkippedLookups } from '../remote/lookups.mjs'

// Order in which the checks that use the Datatracker document lookup are named
const DOCUMENT_LOOKUP_CHECKS = ['revision', 'stream', 'submission type', 'cross-stream', 'ipr']

// Checks that --offline can keep from running, in the order they are named, with their names
export const SKIPPED_CHECKS = {
  'reference status': 'status and obsolescence of the cited RFCs',
  downrefs: 'downrefs (including the Downref Registry)',
  'cited drafts': 'states of the cited drafts (newer revisions, replacement, publication as an RFC)',
  'obsoletes-updates': 'status of the RFCs this document obsoletes or updates',
  'cross-stream': 'streams of the RFCs this document obsoletes or updates',
  revision: "this document's revision on Datatracker",
  stream: "this document's stream on Datatracker",
  'submission type': "this document's stream on Datatracker, against its submissionType",
  ipr: "this document's stream on Datatracker, for its ipr value"
}

/**
 * Join words as an English list: "a", "a and b", "a, b and c"
 *
 * @param {string[]} items Words
 * @returns {string} List
 */
function joinList (items) {
  if (items.length < 2) {
    return items[0]
  }
  const allButLast = items.slice(0, -1).join(', ')
  const last = items[items.length - 1]
  return `${allButLast} and ${last}`
}

/**
 * Describe the reasons of failed lookups: the one reason when they all failed the same way,
 * otherwise each item with its reason
 *
 * @param {Array<{label: string, reason: string}>} items Items whose lookup failed
 * @returns {{list: string, reasons: string}} Items, and the reason in brackets when shared
 */
function describeFailures (items) {
  const reasons = new Set(items.map(item => item.reason))
  if (reasons.size === 1) {
    const labels = items.map(item => item.label)
    return { list: joinList(labels), reasons: ` (${items[0].reason})` }
  }
  const labelsWithReasons = items.map(item => `${item.label} (${item.reason})`)
  return { list: joinList(labelsWithReasons), reasons: '' }
}

/**
 * Tell whether a key of the failed RFC lookups is an RFC number (and not a value kept as written)
 *
 * @param {string} key Key of a failed RFC lookup
 * @returns {boolean} Whether it is an RFC number
 */
function isRfcNumber (key) {
  return /^[0-9]+$/.test(key)
}

/**
 * Order the keys of the failed RFC lookups: RFC numbers first, by number, then the values kept
 * as written, alphabetically
 *
 * @param {string} a Key
 * @param {string} b Key
 * @returns {number} Sort order
 */
function compareRfcKeys (a, b) {
  const aIsNumber = isRfcNumber(a)
  const bIsNumber = isRfcNumber(b)
  if (aIsNumber && bIsNumber) {
    return Number(a) - Number(b)
  }
  if (aIsNumber) {
    return -1
  }
  if (bIsNumber) {
    return 1
  }
  return a.localeCompare(b)
}

/**
 * Name a failed RFC lookup in REFERENCE_STATUS_UNAVAILABLE, saying when the RFC is in the
 * document's Obsoletes or Updates
 *
 * @param {string} key Key of the failed RFC lookup (RFC number, or a value kept as written)
 * @param {Set<string>} uses What the RFC is to the document ('reference', 'obsoletes', 'updates')
 * @returns {string} Label
 */
function rfcLabel (key, uses) {
  let name = key
  if (isRfcNumber(key)) {
    name = `RFC ${key}`
  }
  const listed = []
  if (uses.has('obsoletes')) {
    listed.push('Obsoletes')
  }
  if (uses.has('updates')) {
    listed.push('Updates')
  }
  if (listed.length === 0) {
    return name
  }
  return `${name} (in ${joinList(listed)})`
}

/**
 * Report the remote lookups made for the document that failed, once per document, after all the
 * checks using them have run (the checks run concurrently and share the lookups).
 *
 * A lookup that failed (network error, timeout, an HTTP error other than 404/410) says nothing
 * about the document, so the checks that needed it don't report anything; this says which
 * couldn't run and why, as DOWNREF_REGISTRY_UNAVAILABLE does for the Downref Registry. A lookup
 * that --offline skipped is not a failure: --offline makes no lookup, so neither is ever given.
 *
 * | Code                         | normal  | forgive-checklist | submission |
 * |------------------------------|---------|-------------------|------------|
 * | REFERENCE_STATUS_UNAVAILABLE | Comment | Comment           | -          |
 * | DOCUMENT_LOOKUP_UNAVAILABLE  | Comment | Comment           | Comment    |
 *
 * REFERENCE_STATUS_UNAVAILABLE lists the RFCs cited by the document, or listed in its Obsoletes
 * and Updates metadata, whose rfc-editor.org lookup failed, and the drafts cited by the document
 * whose Datatracker lookup failed (which then get no UNDEFINED_STATE). DOCUMENT_LOOKUP_UNAVAILABLE names
 * the documents whose Datatracker document lookup failed, and the checks that couldn't run
 * (revision, stream, submission type, cross-stream, ipr).
 *
 * With --offline, nothing is looked up, so nothing fails; instead, one LOOKUPS_SKIPPED_OFFLINE comment
 * (in every mode) names the checks that would have looked something up for this document in this
 * mode and didn't run. A document none of them applies to gets none.
 *
 * @param {Object} doc Document checked
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {boolean} [opts.offline=false] Whether the lookups were skipped
 * @returns {Array} List of comments, or empty if no lookup failed or was skipped
 */
export async function validateLookupFailures (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []

  if (offline) {
    const skipped = getSkippedLookups(doc)
    const skippedChecks = Object.keys(SKIPPED_CHECKS).filter(check => skipped.has(check))
    const checks = skippedChecks.map(check => SKIPPED_CHECKS[check])
    if (checks.length > 0) {
      const subject = checks.length > 1 ? 'these checks' : 'this check'
      const message = `With --offline, nothing was looked up on Datatracker or the RFC Editor site, so ${subject} didn't run: ${checks.join('; ')}.`
      result.push(new ValidationComment('LOOKUPS_SKIPPED_OFFLINE', message))
    }
  }
  // -> Only lookups that were attempted and failed are recorded (--offline makes none)
  const { rfcs, docs, drafts } = getLookupFailures(doc)

  const unavailable = []
  if (rfcs.size > 0 && mode !== MODES.SUBMISSION) {
    const keys = [...rfcs.keys()].sort(compareRfcKeys)
    const items = []
    let cited = 0
    let listed = 0
    for (const key of keys) {
      const { reason, uses } = rfcs.get(key)
      items.push({ label: rfcLabel(key, uses), reason })
      if (uses.has('reference')) {
        cited++
      }
      if (uses.has('obsoletes') || uses.has('updates')) {
        listed++
      }
    }
    const { list, reasons } = describeFailures(items)
    const unchecked = []
    if (cited > 1) {
      unchecked.push('the references to them weren\'t checked for downrefs or obsolete RFCs')
    } else if (cited === 1) {
      unchecked.push('the reference to it wasn\'t checked for downrefs or obsolete RFCs')
    }
    if (listed > 1) {
      unchecked.push('the RFCs this document obsoletes or updates weren\'t checked against rfc-editor.org')
    } else if (listed === 1) {
      unchecked.push('the RFC this document obsoletes or updates wasn\'t checked against rfc-editor.org')
    }
    const consequences = unchecked.join(', and ')
    unavailable.push(`The status of ${list} couldn't be fetched from rfc-editor.org${reasons}, so ${consequences}.`)
  }

  if (drafts.size > 0 && mode !== MODES.SUBMISSION) {
    const names = [...drafts.keys()].sort((a, b) => a.localeCompare(b))
    const items = []
    let normative = false
    for (const name of names) {
      const { reason, uses } = drafts.get(name)
      items.push({ label: name, reason })
      if (uses.has('normative')) {
        normative = true
      }
    }
    const { list, reasons } = describeFailures(items)
    const checks = ['newer revisions', 'replacement', 'publication as an RFC']
    if (normative) {
      checks.push('downrefs')
    }
    const allButLast = checks.slice(0, -1).join(', ')
    const last = checks[checks.length - 1]
    const what = `${allButLast} or ${last}`
    if (names.length > 1) {
      unavailable.push(`The state of the cited drafts ${list} couldn't be fetched from Datatracker${reasons}, so the references to them weren't checked for ${what}.`)
    } else {
      unavailable.push(`The state of the cited draft ${list} couldn't be fetched from Datatracker${reasons}, so the reference to it wasn't checked for ${what}.`)
    }
  }

  if (unavailable.length > 0) {
    const message = unavailable.join(' ')
    result.push(new ValidationComment('REFERENCE_STATUS_UNAVAILABLE', message))
  }

  if (docs.size > 0) {
    // -> Sorted, as the checks run concurrently: the order in which the lookups failed varies
    const docNames = [...docs.keys()].sort((a, b) => a.localeCompare(b))
    const items = []
    const checksNotRun = new Set()
    for (const name of docNames) {
      const { reason, checks } = docs.get(name)
      items.push({ label: name, reason })
      for (const check of checks) {
        checksNotRun.add(check)
      }
    }
    const checks = DOCUMENT_LOOKUP_CHECKS.filter(check => checksNotRun.has(check))
    const { list, reasons } = describeFailures(items)
    let checksIntro = 'this check'
    if (checks.length > 1) {
      checksIntro = 'these checks'
    }
    const message = `Datatracker couldn't be asked about ${list}${reasons}, so ${checksIntro} didn't run: ${checks.join(', ')}.`
    result.push(new ValidationComment('DOCUMENT_LOOKUP_UNAVAILABLE', message))
  }

  return result
}
