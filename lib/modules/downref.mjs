import { ValidationWarning, ValidationError, ValidationComment } from '../helpers/error.mjs'
import { checkReferencesInDownrefs } from '../remote/downref.mjs'
import { MODES } from '../config/modes.mjs'
import { getStatusCategory } from '../config/rfc-status-hierarchy.mjs'
import { fetchRemoteDocInfoJson, fetchRemoteRfcInfo } from '../helpers/remote.mjs'
import { findAllDescendantsWith } from '../helpers/traversal.mjs'

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
      const { referenceSectionRfc, referenceSectionDraftReferences } = doc.data.extractedElements
      const statusCategory = getStatusCategory(doc.data.header.intendedStatus ?? doc.data.header.category)
      const rfcs = referenceSectionRfc.filter((extracted) => extracted.subsection === 'normative_references').map((extracted) => extracted.value).map((rfcNumber) => `RFC ${rfcNumber}`)
      const drafts = normalizeDraftReferences(referenceSectionDraftReferences.filter((extracted) => extracted.subsection === 'normative_references').map((extracted) => extracted.value))

      await Promise.all([...rfcs, ...drafts].map(async (ref) => {
        let refStatus = null

        if (ref.startsWith('RFC')) {
          const rfcNumber = ref.split(' ')[1]
          const rfcInfo = await fetchRemoteRfcInfo(rfcNumber)
          refStatus = getStatusCategory(rfcInfo?.status)
        } else {
          const draftInfo = await fetchRemoteDocInfoJson(ref)
          refStatus = getStatusCategory(draftInfo?.intended_std_level || draftInfo?.std_level)
        }

        if (refStatus !== null && refStatus < statusCategory) {
          const isDownref = await checkReferencesInDownrefs([ref])
          const errorType = isDownref.length > 0 ? 'DOWNREF_TO_LOWER_STATUS_IN_REGISTRY' : 'DOWNREF_TO_LOWER_STATUS'
          const ValidationClass = mode === MODES.NORMAL ? ValidationError : ValidationWarning

          result.push(new ValidationClass(errorType, `Reference to ${ref}, which has a lower status than the current document.`, {
            ref: `https://datatracker.ietf.org/doc/${ref}`
          }))
        }
      }))

      break
    }
    case 'xml': {
      const referencesSections = doc.data?.rfc?.back?.references?.references || []
      const normativeReferencesSection = referencesSections.find(section =>
        section.name?.toLowerCase().includes('normative references')
      )
      const definedReferences = findAllDescendantsWith(normativeReferencesSection, (value, key) => key === '_attr' && value.anchor)
        .flatMap((match) => (Array.isArray(match.value.anchor) ? match.value.anchor : [match.value.anchor]))
        .filter(Boolean)

      const normilizedReferences = normalizeXmlReferences(definedReferences)

      const docStatus = getStatusCategory(doc.data.rfc._attr.category ?? doc.data.rfc._attr.status)

      await Promise.all(normilizedReferences.map(async (ref) => {
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
          const errorType = isDownref.length > 0 ? 'DOWNREF_TO_LOWER_STATUS_IN_REGISTRY' : 'DOWNREF_TO_LOWER_STATUS'
          const ValidationClass = mode === MODES.NORMAL ? ValidationError : ValidationWarning

          result.push(new ValidationClass(errorType, `Reference to ${ref}, which has a lower status than the current document.`, {
            ref: `https://datatracker.ietf.org/doc/${ref}`
          }))
        }
      }))

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
      normalized = normalized.replace(/-\d{2}$/, '')

      return normalized
    })
    .filter((ref) => ref.toLowerCase().includes('draft'))
}

/**
 * Normalize XML references to drafts and RFCs.
 *
 * @param {Array} references - Array of reference strings.
 * @returns {Array} - Normalized references including only drafts and RFCs.
 */
