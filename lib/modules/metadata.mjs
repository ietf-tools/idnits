import { ValidationComment, ValidationWarning } from '../helpers/error.mjs'
import { getDocInfo, getRfcInfo, prefetchRfcInfo, recordSkippedLookup } from '../remote/lookups.mjs'
import { MODES } from '../config/modes.mjs'
import { fetchDatatrackerStream, getDocumentStream, streamDisplayName } from '../helpers/stream.mjs'
import { uniq } from 'lodash-es'

import { CERTAINTY } from '../model/indexes.mjs'
import { getCategory, getDate, getDocName, getRelationMentions, getRelations } from '../model/metadata.mjs'

const RFC_NUM_RE_GENERAL = /[0-9]+/
const RFC_NUM_RE = /[0-9]+/g
const VERSION_SUFFIX_RE = /-([0-9]{2})$/

// The relations a document can list, in the order they are checked
const RELATIONS = ['obsoletes', 'updates']

// How the messages name each relation: the text header line, and how an RFC is listed in metadata or
// mentioned in the abstract
const RELATION_WORDS = {
  obsoletes: { headerLine: 'Obsoletes', listedAs: '"obsoleted"', mentionedAs: '"obsoleted" or "replaced"' },
  updates: { headerLine: 'Updates', listedAs: '"updated"', mentionedAs: '"updated"' }
}

/**
 * Format an RFC list from rfc-editor.org, e.g. ["RFC3261", "RFC9000"], as "RFC 3261, RFC 9000".
 * The values already carry the "RFC" prefix.
 *
 * @param {Array<string>} rfcs RFC names, "RFC3261" or "3261"
 * @returns {string} The list for a message
 */
function formatRfcList (rfcs) {
  return rfcs.map(rfc => `RFC ${String(rfc).replace(/^RFC\s*/i, '')}`).join(', ')
}

/**
 * Warnings for the values of the <rfc> obsoletes or updates attribute that are neither an RFC number
 * nor an Internet-Draft name
 *
 * @param {Array<{value: string, rfcs: Array<string>}>} others Values, from getRelations
 * @param {string} attr Attribute name: 'obsoletes' or 'updates'
 * @returns {Array<ValidationWarning>} Warnings
 */
function notRfcNumberWarnings (others, attr) {
  return others.map(({ value, rfcs }) => {
    let readAs = ''
    if (rfcs.length > 0) {
      readAs = ` (read as ${formatRfcList(rfcs)})`
    }
    const message = `The <rfc> ${attr} attribute lists "${value}", which is not an RFC number${readAs}. The attribute is a comma-separated list of RFC numbers or Internet-Draft names.`
    return new ValidationWarning(`${attr.toUpperCase()}_NOT_RFC_NUMBER`, message, {
      ref: `https://authors.ietf.org/en/rfcxml-vocabulary#${attr}`,
      path: `rfc.${attr}`
    })
  })
}

/**
 * Validate document date
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateDate (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const DATE_THRESHOLD = 3
  const docDate = getDate(doc)
  const opts = { ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date', ...docDate.location }

  if (!docDate.present) {
    if (docDate.certainty === CERTAINTY.DECLARED) {
      // RFC 7998 Section 5.2.3: the prep tool inserts a missing <date>
      result.push(new ValidationComment('MISSING_DATE_ELEMENT', 'The document has no <date> element. The current date will be filled in when the document is prepared.', opts))
    } else {
      result.push(new ValidationWarning('MISSING_DOC_DATE', 'The document date could not be determined.', opts))
    }
    return result
  }
  if (!docDate.date) {
    result.push(new ValidationWarning('MISSING_DOC_DATE', 'The document date could not be determined.', opts))
    return result
  }

  const daysDiff = Math.round(docDate.date.diffNow().as('days'))
  if (daysDiff < -DATE_THRESHOLD) {
    result.push(new ValidationWarning('DOC_DATE_IN_PAST', `The document date is ${daysDiff * -1} days in the past. Is this intentional?`, opts))
  } else if (daysDiff > DATE_THRESHOLD) {
    result.push(new ValidationWarning('DOC_DATE_IN_FUTURE', `The document date is ${daysDiff} days in the future. Is this intentional?`, opts))
  }

  return result
}

/**
 * Message for a document that gives no category
 *
 * @param {Object} doc Document to validate
 * @param {Object} category Its category (see getCategory)
 * @returns {string} The message
 */
function missingCategoryMessage (doc, category) {
  if (category.certainty === CERTAINTY.DECLARED) {
    return 'The <rfc> element has no category attribute, which gives the document\'s (intended) status.'
  }
  // An RFC states its category on the Category: line, a draft its intended status on the Intended
  // status: line. A draft that gives its status on a Category: line, as an RFC does, still has no
  // intended status.
  if (doc.docKind === 'rfc') {
    return 'The RFC has no Category: line.'
  }
  if (category.misplacedValue) {
    return 'The draft gives its status on a Category: line; Internet-Drafts use an Intended status: line.'
  }
  return 'The draft has no Intended status: line.'
}

