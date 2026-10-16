import { ValidationWarning, ValidationError, ValidationComment } from '../helpers/error.mjs'
import { checkReferencesInDownrefs } from '../remote/downref.mjs'
import { MODES } from '../config/modes.mjs'
import { getStatusCategory } from '../config/rfc-status-hierarchy.mjs'
import { getDocInfoJson, getRfcInfo, resolveDraftChain } from '../remote/lookups.mjs'
import { collectXmlReferences, getCitedDrafts, getCitedRfcs } from '../helpers/xml-references.mjs'
import { castArray, findLast, last, trimStart, uniq } from 'lodash-es'
import { splitDraftName } from '../helpers/common.mjs'

const BCP97_REF = 'https://www.rfc-editor.org/info/bcp97'
const NORMATIVE_REFERENCES_STATEMENT_REF = 'https://datatracker.ietf.org/doc/statement-iesg-iesg-statement-normative-and-informative-references-20060419/'

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
 * @param {Object} doc - Document being checked
 * @returns {Promise<NormativeDraftReference[]>} - Normative draft references, one per draft
 */
export function classifyNormativeDraftReferences (doc) {
  if (!normativeDraftsByDoc.has(doc)) {
    normativeDraftsByDoc.set(doc, resolveNormativeDraftReferences(doc))
  }
  return normativeDraftsByDoc.get(doc)
}

/**
 * Resolve the normative references to Internet-Drafts of a document
 *
 * @param {Object} doc - Document being checked
 * @returns {Promise<NormativeDraftReference[]>} - Normative draft references, one per draft
 */
