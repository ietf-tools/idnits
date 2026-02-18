import { ValidationWarning, ValidationError, ValidationComment } from '../helpers/error.mjs'
import { checkReferencesInDownrefs } from '../remote/downref.mjs'
import { MODES } from '../config/modes.mjs'
import { getStatusCategory } from '../config/rfc-status-hierarchy.mjs'
import { fetchRemoteDocInfoJson, fetchRemoteRfcInfo } from '../remote/common.mjs'
import { findAllDescendantsWith } from '../helpers/traversal.mjs'
import { isPlainObject, last, toPairs, trimStart } from 'lodash-es'
import { formatEnumeration, splitDraftName } from '../helpers/common.mjs'

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
      const possibleDownrefs = referenceSectionDraftReferences.map(ref => ref.value).filter(refValue => !nonReferenceSectionDraftReferences.includes(refValue))
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
      const referencesSections = doc.data.rfc?.back?.references?.references
      if (!referencesSections) { return result }
      const normalizedReferences = extractReferencesFromXml(referencesSections, /normative references/i)

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
 * Extracts references from one or more XML document reference sections.
 *
 * @param {Array<Object>} referencesSections - XML document <references> sections
 * @param {RegExp|RegExp[]} [subsections] - Один або масив RegExp для фільтрації по назві підсекції.
 *                                           Якщо не вказано, витягуємо з усіх.
 * @returns {Array<String>} - Масив нормалізованих референсів (RFC і draft-ім’я).
 */
function extractReferencesFromXml (referencesSections, subsections, normalizeDraftRefs = true) {
  let sectionsToScan
  if (!subsections) {
    sectionsToScan = referencesSections
  } else {
    const regs = Array.isArray(subsections) ? subsections : [subsections]
    sectionsToScan = referencesSections.filter(section => {
      const nameText = typeof section.name === 'string'
        ? section.name
        : isPlainObject(section.name)
          ? section.name['#text']
          : ''
      if (!nameText) return false
      const lower = nameText.toLowerCase()
      return regs.some(rx => rx.test(lower))
    })
  }

  const allRefs = sectionsToScan.flatMap(sec => sec.reference || [])

  if (allRefs.length === 0) {
    return []
  }

  return getXmlReferences(allRefs, normalizeDraftRefs)
}

/**
 * function to get xml references from xml document
 *
 * @param {Array} references
 * @returns
 */
function getXmlReferences (references, normilizeDraftRefs = true) {
  const { drafts, rfcs } = references.reduce((acc, ref) => {
    const sis = Array.isArray(ref.seriesInfo)
      ? ref.seriesInfo
      : ref.seriesInfo
        ? [ref.seriesInfo]
        : []

    // draft
    const di = sis.find(si => si._attr?.name === 'Internet-Draft')
    if (di?._attr?.value) {
      acc.drafts.add(di._attr.value)
    }

    // rfc
    const ri = sis.find(si => si._attr?.name === 'RFC')
    if (ri?._attr?.value) {
      acc.rfcs.add(`RFC ${ri._attr.value}`)
    }

    return acc
  }, { drafts: new Set(), rfcs: new Set() })

  const draftList = normilizeDraftRefs ? normalizeDraftReferences(Array.from(drafts)) : Array.from(drafts)
  const rfcList = Array.from(rfcs)

  return [...draftList, ...rfcList]
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
      const draftName = ref.trim().replace(/^\[|\]$/g, '')
        .replace(/-\d{2}$/, '')
        .replace(/^I-D\./i, '')
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
          const obsoletedByList = rfcInfo.obsoleted_by.map(rfc => `RFC${rfc}`).join(', ')
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
      const referencesSections = doc.data.rfc?.back?.references?.references
      if (!referencesSections) { return result }
      const normativeReferences = extractReferencesFromXml(referencesSections, /normative references/i)
      const normilizedReferences = normativeReferences.filter((ref) => ref.startsWith('RFC')).map((ref) => ref.match(/\d+/)[0])

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
          const obsoletedByList = rfcInfo.obsoleted_by.map(rfc => `RFC${rfc}`).join(', ')
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
          const obsoletedByList = rfcInfo.obsoleted_by.map(rfc => `RFC${rfc}`).join(', ')
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
      const referencesSections = doc.data.rfc?.back?.references?.references
      if (!referencesSections) { return result }
      const references = referencesSections
        .filter(section => !/normative references|informative references/i.test(section.name))
        .flatMap(section => findAllDescendantsWith(section, (value, key) => key === '_attr' && value.anchor))
        .flatMap(match => Array.isArray(match.value.anchor) ? match.value.anchor : [match.value.anchor])
        .filter(Boolean)

      const unclassifiedReferences = normalizeXmlReferences(references)
        .filter(ref => ref.startsWith('RFC'))
        .map(ref => ref.match(/\d+/)[0])

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
          const obsoletedByList = rfcInfo.obsoleted_by.map(rfc => `RFC${rfc}`).join(', ')
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
 * extracted elements. Specifically, it identifies if:
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

  const informativeReferences = doc.data.extractedElements.referenceSectionRfc
    .filter(el => el.subsection === 'informative_references')
    .map(el => el.value)

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

    if (rfcInfo.obsoleted_by.length > 0) {
      const obsoletedByList = rfcInfo.obsoleted_by.map(rfc => `RFC${rfc}`).join(', ')
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
      const referencesSections = doc.data.rfc?.back?.references?.references
      if (!referencesSections) { return result }
      const definedReferences = findAllDescendantsWith(referencesSections, (value, key) => key === '_attr' && value.anchor)
        .flatMap((match) => (Array.isArray(match.value.anchor) ? match.value.anchor : [match.value.anchor]))
        .filter(Boolean)
      const normilizedReferences = normalizeXmlReferences(definedReferences)
      const drafts = normilizedReferences.filter((el) => el.startsWith('draft-'))

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
      const referencesSections = doc.data.rfc?.back?.references?.references
      if (!referencesSections) { return result }
      const references = extractReferencesFromXml(referencesSections, /.*/gmi, false)

      const drafts = references.filter((el) => el.startsWith('draft-'))
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
    } else if (lastVersion.name !== draftName && lastVersion.rev !== draftVersion) {
      const newerDrafts = {}
      let curPublishedDate = null
      for (const entry of draftInfo.rev_history) {
        if (entry.name === draftName && entry.rev === draftVersion) {
          curPublishedDate = entry.published
        } else if (curPublishedDate && entry.published > curPublishedDate) {
          newerDrafts[entry.name] = entry.rev
        }
      }
      const newerDraftsArr = toPairs(newerDrafts).map(d => `${d[0]} (version ${d[1]})`)
      result.push(new ValidationWarning(
        'OUTDATED_DRAFT',
        `The draft reference ${draftName} (version ${draftVersion}) is stale. It was replaced by ${formatEnumeration(newerDraftsArr)}.`,
        { ref: `https://datatracker.ietf.org/doc/${draftName}` }
      ))
    }
  }

  return result
}