/**
 * Validate document category (status / intended status)
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateCategory (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const category = getCategory(doc)
  const opts = { ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#category', ...category.location }

  if (!category.value) {
    result.push(new ValidationWarning('MISSING_DOC_CATEGORY', missingCategoryMessage(doc, category), opts))
  } else if (!category.known) {
    // -> The allowed values as the document writes them
    let allowed = 'Standards Track, Best Current Practice, Informational, Experimental and Historic'
    if (category.certainty === CERTAINTY.DECLARED) {
      allowed = 'std, bcp, info, exp and historic'
    }
    result.push(new ValidationWarning('INVALID_DOC_CATEGORY', `The document category has an invalid value. Allowed values are ${allowed}.`, opts))
  }

  return result
}

/**
 * Finding for an RFC of another stream, or maybe of another stream, that a document obsoletes or updates
 *
 * @param {boolean} certain Whether both streams are known (and differ)
 * @param {string} message Message of the finding
 * @param {Object} opts Options of the finding (ref, path or lines)
 * @returns {ValidationWarning|ValidationComment} The finding
 */
function crossStreamFinding (certain, message, opts) {
  if (certain) {
    return new ValidationWarning('CROSS_STREAM_OBSOLETES_UPDATES', message, opts)
  }
  return new ValidationComment('POSSIBLE_CROSS_STREAM_OBSOLETES_UPDATES', message, opts)
}

/**
 * Check whether the RFCs a document obsoletes or updates are in its stream
 *
 * The stream of each RFC comes from Datatracker, the stream of the document
 * from getDocumentStream. RFCs Datatracker doesn't know (or has no stream for)
 * are not checked.
 *
 * | RFC stream | Document stream | Finding                                            |
 * |------------|-----------------|----------------------------------------------------|
 * | Legacy     | any             | POSSIBLE_CROSS_STREAM_OBSOLETES_UPDATES (Comment)  |
 * | other      | same            | -                                                  |
 * | other      | different       | CROSS_STREAM_OBSOLETES_UPDATES (Warning)           |
 * | other      | unknown         | POSSIBLE_CROSS_STREAM_OBSOLETES_UPDATES (Comment)  |
 *
 * @param {Object} doc Document to validate
 * @param {Object} refs RFC numbers the document obsoletes and updates
 * @param {Array<string>} refs.obsoletes RFC numbers the document obsoletes
 * @param {Array<string>} refs.updates RFC numbers the document updates
 * @returns {Promise<Array>} List of CROSS_STREAM_OBSOLETES_UPDATES and POSSIBLE_CROSS_STREAM_OBSOLETES_UPDATES findings
 */
async function checkCrossStream (doc, { obsoletes, updates }) {
  const result = []
  let ownStream

  for (const [verb, refs] of [['obsolete', obsoletes], ['update', updates]]) {
    const attr = `${verb}s`
    // -> Located where the document lists the relation
    const { location } = getRelations(doc, attr)
    for (const ref of refs) {
      const target = (await fetchDatatrackerStream(`rfc${ref}`, { doc, check: 'cross-stream', cited: true }))?.stream
      if (!target) {
        continue
      }
      const findingOpts = { ref: `https://authors.ietf.org/en/rfcxml-vocabulary#${attr}`, ...location }

      // -> Legacy RFCs predate the streams: nothing to compare with
      if (target === 'legacy') {
        result.push(crossStreamFinding(false, `This document attempts to ${verb} RFC ${ref}, which is in the Legacy stream (published before the current RFC streams were defined). Check whether specific rules apply to this process.`, findingOpts))
        continue
      }

      if (ownStream === undefined) {
        ownStream = await getDocumentStream(doc, { check: 'cross-stream' })
      }
      // -> Stream of this document unknown
      if (!ownStream) {
        result.push(crossStreamFinding(false, `This document attempts to ${verb} RFC ${ref}, which is in the ${streamDisplayName(target)} stream. If this document is not in that stream, specific rules may apply to this process, and you will need sign-off from both stream heads before this document can proceed.`, findingOpts))
      // -> Different streams
      } else if (ownStream !== target) {
        result.push(crossStreamFinding(true, `This document (${streamDisplayName(ownStream)} stream) attempts to ${verb} RFC ${ref}, an RFC from another stream (${streamDisplayName(target)}). Specific rules may apply to this process, and you will need sign-off from both stream heads before this document can proceed.`, findingOpts))
      }
    }
  }

  return result
}

