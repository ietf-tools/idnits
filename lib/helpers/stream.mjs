import { last } from 'lodash-es'
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
 * @param {string} name Draft name (e.g. draft-iab-foo-bar-01)
 * @returns {string|null} 'iab' or 'irtf', or null if the name doesn't imply a stream
 */
export function streamFromDraftName (name) {
  const prefix = name?.toLowerCase().match(/^draft-([a-z0-9]+)-/)?.[1]
  return ['iab', 'irtf'].includes(prefix) ? prefix : null
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