function normalizeXmlReferences (references) {
  const normalizedReferences = []

  references.forEach((ref) => {
    if (/^RFC\d+$/i.test(ref)) {
      const rfcNumber = ref.match(/\d+/)[0]
      normalizedReferences.push(`RFC ${rfcNumber}`)
    } else if (/draft/i.test(ref)) {
      const draftName = ref.trim().replace(/^\[|\]$/g, '').replace(/-\d{2}$/, '')
      normalizedReferences.push(draftName)
    }
  })

  return normalizedReferences
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
        .map((el) => el.value)

      const rfcInfos = await Promise.all(normativeReferences.map(rfcNum => fetchRemoteRfcInfo(rfcNum)))

      rfcInfos.forEach((rfcInfo, index) => {
        const rfcNum = normativeReferences[index]

        if (!rfcInfo || !rfcInfo.status) {
          result.push(new ValidationComment('UNDEFINED_STATUS', `RFC ${rfcNum} does not have a defined status or could not be fetched.`, {
            ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`
          }))
          return
        }

        const statusCategory = getStatusCategory(rfcInfo.status)

        if (statusCategory === null) {
          result.push(new ValidationComment('UNKNOWN_STATUS', `RFC ${rfcNum} has an unrecognized status: "${rfcInfo.status}".`, {
            ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`
          }))
        }

        if (rfcInfo.obsoleted_by.length > 0) {
          const obsoletedByList = rfcInfo.obsoleted_by.join(', ')
          const message = `The referenced document RFC ${rfcNum} is obsolete and has been replaced by: ${obsoletedByList}.`

          if (mode === MODES.NORMAL) {
            result.push(new ValidationError(
              'OBSOLETE_DOCUMENT',
              message,
              {
                ref: `https://www.rfc-editor.org/info/rfc${rfcInfo.rfc}`
              }
            ))
          } else if (mode === MODES.FORGIVE_CHECKLIST) {
            result.push(new ValidationWarning(
              'OBSOLETE_DOCUMENT',
              message,
              {
                ref: `https://www.rfc-editor.org/info/rfc${rfcInfo.rfc}`
              }
            ))
          }
        }
      })

      break
    }
    case 'xml': {
      const referencesSections = doc.data.rfc.back.references.references
      const normativeReferencesSection = referencesSections.find(section =>
        section.name?.toLowerCase().includes('normative references')
      )
      const normativeReferences = normativeReferencesSection
        ? findAllDescendantsWith(normativeReferencesSection, (value, key) => key === '_attr' && value.anchor)
          .flatMap((match) => (Array.isArray(match.value.anchor) ? match.value.anchor : [match.value.anchor]))
          .filter(Boolean)
        : []
      const normilizedReferences = normalizeXmlReferences(normativeReferences)
        .filter((ref) => ref.startsWith('RFC'))
        .map((ref) => ref.match(/\d+/)[0])

      const rfcInfos = await Promise.all(normilizedReferences.map(rfcNum => fetchRemoteRfcInfo(rfcNum)))

      rfcInfos.forEach((rfcInfo, index) => {
        const rfcNum = normilizedReferences[index]

        if (!rfcInfo || !rfcInfo.status) {
          result.push(new ValidationComment('UNDEFINED_STATUS', `RFC ${rfcNum} does not have a defined status or could not be fetched.`, {
            ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`
          }))
          return
        }

        const statusCategory = getStatusCategory(rfcInfo.status)

        if (statusCategory === null) {
          result.push(new ValidationComment('UNKNOWN_STATUS', `RFC ${rfcNum} has an unrecognized status: "${rfcInfo.status}".`, {
            ref: `https://www.rfc-editor.org/info/rfc${rfcNum}`
          }))
        }

        if (rfcInfo.obsoleted_by.length > 0) {
          const obsoletedByList = rfcInfo.obsoleted_by.join(', ')
          const message = `The referenced document RFC ${rfcNum} is obsolete and has been replaced by: ${obsoletedByList}.`

          if (mode === MODES.NORMAL) {
            result.push(new ValidationError(
              'OBSOLETE_DOCUMENT',
              message,
              {
                ref: `https://www.rfc-editor.org/info/rfc${rfcInfo.rfc}`
              }
            ))
          } else if (mode === MODES.FORGIVE_CHECKLIST) {
            result.push(new ValidationWarning(
              'OBSOLETE_DOCUMENT',
              message,
              {
                ref: `https://www.rfc-editor.org/info/rfc${rfcInfo.rfc}`
              }
            ))
          }
        }
      })

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

      const rfcInfos = await Promise.all(unclassifiedReferences.map(ref => fetchRemoteRfcInfo(ref)))

      rfcInfos.forEach((rfcInfo, index) => {
        const ref = unclassifiedReferences[index]

        if (!rfcInfo || !rfcInfo.status) {
          result.push(new ValidationComment(
            'UNDEFINED_STATUS',
            `The unclassified reference ${ref} does not have a defined status or could not be fetched.`,
            { ref: `https://www.rfc-editor.org/info/rfc${ref}` }
          ))
          return
        }

        if (rfcInfo.obsoleted_by.length > 0) {
          const obsoletedByList = rfcInfo.obsoleted_by.join(', ')
          const message = `The unclassified reference ${ref} is obsolete and has been replaced by: ${obsoletedByList}.`

          if (mode === MODES.NORMAL) {
            result.push(new ValidationError(
              'OBSOLETE_UNCLASSIFIED_REFERENCE',
              message,
              { ref: `https://www.rfc-editor.org/info/rfc${rfcInfo.rfc}` }
            ))
          } else if (mode === MODES.FORGIVE_CHECKLIST) {
            result.push(new ValidationWarning(
              'OBSOLETE_UNCLASSIFIED_REFERENCE',
              message,
              { ref: `https://www.rfc-editor.org/info/rfc${rfcInfo.rfc}` }
            ))
          }
        }
      })
      break
    }
    case 'xml': {
      const referencesSections = doc.data.rfc.back.references.references
      const references = referencesSections
        .filter(section => !/normative references|informative references/i.test(section.name))
        .flatMap(section => findAllDescendantsWith(section, (value, key) => key === '_attr' && value.anchor))
        .flatMap(match => Array.isArray(match.value.anchor) ? match.value.anchor : [match.value.anchor])
        .filter(Boolean)

      const unclassifiedReferences = normalizeXmlReferences(references)
        .filter(ref => ref.startsWith('RFC'))
        .map(ref => ref.match(/\d+/)[0])

      const rfcInfos = await Promise.all(unclassifiedReferences.map(rfcNum => fetchRemoteRfcInfo(rfcNum)))

      rfcInfos.forEach((rfcInfo, index) => {
        const rfcNum = unclassifiedReferences[index]

        if (!rfcInfo?.status) {
          result.push(new ValidationComment(
            'UNDEFINED_STATUS',
            `RFC ${rfcNum} does not have a defined status or could not be fetched`,
            { ref: `https://www.rfc-editor.org/info/rfc${rfcNum}` }
          ))
          return
        }

        if (rfcInfo.obsoleted_by.length) {
          const obsoletedByList = rfcInfo.obsoleted_by.join(', ')
          const message = `The unclassified reference RFC ${rfcNum} is obsolete and has been replaced by: ${obsoletedByList}`

          result.push(
            mode === MODES.NORMAL
              ? new ValidationError('OBSOLETE_UNCLASSIFIED_REFERENCE', message, { ref: `https://www.rfc-editor.org/info/rfc${rfcInfo.rfc}` })
              : new ValidationWarning('OBSOLETE_UNCLASSIFIED_REFERENCE', message, { ref: `https://www.rfc-editor.org/info/rfc${rfcInfo.rfc}` })
          )
        }
      })
      break
    }
  }

  return result
}