/**
 * Findings for the RFCs a document lists as obsoleted or updated that its abstract doesn't mention, and
 * for those the abstract states but the document doesn't list
 *
 * The code and message follow from how certain the list is: declared (XML attributes) gives
 * OBSOLETES_NOT_IN_ABSTRACT and OBSOLETES_NOT_IN_RFC (Warnings), inferred (text header lines) gives
 * POSSIBLE_OBSOLETES_NOT_IN_ABSTRACT and MENTIONED_NOT_IN_OBSOLETES (Comments); likewise for updates.
 * RFCs are compared by number: the abstract's "RFC 0793" and the header's "793" name the same RFC.
 *
 * @param {Object} relation RFCs the document lists (see getRelations)
 * @param {Object} mentions RFCs its abstract mentions (see getRelationMentions)
 * @returns {{notMentioned: Array, notListed: Array}} Findings
 */
function abstractRelationFindings (relation, mentions) {
  const ref = 'https://authors.ietf.org/en/required-content#abstract'
  const kind = relation.kind
  const code = kind.toUpperCase()
  const words = RELATION_WORDS[kind]
  const declared = relation.certainty === CERTAINTY.DECLARED
  const sameRfc = (list, rfc) => list.some(num => Number(num) === Number(rfc))
  const listedRfcs = relation.rfcs.map(listed => listed.rfc)

  const notMentioned = relation.rfcs.filter(listed => !sameRfc(mentions.mentioned, listed.rfc)).map(listed => {
    if (declared) {
      return new ValidationWarning(`${code}_NOT_IN_ABSTRACT`, `The document states that it ${kind} RFC ${listed.rfc} but doesn't explicitly mention it in the <abstract> section.`, {
        ref,
        ...mentions.location
      })
    }
    // -> Located where the header line lists the RFC
    return new ValidationComment(`POSSIBLE_${code}_NOT_IN_ABSTRACT`, `RFC ${listed.rfc} is listed as ${words.listedAs} in metadata but is not mentioned in the abstract.`, {
      ref,
      ...listed.location
    })
  })

  const notListed = mentions.stated.filter(rfc => !sameRfc(listedRfcs, rfc)).map(rfc => {
    if (declared) {
      return new ValidationWarning(`${code}_NOT_IN_RFC`, `The document abstract states that it ${kind} RFC ${rfc} but it's not mentioned in the ${kind} <rfc> field.`, {
        ref,
        ...mentions.location
      })
    }
    // -> Located at the abstract (its heading line)
    return new ValidationComment(`MENTIONED_NOT_IN_${code}`, `RFC ${rfc} is mentioned as ${words.mentionedAs} in the abstract but not listed in metadata.`, {
      ref,
      ...mentions.location
    })
  })

  return { notMentioned, notListed }
}

/**
 * Look up the RFCs a document lists as obsoleted or updated on rfc-editor.org, for those that don't
 * exist, are already obsoleted or, for updates, are already updated
 *
 * @param {Object} doc Document to validate
 * @param {Object} relation RFCs the document lists (see getRelations)
 * @returns {Promise<Array>} Findings
 */
async function lookupRelationFindings (doc, relation) {
  const result = []
  if (relation.rfcs.length === 0) {
    return result
  }
  const kind = relation.kind
  const code = kind.toUpperCase()
  const declared = relation.certainty === CERTAINTY.DECLARED
  const lookups = relation.rfcs.filter(listed => RFC_NUM_RE_GENERAL.test(listed.rfc))
  prefetchRfcInfo(doc, lookups.map(listed => listed.rfc))
  for (const { rfc, location } of lookups) {
    // -> Located where the document lists the RFC: on the header line for text, at the attribute for XML
    const opts = { ref: `https://authors.ietf.org/en/rfcxml-vocabulary#${kind}`, ...location }
    let listedAt = `The ${RELATION_WORDS[kind].headerLine} header line lists RFC ${rfc}`
    if (declared) {
      listedAt = `The <rfc> field states that it ${kind} RFC ${rfc}`
    }
    const rfcInfo = await getRfcInfo(doc, rfc, kind)
    if (rfcInfo === undefined) {
      // -> Lookup failed or not made: nothing known about this RFC (REFERENCE_STATUS_UNAVAILABLE
      //    or LOOKUP_LIMIT_REACHED says so)
    } else if (!rfcInfo) {
      result.push(new ValidationWarning(`${code}_RFC_NOT_FOUND`, `${listedAt} but no matching RFC could be found on rfc-editor.org.`, opts))
    } else if (rfcInfo.obsoleted_by?.length > 0) {
      result.push(new ValidationWarning(`${code}_OBSOLETED_RFC`, `${listedAt} but it's already obsoleted by ${formatRfcList(rfcInfo.obsoleted_by)}.`, opts))
    } else if (kind === 'updates' && rfcInfo.updated_by?.length > 0) {
      result.push(new ValidationWarning('UPDATES_UPDATED_RFC', `This document updates RFC ${rfc}. That RFC is already updated by ${formatRfcList(rfcInfo.updated_by)}. Verify that this document does not conflict with those.`, opts))
    }
  }
  return result
}

