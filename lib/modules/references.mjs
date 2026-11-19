import { ValidationComment, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { CERTAINTY } from '../model/indexes.mjs'
import { getDraftRevisionMismatches, getReferenceLinks } from '../model/references.mjs'

const RFC_REFERENCE_STYLE_REF = 'https://www.rfc-editor.org/styleguide/part2/#ref_rfcs'

// Most locations given for a finding
const MAX_LINES = 20

// A link to an RFC's text rather than to its info page: the /rfc/ path of rfc-editor.org, with or
// without www, over http or https, to the RFC itself or to one of its formats
const RFC_TEXT_URL_RE = /^(?:https?:\/\/)?(?:www\.)?rfc-editor\.org\/rfc\/rfc0*(\d+)(?:\.(?:txt|html|pdf|xml))?\/?$/i

/**
 * URL of the info page of an RFC, where references to it should link to
 *
 * @param {string} rfc RFC number, without leading zeros
 * @returns {string} URL of the info page
 */
function infoUrl (rfc) {
  return `https://www.rfc-editor.org/info/rfc${rfc}`
}

/**
 * Info page URL to give instead of a link to an RFC's text
 *
 * @param {string} url Link
 * @returns {string|null} URL of the info page of the RFC, null when the link is not one to an RFC's text
 */
function expectedInfoUrl (url) {
  const rfc = String(url ?? '').trim().match(RFC_TEXT_URL_RE)?.[1]
  return rfc ? infoUrl(rfc) : null
}

/**
 * Validate that references to RFCs link to the RFC's info page, https://www.rfc-editor.org/info/rfcN,
 * as published RFCs and the RFC Editor's bibliography entries do, rather than to its text at
 * https://www.rfc-editor.org/rfc/rfcN (with any extension).
 *
 * In an XML document, the explicit target attributes of <reference> elements are checked; in a
 * text document, the URLs in the references section, joined back together when wrapped across lines.
 * One finding is given for the whole document: a Warning for XML, a Comment for text.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateRfcReferenceUrls (doc, { mode = MODES.NORMAL } = {}) {
  if (mode === MODES.SUBMISSION) {
    return []
  }

  const found = getReferenceLinks(doc)
    .map((link) => ({ ...link, expected: expectedInfoUrl(link.url) }))
    .filter((link) => link.expected)
  if (found.length === 0) {
    return []
  }

  const [first] = found
  const others = found.length > 1 ? ` (and ${found.length - 1} more)` : ''
  const message = `References to RFCs should link to the RFC's info page, https://www.rfc-editor.org/info/rfcN. Found ${found.length} ${found.length > 1 ? 'links' : 'link'} to RFC text instead: ${first.url}${others}; for that one, use ${first.expected}.`
  if (first.certainty === CERTAINTY.DECLARED) {
    // -> The author wrote the target
    return [new ValidationWarning('RFC_REFERENCE_URL_FORMAT', message, { ref: RFC_REFERENCE_STYLE_REF, ...first.location })]
  }
  // -> In a text draft these links mostly come from xml2rfc's default for references without a target,
  //    which is /rfc/ until xml2rfc switches to /info/: once it renders /info/, report this as a Warning
  //    under RFC_REFERENCE_URL_FORMAT, as for XML
  return [new ValidationComment('RENDERED_RFC_REFERENCE_URL_FORMAT', `${message} xml2rfc currently renders references without a target this way and will switch to /info/: if this document was produced by xml2rfc from XML without explicit targets, nothing needs changing in the source.`, {
    ref: RFC_REFERENCE_STYLE_REF,
    lines: found.slice(0, MAX_LINES).flatMap((link) => link.location.lines)
  })]
}

const DRAFT_REFERENCE_STYLE_REF = 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.6.4'

/**
 * Validate that a reference to a draft links to the revision it cites: an entry whose link names one
 * revision of a draft and whose text (text document) or Internet-Draft <seriesInfo> (XML document)
 * names another leaves the reader unsure which is meant, and the stale-revision check follows the link
 * (text) or the <seriesInfo> (XML). One Warning per entry, located at its label (text) or <reference>
 * (XML). Only links to IETF hosts are looked at; not reported in submission mode, like the other checks
 * of what a reference cites.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateDraftReferenceRevisions (doc, { mode = MODES.NORMAL } = {}) {
  if (mode === MODES.SUBMISSION) {
    return []
  }

  return getDraftRevisionMismatches(doc).map((mismatch) => {
    // -> A declared reference names its draft in its <seriesInfo>, an inferred one in the text of its entry
    const where = mismatch.certainty === CERTAINTY.DECLARED ? 'its <seriesInfo>' : 'its text'
    const pairs = mismatch.drafts.map(({ linked, named }) => `links to ${linked} but ${where} names ${named.join(' and ')}`)
    const label = mismatch.label === null ? '' : `[${mismatch.label}] `
    return new ValidationWarning(
      'DRAFT_REFERENCE_REVISION_MISMATCH',
      `Reference ${label}${pairs.join('; it ')}. Make both name the revision meant.`,
      { ref: DRAFT_REFERENCE_STYLE_REF, ...mismatch.location }
    )
  })
}
