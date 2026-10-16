import { last } from 'lodash-es'
import { MODES } from '../config/modes.mjs'
import { ValidationComment, ValidationError, ValidationWarning } from './error.mjs'
import { fetchRemoteDocInfo } from '../remote/common.mjs'

/**
 * Display names of the Datatracker stream slugs
 */
export const STREAM_NAMES = {
  ietf: 'IETF',
  iab: 'IAB',
  irtf: 'IRTF',
  ise: 'Independent Submission',
  editorial: 'Editorial',
  legacy: 'Legacy'
}

/**
 * Value xml2rfc uses when the <rfc> element has no submissionType attribute
 */
export const DEFAULT_SUBMISSION_TYPE = 'IETF'

const SUBMISSION_TYPE_TO_STREAM = {
  ietf: 'ietf',
  iab: 'iab',
  irtf: 'irtf',
  independent: 'ise',
  editorial: 'editorial'
}

// First lines of an RFC header naming its stream (RFC 7841 section 3.1, RFC 9280
// section 3.2.3), with or without the abbreviation
const HEADER_SOURCE_TO_STREAM = {
  'internet engineering task force (ietf)': 'ietf',
  'internet engineering task force': 'ietf',
  'internet architecture board (iab)': 'iab',
  'internet architecture board': 'iab',
  'internet research task force (irtf)': 'irtf',
  'internet research task force': 'irtf',
  'independent submission': 'ise',
  'editorial stream': 'editorial'
}

/**
 * Convert an rfcxml submissionType value (IETF, IAB, IRTF, independent, editorial)
 * to the matching Datatracker stream slug (ietf, iab, irtf, ise, editorial).
 *
 * @param {string} submissionType rfcxml submissionType value (case-insensitive)
 * @returns {string|null} Datatracker stream slug, or null if the value is not a valid submissionType
 */
export function submissionTypeToStream (submissionType) {
  return SUBMISSION_TYPE_TO_STREAM[submissionType?.toLowerCase()] ?? null
}

/**
 * Get the stream named by the first line of a text RFC header
 * (e.g. "Internet Engineering Task Force (IETF)" -> "ietf")
 *
 * @param {string} source First line of the header (left column)
 * @returns {string|null} Datatracker stream slug, or null if the line doesn't name a stream
 *   (e.g. "Network Working Group" in RFCs published before RFC 5741)
 */
export function streamFromHeaderSource (source) {
  const name = source?.trim().replace(/\s+/g, ' ').toLowerCase()
  return HEADER_SOURCE_TO_STREAM[name] ?? null
}

/**
 * Get a human-readable name for a Datatracker stream slug
 *
 * @param {string} stream Datatracker stream slug
 * @returns {string} Display name (the slug itself if unknown)
 */
export function streamDisplayName (stream) {
  return STREAM_NAMES[stream] ?? stream
}

/**
 * Get the stream implied by a draft name prefix (draft-iab-..., draft-irtf-...)
 *
 * draft-ietf-... only implies the IETF stream when asked for: an XML draft
 * named draft-ietf-... can legitimately declare another stream, but a text
 * draft has no other way to declare one.
 *
 * @param {string} name Draft name (e.g. draft-iab-foo-bar-01)
 * @param {Object} [opts] Additional options
 * @param {boolean} [opts.ietf=false] Whether draft-ietf-... implies the IETF stream
 * @returns {string|null} 'iab', 'irtf' (or 'ietf'), or null if the name doesn't imply a stream
 */
export function streamFromDraftName (name, { ietf = false } = {}) {
  const prefix = name?.toLowerCase().match(/^draft-([a-z0-9]+)-/)?.[1]
  return ['iab', 'irtf', ...(ietf ? ['ietf'] : [])].includes(prefix) ? prefix : null
}

/**
 * Extract the stream slug from a Datatracker stream value
 * (e.g. "/api/v1/name/streamname/ietf/" -> "ietf")
 *
 * @param {string} value Datatracker stream URI or slug
 * @returns {string|null} Stream slug, or null if there is no stream
 */
export function parseDatatrackerStream (value) {
  if (!value || typeof value !== 'string') {
    return null
  }
  return last(value.split('/').filter(p => p))?.toLowerCase() ?? null
}

/**
 * Fetch the current stream of a document from Datatracker
 *
 * @param {string} docName Document name (version suffix is ignored)
 * @returns {Promise<Object|null>} null if Datatracker doesn't know the document (or can't be reached),
 *   otherwise { stream } where stream is the slug or null if the document has no stream yet
 */
export async function fetchDatatrackerStream (docName) {
  const docInfo = await fetchRemoteDocInfo(docName)
  if (!docInfo) {
    return null
  }
  return { stream: parseDatatrackerStream(docInfo.stream) }
}

/**
 * Compare a declared stream with the stream Datatracker has for the document
 *
 * How serious a disagreement is depends on the mode:
 *
 * | Datatracker stream | normal | forgive-checklist | submission |
 * |--------------------|--------|-------------------|------------|
 * | none yet           | Error  | Warning           | Comment    |
 * | different          | Error  | Warning           | Error      |
 *
 * Nothing is reported when Datatracker doesn't know the document (or can't be reached).
 *
 * @param {string} docName Document name to look up (draft name or rfcNNNN)
 * @param {string} declaredStream Datatracker stream slug the document declares
 * @param {Object} opts Options
 * @param {string} opts.declared Start of the message, saying where the stream is declared
 * @param {string} [opts.docType='draft'] What the document is called in the message (draft, RFC)
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {Object} [opts.findingOpts] Options of the findings (ref, path, lines)
 * @returns {Promise<Array>} SUBMISSION_TYPE_UNEXPECTED finding, or empty if Datatracker agrees
 */
export async function checkDatatrackerStream (docName, declaredStream, { declared, docType = 'draft', mode = MODES.NORMAL, findingOpts = {} }) {
  const existing = await fetchDatatrackerStream(docName)

  // -> Existing version on Datatracker has no stream yet
  if (existing && !existing.stream) {
    const message = `${declared}, but Datatracker has no stream for this ${docType} yet.`
    if (mode === MODES.SUBMISSION) {
      return [new ValidationComment('SUBMISSION_TYPE_UNEXPECTED', message, findingOpts)]
    } else if (mode === MODES.FORGIVE_CHECKLIST) {
      return [new ValidationWarning('SUBMISSION_TYPE_UNEXPECTED', message, findingOpts)]
    }
    return [new ValidationError('SUBMISSION_TYPE_UNEXPECTED', message, findingOpts)]
  // -> Existing stream doesn't match the declared stream
  } else if (existing && existing.stream !== declaredStream) {
    const message = `${declared}, but Datatracker has this ${docType} in the ${streamDisplayName(existing.stream)} stream.`
    if (mode === MODES.FORGIVE_CHECKLIST) {
      return [new ValidationWarning('SUBMISSION_TYPE_UNEXPECTED', message, findingOpts)]
    }
    return [new ValidationError('SUBMISSION_TYPE_UNEXPECTED', message, findingOpts)]
  }

  return []
}
