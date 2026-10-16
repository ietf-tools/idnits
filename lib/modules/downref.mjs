import { ValidationWarning, ValidationError, ValidationComment } from '../helpers/error.mjs'
import { checkReferencesInDownrefs } from '../remote/downref.mjs'
import { MODES } from '../config/modes.mjs'
import { getStatusCategory } from '../config/rfc-status-hierarchy.mjs'
import { fetchRemoteDocInfoJson, fetchRemoteRfcInfo } from '../remote/common.mjs'
import { collectXmlReferences, getCitedDrafts, getCitedRfcs } from '../helpers/xml-references.mjs'
import { castArray, findLast, last, trimStart, uniq } from 'lodash-es'
import { splitDraftName } from '../helpers/common.mjs'

/**
 * Validate document references for RFCs and Drafts downrefs.
 *
 * @param {Object} doc - Document to validate
 * @param {Object} [opts] - Additional options
 * @param {number} [opts.mode=0] - Validation mode to use
 * @param {boolean} [opts.offline=false] - Skip fetching remote data if true
 * @returns {Array} - List of errors/warnings/comments
 */
export async function validateDownrefs (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  switch (doc.type) {
    case 'txt': {
      const { referenceSectionRfc, draftStatusReferences, referenceSectionDraftReferences, nonReferenceSectionDraftReferences } = doc.data.extractedElements
      const statusCategory = getStatusCategory(doc.data.header.intendedStatus ?? doc.data.header.category)
      const possibleDownrefs = referenceSectionDraftReferences
        .filter(ref => ref.subsection === 'normative_references')
        .map(ref => ref.value)
        .filter(refValue => !nonReferenceSectionDraftReferences.includes(refValue))
      const rfcs = referenceSectionRfc.filter((extracted) => extracted.subsection === 'normative_references').map((extracted) => extracted.value).map((rfcNumber) => `RFC ${rfcNumber}`)
      const drafts = normalizeDraftReferencesForDownref(draftStatusReferences.filter((extracted) => extracted.subsection === 'normative_references').map((extracted) => extracted.value))

      for (const ref of [...rfcs, ...drafts, ...possibleDownrefs]) {
        let refStatus = null

        if (ref.startsWith('RFC')) {
          const rfcNumber = trimStart(ref.split(' ')[1], '0')
          const rfcInfo = await fetchRemoteRfcInfo(rfcNumber)
          refStatus = getStatusCategory(rfcInfo?.status)
        } else {
          const draftInfo = await fetchRemoteDocInfoJson(ref)
          refStatus = getStatusCategory(draftInfo?.intended_std_level || draftInfo?.std_level)
        }

        if (refStatus !== null && refStatus < statusCategory) {
          const isDownref = await checkReferencesInDownrefs([ref])
          const docType = doc.docKind === 'rfc' ? 'this RFC' : "this draft's intended status"
          if (isDownref.length > 0) {
            switch (mode) {
              case MODES.NORMAL:
                result.push(new ValidationWarning('DOWNREF_TO_LOWER_STATUS_IN_REGISTRY', `Reference to ${ref}, which has a lower status than ${docType} and is listed in the Downref Registry.`, {
                  ref: 'https://www.rfc-editor.org/info/bcp97'
                }))
                break
              case MODES.FORGIVE_CHECKLIST:
                result.push(new ValidationWarning('DOWNREF_TO_LOWER_STATUS_IN_REGISTRY', `Reference to ${ref}, which has a lower status than ${docType} and is listed in the Downref Registry.`, {
                  ref: 'https://www.rfc-editor.org/info/bcp97'
                }))
                break
            }
          } else {
            switch (mode) {
              case MODES.NORMAL:
                result.push(new ValidationError('DOWNREF_TO_LOWER_STATUS', `Reference to ${ref}, which has a lower status than ${docType}. This reference is not in the Downref Registry.`, {
                  ref: 'https://www.rfc-editor.org/info/bcp97'
                }))
                break
              case MODES.FORGIVE_CHECKLIST:
                result.push(new ValidationWarning('DOWNREF_TO_LOWER_STATUS', `Reference to ${ref}, which has a lower status than ${docType}. This reference is not in the Downref Registry.`, {
                  ref: 'https://www.rfc-editor.org/info/bcp97'
                }))
                break
            }
          }
        } else if (!refStatus) {
          switch (mode) {
            case MODES.NORMAL:
              result.push(new ValidationError('POSSIBLE_DOWNREF', `Reference to ${ref} is possible downref`, {
                ref: 'https://www.rfc-editor.org/info/bcp97'
              }))
              break
            case MODES.FORGIVE_CHECKLIST:
              result.push(new ValidationWarning('POSSIBLE_DOWNREF', `Reference to ${ref} is possible downref`, {
                ref: 'https://www.rfc-editor.org/info/bcp97'
              }))
              break
          }
        }
      }

      break
    }
    case 'xml': {
      const references = collectXmlReferences(doc)
      const normalizedReferences = [
        ...uniq(normalizeDraftReferences(getCitedDrafts(references, ['normative']))),
        ...getCitedRfcs(references, ['normative']).map(rfcNumber => `RFC ${rfcNumber}`)
      ]
      if (normalizedReferences.length === 0) { return result }

      const docStatus = getStatusCategory(doc.data.rfc._attr.category ?? doc.data.rfc._attr.status)

      for (const ref of normalizedReferences) {
        let refStatus = null

        if (/^RFC\s*\d+$/i.test(ref)) {
          const rfcNumber = ref.match(/\d+/)[0]
          const rfcInfo = await fetchRemoteRfcInfo(rfcNumber)
          refStatus = getStatusCategory(rfcInfo?.status)
        } else if (/draft/i.test(ref)) {
          const draftInfo = await fetchRemoteDocInfoJson(ref)
          refStatus = getStatusCategory(draftInfo?.intended_std_level || draftInfo?.std_level)
        }

        if (refStatus !== null && refStatus < docStatus) {
          const isDownref = await checkReferencesInDownrefs([ref])
          const docType = doc.docKind === 'rfc' ? 'this RFC' : "this draft's intended status"
          if (isDownref.length > 0) {
            switch (mode) {
              case MODES.NORMAL:
                result.push(
                  new ValidationWarning(
                    'DOWNREF_TO_LOWER_STATUS_IN_REGISTRY',
                    `Reference to ${ref}, which has a lower status than ${docType} and is listed in the Downref Registry.`,
                    { ref: 'https://www.rfc-editor.org/info/bcp97' }
                  )
                )
                break
              case MODES.FORGIVE_CHECKLIST:
                result.push(
                  new ValidationWarning(
                    'DOWNREF_TO_LOWER_STATUS_IN_REGISTRY',
                    `Reference to ${ref}, which has a lower status than ${docType} and is listed in the Downref Registry.`,
                    { ref: 'https://www.rfc-editor.org/info/bcp97' }
                  )
                )
                break
            }
          } else {
            switch (mode) {
              case MODES.NORMAL:
                result.push(
                  new ValidationError(
                    'DOWNREF_TO_LOWER_STATUS',
                    `Reference to ${ref}, which has a lower status than ${docType}. This reference is not in the Downref Registry.`,
                    { ref: 'https://www.rfc-editor.org/info/bcp97' }
                  )
                )
                break
              case MODES.FORGIVE_CHECKLIST:
                result.push(
                  new ValidationWarning(
                    'DOWNREF_TO_LOWER_STATUS',
                    `Reference to ${ref}, which has a lower status than ${docType}. This reference is not in the Downref Registry.`,
                    { ref: 'https://www.rfc-editor.org/info/bcp97' }
                  )
                )
                break
            }
          }
        } else if (refStatus === null) {
          switch (mode) {
            case MODES.NORMAL:
              result.push(
                new ValidationError(
                  'POSSIBLE_DOWNREF',
                  `${ref} status can't be fetched. Reference is possible downref`,
                  { ref: 'https://www.rfc-editor.org/info/bcp97' }
                )
              )
              break
            case MODES.FORGIVE_CHECKLIST:
              result.push(
                new ValidationWarning(
                  'POSSIBLE_DOWNREF',
                  `${ref} status can't be fetched. Reference is possible downref`,
                  { ref: 'https://www.rfc-editor.org/info/bcp97' }
                )
              )
              break
          }
        }
      }
      break
    }
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
 *
 * @param {Array} references - Array of textual references.
 * @returns {Array} - Array of normalized references containing "draft".
 */
function normalizeDraftReferencesForDownref (references) {
  return references
    .map((ref) => {
      let normalized = ref.replace(/^\[|\]$/g, '')
      normalized = normalized.replace(/-\d{2}$/, '')

      return normalized
    })
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
 * 2. Fetch metadata for each RFC using `fetchRemoteRfcInfo`.
 * 3. Validate the fetched status:
 *    - If no status is defined or the RFC cannot be fetched, a `UNDEFINED_STATUS` comment is added.
 *    - If the status is unrecognized, an `UNKNOWN_STATUS` comment is added.
 * 4. Return a list of validation comments highlighting issues.
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

  switch (doc.type) {
    case 'txt': {
      const normativeReferences = doc.data.extractedElements.referenceSectionRfc
        .filter((el) => el.subsection === 'normative_references' && RFC_NUMBER_REG.test(el.value))
        .map((el) => trimStart(el.value, '0'))

      for (const rfcNum of normativeReferences) {
        const rfcInfo = await fetchRemoteRfcInfo(rfcNum)

        if (!rfcInfo || !rfcInfo.status) {
          result.push(new ValidationComment('UNDEFINED_STATUS', `RFC ${rfcNum} does not have a defined status or could not be fetched.`, {
            ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`
          }))
          continue
        }

        const statusCategory = getStatusCategory(rfcInfo.status)

        if (statusCategory === null) {
          result.push(new ValidationComment('UNKNOWN_STATUS', `RFC ${rfcNum} has an unrecognized status: "${rfcInfo.status}".`, {
            ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`
          }))
        }

        if (rfcInfo.obsoleted_by?.length > 0) {
          const obsoletedByList = formatObsoletedByList(rfcInfo.obsoleted_by)
          const message = `RFC ${rfcNum} is obsolete and has been replaced by: ${obsoletedByList}.`

          if (mode === MODES.NORMAL) {
            result.push(new ValidationError(
              'OBSOLETE_REFERENCE',
              message,
              {
                ref: 'https://authors.ietf.org/en/required-content#references'
              }
            ))
          } else if (mode === MODES.FORGIVE_CHECKLIST) {
            result.push(new ValidationWarning(
              'OBSOLETE_REFERENCE',
              message,
              {
                ref: 'https://authors.ietf.org/en/required-content#references'
              }
            ))
          }
        }
      }
      break
    }
    case 'xml': {
      const normilizedReferences = getCitedRfcs(collectXmlReferences(doc), ['normative'])

      for (const rfcNum of normilizedReferences) {
        const rfcInfo = await fetchRemoteRfcInfo(rfcNum)

        if (!rfcInfo || !rfcInfo.status) {
          result.push(new ValidationComment('UNDEFINED_STATUS', `RFC ${rfcNum} does not have a defined status or could not be fetched.`, {
            ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`
          }))
          continue
        }

        const statusCategory = getStatusCategory(rfcInfo.status)

        if (statusCategory === null) {
          result.push(new ValidationComment('UNKNOWN_STATUS', `RFC ${rfcNum} has an unrecognized status: "${rfcInfo.status}".`, {
            ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`
          }))
        }

        if (rfcInfo.obsoleted_by.length > 0) {
          const obsoletedByList = formatObsoletedByList(rfcInfo.obsoleted_by)
          const message = `RFC ${rfcNum} is obsolete and has been replaced by: ${obsoletedByList}.`

          if (mode === MODES.NORMAL) {
            result.push(new ValidationError(
              'OBSOLETE_REFERENCE',
              message,
              {
                ref: 'https://authors.ietf.org/en/required-content#references'
              }
            ))
          } else if (mode === MODES.FORGIVE_CHECKLIST) {
            result.push(new ValidationWarning(
              'OBSOLETE_REFERENCE',
              message,
              {
                ref: 'https://authors.ietf.org/en/required-content#references'
              }
            ))
          }
        }
      }
      break
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
 *   `fetchRemoteRfcInfo`.
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

  switch (doc.type) {
    case 'txt': {
      const unclassifiedReferences = doc.data.extractedElements.referenceSectionRfc
        .filter(el => el.subsection === 'unclassified_references')
        .map(el => el.value)

      for (const ref of unclassifiedReferences) {
        const rfcInfo = await fetchRemoteRfcInfo(ref)

        if (!rfcInfo || !rfcInfo.status) {
          result.push(new ValidationComment(
            'UNDEFINED_STATUS',
            `The unclassified reference ${ref} does not have a defined status or could not be fetched.`,
            { ref: `https://www.rfc-editor.org/info/rfc${ref}` }
          ))
          continue
        }

        if (rfcInfo.obsoleted_by.length > 0) {
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
        const rfcInfo = await fetchRemoteRfcInfo(rfcNum)

        if (!rfcInfo?.status) {
          result.push(new ValidationComment(
            'UNDEFINED_STATUS',
            `RFC ${rfcNum} does not have a defined status or could not be fetched`,
            { ref: `https://www.rfc-editor.org/info/rfc${rfcNum}` }
          ))
          continue
        }

        if (rfcInfo.obsoleted_by.length) {
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
    const rfcInfo = await fetchRemoteRfcInfo(ref)

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
 * - The referenced draft exists and its state can be fetched.
 * - A draft is not already published as an RFC (and thus should not be referenced as a draft).
 *
 * @param {Object} doc - The document to validate. Should contain `type` and `data` properties.
 * @param {Object} [opts] - Additional options for validation.
 * @param {number} [opts.mode] - The validation mode (e.g., SUBMISSION mode skips validation).
 *
 * @returns {Array} A list of `ValidationWarning` objects containing information about invalid references.
 */

export async function validatePublishedDraftReferences (doc, { mode } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  switch (doc.type) {
    case 'txt': {
      const referenceSectionDraftReferences = doc.data.extractedElements.draftStatusReferences
      const drafts = normalizeDraftReferences(referenceSectionDraftReferences.map((el) => el.value))

      for (let i = 0; i < drafts.length; i++) {
        const draftInfo = await fetchRemoteDocInfoJson(drafts[i])

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
        const draftInfo = await fetchRemoteDocInfoJson(drafts[i])

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
 * output validation warning.
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
    const draftInfo = await fetchRemoteDocInfoJson(draftName)
    const lastVersion = last(draftInfo?.rev_history)
    if (!draftInfo || !draftInfo.rev_history || !lastVersion) {
      result.push(new ValidationWarning(
        'UNDEFINED_STATE',
        `The draft reference ${draftName} does not have a defined state or could not be fetched.`,
        { ref: `https://datatracker.ietf.org/doc/${draftName}` }
      ))
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