/**
 * Validate that the document updates / obsoletes another document correctly
 *
 * In submission mode, only the cross-stream check (see checkCrossStream) runs.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {boolean} [opts.offline=false] Disable checks that require an internet connection
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateObsoleteUpdateRef (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []
  const relations = RELATIONS.map(kind => getRelations(doc, kind))

  // -> Obsoletes / updates an RFC of another stream
  let crossStream = []
  const rfcNumbers = relation => uniq(relation.rfcs.flatMap(listed => String(listed.rfc).match(RFC_NUM_RE) ?? []).map(Number))
  const listed = {
    obsoletes: rfcNumbers(relations[0]),
    updates: rfcNumbers(relations[1])
  }
  if (!offline) {
    crossStream = await checkCrossStream(doc, listed)
  } else if (listed.obsoletes.length > 0 || listed.updates.length > 0) {
    // -> The streams of the RFCs come from Datatracker (in every mode), their status from
    //    rfc-editor.org (not in submission)
    recordSkippedLookup(doc, 'cross-stream')
    if (mode !== MODES.SUBMISSION) {
      recordSkippedLookup(doc, 'obsoletes-updates')
    }
  }

  if (mode === MODES.SUBMISSION) {
    return crossStream
  }

  // -> Values that are neither an RFC number nor an Internet-Draft name (XML only: the text parser keeps
  //    only numbers)
  for (const relation of relations) {
    result.push(...notRfcNumberWarnings(relation.others, relation.kind))
  }

  // -> RFCs listed but not mentioned in the abstract, and stated in the abstract but not listed
  const abstractFindings = []
  for (const relation of relations) {
    abstractFindings.push(abstractRelationFindings(relation, await getRelationMentions(doc, relation.kind)))
  }
  // -> Kept as before: declared (XML) findings in order of relation, inferred (text) findings in order of
  //    kind of finding
  if (relations[0].certainty === CERTAINTY.DECLARED) {
    for (const { notMentioned, notListed } of abstractFindings) {
      result.push(...notMentioned, ...notListed)
    }
  } else {
    result.push(...abstractFindings.flatMap(findings => findings.notMentioned))
    result.push(...abstractFindings.flatMap(findings => findings.notListed))
  }

  // -> Obsoletes or updates an RFC that doesn't exist or is already obsoleted
  if (!offline) {
    for (const relation of relations) {
      result.push(...await lookupRelationFindings(doc, relation))
    }
  }

  result.push(...crossStream)
  return result
}

/**
 * Validate document version
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {boolean} [opts.offline=false] Disable checks that require an internet connection
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateVersion (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []

  if (mode !== MODES.SUBMISSION) {
    return result
  }
  const { name: docName, certainty, location } = getDocName(doc)
  if (offline) {
    // -> Only a name with a revision is looked up
    if (VERSION_SUFFIX_RE.test(docName ?? '')) {
      recordSkippedLookup(doc, 'revision')
    }
    return result
  }

  const versionMatch = docName?.match(VERSION_SUFFIX_RE)
  if (!versionMatch?.[1]) {
    return result
  }
  const docInfo = await getDocInfo(doc, docName, 'revision')
  if (docInfo && docInfo.rev) {
    const opts = { ...location, ref: `https://datatracker.ietf.org/doc/${docInfo.name}` }
    const latestVersion = parseInt(docInfo.rev)
    const docVersion = parseInt(versionMatch[1])
    if (latestVersion === docVersion) {
      let message = 'A document with this name and version already exists in the Internet-Draft repository.'
      if (certainty === CERTAINTY.DECLARED) {
        message = 'A document with this version already exists in the Internet-Draft repository.'
      }
      result.push(new ValidationWarning('DUPLICATE_DOC_VERSION', message, opts))
    } else if (latestVersion > docVersion) {
      result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version in the Internet-Draft repository is ${latestVersion} but your document is ${docVersion}.`, opts))
    } else if (docVersion > latestVersion + 1) {
      result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version in the Internet-Draft repository is ${latestVersion} but your document is ${docVersion} and leaves a gap.`, opts))
    }
  } else if (docInfo === null && versionMatch[1] !== '00') {
    result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', 'The document version is unexpected. As no document with this name exists in the Internet-Draft repository, it should be version 00.', location))
  }

  return result
}
