import { MODES } from '../config/modes.mjs'
import { ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { get } from 'lodash-es'

const VALID_BASE_NAME_CHARS_RE = /^[a-z0-9-]+$/
const VALID_VERSION_SUFFIX_RE = /-[0-9]{2}$/

// Datatracker's validate_submission_name: "draft-", a letter, then lowercase
// letters, digits and hyphens, at most 50 characters without the revision
const NAME_CHARS_RE = /^draft-[a-z][-a-z0-9]*$/
const NAME_MAX_LENGTH = 50
// Datatracker splits a declared name into a name and a two-digit revision
const NAME_REVISION_RE = /^(.*?)(?:-([0-9]{2}))?$/

const errRefUrl = 'https://authors.ietf.org/naming-your-internet-draft'

/**
 * Severity of a finding that Datatracker's submission checks reject: an Error
 * in submission mode, where it would block the upload, and a Warning otherwise
 *
 * @param {number} mode Validation mode
 * @returns {typeof ValidationError} Finding class
 */
function submissionSeverity (mode) {
  return mode === MODES.SUBMISSION ? ValidationError : ValidationWarning
}

/**
 * Split an Internet-Draft name into the name proper and its revision
 *
 * @param {string} name Name, with or without a -NN revision
 * @returns {{ stem: string, revision: string|undefined }} Name without revision, and revision
 */
function splitRevision (name) {
  const [, stem, revision] = NAME_REVISION_RE.exec(name)
  return { stem, revision }
}

/**
 * Check an Internet-Draft name against the rules Datatracker applies to the
 * name of a submission (validate_submission_name and validate_submission_rev)
 *
 * @param {string} name Name to check, with its revision
 * @param {string} prefix Code prefix (FILENAME or DOCNAME)
 * @param {string} subject What the name is, for the messages
 * @param {Object} opts Additional options
 * @param {number} opts.mode Validation mode
 * @param {string} [opts.path] Path of the name in an XML document
 * @returns {Array} List of findings
 */
function checkDraftName (name, prefix, subject, { mode, path }) {
  const result = []
  const Severity = submissionSeverity(mode)
  const opts = { ref: errRefUrl, ...(path && { path }) }
  // A name given with a file name extension is reported once, as such
  const extension = /\.(txt|xml)$/i.test(name)
  const { stem, revision } = splitRevision(extension ? name.slice(0, -4) : name)

  if (!stem.startsWith('draft-')) {
    result.push(new Severity(`${prefix}_MISSING_DRAFT_PREFIX`, `${subject} "${name}" must start with "draft-".`, opts))
  } else if (extension || !NAME_CHARS_RE.test(stem)) {
    const hint = name.includes('.') ? ' Was a file name extension included by mistake?' : ''
    result.push(new Severity(`${prefix}_INVALID_CHARS`, `${subject} "${name}" must consist of lowercase letters, digits and hyphens only, with a letter after "draft-".${hint}`, opts))
  }

  if (stem.length > NAME_MAX_LENGTH) {
    result.push(new Severity(`${prefix}_TOO_LONG`, `${subject} "${name}" must be at most ${NAME_MAX_LENGTH} characters long without its revision; found ${stem.length}.`, opts))
  }

  const components = stem.split('-')
  if (components.includes('')) {
    result.push(new Severity(`${prefix}_EMPTY_COMPONENT`, `${subject} "${name}" must not contain adjacent hyphens or end with a hyphen.`, opts))
  } else if (components.length < 3) {
    result.push(new Severity(`${prefix}_MISSING_COMPONENTS`, `${subject} "${name}" must consist of at least 3 hyphen-separated components before the revision (e.g. draft-author-subject-00).`, opts))
  }

  if (!revision) {
    result.push(new Severity(`${prefix}_INVALID_VERSION_SUFFIX`, `${subject} "${name}" must end with a two-digit revision (e.g. -00).`, opts))
  }

  return result
}

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
  if (filename.length > 72) {
    if (filename.length > 255) {
      result.push(new ValidationError('FILENAME_TOO_LONG', 'Filename cannot exceed 255 characters, including the extension.', { ref: errRefUrl }))
    } else {
      result.push(new ValidationWarning('FILENAME_TOO_LONG', 'Filename exceeds 72 characters, including the extension. Consider using a shorter filename.', { ref: errRefUrl }))
    }
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
 * Validate the name declared in the document, and that the filename matches it
 *
 * For an Internet-Draft, the declared name (docName in XML, the name on the
 * first page in text) must pass Datatracker's submission name checks.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateDocName (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const filenameParts = doc.filename.split('.')

  if (doc.docKind === 'rfc') {
    return result
  }

  const declaredName = doc.type === 'xml'
    ? get(doc, 'data.rfc._attr.docName')?.trim()
    : get(doc, 'data.slug')?.replace(/\.txt$/, '')

  // -> No declared name
  if (!declaredName) {
    // (a text document without one is reported as DOCUMENT_NAME_MISSING)
    if (doc.type === 'xml') {
      result.push(new (submissionSeverity(mode))('DOCNAME_MISSING', 'The document does not declare its name (the docName attribute of the <rfc> element).', { ref: errRefUrl, path: 'rfc.docName' }))
    }
    return result
  }

  // -> Declared name
  result.push(...checkDraftName(declaredName, 'DOCNAME', 'Document name', {
    mode,
    path: doc.type === 'xml' ? 'rfc.docName' : undefined
  }))

  // -> Filename matches the declared name
  if (filenameParts[0] !== declaredName) {
    result.push(new ValidationError('FILENAME_DOCNAME_MISMATCH', 'Filename does not match the name declared in the document.', { ref: errRefUrl }))
  }

  return result
}
