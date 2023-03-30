import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { find, get, has, isPlainObject } from 'lodash-es'
import { findChildWith } from '../helpers/traversal.mjs'

/**
 * Validate a document abstract section
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export function validateAbstractSection (doc, { mode = MODES.NORMAL } = {}) {
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
          if (!['dl', 'ol', 't', 'ul'].includes(key)) {
            result.push(new ValidationError('INVALID_ABSTRACT_SECTION_CHILD', 'The abstract section must consist of <dl>, <ol>, <t> or <ul> elements only.', {
              ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.1',
              path: `rfc.front.abstract.${key}`
            }))
            break
          }
        }
        const refEntryFound = findChildWith(doc.data.rfc.front.abstract, (v, k) => { return k === 'xref' })
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
export function validateIntroductionSection (doc, { mode = MODES.NORMAL } = {}) {
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
            if (!['artwork', 'aside', 'blockquote', 'dl', 'figure', 'iref', 'ol', 'sourcecode', 't', 'table', 'texttable', 'ul'].includes(key)) {
              result.push(new ValidationError('INVALID_INTRODUCTION_SECTION_CHILD', 'The introduction section must consist of <artwork>, <aside>, <blockquote>, <dl>, <figure>, <iref>, <ol>, <sourcecode>, <t>, <table>, <texttable> or <ul> elements only.', {
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
