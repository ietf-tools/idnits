import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { XML_SCHEMA } from '../config/schema.mjs'
import { find, get, has, isPlainObject } from 'lodash-es'
import { findDescendantWith } from '../helpers/traversal.mjs'
import { hasMeaningfulContent } from '../helpers/utils.mjs'

/**
 * Validate a document abstract section
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateAbstractSection (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  switch (doc.type) {
    case 'txt': {
      if (!doc.data.markers.abstract.start) {
        result.push(new ValidationError('MISSING_ABSTRACT_SECTION', 'The abstract section is missing.', {
          ref: 'https://authors.ietf.org/required-content#abstract'
        }))
      } else if (!doc.data.content.abstract || !hasMeaningfulContent(doc.data.content.abstract)) {
        result.push(new ValidationError('EMPTY_ABSTRACT_SECTION', 'The abstract section is present but contains no meaningful content.', {
          ref: 'https://authors.ietf.org/required-content#abstract'
        }))
      } else {
        const abstractContent = doc.data.content.abstract.join(' ') || ''
        const updatesRfc = doc.data.extractedElements?.updatesRfc || []
        const obsoletesRfc = doc.data.extractedElements?.obsoletesRfc || []

        const rfcReferencePattern = /\[RFC\d+\]/ig
        const urlPattern = /https?:\/\/[^\s]+|www\.[^\s]+/i
        const sectionReferencePattern = /\bSection\s\d+(\.\d+)?\b|\bAppendix\s\w+\b/i
        const internetDraftReferencePattern = /\[I-D\.[^\]]+\]/i
        const customReferencePattern = /\[(?!RFC\d+\b)[A-Za-z0-9-]+\]/i

        const rfcMatches = [...abstractContent.matchAll(rfcReferencePattern)].map(match => match[0].match(/\d+/)[0])
        const notAllowedRfcReferences = rfcMatches.filter(rfc => !updatesRfc.includes(rfc) && !obsoletesRfc.includes(rfc))

        const validateReference = (pattern, errorCode, errorMessage) => {
          if (pattern.test(abstractContent)) {
            switch (mode) {
              case MODES.NORMAL: {
                result.push(new ValidationError(errorCode, errorMessage, {
                  ref: 'https://authors.ietf.org/required-content#abstract'
                }))
                break
              }
              case MODES.FORGIVE_CHECKLIST: {
                result.push(new ValidationWarning(errorCode, errorMessage, {
                  ref: 'https://authors.ietf.org/required-content#abstract'
                }))
                break
              }
            }
          }
        }

        if (notAllowedRfcReferences.length > 0) validateReference(rfcReferencePattern, 'INVALID_ABSTRACT_SECTION_REF', 'The abstract section should not contain references to RFCs.')
        validateReference(urlPattern, 'INVALID_ABSTRACT_SECTION_URL', 'The abstract section should not contain URLs.')
        validateReference(sectionReferencePattern, 'INVALID_ABSTRACT_SECTION_REF', 'The abstract section should not contain references to sections or appendices.')
        validateReference(internetDraftReferencePattern, 'INVALID_ABSTRACT_SECTION_ID_REF', 'The abstract section should not contain references to Internet-Drafts.')
        validateReference(customReferencePattern, 'INVALID_ABSTRACT_SECTION_CUSTOM_REF', 'The abstract section should not contain custom references like [REST].')
      }
      break
    }
    case 'xml': {
      if (!has(doc, 'data.rfc.front.abstract')) {
        result.push(new ValidationError('MISSING_ABSTRACT_SECTION', 'The abstract section is missing.', {
          ref: 'https://authors.ietf.org/required-content#abstract',
          path: 'rfc.front.abstract'
        }))
      } else if (!isPlainObject(doc.data.rfc.front.abstract) || Object.keys(doc.data.rfc.front.abstract).length < 1) {
        result.push(new ValidationError('INVALID_ABSTRACT_SECTION', 'The abstract section must consist of at least 1 <dl>, <ol>, <t> or <ul> element.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.1',
          path: 'rfc.front.abstract'
        }))
      } else {
        for (const key of Object.keys(doc.data.rfc.front.abstract)) {
          if (!XML_SCHEMA.abstract.allowedChildren.includes(key)) {
            result.push(new ValidationError('INVALID_ABSTRACT_SECTION_CHILD', 'The abstract section must consist of <dl>, <ol>, <t> or <ul> elements only.', {
              ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.1',
              path: `rfc.front.abstract.${key}`
            }))
            break
          }
        }
        const refEntryFound = findDescendantWith(doc.data.rfc.front.abstract, (v, k) => { return k === 'xref' })
        if (refEntryFound) {
          switch (mode) {
            case MODES.NORMAL: {
              result.push(new ValidationError('INVALID_ABSTRACT_SECTION_REF', 'The abstract section should not contain references.', {
                ref: 'https://authors.ietf.org/required-content#abstract',
                path: `rfc.front.abstract.${refEntryFound.path.join('.')}`
              }))
              break
            }
            case MODES.FORGIVE_CHECKLIST: {
              result.push(new ValidationWarning('INVALID_ABSTRACT_SECTION_REF', 'The abstract section should not contain references.', {
                ref: 'https://authors.ietf.org/required-content#abstract',
                path: `rfc.front.abstract.${refEntryFound.path.join('.')}`
              }))
              break
            }
          }
        }
      }
      break
    }
  }

  return result
}

/**
 * Validate a document introduction section
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateIntroductionSection (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  switch (doc.type) {
    case 'txt': {
      const markers = doc.data.markers

      if (!markers.header.start || !markers.title) {
        result.push(
          new ValidationError(
            'INVALID_DOCUMENT_STRUCTURE',
            'The document is missing a valid header or title, making further validation impossible.',
            {
              ref: 'https://authors.ietf.org/en/required-content#introduction'
            }
          )
        )
        break
      }

      if (!doc.data.markers.introduction.start) {
        switch (mode) {
          case MODES.NORMAL: {
            result.push(new ValidationError(
              'MISSING_INTRODUCTION_SECTION',
              'The first section is missing. Expected "Introduction", "Overview", or "Background".',
              {
                ref: 'https://authors.ietf.org/en/required-content#introduction'
              }
            ))
            break
          }
          case MODES.FORGIVE_CHECKLIST: {
            result.push(new ValidationWarning(
              'MISSING_INTRODUCTION_SECTION',
              'The first section is missing. Expected "Introduction", "Overview", or "Background".',
              {
                ref: 'https://authors.ietf.org/en/required-content#introduction'
              }
            ))
            break
          }
        }
      } else {
        if (!hasMeaningfulContent(doc.data.content.introduction)) {
          result.push(
            new ValidationError(
              'EMPTY_INTRODUCTION_SECTION',
              'The first section is present but contains no meaningful content.',
              {
                ref: 'https://authors.ietf.org/en/required-content#introduction'
              }
            )
          )
        }
      }
      break
    }
    case 'xml': {
      const sections = get(doc, 'data.rfc.middle.section', [])
      const introSection = find(sections, s => ['Introduction', 'Overview', 'Background'].includes(s.name))
      if (!introSection) {
        switch (mode) {
          case MODES.NORMAL: {
            result.push(new ValidationError('MISSING_INTRODUCTION_SECTION', 'The introduction section is missing.', {
              ref: 'https://authors.ietf.org/en/required-content#introduction'
            }))
            break
          }
          case MODES.FORGIVE_CHECKLIST: {
            result.push(new ValidationWarning('MISSING_INTRODUCTION_SECTION', 'The introduction section is missing.', {
              ref: 'https://authors.ietf.org/en/required-content#introduction'
            }))
            break
          }
        }
      } else {
        const childrenTypes = Object.keys(introSection).filter(k => k !== 'name' && k !== '_attr')
        if (childrenTypes.length < 1) {
          result.push(new ValidationError('INVALID_INTRODUCTION_SECTION', 'The introduction section is empty.', {
            ref: 'https://authors.ietf.org/en/required-content#introduction'
          }))
        } else {
          for (const key of childrenTypes) {
            if (!XML_SCHEMA.section.allowedChildren.includes(key)) {
              result.push(new ValidationError('INVALID_INTRODUCTION_SECTION_CHILD', `The introduction section must consist of ${XML_SCHEMA.section.allowedChildren.map(e => '<' + e + '>').join(', ')} elements only.`, {
                ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.46'
              }))
              break
            }
          }
        }
      }
      break
    }
  }

  return result
}

/**
 * Validate a document security considerations section
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateSecurityConsiderationsSection (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  switch (doc.type) {
    case 'txt': {
      if (!doc.data.markers.securityConsiderations.start) {
        switch (mode) {
          case MODES.NORMAL: {
            result.push(new ValidationError(
              'MISSING_SECURITY_CONSIDERATIONS_SECTION',
              'The security considerations section is missing.',
              {
                ref: 'https://authors.ietf.org/en/required-content#security-considerations'
              }
            ))
            break
          }
          case MODES.FORGIVE_CHECKLIST: {
            result.push(new ValidationWarning(
              'MISSING_SECURITY_CONSIDERATIONS_SECTION',
              'The security considerations section is missing.',
              {
                ref: 'https://authors.ietf.org/en/required-content#security-considerations'
              }
            ))
            break
          }
        }
      } else {
        if (!hasMeaningfulContent(doc.data.content.securityConsiderations)) {
          result.push(
            new ValidationError(
              'EMPTY_SECURITY_CONSIDERATIONS_SECTION',
              'The security considerations section is present but contains no meaningful content.',
              {
                ref: 'https://authors.ietf.org/en/required-content#security-considerations'
              }
            )
          )
        }
      }
      break
    }
    case 'xml': {
      const sections = get(doc, 'data.rfc.middle.section', [])
      const secSection = find(sections, s => ['Security Considerations'].includes(s.name))
      if (!secSection) {
        switch (mode) {
          case MODES.NORMAL: {
            result.push(new ValidationError('MISSING_SECURITY_CONSIDERATIONS_SECTION', 'The security considerations section is missing.', {
              ref: 'https://authors.ietf.org/en/required-content#security-considerations'
            }))
            break
          }
          case MODES.FORGIVE_CHECKLIST: {
            result.push(new ValidationWarning('MISSING_SECURITY_CONSIDERATIONS_SECTION', 'The security considerations section is missing.', {
              ref: 'https://authors.ietf.org/en/required-content#security-considerations'
            }))
            break
          }
        }
      } else {
        const childrenTypes = Object.keys(secSection).filter(k => k !== 'name' && k !== '_attr')
        if (childrenTypes.length < 1) {
          result.push(new ValidationError('INVALID_SECURITY_CONSIDERATIONS_SECTION', 'The security considerations section is empty.', {
            ref: 'https://authors.ietf.org/en/required-content#security-considerations'
          }))
        } else {
          for (const key of childrenTypes) {
            if (!XML_SCHEMA.section.allowedChildren.includes(key)) {
              result.push(new ValidationError('INVALID_SECURITY_CONSIDERATIONS_SECTION_CHILD', `The security considerations section must consist of ${XML_SCHEMA.section.allowedChildren.map(e => '<' + e + '>').join(', ')} elements only.`, {
                ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.46'
              }))
              break
            }
          }
        }
      }
      break
    }
  }

  return result
}

/**
 * Validate document author section(s)
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateAuthorSection (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  switch (doc.type) {
    case 'txt': {
      if (!doc.data.markers.authorAddress.start) {
        switch (mode) {
          case MODES.NORMAL:
            result.push(
              new ValidationError(
                'MISSING_AUTHOR_SECTION',
                'The author section is missing.',
                {
                  ref: 'https://authors.ietf.org/en/required-content#authors-addresses'
                }
              )
            )
            break
          case MODES.FORGIVE_CHECKLIST:
            result.push(
              new ValidationWarning(
                'MISSING_AUTHOR_SECTION',
                'The author section is missing.',
                {
                  ref: 'https://authors.ietf.org/en/required-content#authors-addresses'
                }
              )
            )
            break
        }
      } else {
        const authorSectionTitle = doc.data.content.authorAddress[0]?.trim()

        if (authorSectionTitle) {
          const invalidPossessiveMark = /[^a-z\s\u2018\u2019\u201B'`] (Addresses|contact information)$/i.test(authorSectionTitle)
          if (invalidPossessiveMark) {
            result.push(
              new ValidationWarning(
                'MISUSED_POSSESSIVE_MARK',
                `The author's address section title "${authorSectionTitle}" uses an incorrect possessive mark or character other than a single quote.`,
                {
                  ref: 'https://authors.ietf.org/en/required-content#authors-addresses',
                  path: 'data.content.authorAddress[0]'
                }
              )
            )
          }
        }
      }
      break
    }
    case 'xml': {
      let authors = get(doc, 'data.rfc.front.author', [])
      // -> Check if there's only 1 author, which won't be an array
      if (isPlainObject(authors)) {
        authors = [authors]
      }
      if (!authors || authors.length < 1) {
        switch (mode) {
          case MODES.NORMAL: {
            result.push(new ValidationError('MISSING_AUTHOR_SECTION', 'The author section is missing.', {
              ref: 'https://authors.ietf.org/en/required-content#authors-addresses'
            }))
            break
          }
          case MODES.FORGIVE_CHECKLIST: {
            result.push(new ValidationWarning('MISSING_AUTHOR_SECTION', 'The author section is missing.', {
              ref: 'https://authors.ietf.org/en/required-content#authors-addresses'
            }))
            break
          }
        }
      } else {
        if (authors.length > 5) {
          result.push(new ValidationComment('TOO_MANY_AUTHORS', 'There are more than 5 authors / editors.  If there is a need to list more, discuss the need with the relevant stream leadership as early in the process as possible. For the IETF stream, consult an Area Director.', {
            ref: 'https://authors.ietf.org/en/required-content#authors-addresses',
            path: 'rfc.front.author'
          }))
        }
        let idx = 0
        for (const author of authors) {
          const hasOrg = has(author, 'organization')
          const orgName = has(author, 'organization.#text') ? author.organization['#text'].trim() : author?.organization?.trim()
          if (hasOrg && orgName?.length < 1) {
            result.push(new ValidationWarning('EMPTY_AUTHOR_ORGANIZATION', 'The author organization is defined but empty.', {
              ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#author',
              path: `rfc.front.author[${idx}].organization`
            }))
          }
          if (!hasOrg && !author?._attr?.fullname) {
            result.push(new ValidationWarning('MISSING_AUTHOR_FULLNAME', 'The author fullname attribute is missing.', {
              ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#author',
              path: `rfc.front.author[${idx}].fullname`
            }))
          }
          if ((has(author, '_attr.asciiFullname') || has(author, '_attr.asciiInitials') || has(author, '_attr.asciiSurname')) && !author?._attr?.fullname) {
            result.push(new ValidationWarning('MISSING_AUTHOR_FULLNAME_WITH_ASCII', 'An author ascii[Fullname|Initials|Surname] attribute is defined but the fullname attribute is missing.', {
              ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#author',
              path: `rfc.front.author[${idx}].fullname`
            }))
          }
          if (has(author, 'role') && author?.role !== 'editor') {
            result.push(new ValidationWarning('INVALID_AUTHOR_ROLE', 'The author role attribute is defined but has an invalid value. Should be "editor".', {
              ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#author',
              path: `rfc.front.author[${idx}].editor`
            }))
          }
          idx++
        }
      }
      break
    }
  }

  return result
}

/**
 * Validate document references section(s)
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateReferencesSection (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  switch (doc.type) {
    case 'txt': {
      const referencesContent = doc.data.content.references

      if (!doc.data.markers.references.start) {
        switch (mode) {
          case MODES.NORMAL: {
            result.push(
              new ValidationError(
                'MISSING_REFERENCES_SECTION',
                'The references section is missing',
                {
                  ref: 'https://authors.ietf.org/required-content#references'
                }
              )
            )
            break
          }
          case MODES.FORGIVE_CHECKLIST: {
            result.push(
              new ValidationWarning(
                'MISSING_REFERENCES_SECTION',
                'The references section is missing',
                {
                  ref: 'https://authors.ietf.org/required-content#references'
                }
              )
            )
            break
          }
        }
        break
      } else if (!hasMeaningfulContent(referencesContent)) {
        switch (mode) {
          case MODES.NORMAL: {
            result.push(
              new ValidationError(
                'EMPTY_REFERENCES_SECTION',
                'The references section is present but contains no meaningful content.',
                {
                  ref: 'https://authors.ietf.org/required-content#references'
                }
              )
            )
            break
          }
          case MODES.FORGIVE_CHECKLIST: {
            result.push(
              new ValidationWarning(
                'EMPTY_REFERENCES_SECTION',
                'The references section is present but contains no meaningful content.',
                {
                  ref: 'https://authors.ietf.org/required-content#references'
                }
              )
            )
            break
          }
        }
      }

      const subsectionPattern = /^\d+\.\d+\.\s+(.+)$/i
      const normativePattern = /normative/i
      const informativePattern = /informative/i
      const subsections = []

      for (const line of referencesContent) {
        const match = subsectionPattern.test(line)
        if (match) {
          subsections.push(line)
        }
      }

      if (subsections.length === 0) {
        switch (mode) {
          case MODES.NORMAL: {
            result.push(
              new ValidationError(
                'MISSING_REFERENCES_SUBSECTIONS',
                'The references section does not contain any valid subsections.',
                {
                  ref: 'https://authors.ietf.org/required-content#references'
                }
              )
            )
            break
          }
          case MODES.FORGIVE_CHECKLIST: {
            result.push(
              new ValidationWarning(
                'MISSING_REFERENCES_SUBSECTIONS',
                'The references section does not contain any valid subsections.',
                {
                  ref: 'https://authors.ietf.org/required-content#references'
                }
              )
            )
            break
          }
        }
      } else {
        for (const subsection of subsections) {
          if (!normativePattern.test(subsection) && !informativePattern.test(subsection)) {
            switch (mode) {
              case MODES.NORMAL: {
                result.push(
                  new ValidationError(
                    'UNCLASSIFIED_REFERENCES_SUBSECTION',
                    `The subsection "${subsection}" is not classified as Normative or Informative.`,
                    {
                      ref: 'https://authors.ietf.org/required-content#references',
                      line: subsection
                    }
                  )
                )
                break
              }
              case MODES.FORGIVE_CHECKLIST: {
                result.push(
                  new ValidationWarning(
                    'UNCLASSIFIED_REFERENCES_SUBSECTION',
                    `The subsection "${subsection}" is not classified as Normative or Informative.`,
                    {
                      ref: 'https://authors.ietf.org/required-content#references',
                      line: subsection
                    }
                  )
                )
                break
              }
            }
          }
        }
      }
      break
    }
    case 'xml': {
      let refsSections = get(doc, 'data.rfc.back.references', [])
      // -> Check if there's only 1 references section, which won't be an array
      if (isPlainObject(refsSections)) {
        refsSections = [refsSections]
      }
      if (refsSections?.length > 0) {
        let idx = 0
        for (const refs of refsSections) {
          if (!refs._attr?.title) {
            switch (mode) {
              case MODES.NORMAL: {
                result.push(new ValidationError('MISSING_REFERENCES_TITLE', 'The references section is missing a title attribute.', {
                  ref: 'https://authors.ietf.org/required-content#references',
                  path: `rfc.back.references[${idx}].title`
                }))
                break
              }
              case MODES.FORGIVE_CHECKLIST: {
                result.push(new ValidationWarning('MISSING_REFERENCES_TITLE', 'The references section is missing a title attribute.', {
                  ref: 'https://authors.ietf.org/required-content#references',
                  path: `rfc.back.references[${idx}].title`
                }))
                break
              }
            }
            continue
          }
          const titleAttr = refs._attr.title.toLowerCase()
          if (!(titleAttr.indexOf('informative') >= 0 || titleAttr.indexOf('normative') >= 0)) {
            switch (mode) {
              case MODES.NORMAL: {
                result.push(new ValidationError('INVALID_REFERENCES_TITLE', 'The references section title attribute should be Normative or Informative.', {
                  ref: 'https://authors.ietf.org/required-content#references',
                  path: `rfc.back.references[${idx}].title`
                }))
                break
              }
              case MODES.FORGIVE_CHECKLIST: {
                result.push(new ValidationWarning('INVALID_REFERENCES_TITLE', 'The references section title attribute should be Normative or Informative.', {
                  ref: 'https://authors.ietf.org/required-content#references',
                  path: `rfc.back.references[${idx}].title`
                }))
                break
              }
            }
          }
          idx++
        }
      }
      break
    }
  }

  return result
}

/**
 * Validate a document IANA considerations section
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateIANAConsiderationsSection (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  switch (doc.type) {
    case 'txt': {
      // TODO: Text type validation
      break
    }
    case 'xml': {
      const sections = get(doc, 'data.rfc.middle.section', [])
      const secSection = find(sections, s => ['IANA Considerations'].includes(s.name))
      if (!secSection) {
        if (doc.docKind === 'rfc') {
          if (mode === MODES.NORMAL || mode === MODES.FORGIVE_CHECKLIST) {
            result.push(new ValidationComment('MISSING_IANA_CONSIDERATIONS_SECTION', 'The IANA considerations section is missing.', {
              ref: 'https://authors.ietf.org/en/required-content#iana-considerations'
            }))
          }
        } else {
          switch (mode) {
            case MODES.NORMAL: {
              result.push(new ValidationError('MISSING_IANA_CONSIDERATIONS_SECTION', 'The IANA considerations section is missing.', {
                ref: 'https://authors.ietf.org/en/required-content#iana-considerations'
              }))
              break
            }
            case MODES.FORGIVE_CHECKLIST: {
              result.push(new ValidationWarning('MISSING_IANA_CONSIDERATIONS_SECTION', 'The IANA considerations section is missing.', {
                ref: 'https://authors.ietf.org/en/required-content#iana-considerations'
              }))
              break
            }
          }
        }
      } else {
        const childrenTypes = Object.keys(secSection).filter(k => k !== 'name' && k !== '_attr')
        if (childrenTypes.length < 1) {
          result.push(new ValidationError('INVALID_IANA_CONSIDERATIONS_SECTION', 'The IANA considerations section is empty.', {
            ref: 'https://authors.ietf.org/en/required-content#iana-considerations'
          }))
        } else {
          for (const key of childrenTypes) {
            if (!XML_SCHEMA.section.allowedChildren.includes(key)) {
              result.push(new ValidationError('INVALID_IANA_CONSIDERATIONS_SECTION_CHILD', `The security considerations section must consist of ${XML_SCHEMA.section.allowedChildren.map(e => '<' + e + '>').join(', ')} elements only.`, {
                ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.46'
              }))
              break
            }
          }
        }
      }
      break
    }
  }

  return result
}
