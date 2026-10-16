import { MODES } from '../config/modes.mjs'
import { ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { get } from 'lodash-es'

// Datatracker's validate_submission_name: "draft-", a letter, then lowercase
// letters, digits and hyphens, at most 50 characters without the revision
const NAME_CHARS_RE = /^draft-[a-z][-a-z0-9]*$/
const NAME_MAX_LENGTH = 50
// Datatracker splits a declared name into a name and a two-digit revision
const NAME_REVISION_RE = /^(.*?)(?:-([0-9]{2}))?$/

// Characters Datatracker refuses in the name of an uploaded file
const UPLOAD_INVALID_CHARS_RE = /[&\\/;*$\s]/

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
 * Split a file name into its base name and extension, the extension being
 * whatever follows the last dot. The ".v2v3" that `xml2rfc --v2v3` adds to the
 * name of the file it writes is not part of the base name.
 *
 * @param {string} filename File name
 * @returns {{ base: string, ext: string|null }} Base name and lowercased extension (null without one)
 */
export function splitFilename (filename) {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) {
    return { base: filename, ext: null }
  }
  const ext = filename.slice(dot + 1).toLowerCase()
  let base = filename.slice(0, dot)
  if (ext === 'xml' && base.toLowerCase().endsWith('.v2v3')) {
    base = base.slice(0, -5)
  }
  return { base, ext }
}

/**
 * Validate a filename
 *
 * Only what Datatracker checks in the name of an uploaded file: the extension
 * and a few characters, plus any dot besides the one before the extension.
 * How the name itself is built is checked against the name declared in the
 * document, see validateDocName.
 * https://authors.ietf.org/naming-your-internet-draft
 *
 * @param {string} filename Filename to check
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateFilename (filename, { mode = MODES.NORMAL } = {}) {
  const result = []
  const Severity = submissionSeverity(mode)
  const { base, ext } = splitFilename(filename)

  // Check extension (Datatracker accepts either case)
  if (ext === null) {
    result.push(new Severity('FILENAME_MISSING_EXTENSION', 'Filename must have an extension.', { ref: errRefUrl }))
  } else if (!['txt', 'xml'].includes(ext)) {
    result.push(new Severity('FILENAME_EXTENSION_INVALID', 'Filename extension must be either .txt or .xml.', { ref: errRefUrl }))
  }

  // Check filename characters
  if (base.includes('.')) {
    result.push(new Severity('FILENAME_TOO_MANY_DOTS', 'Filename cannot have more than 1 dot, only to separate the base name from the extension.', { ref: errRefUrl }))
  }
  // (the name itself, letter case included, is checked against the declared name)
  if (UPLOAD_INVALID_CHARS_RE.test(base)) {
    result.push(new Severity('FILENAME_INVALID_CHARS', 'Filename contains characters Datatracker does not accept in an upload: & \\ / ; * $ or whitespace.', { ref: errRefUrl }))
  }

  return result
}

/**
 * Validate the name declared in the document, and that the filename matches it
 *
 * For an Internet-Draft, the declared name (docName in XML, the name on the
 * first page in text) must pass Datatracker's submission name checks, and the
 * filename must be that name. For an RFC, the filename must be rfc<number>.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateDocName (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const { base } = splitFilename(doc.filename)
  // A filename that isn't the document's own name blocks an RFC's publication
  const MismatchSeverity = mode === MODES.NORMAL ? ValidationError : ValidationWarning
  const mismatch = (message) => new MismatchSeverity('FILENAME_DOCNAME_MISMATCH', message, { ref: errRefUrl })

  // (the text parser also takes a text document named rfcNNNN.txt for an RFC,
  // so one carrying the Internet-Draft indicator is compared as a draft)
  const isRFC = doc.docKind === 'rfc' && !(doc.type === 'txt' && get(doc, 'data.contains.idIndication'))
  if (isRFC) {
    const number = String((doc.type === 'xml' ? get(doc, 'data.rfc._attr.number') : get(doc, 'data.header.rfcNumber')) ?? '').trim()
    if (/^[0-9]+$/.test(number)) {
      const fileNumber = /^rfc([0-9]+)$/i.exec(base)?.[1]
      if (!fileNumber || Number(fileNumber) !== Number(number)) {
        result.push(mismatch(`Filename does not match the RFC number declared in the document (expected rfc${Number(number)}).`))
      }
    }
    return result
  }

  const declaredName = doc.type === 'xml'
    ? get(doc, 'data.rfc._attr.docName')?.trim()
    : get(doc, 'data.slug')?.replace(/\.txt$/, '')

  // -> No declared name: check the filename in its place
  if (!declaredName) {
    // (a text document without one is reported as DOCUMENT_NAME_MISSING)
    if (doc.type === 'xml') {
      result.push(new (submissionSeverity(mode))('DOCNAME_MISSING', 'The document does not declare its name (the docName attribute of the <rfc> element).', { ref: errRefUrl, path: 'rfc.docName' }))
    }
    result.push(...checkDraftName(base, 'FILENAME', 'Filename', { mode }))
    return result
  }

  // -> Declared name
  result.push(...checkDraftName(declaredName, 'DOCNAME', 'Document name', {
    mode,
    path: doc.type === 'xml' ? 'rfc.docName' : undefined
  }))

  // -> Filename matches the declared name
  // (a declared name given with an extension is reported as DOCNAME_INVALID_CHARS)
  const comparedName = declaredName.replace(/\.(txt|xml)$/i, '')
  if (base !== comparedName) {
    const fileName = splitRevision(base)
    const docName = splitRevision(comparedName)
    if (!fileName.revision && docName.revision && fileName.stem === docName.stem) {
      // Same name without its revision, a common pattern while drafting
      result.push(new (submissionSeverity(mode))('FILENAME_INVALID_VERSION_SUFFIX', `Filename does not end with the revision of the document name "${declaredName}".`, { ref: errRefUrl }))
    } else if (!(fileName.revision && !docName.revision && fileName.stem === docName.stem)) {
      // (a declared name missing its revision is reported as DOCNAME_INVALID_VERSION_SUFFIX)
      result.push(mismatch(`Filename does not match the name declared in the document ("${declaredName}").`))
    }
  }

  return result
}
