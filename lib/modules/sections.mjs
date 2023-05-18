import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { XML_SCHEMA } from '../config/schema.mjs'
import { find, get, has, isPlainObject } from 'lodash-es'
import { findDescendantWith } from '../helpers/traversal.mjs'

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
      // TODO: Text type validation
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
      // TODO: Text type validation
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
      // TODO: Text type validation
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
      // TODO: Text type validation
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
          if (hasOrg && author?.organization?.trim()?.length < 1) {
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