async function resolveNormativeDraftReferences (doc) {
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
    const name = reference.replace(/-[0-9]{2}$/, '')
    if (!/^draft-/i.test(name) || seen.has(name)) {
      continue
    }
    seen.add(name)
    references.push({ reference, name, ...await resolveDraftChain(doc, name) })
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
 * @returns {Promise<Array>} - Findings
 */
async function checkRfcDownref (doc, rfcNumber, subject, mode) {
  const rfcInfo = await getRfcInfo(doc, rfcNumber)
  const refStatus = getStatusCategory(rfcInfo?.status)

  if (refStatus === null) {
    const message = `${subject} status can't be fetched. Reference is possible downref`
    return mode === MODES.NORMAL
      ? [new ValidationError('POSSIBLE_DOWNREF', message, { ref: BCP97_REF })]
      : [new ValidationWarning('POSSIBLE_DOWNREF', message, { ref: BCP97_REF })]
  }

  const docStatus = getDocStatusCategory(doc)
  if (docStatus === null || refStatus >= docStatus) {
    return []
  }

  const docType = describeDocStatus(doc)
  const isDownref = await checkReferencesInDownrefs([`RFC ${rfcNumber}`])
  if (isDownref.length > 0) {
    return [new ValidationWarning('DOWNREF_TO_LOWER_STATUS_IN_REGISTRY', `Reference to ${subject}, which has a lower status than ${docType} and is listed in the Downref Registry.`, { ref: BCP97_REF })]
  }
  const message = `Reference to ${subject}, which has a lower status than ${docType}. This reference is not in the Downref Registry.`
  return mode === MODES.NORMAL
    ? [new ValidationError('DOWNREF_TO_LOWER_STATUS', message, { ref: BCP97_REF })]
    : [new ValidationWarning('DOWNREF_TO_LOWER_STATUS', message, { ref: BCP97_REF })]
}

/**
 * Validate the normative references of a document for downrefs.
 *
 * - An RFC of a lower status than the document is a downref, unless it is in the Downref Registry.
 * - An RFC whose status can't be fetched, and a reference (TXT) that is neither an RFC nor a
 *   draft, is a possible downref.
 * - An Internet-Draft has no status yet, so it is never a downref. It is followed through the
 *   drafts that replaced it: one published as an RFC is judged as that RFC, otherwise the
 *   reference is reported as a normative reference to a draft, and as a downref in the making
 *   when the document is Standards Track or BCP and the draft's intended status is lower.
 *
 * @param {Object} doc - Document to validate
 * @param {Object} [opts] - Additional options
 * @param {number} [opts.mode=0] - Validation mode to use
 * @returns {Array} - List of errors/warnings/comments
 */
export async function validateDownrefs (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  let rfcs = []
  let labels = []
  switch (doc.type) {
    case 'txt': {
      const { referenceSectionRfc, referenceSectionDraftReferences, nonReferenceSectionDraftReferences } = doc.data.extractedElements
      rfcs = uniq(referenceSectionRfc.filter((extracted) => extracted.subsection === 'normative_references').map((extracted) => trimStart(extracted.value, '0')))
      // -> Labels of normative references that are neither RFCs nor drafts, e.g. [ISO10589]
      labels = referenceSectionDraftReferences
        .filter(ref => ref.subsection === 'normative_references')
        .map(ref => ref.value)
        .filter(refValue => !nonReferenceSectionDraftReferences.includes(refValue))
      break
    }
    case 'xml': {
      rfcs = getCitedRfcs(collectXmlReferences(doc), ['normative'])
      break
    }
  }

  for (const rfcNumber of rfcs) {
    result.push(...await checkRfcDownref(doc, rfcNumber, `RFC ${rfcNumber}`, mode))
  }

  const docStatus = getDocStatusCategory(doc)
  const checkedRfcs = new Set(rfcs)
  const lowerStatusDrafts = new Set()
  for (const draft of await classifyNormativeDraftReferences(doc)) {
    const { end } = draft

    // -> A draft published as an RFC is judged as that RFC (the stale reference checks tell
    //    the author to update the reference)
    if (end.kind === 'rfc') {
      if (!checkedRfcs.has(end.rfc)) {
        checkedRfcs.add(end.rfc)
        result.push(...await checkRfcDownref(doc, end.rfc, describeDraftRfc(draft), mode))
      }
      continue
    }

    const subject = describeDraftReference(draft)
    result.push(new ValidationWarning(
      'NORMATIVE_REFERENCE_TO_DRAFT',
      `Normative reference to ${subject}. A document is not published as an RFC before the drafts it references normatively.`,
      { ref: NORMATIVE_REFERENCES_STATEMENT_REF }
    ))

    // -> A draft has no status until it is published, so a lower intended status is only a
    //    downref in the making, and no intended status says nothing yet
    const draftStatus = end.kind === 'draft' && end.intendedStatus ? getStatusCategory(end.intendedStatus) : null
    if (docStatus !== null && draftStatus !== null && draftStatus < docStatus && !lowerStatusDrafts.has(end.name)) {
      lowerStatusDrafts.add(end.name)
      result.push(new ValidationWarning(
        'NORMATIVE_REFERENCE_TO_LOWER_STATUS_DRAFT',
        `Normative reference to ${subject}: the intended status of ${end.name} (${end.intendedStatus}) is lower than ${describeDocStatus(doc)}, so the reference will be a downref if ${end.name} is published with that status.`,
        { ref: BCP97_REF }
      ))
    }
  }

  for (const label of labels) {
    const message = `Reference to ${label} is possible downref`
    result.push(mode === MODES.NORMAL
      ? new ValidationError('POSSIBLE_DOWNREF', message, { ref: BCP97_REF })
      : new ValidationWarning('POSSIBLE_DOWNREF', message, { ref: BCP97_REF }))
  }

  return result
}

/**
 * Normalize references by removing brackets, versions, and checking for drafts.
 *
 * @param {Array} references - Array of textual references.
 * @returns {Array} - Array of normalized references containing "draft".
 */
function normalizeDraftReferences (references) {
  return references
    .map((ref) => {
      let normalized = ref.replace(/^\[|\]$/g, '')
      normalized = normalized
        .replace(/-\d{2}$/, '')
        .replace(/^I-D\./i, '')

      return normalized
    })
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
 *    - If no status is defined or the RFC cannot be fetched, a `UNDEFINED_STATUS` comment is added.
 *    - If the status is unrecognized, an `UNKNOWN_STATUS` comment is added.
 * 4. Do the same for the RFC that a draft cited normatively was published as, directly or
 *    through the drafts that replaced it.
 * 5. Return a list of validation comments highlighting issues.
 *
 * @param {Object} doc - The document to validate.
 * @param {Object} [opts] - Additional options.
 * @param {number} [opts.mode=MODES.NORMAL] - Validation mode (e.g., NORMAL, SUBMISSION).
 * @returns {Promise<Array>} - A list of validation results, including warnings or comments.
 */
export async function validateNormativeReferences (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const RFC_NUMBER_REG = /^\d+$/

  if (mode === MODES.SUBMISSION) {
    return result
  }

  const ownRfcNumber = getOwnRfcNumber(doc)
  const normativeReferences = doc.type === 'xml'
    ? getCitedRfcs(collectXmlReferences(doc), ['normative'])
    : uniq(doc.data.extractedElements.referenceSectionRfc
      .filter((el) => el.subsection === 'normative_references' && RFC_NUMBER_REG.test(el.value))
      .map((el) => trimStart(el.value, '0')))

  for (const rfcNum of normativeReferences) {
    result.push(...await checkNormativeRfc(doc, rfcNum, `RFC ${rfcNum}`, mode, ownRfcNumber))
  }

  // -> A draft published as an RFC, directly or through the drafts that replaced it, is judged as that RFC
  const checkedRfcs = new Set(normativeReferences)
  for (const draft of await classifyNormativeDraftReferences(doc)) {
    if (draft.end.kind === 'rfc' && !checkedRfcs.has(draft.end.rfc)) {
      checkedRfcs.add(draft.end.rfc)
      result.push(...await checkNormativeRfc(doc, draft.end.rfc, describeDraftRfc(draft), mode, ownRfcNumber))
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
 * @returns {Promise<Array>} - Findings
 */
async function checkNormativeRfc (doc, rfcNum, subject, mode, ownRfcNumber) {
  const rfcInfo = await getRfcInfo(doc, rfcNum)

  if (!rfcInfo || !rfcInfo.status) {
    return [new ValidationComment('UNDEFINED_STATUS', `${subject} does not have a defined status or could not be fetched.`, {
      ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`
    })]
  }

  const result = []
  if (getStatusCategory(rfcInfo.status) === null) {
    result.push(new ValidationComment('UNKNOWN_STATUS', `${subject} has an unrecognized status: "${rfcInfo.status}".`, {
      ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`
    }))
  }

  if (rfcInfo.obsoleted_by?.length > 0 && !isObsoletedBySelf(rfcInfo.obsoleted_by, ownRfcNumber)) {
    const message = `${subject} is obsolete and has been replaced by: ${formatObsoletedByList(rfcInfo.obsoleted_by)}.`
    if (mode === MODES.NORMAL) {
      result.push(new ValidationError('OBSOLETE_REFERENCE', message, { ref: 'https://authors.ietf.org/en/required-content#references' }))
    } else if (mode === MODES.FORGIVE_CHECKLIST) {
      result.push(new ValidationWarning('OBSOLETE_REFERENCE', message, { ref: 'https://authors.ietf.org/en/required-content#references' }))
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
 * @returns {Promise<Array>} - A list of validation results, including errors, warnings, or comments.
 *
 */
export async function validateUnclassifiedReferences (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  const ownRfcNumber = getOwnRfcNumber(doc)

  switch (doc.type) {
    case 'txt': {
      const unclassifiedReferences = doc.data.extractedElements.referenceSectionRfc
        .filter(el => el.subsection === 'unclassified_references')
        .map(el => el.value)

      for (const ref of unclassifiedReferences) {
        const rfcInfo = await getRfcInfo(doc, ref)

        if (!rfcInfo || !rfcInfo.status) {
          result.push(new ValidationComment(
            'UNDEFINED_STATUS',
            `The unclassified reference ${ref} does not have a defined status or could not be fetched.`,
            { ref: `https://www.rfc-editor.org/info/rfc${ref}` }
          ))
          continue
        }

        if (rfcInfo.obsoleted_by?.length > 0 && !isObsoletedBySelf(rfcInfo.obsoleted_by, ownRfcNumber)) {
          const obsoletedByList = formatObsoletedByList(rfcInfo.obsoleted_by)
          const message = `RFC ${ref} is obsolete and has been replaced by: ${obsoletedByList}.`

          if (mode === MODES.NORMAL) {
            result.push(new ValidationError(
              'OBSOLETE_REFERENCE',
              message,
              { ref: 'https://authors.ietf.org/en/required-content#references' }
            ))
          } else if (mode === MODES.FORGIVE_CHECKLIST) {
            result.push(new ValidationWarning(
              'OBSOLETE_REFERENCE',
              message,
              { ref: 'https://authors.ietf.org/en/required-content#references' }
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

        if (!rfcInfo?.status) {
          result.push(new ValidationComment(
            'UNDEFINED_STATUS',
            `RFC ${rfcNum} does not have a defined status or could not be fetched`,
            { ref: `https://www.rfc-editor.org/info/rfc${rfcNum}` }
          ))
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
 * @returns {Promise<Array>} - A list of validation results, including errors, warnings, or comments.
 */
export async function validateInformativeReferences (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  const informativeReferences = doc.type === 'xml'
    ? getCitedRfcs(collectXmlReferences(doc), ['informative'])
    : doc.data.extractedElements.referenceSectionRfc
      .filter(el => el.subsection === 'informative_references')
      .map(el => el.value)

  const ownRfcNumber = getOwnRfcNumber(doc)

  for (const ref of informativeReferences) {
    const rfcInfo = await getRfcInfo(doc, ref)

    if (!rfcInfo || !rfcInfo.status) {
      result.push(new ValidationComment(
        'UNDEFINED_STATUS',
        `The informative reference RFC ${ref} does not have a defined status or could not be fetched.`,
        { ref: `https://www.rfc-editor.org/info/rfc${ref}` }
      ))
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
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        ))
      } else if (mode === MODES.FORGIVE_CHECKLIST) {
        result.push(new ValidationComment(
          'OBSOLETE_INFORMATIVE_REFERENCE',
          message,
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        ))
      }
    }
  }

  return result
}

/**
 * Validate draft references in a document to ensure their states are valid.
 *
 * This function checks all draft references in a document, ensuring:
 * - The referenced draft exists and its state can be fetched. This is the only check that
 *   reports a draft that can't be fetched (validateReferenceForStale skips it).
 * - A draft is not already published as an RFC (and thus should not be referenced as a draft).
 *
 * A published RFC is not checked: a draft it cites may well have been published since, and
 * the RFC can't change anyway. RFC Editor working copies, which may already carry their RFC
 * number but haven't been through xml2rfc's prep tool (no prepTime), are still checked.
 *
 * @param {Object} doc - The document to validate. Should contain `type` and `data` properties.
 * @param {Object} [opts] - Additional options for validation.
 * @param {number} [opts.mode] - The validation mode (e.g., SUBMISSION mode skips validation).
 *
 * @returns {Array} A list of `ValidationWarning` objects containing information about invalid references.
 */

export async function validatePublishedDraftReferences (doc, { mode } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION || isPublishedRfc(doc)) {
    return result
  }

  switch (doc.type) {
    case 'txt': {
      const referenceSectionDraftReferences = doc.data.extractedElements.draftStatusReferences
      const drafts = uniq(normalizeDraftReferences(referenceSectionDraftReferences.map((el) => el.value)))

      for (let i = 0; i < drafts.length; i++) {
        const draftInfo = await getDocInfoJson(doc, drafts[i])

        if (!draftInfo || !draftInfo.state) {
          result.push(new ValidationWarning(
            'UNDEFINED_STATE',
            `The draft reference ${drafts[i]} does not have a defined state or could not be fetched.`,
            { ref: `https://datatracker.ietf.org/doc/${drafts[i]}` }
          ))
          continue
        } else if (draftInfo.state.toLowerCase() === 'rfc') {
          result.push(new ValidationWarning(
            'INVALID_STATE_FOR_DRAFT',
            `The draft reference ${drafts[i]} is already published as an RFC and should not be referenced as a draft.`,
            { ref: `https://datatracker.ietf.org/doc/${drafts[i]}` }
          ))
        }
      }
      break
    }
    case 'xml': {
      const drafts = uniq(normalizeDraftReferences(getCitedDrafts(collectXmlReferences(doc))))

      for (let i = 0; i < drafts.length; i++) {
        const draftInfo = await getDocInfoJson(doc, drafts[i])

        if (!draftInfo || !draftInfo.state) {
          result.push(new ValidationWarning(
            'UNDEFINED_STATE',
            `The draft reference ${drafts[i]} does not have a defined state or could not be fetched.`,
            { ref: `https://datatracker.ietf.org/doc/${drafts[i]}` }
          ))
          continue
        } else if (draftInfo.state.toLowerCase() === 'rfc') {
          result.push(new ValidationWarning(
            'INVALID_STATE_FOR_DRAFT',
            `The draft reference ${drafts[i]} is already published as an RFC and should not be referenced as a draft.`,
            { ref: `https://datatracker.ietf.org/doc/${drafts[i]}` }
          ))
        }
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
 */
export async function validateReferenceForStale (doc, { mode } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  let parsedDrafts = []

  switch (doc.type) {
    case 'txt': {
      const referenceSectionDraftReferences = doc.data.extractedElements.draftStatusReferences
      parsedDrafts = referenceSectionDraftReferences.map(r => {
        const { baseName, version } = splitDraftName(r.value)
        return {
          baseName,
          version,
          subsection: r.subsection
        }
      })
      break
    }
    case 'xml': {
      const drafts = getCitedDrafts(collectXmlReferences(doc))
      parsedDrafts = drafts.map(r => {
        const { baseName, version } = splitDraftName(r)
        return {
          baseName,
          version
        }
      })
      break
    }
  }

  for (let i = 0; i < parsedDrafts.length; i++) {
    const draftName = parsedDrafts[i].baseName
    const draftVersion = parsedDrafts[i].version
    const draftInfo = await getDocInfoJson(doc, draftName)
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
        { ref: `https://datatracker.ietf.org/doc/${draftName}` }
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
