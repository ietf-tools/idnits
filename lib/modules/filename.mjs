import { MODES } from '../config/modes.mjs'
import { ValidationError } from '../helpers/error.mjs'
import { get } from 'lodash-es'

const VALID_BASE_NAME_CHARS_RE = /^[a-z0-9-]+$/
const VALID_VERSION_SUFFIX_RE = /-[0-9]{2}$/

const errRefUrl = 'https://authors.ietf.org/naming-your-internet-draft'

/**
 * Validate a filename
 * https://authors.ietf.org/naming-your-internet-draft
 *
 * @param {string} filename Filename to check
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateFilename (filename, { mode = MODES.NORMAL } = {}) {
  const result = []
  const filenameParts = filename.split('.')

  // Check filename parts
  if (filenameParts.length < 2) {
    result.push(new ValidationError('FILENAME_MISSING_EXTENSION', 'Filename must have an extension.', { ref: errRefUrl }))
  } else if (filenameParts.length > 2) {
    result.push(new ValidationError('FILENAME_TOO_MANY_DOTS', 'Filename cannot have more than 1 dot, only to separate the base name from the extension.', { ref: errRefUrl }))
  }

  // Check filename characters
  if (!VALID_BASE_NAME_CHARS_RE.test(filenameParts[0])) {
    result.push(new ValidationError('FILENAME_INVALID_CHARS', 'Filename contains invalid characters. Must consist of lower alpha, digits and dash only.', { ref: errRefUrl }))
  }

  // Check extension
  if (!['txt', 'xml'].includes(filenameParts[1])) {
    result.push(new ValidationError('FILENAME_EXTENSION_INVALID', 'Filename extension must be either .txt or .xml.', { ref: errRefUrl }))
  }

  // Check length
  if (filename.length > 50) {
    result.push(new ValidationError('FILENAME_TOO_LONG', 'Filename cannot exceed 50 characters, including the extension.', { ref: errRefUrl }))
  }

  // Ensure filename starts with draft-
  if (!filename.startsWith('draft-')) {
    result.push(new ValidationError('FILENAME_MISSING_DRAFT_PREFIX', 'Filename must start with "draft-".', { ref: errRefUrl }))
  }

  // Ensure filename ends with a version
  if (!VALID_VERSION_SUFFIX_RE.test(filenameParts[0])) {
    result.push(new ValidationError('FILENAME_INVALID_VERSION_SUFFIX', 'Filename must end with a version in format 00.', { ref: errRefUrl }))
  }

  // Ensure filename has at least 4 components
  if (filenameParts[0].split('-').length < 4) {
    result.push(new ValidationError('FILENAME_MISSING_COMPONENTS', 'Filename must consists of at least 4 components (e.g. draft-author-subject-version).', { ref: errRefUrl }))
  }

  return result
}

/**
 * Validate a filename match document name
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateDocName (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const filenameParts = doc.filename.split('.')

  switch (doc.type) {
    case 'txt': {
      if (filenameParts[0] !== get(doc, 'data.slug')) {
        result.push(new ValidationError('FILENAME_DOCNAME_MISMATCH', 'Filename does not match the name declared in the document.', { ref: errRefUrl }))
      }
      break
    }
    case 'xml': {
      if (filenameParts[0] !== get(doc, 'data.rfc._attr.docName')) {
        result.push(new ValidationError('FILENAME_DOCNAME_MISMATCH', 'Filename does not match the name declared in the document.', { ref: errRefUrl }))
      }
      break
    }
  }

  return result
}
