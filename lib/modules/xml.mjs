import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { XML_SCHEMA } from '../config/schema.mjs'
import { get, has, last } from 'lodash-es'
import { findAllDescendantsWith, traverseAll, traverseAllValues } from '../helpers/traversal.mjs'
import { fetchRemoteDocInfo } from '../remote/common.mjs'

const TEXT_REFS_RE = /\[(?:RFC)?[0-9]+\]/gi

/**
 * Ensure that the document doesn't contain deprecated elements
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function detectDeprecatedElements (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const deprecatedElements = Object.keys(XML_SCHEMA._deprecated)

  const entriesFound = findAllDescendantsWith(doc.data.rfc, (v, k) => { return deprecatedElements.includes(k) })

  if (entriesFound.length > 0) {
    for (const entry of entriesFound) {
      const schemaElement = XML_SCHEMA._deprecated[entry.key]
      result.push(new ValidationWarning('DEPRECATED_ELEMENT', `The <${entry.key}> element is deprecated. ${schemaElement.suggestion}`, {
        ref: schemaElement.ref,
        path: `rfc.${entry.path.join('.')}`
      }))
    }
  }

  return result
}

/**
 * Validate a document ipr attribute
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateIprAttribute (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const allowedValues = [
    'trust200902',
    'pre5378Trust200902',
    'noModificationTrust200902',
    'noDerivativesTrust200902'
  ]

  if (!has(doc, 'data.rfc._attr.ipr')) {
    result.push(new ValidationError('MISSING_IPR_ATTRIBUTE', 'The ipr attribute is missing from the <rfc> element.', { ref: 'https://authors.ietf.org/en/required-content#copyright-notice' }))
  } else if (!allowedValues.includes(doc.data.rfc._attr.ipr)) {
    result.push(new ValidationWarning('INVALID_IPR_VALUE', 'The ipr attribute should be one of "trust200902", "noModificationTrust200902", "noDerivativesTrust200902", or "pre5378Trust200902".', { ref: 'https://authors.ietf.org/en/required-content#copyright-notice' }))
  } else if (get(doc, 'data.rfc._attr.submissionType') && ['noDerivativesTrust200902', 'noModificationTrust200902'].includes(doc.data.rfc._attr.ipr)) {
    result.push(new ValidationError('FORBIDDEN_IPR_VALUE_FOR_STREAM', 'The ipr attribute cannot be "noDerivativesTrust200902" or "noModificationTrust200902" when document is a stream.', { ref: 'https://authors.ietf.org/en/required-content#copyright-notice' }))
  }

  return result
}

/**
 * Validate a document preptime attribute
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validatePreptimeAttribute (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (has(doc, 'data.rfc._attr.prepTime')) {
    if (mode === MODES.SUBMISSION) {
      result.push(new ValidationError('RFC_PREPTIME_ATTRIBUTE', 'The prepTime attribute should not be present on the <rfc> element.'))
    } else {
      result.push(new ValidationComment('RFC_PREPTIME_ATTRIBUTE', 'The prepTime attribute should not be present on the <rfc> element.'))
    }
  }

  return result
}

/**
 * Validate a document code blocks
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateCodeBlocks (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  await traverseAll(doc.data, (v, k, p) => {
    if (typeof v === 'string' && v.toLowerCase().includes('<code begins>')) {
      if (k === 'sourcecode') {
        result.push(new ValidationWarning('UNNECESSARY_CODE_BEGINS', 'The text inside a <sourcecode> tag contains the string <CODE BEGINS>. This is unnecessary and may duplicate what a presentation format converter will produce.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#sourcecode',
          path: `rfc.${[...p, k].join('.')}`
        }))
      } else {
        result.push(new ValidationWarning('MISSING_SOURCECODE_TAG', 'Consider using the <sourcecode> tag instead of <CODE BEGINS> for code blocks.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#sourcecode',
          path: `rfc.${[...p, k].join('.')}`
        }))
      }
    }
  })

  return result
}

/**
 * Validate a document for text-like refs
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateTextLikeRefs (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  await traverseAll(doc.data, (v, k, p) => {
    if (typeof v === 'string' && v.match(TEXT_REFS_RE)) {
      result.push(new ValidationWarning('TEXT_DOC_REF', 'Text occurs that looks like a text-document reference (e.g. [1] or [RFC...]). A reference should instead use an <eref> tag.', {
        ref: 'https://authors.ietf.org/en/references-in-rfcxml',
        path: `rfc.${[...p, k].join('.')}`
      }))
    }
  })

  return result
}

/**
 * Validate a document submission type
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateSubmissionType (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []

  const submissionType = get(doc, 'data.rfc._attr.submissionType')?.toLowerCase()
  const filenameStream = doc.filename?.split('.')[0]?.split('-')?.[1]
  const docName = get(doc, 'data.rfc._attr.docName')

  // -> Check submissionType value
  if (submissionType && !['ietf', 'iab', 'irtf', 'independent', 'editorial'].includes(submissionType)) {
    result.push(new ValidationError('SUBMISSION_TYPE_INVALID', 'The document stream specified in the rfc tag is invalid. Should be either IETF, IAB, IRTF, independent or editorial.', {
      ref: 'https://www.rfc-editor.org/rfc/rfc7841.html',
      path: 'rfc.submissionType'
    }))
  // -> Check filename stream === submissionType (if not independent / editorial)
  } else if (['iab', 'irtf'].includes(filenameStream) && submissionType !== filenameStream) {
    result.push(new ValidationError('SUBMISSION_TYPE_MISMATCH', 'The document stream specified in the rfc tag doesn\'t match the stream from the filename.', {
      ref: 'https://www.rfc-editor.org/rfc/rfc7841.html',
      path: 'rfc.submissionType'
    }))
  // -> Check for existing doc stream mismatch
  } else if (!offline && docName) {
    const docInfo = await fetchRemoteDocInfo(docName)

    // -> Existing version on Datatracker
    if (docInfo) {
      const existingStream = docInfo.stream && last(docInfo.stream.split('/').filter(p => p))
      // -> Existing has no stream but doc specifies one
      if (!existingStream && ['ietf', 'iab', 'irtf'].includes(submissionType)) {
        result.push(new ValidationError('SUBMISSION_TYPE_UNEXPECTED', 'A document stream is specified in the rfc tag but the existing version has no stream on Datatracker. Is this intentional?', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7841.html',
          path: 'rfc.submissionType'
        }))
      // -> Existing stream doesn't match submission type
      } else if (existingStream && ['ietf', 'iab', 'irtf'].includes(submissionType) && submissionType !== existingStream) {
        result.push(new ValidationError('SUBMISSION_TYPE_UNEXPECTED', 'The document stream specified in the rfc tag does not match the existing version on Datatracker.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7841.html',
          path: 'rfc.submissionType'
        }))
      }
    }
  }

  return result
}

/**
 * Validate a document boilerplate
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateXMLBoilerplate (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  const ALLOWED_IPR_VALUES = [
    'trust200902',
    'noModificationTrust200902',
    'noDerivativesTrust200902',
    'pre5378Trust200902'
  ]

  const IETF_TLP_6A_6D_REGEX = [
    /This Internet-Draft is submitted in full conformance with the provisions of BCP 78 and BCP 79\./,
    /Copyright \(c\) \d{4} IETF Trust and the persons identified as the document authors\. All rights reserved\.\s+This document is subject to BCP 78 and the IETF Trust’s Legal Provisions Relating to IETF Documents \(http:\/\/trustee\.ietf\.org\/license-info\) in effect on the date of publication of this document\. Please review these documents carefully, as they describe your rights and restrictions with respect to this document\. Code Components extracted from this document must include Simplified BSD License text as described in Section 4\.e of the Trust Legal Provisions and are provided without warranty as described in the Simplified BSD License\./,
    /This document may not be modified, and derivative works of it may not be created, except to format it for publication as an RFC or to translate it into languages other than English\./,
    /This document may not be modified, and derivative works of it may not be created, and it may not be published except as an Internet-Draft\./,
    /This document may contain material from IETF Documents or IETF Contributions published or made publicly available before November 10, 2008\. The person\(s\) controlling the copyright in some of this material may not have granted the IETF Trust the right to allow modifications of such material outside the IETF Standards Process\. Without obtaining an adequate license from the person\(s\) controlling the copyright in such materials, this document may not be modified outside the IETF Standards Process, and derivative works of it may not be created outside the IETF Standards Process, except to format it for publication as an RFC or to translate it into languages other than English\./,
    /Copyright \(c\) \d{4} IETF Trust and the persons identified as authors of the code\. All rights reserved\.\s+Redistribution and use in source and binary forms, with or without modification, is permitted pursuant to, and subject to the license terms contained in, the Simplified BSD License set forth in Section 4\.c of the IETF Trust’s Legal Provisions Relating to IETF Documents \(http:\/\/trustee\.ietf\.org\/license-info\)\./
  ]

  // Check ipr attribute
  const ipr = doc.data.rfc._attr?.ipr
  if (!ipr) {
    result.push(new ValidationError('MISSING_IPR_ATTRIBUTE', 'The ipr attribute is missing from the <rfc> tag.', {
      ref: 'https://authors.ietf.org/en/required-content#copyright-notice',
      path: 'rfc._attr.ipr'
    }))
  } else if (!ALLOWED_IPR_VALUES.includes(ipr)) {
    result.push(new ValidationWarning('INVALID_IPR_VALUE', `The ipr attribute "${ipr}" is not a valid value. It should be one of ${ALLOWED_IPR_VALUES.join(', ')}.`, {
      ref: 'https://authors.ietf.org/en/required-content#copyright-notice',
      path: 'rfc._attr.ipr'
    }))
  }

  if (doc.docKind !== 'rfc') {
    // Check for unecessary boilerplate in draft
    await traverseAllValues(doc.data, (value, key, path) => {
      if (typeof value === 'string') {
        for (const regex of IETF_TLP_6A_6D_REGEX) {
          const tlpPath = `rfc.${path.join('.')}`
          if (tlpPath.startsWith('rfc.front.boilerplate')) {
            continue
          }
          if (regex.test(value)) {
            result.push(new ValidationWarning('UNNECESSARY_BOILERPLATE_TEXT', `The text inside tag "${path.join('.')}" matches a boilerplate from IETF-TLP-5 (section 6a-6d). Consider removing it.`, {
              ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#ipr',
              path: tlpPath
            }))
          }
        }
      }
    })

    // There shouldn't be a boilerplate in drafts
    if (has(doc.data, 'rfc.front.boilerplate')) {
      result.push(new ValidationWarning('UNNECESSARY_BOILERPLATE_ELEMENT', 'The boilerplate element will automatically be added at publishing time. Consider remove it.', {
        ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#ipr',
        path: 'rfc.front.boilerplate'
      }))
    }

    return result
  }

  // RFC prep checks only going forward

  if (has(doc, 'data.rfc.front.boilerplate')) {
    for (const section of (doc.data.rfc.front.boilerplate.section ?? [])) {
      if (section._attr?.anchor === 'status-of-memo' || section.name?.['#text']?.toLowerCase() === 'status of this memo') {
        // TODO:
      } else if (section._attr?.anchor === 'copyright' || section.name?.['#text']?.toLowerCase() === 'copyright notice') {
        // TODO:
      }
    }
    // console.info(doc.data.rfc.front.boilerplate.section[1].t)
  }

  return result
}

/**
 * Validate a IPR boilerplate for XML documents
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateIPRAutogeneratedBoilerplate (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (doc.docKind !== 'rfc') {
    return result
  }

  const REGEX_IPR_200902_STATUS = [
    /^This Internet-Draft is submitted in full conformance\s+with the provisions of BCP 78 and BCP 79\.$/m
  ]

  // “noModification”
  const REGEX_NO_MODIFICATION = [
    /^This document may not be modified, and derivative works of it may\s+not be created, except to format it for publication as an RFC or\s+to translate it into languages other than English\.$/m
  ]

  // “noDerivatives”
  const REGEX_NO_DERIVATIVES = [
    /^This document may not be modified, and derivative works of it may\s+not be created, and it may not be published except as an\s+Internet-Draft\.$/m
  ]

  // “pre5378Trust200902”
  const REGEX_PRE5378 = [
    /^This document may contain material from IETF Documents or IETF\s+Contributions published or made publicly available before\s+November 10, 2008\.\s{2}The person\(s\) controlling the copyright in some\s+of this material may not have granted the IETF Trust the right to\s+allow modifications of such material outside the IETF Standards\s+Process\.\s+Without obtaining an adequate license from the person\(s\)\s+controlling the copyright in such materials, this document may not\s+be modified outside the IETF Standards Process, and derivative\s+works of it may not be created outside the IETF Standards Process, except to format it for publication as an RFC or to translate it into languages other than English\.$/ms
  ]

  const EXPECTED_BOILERPLATE = {
    trust200902: {
      mustInclude: REGEX_IPR_200902_STATUS,
      mustNotInclude: [...REGEX_NO_MODIFICATION, ...REGEX_NO_DERIVATIVES, ...REGEX_PRE5378]
    },
    noModificationTrust200902: {
      mustInclude: [...REGEX_IPR_200902_STATUS, ...REGEX_NO_MODIFICATION],
      mustNotInclude: [...REGEX_NO_DERIVATIVES, ...REGEX_PRE5378]
    },
    noDerivativesTrust200902: {
      mustInclude: [...REGEX_IPR_200902_STATUS, ...REGEX_NO_DERIVATIVES],
      mustNotInclude: [...REGEX_NO_MODIFICATION, ...REGEX_PRE5378]
    },
    pre5378Trust200902: {
      mustInclude: [...REGEX_IPR_200902_STATUS, ...REGEX_PRE5378],
      mustNotInclude: [...REGEX_NO_MODIFICATION, ...REGEX_NO_DERIVATIVES]
    }
  }

  const ipr = doc.data.rfc._attr?.ipr

  if (has(doc.data, 'rfc.boilerplate')) {
    const boilerplateText = doc.data.rfc.boilerplate || ''

    const { mustInclude, mustNotInclude } = EXPECTED_BOILERPLATE[ipr] || {}

    for (const regex of (mustInclude || [])) {
      if (!regex.test(boilerplateText)) {
        result.push(new ValidationWarning(
          'MISSING_EXPECTED_BOILERPLATE',
          `Expected boilerplate text not found (regex: ${regex}) for ipr="${ipr}".`,
          {
            ref: 'https://authors.ietf.org',
            path: 'rfc.boilerplate'
          }
        ))
      }
    }

    for (const regex of (mustNotInclude || [])) {
      if (regex.test(boilerplateText)) {
        result.push(new ValidationWarning(
          'UNEXPECTED_BOILERPLATE_TEXT',
          `Found unexpected boilerplate text (regex: ${regex}) for ipr="${ipr}".`,
          {
            ref: 'https://authors.ietf.org',
            path: 'rfc.boilerplate'
          }
        ))
      }
    }
  }

  return result
}
