import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { XML_SCHEMA } from '../config/schema.mjs'
import { findIndex, get, has, isPlainObject } from 'lodash-es'
import { findAllDescendantsWith, findDescendantWith } from '../helpers/traversal.mjs'
import { getReferencesSections } from '../helpers/references.mjs'
import { listXmlReferences, maskCommentsAndCdata } from '../helpers/xml-references.mjs'
import { getMiddleSections, getSectionName } from '../helpers/sections.mjs'
import { getLocations } from '../parsers/txt.mjs'

const MIN_SECTION_CONTENT_LENGTH = 2
// -> Number of locations listed in a finding
const MAX_LINES = 20

/**
 * Location of a line of a text document, where its text starts
 *
 * @param {Object} doc Parsed text document
 * @param {number} line Line (1-based), 0 when unknown
 * @returns {Array<{line: number, pos: number}>|undefined} The location, or undefined when unknown
 */
function lineLocation (doc, line) {
  const text = line ? doc.body?.split(/\r?\n/)[line - 1] : undefined
  return text === undefined ? undefined : [{ line, pos: text.length - text.trimStart().length + 1 }]
}

/**
 * Locations of the lines the text parser keeps as the content of a section (e.g. doc.data.content.references),
 * found by matching them in order to the lines of the document after the table of contents
 *
 * @param {Object} doc Parsed text document
 * @param {string[]} entries Lines kept as the content of a section, trimmed
 * @param {number} fromLine Line (1-based) the first entry is on or after
 * @returns {Array<{line: number, pos: number}|undefined>} Location of each entry, undefined when not found
 */
function contentLocations (doc, entries, fromLine) {
  const lines = doc.body?.split(/\r?\n/) ?? []
  let idx = Math.max(fromLine - 1, 0)
  return entries.map((entry) => {
    while (idx < lines.length && lines[idx].trim() !== entry) idx++
    if (idx >= lines.length) return undefined
    const text = lines[idx++]
    return { line: idx, pos: text.length - text.trimStart().length + 1 }
  })
}

/**
 * Line after which the sections of the body of a text document start: the end of the table of contents,
 * else of the header
 *
 * @param {Object} doc Parsed text document
 * @returns {number} Line (1-based)
 */
function bodyStartLine (doc) {
  const markers = doc.data.markers ?? {}
  return Math.max(markers.toc?.end ?? 0, markers.header?.end ?? 0) + 1
}

/**
 * Value of the lines option of a finding: the locations, at most MAX_LINES, or undefined when there are none
 *
 * @param {Array<{line: number, pos: number}|undefined>} locations Locations
 * @returns {Array<{line: number, pos: number}>|undefined} Lines option
 */
function linesOption (locations) {
  const lines = locations.filter(Boolean).slice(0, MAX_LINES)
  return lines.length ? lines : undefined
}

/**
 * A letter of a script other than Latin. Accented Latin letters, digits, punctuation and
 * letters shared by all scripts (e.g. U+02BB MODIFIER LETTER TURNED COMMA) don't match.
 */
const NON_LATIN_LETTER_RE = /[^\P{L}\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u

/**
 * Decode the numeric character references (e.g. &#x5F20; or &#20013;) that the
 * XML parser leaves in attribute values
 *
 * @param {string} value Attribute value
 * @returns {string} Attribute value with numeric character references decoded
 */
function decodeCharRefs (value) {
  return value.replaceAll(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (match, hex, dec) => {
    const codePoint = hex ? parseInt(hex, 16) : parseInt(dec, 10)
    return codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : match
  })
}

/**
 * Get the trimmed text content of a parsed XML element
 *
 * An element with attributes is parsed to an object, whose text (if any) is
 * under '#text', and a numeric text content is parsed to a number.
 *
 * @param {*} value Parsed element value
 * @returns {string} Trimmed text content, empty if there is none
 */
function getElementText (value) {
  const text = isPlainObject(value) ? value['#text'] : value
  return text === undefined || text === null ? '' : String(text).trim()
}

/**
 * RFC 8792 folding header, e.g. "===== NOTE: '\' line wrapping per RFC 8792 =====",
 * for either the single (\) or the double (\\) backslash strategy
 */
const RFC8792_FOLDING_HEADER = /^[ \t=]*NOTE: '\\\\?' line wrapping per RFC 8792[ \t=\r]*$/m

/**
 * Whether a parsed <reference> is RFC 8792, by its anchor or its RFC seriesInfo
 *
 * @param {Object} ref Parsed <reference> element
 * @returns {boolean} True if the reference is RFC 8792
 */
function isRfc8792Reference (ref) {
  if (!ref?._attr?.anchor) { return false }
  if (/^RFC0*8792$/i.test(ref._attr.anchor)) { return true }
  return [ref.seriesInfo, ref.front?.seriesInfo]
    .flat()
    .some(info => info?._attr?.name === 'RFC' && String(info._attr.value).trim() === '8792')
}

/**
 * Report the children of a parsed <section> that xml2rfc's grammar doesn't allow
 * there (see XML_SCHEMA.section), once per kind of child
 *
 * @param {Object} section Parsed <section> element
 * @param {string} code Error code to report
 * @param {string} label Name of the section in messages, e.g. "introduction section"
 * @param {string} path Path of the section
 * @returns {ValidationError[]} One error per disallowed kind of child
 */
function validateSectionChildren (section, code, label, path) {
  const allowed = XML_SCHEMA.section.allowedChildren.map(e => '<' + e + '>').join(', ')
  return Object.keys(section)
    .filter(k => k !== 'name' && k !== '_attr' && !XML_SCHEMA.section.allowedChildren.includes(k))
    .map(k => {
      // The parser keeps text found directly in the section, outside of any element, as #text
      const what = k === '#text' ? 'text outside of any element' : `a <${k}> element`
      return new ValidationError(code, `The ${label} contains ${what}, which is not allowed in a section. A section can only contain ${allowed} elements.`, {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.46',
        path: k === '#text' ? path : `${path}.${k}`
      })
    })
}

/**
 * Report a required section that is present but empty: an Error, except in submission mode,
 * where it is a Warning so that an early draft with a placeholder section can still be submitted
 *
 * @param {number} mode Validation mode
 * @param {string} code Code to report
 * @param {string} message Message to report
 * @param {Object} opts Options of the finding (ref, lines, path)
 * @returns {ValidationError|ValidationWarning} The finding
 */
function emptySectionFinding (mode, code, message, opts) {
  return mode === MODES.SUBMISSION ? new ValidationWarning(code, message, opts) : new ValidationError(code, message, opts)
}

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
      } else if (!doc.data.content.abstract || doc.data.content.abstract?.length < MIN_SECTION_CONTENT_LENGTH) {
        result.push(emptySectionFinding(mode, 'EMPTY_ABSTRACT_SECTION', 'The abstract section is present but contains no meaningful content.', {
          ref: 'https://authors.ietf.org/required-content#abstract',
          lines: lineLocation(doc, doc.data.markers.abstract.start)
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
        const isNotAllowedRfc = rfc => !updatesRfc.includes(rfc) && !obsoletesRfc.includes(rfc)
        const notAllowedRfcReferences = rfcMatches.filter(isNotAllowedRfc)

        // -> Where each line of the abstract, and so each offset in its joined text, is in the document
        const entryLocations = contentLocations(doc, doc.data.content.abstract, doc.data.markers.abstract.start)
        const entryOffsets = []
        doc.data.content.abstract.reduce((offset, entry) => { entryOffsets.push(offset); return offset + entry.length + 1 }, 0)
        const locateOffset = (offset) => {
          const idx = entryOffsets.findLastIndex(start => start <= offset)
          const loc = entryLocations[idx]
          return loc && { line: loc.line, pos: loc.pos + offset - entryOffsets[idx] }
        }
        // -> Where the text a pattern matches is (a match wrapped across lines is where it starts)
        const matchLocations = (pattern, keep = () => true) => {
          return [...abstractContent.matchAll(new RegExp(pattern.source, 'gi'))].filter(keep).map(match => locateOffset(match.index))
        }

        const validateReference = (pattern, errorCode, errorMessage, keep) => {
          if (pattern.test(abstractContent)) {
            switch (mode) {
              case MODES.NORMAL: {
                result.push(new ValidationError(errorCode, errorMessage, {
                  ref: 'https://authors.ietf.org/required-content#abstract',
                  lines: linesOption(matchLocations(pattern, keep))
                }))
                break
              }
              case MODES.FORGIVE_CHECKLIST: {
                result.push(new ValidationWarning(errorCode, errorMessage, {
                  ref: 'https://authors.ietf.org/required-content#abstract',
                  lines: linesOption(matchLocations(pattern, keep))
                }))
                break
              }
            }
          }
        }

        if (notAllowedRfcReferences.length > 0) validateReference(rfcReferencePattern, 'INVALID_ABSTRACT_SECTION_REF', 'The abstract section should not contain references to RFCs.', match => isNotAllowedRfc(match[0].match(/\d+/)[0]))
        validateReference(urlPattern, 'INVALID_ABSTRACT_SECTION_URL', 'The abstract section should not contain URLs.')
        validateReference(sectionReferencePattern, 'INVALID_ABSTRACT_SECTION_REF', 'The abstract section should not contain references to sections or appendices.')
        validateReference(internetDraftReferencePattern, 'INVALID_ABSTRACT_SECTION_ID_REF', 'The abstract section should not contain references to Internet-Drafts.')
        validateReference(customReferencePattern, 'INVALID_ABSTRACT_SECTION_CUSTOM_REF', 'The abstract section should not contain custom references like [REST].')
      }
      break
    }
    case 'xml': {
      const abstractSection = get(doc, 'data.rfc.front.abstract')
      const childrenTypes = isPlainObject(abstractSection) ? Object.keys(abstractSection).filter(k => k !== '_attr') : []
      if (!has(doc, 'data.rfc.front.abstract')) {
        result.push(new ValidationError('MISSING_ABSTRACT_SECTION', 'The abstract section is missing.', {
          ref: 'https://authors.ietf.org/required-content#abstract',
          path: 'rfc.front.abstract'
        }))
      } else if (childrenTypes.length < 1) {
        result.push(emptySectionFinding(mode, 'INVALID_ABSTRACT_SECTION', 'The abstract section must consist of at least 1 <dl>, <ol>, <t> or <ul> element.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.1',
          path: 'rfc.front.abstract'
        }))
      } else {
        for (const key of childrenTypes) {
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
        if (doc.data.content.introduction?.length < MIN_SECTION_CONTENT_LENGTH) {
          result.push(
            emptySectionFinding(
              mode,
              'EMPTY_INTRODUCTION_SECTION',
              'The first section is present but contains no meaningful content.',
              {
                ref: 'https://authors.ietf.org/en/required-content#introduction',
                lines: lineLocation(doc, doc.data.markers.introduction.start)
              }
            )
          )
        }
      }
      break
    }
    case 'xml': {
      const sections = getMiddleSections(doc)
      const introSectionIdx = findIndex(sections, s => ['Introduction', 'Overview', 'Background'].includes(getSectionName(s)))
      const introSection = introSectionIdx >= 0 ? sections[introSectionIdx] : null
      if (!introSection) {
        switch (mode) {
          case MODES.NORMAL: {
            result.push(new ValidationError('MISSING_INTRODUCTION_SECTION', 'The introduction section is missing.', {
              ref: 'https://authors.ietf.org/en/required-content#introduction',
              path: 'rfc.middle.section'
            }))
            break
          }
          case MODES.FORGIVE_CHECKLIST: {
            result.push(new ValidationWarning('MISSING_INTRODUCTION_SECTION', 'The introduction section is missing.', {
              ref: 'https://authors.ietf.org/en/required-content#introduction',
              path: 'rfc.middle.section'
            }))
            break
          }
        }
      } else {
        const childrenTypes = Object.keys(introSection).filter(k => k !== 'name' && k !== '_attr')
        if (childrenTypes.length < 1) {
          result.push(emptySectionFinding(mode, 'INVALID_INTRODUCTION_SECTION', 'The introduction section is empty.', {
            ref: 'https://authors.ietf.org/en/required-content#introduction',
            path: `rfc.middle.section[${introSectionIdx}]`
          }))
        } else {
          result.push(...validateSectionChildren(introSection, 'INVALID_INTRODUCTION_SECTION_CHILD', 'introduction section', `rfc.middle.section[${introSectionIdx}]`))
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
        if (doc.data.content.securityConsiderations?.length < MIN_SECTION_CONTENT_LENGTH) {
          result.push(
            emptySectionFinding(
              mode,
              'EMPTY_SECURITY_CONSIDERATIONS_SECTION',
              'The security considerations section is present but contains no meaningful content.',
              {
                ref: 'https://authors.ietf.org/en/required-content#security-considerations',
                lines: lineLocation(doc, doc.data.markers.securityConsiderations.start)
              }
            )
          )
        }
      }
      break
    }
    case 'xml': {
      const sections = getMiddleSections(doc)
      const secSectionIdx = findIndex(sections, s => getSectionName(s) === 'Security Considerations')
      const secSection = secSectionIdx >= 0 ? sections[secSectionIdx] : null
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
          result.push(emptySectionFinding(mode, 'INVALID_SECURITY_CONSIDERATIONS_SECTION', 'The security considerations section is empty.', {
            ref: 'https://authors.ietf.org/en/required-content#security-considerations'
          }))
        } else {
          result.push(...validateSectionChildren(secSection, 'INVALID_SECURITY_CONSIDERATIONS_SECTION_CHILD', 'security considerations section', `rfc.middle.section[${secSectionIdx}]`))
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
  // Only some author checks apply to submissions, the others skip them
  const isSubmission = mode === MODES.SUBMISSION

  switch (doc.type) {
    case 'txt': {
      if (isSubmission) {
        break
      }
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
                  lines: linesOption(contentLocations(doc, doc.data.content.authorAddress.slice(0, 1), bodyStartLine(doc)))
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
        if (authors.length > 5 && !isSubmission) {
          result.push(new ValidationComment('TOO_MANY_AUTHORS', 'There are more than 5 authors / editors.  If there is a need to list more, discuss the need with the relevant stream leadership as early in the process as possible. For the IETF stream, consult an Area Director.', {
            ref: 'https://authors.ietf.org/en/required-content#authors-addresses',
            path: 'rfc.front.author'
          }))
        }
        for (const [idx, author] of authors.entries()) {
          // An empty organization counts as no organization
          const orgName = getElementText(author?.organization)
          if (has(author, 'organization') && orgName.length < 1) {
            result.push(new ValidationComment('EMPTY_AUTHOR_ORGANIZATION', 'The author organization is defined but empty.', {
              ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#author',
              path: `rfc.front.author[${idx}].organization`
            }))
          }

          // -> A name in a non-Latin script needs a Latin alternate (draft-rswg-rfc7997bis, Section 3.1)
          const fullname = typeof author?._attr?.fullname === 'string' ? decodeCharRefs(author._attr.fullname) : ''
          if (NON_LATIN_LETTER_RE.test(fullname) && !author?._attr?.asciiFullname) {
            const message = `The author fullname "${fullname}" is in a non-Latin script but no Latin alternate is given in the asciiFullname attribute.`
            const opts = {
              ref: 'https://datatracker.ietf.org/doc/draft-rswg-rfc7997bis/#section-3.1',
              path: `rfc.front.author[${idx}].fullname`
            }
            result.push(mode === MODES.NORMAL ? new ValidationError('MISSING_LATIN_AUTHOR_NAME', message, opts) : new ValidationWarning('MISSING_LATIN_AUTHOR_NAME', message, opts))
          }

          // -> Checks below don't apply to submissions
          if (isSubmission) {
            continue
          }

          if (!orgName && !author?._attr?.fullname) {
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
          // -> "editor" is the only role defined by RFC 7991 and xml2rfc
          if (has(author, '_attr.role') && author._attr.role !== 'editor') {
            result.push(new ValidationWarning('INVALID_AUTHOR_ROLE', 'The author role attribute is defined but has an invalid value. Should be "editor".', {
              ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#author',
              path: `rfc.front.author[${idx}].role`
            }))
          }
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
      } else if (referencesContent?.length < MIN_SECTION_CONTENT_LENGTH) {
        switch (mode) {
          case MODES.NORMAL: {
            result.push(
              new ValidationError(
                'EMPTY_REFERENCES_SECTION',
                'The references section is present but contains no meaningful content.',
                {
                  ref: 'https://authors.ietf.org/required-content#references',
                  lines: lineLocation(doc, doc.data.markers.references.start)
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
                  ref: 'https://authors.ietf.org/required-content#references',
                  lines: lineLocation(doc, doc.data.markers.references.start)
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
      const plainReferenceFormat = /^(?:\d+\.\s+)?References$/i
      const referenceSectionTitlePattern = /^(\d+\.\s+)?((?:Normative|Informative)\s+)?References$/i
      // -> Headings sit at the margin: an indented "References" is artwork, a
      //    registry template or a table of contents entry
      const marginLines = new Set(doc.body.split(/\r?\n/).filter(line => !/^\s/.test(line)).map(line => line.trim()))
      const referenceSectionTitles = new Set()

      // -> Where each line of the section is, and where each title first is
      const referencesLocations = contentLocations(doc, referencesContent, bodyStartLine(doc))
      const subsectionLocations = []
      const titleLocations = new Map()

      for (const [idx, line] of referencesContent.entries()) {
        const match = subsectionPattern.test(line)
        if (match) {
          subsections.push(line)
          subsectionLocations.push(referencesLocations[idx])
        } else if (referenceSectionTitlePattern.test(line) && marginLines.has(line)) {
          // -> A repeated title is a table of contents entry at the margin
          const title = line.replace(/\s+/g, ' ')
          referenceSectionTitles.add(title)
          if (!titleLocations.has(title)) titleLocations.set(title, referencesLocations[idx])
        }
      }

      // -> An unnumbered Normative or Informative References title after a
      //    References title is its subsection ("References", "Normative
      //    References", "Informative References" when sections are unnumbered)
      let numberOfReferenceSections = 0
      let numberOfUnnumberedSubsections = 0
      let inReferencesSection = false
      const referenceSectionLocations = []
      for (const title of referenceSectionTitles) {
        const [, number, kind] = title.match(referenceSectionTitlePattern)
        if (!kind) {
          inReferencesSection = true
        } else if (number) {
          inReferencesSection = false
        } else if (inReferencesSection) {
          numberOfUnnumberedSubsections++
          continue
        }
        numberOfReferenceSections++
        referenceSectionLocations.push(titleLocations.get(title))
      }

      if (subsections.length === 0 && numberOfUnnumberedSubsections === 0 && plainReferenceFormat.test(referencesContent[0])) {
        switch (mode) {
          case MODES.NORMAL: {
            result.push(
              new ValidationError(
                'REFERENCE_TYPE_NOT_DECLARED',
                'References must be identified as Normative or Informative.',
                {
                  ref: 'https://authors.ietf.org/required-content#references',
                  lines: linesOption(referencesLocations.slice(0, 1))
                }
              )
            )
            break
          }
          case MODES.FORGIVE_CHECKLIST: {
            result.push(
              new ValidationWarning(
                'REFERENCE_TYPE_NOT_DECLARED',
                'References must be identified as Normative or Informative.',
                {
                  ref: 'https://authors.ietf.org/required-content#references',
                  lines: linesOption(referencesLocations.slice(0, 1))
                }
              )
            )
            break
          }
        }
      } else {
        for (const [idx, subsection] of subsections.entries()) {
          const subsectionLocation = subsectionLocations[idx]
          if (!normativePattern.test(subsection) && !informativePattern.test(subsection)) {
            switch (mode) {
              case MODES.NORMAL: {
                result.push(
                  new ValidationError(
                    'UNCLASSIFIED_REFERENCES_SUBSECTION',
                    `The subsection "${subsection}" is not classified as Normative or Informative.`,
                    {
                      ref: 'https://authors.ietf.org/required-content#references',
                      lines: linesOption([subsectionLocation])
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
                      lines: linesOption([subsectionLocation])
                    }
                  )
                )
                break
              }
            }
          }
        }
      }

      // -> RFC 7322 splits references into subsections of one section; the
      //    RFC Editor merges separate sections, so this does not block
      if (numberOfReferenceSections > 1) {
        result.push(
          new ValidationWarning(
            'MULTIPLE_REFERENCES_SECTION_TITLES',
            'References should be one section with Normative and Informative subsections (RFC 7322, Section 4.8.6).',
            {
              ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.6',
              lines: linesOption(referenceSectionLocations)
            }
          )
        )
      }
      break
    }
    case 'xml': {
      // -> Only leaf sections hold references: a <references> wrapping other
      //    <references> (e.g. <name>References</name>) is a container.
      //    A title attribute is reported by DEPRECATED_ATTRIBUTE (xml.mjs).
      for (const { path, name, nameKey } of getReferencesSections(doc)) {
        if (!name) {
          switch (mode) {
            case MODES.NORMAL: {
              result.push(new ValidationError('MISSING_REFERENCES_NAME', 'The references section is missing a <name> child element.', {
                ref: 'https://authors.ietf.org/required-content#references',
                path: `${path}.name`
              }))
              break
            }
            case MODES.FORGIVE_CHECKLIST: {
              result.push(new ValidationWarning('MISSING_REFERENCES_NAME', 'The references section is missing a <name> child element.', {
                ref: 'https://authors.ietf.org/required-content#references',
                path: `${path}.name`
              }))
              break
            }
          }
          continue
        }
        const nameValue = name.toLowerCase()
        if (!(nameValue.indexOf('informative') >= 0 || nameValue.indexOf('normative') >= 0)) {
          switch (mode) {
            case MODES.NORMAL: {
              result.push(new ValidationError('INVALID_REFERENCES_NAME', 'The references section <name> element should be either Normative or Informative.', {
                ref: 'https://authors.ietf.org/required-content#references',
                path: `${path}.${nameKey}`
              }))
              break
            }
            case MODES.FORGIVE_CHECKLIST: {
              result.push(new ValidationWarning('INVALID_REFERENCES_NAME', 'The references section <name> element should be either Normative or Informative.', {
                ref: 'https://authors.ietf.org/required-content#references',
                path: `${path}.${nameKey}`
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
      const IANAConsiderationsSection = doc.data.content.ianaConsiderations

      if (!IANAConsiderationsSection?.length) {
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
        const childrenTypes = IANAConsiderationsSection.filter(line => line.trim() !== '').slice(1)
        if (childrenTypes.length < 1) {
          result.push(emptySectionFinding(mode, 'INVALID_IANA_CONSIDERATIONS_SECTION', 'The IANA considerations section is empty.', {
            ref: 'https://authors.ietf.org/en/required-content#iana-considerations',
            lines: lineLocation(doc, doc.data.markers?.ianaConsiderations?.start)
          }))
        }
      }
      break
    }
    case 'xml': {
      const sections = getMiddleSections(doc)
      const secSectionIdx = findIndex(sections, s => getSectionName(s) === 'IANA Considerations')
      const secSection = secSectionIdx >= 0 ? sections[secSectionIdx] : null
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
          result.push(emptySectionFinding(mode, 'INVALID_IANA_CONSIDERATIONS_SECTION', 'The IANA considerations section is empty.', {
            path: `rfc.middle.section[${secSectionIdx}]`,
            ref: 'https://authors.ietf.org/en/required-content#iana-considerations'
          }))
        } else {
          result.push(...validateSectionChildren(secSection, 'INVALID_IANA_CONSIDERATIONS_SECTION_CHILD', 'IANA considerations section', `rfc.middle.section[${secSectionIdx}]`))
        }
      }
      break
    }
  }

  return result
}

// An [RFCn] label of a text references entry ("[RFC0791]"), in the form the parser declares (BRACKETED_RFC_REFERENCE_RE)
const TEXT_RFC_LABEL_RE = /^\[RFC0*(\d+)\]$/

/**
 * Draft name without its I-D. or draft- prefix and its version, to compare references to a draft
 *
 * @param {string} name Draft name or anchor ("I-D.ietf-foo-bar", "draft-ietf-foo-bar-05")
 * @returns {string} Comparable name ("ietf-foo-bar")
 */
function comparableDraftName (name) {
  return String(name).trim().replace(/^I-D\./i, '').replace(/^draft-/i, '').replace(/-\d\d$/, '').toLowerCase()
}

/**
 * The RFCs and drafts an XML document includes inside a <referencegroup> through its raw text
 * (<?rfc include?> or an external entity), which the parser drops, so the group stays the reference
 *
 * @param {Object} doc Parsed XML document
 * @returns {{ rfcs: Set<string>, drafts: Set<string> }} RFC numbers and comparable draft names
 */
function getGroupedRawIncludes (doc) {
  const rfcs = new Set()
  const drafts = new Set()
  const entities = new Map((doc.externalEntities ?? []).map(entity => [entity.name, entity.url]))
  for (const [group] of maskCommentsAndCdata(doc.body ?? '').matchAll(/<referencegroup\b[\s\S]*?<\/referencegroup\s*>/g)) {
    const targets = [
      ...[...group.matchAll(/<\?rfc\s+include\s*=\s*["']?([^"'\s?]+)/g)].map(match => match[1]),
      ...[...group.matchAll(/&([^;\s&]+);/g)].map(match => entities.get(match[1])).filter(Boolean)
    ]
    for (const target of targets) {
      const rfc = target.match(/reference\.RFC\.0*(\d+)/i)?.[1]
      const draft = target.match(/reference\.I-D\.([a-z0-9._-]+?)(?:\.xml)?$/i)?.[1]
      if (rfc) { rfcs.add(rfc) }
      if (draft) { drafts.add(comparableDraftName(draft)) }
    }
  }
  return { rfcs, drafts }
}

/**
 * What the text of an XML document mentions as typed text, outside its <references> sections:
 * RFC numbers ("RFC 4782", "[RFC7641]"), bracketed labels ("[TLS13]") and draft names, as the text
 * check counts them. Mentions in prose are kept apart from those in <artwork> and <sourcecode>, where
 * an <xref> can't be placed, and in the updates and obsoletes attributes; other attribute values don't count.
 *
 * @param {Object} doc Parsed XML document
 * @returns {{ prose: TypedMentions, code: TypedMentions }} Typed mentions in prose, and in code or attributes
 */
function getTypedMentions (doc) {
  const prose = []
  const code = []
  const walk = (value, path, inCode) => {
    if (path === 'rfc.back.references') { return }
    if (typeof value === 'string' || typeof value === 'number') {
      if (inCode) {
        code.push(String(value))
      } else {
        prose.push(String(value))
      }
    } else if (Array.isArray(value)) {
      value.forEach(item => walk(item, path, inCode))
    } else if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (key === '_attr') {
          continue
        }
        // -> An element's own text belongs to the element; everything inside <artwork> or
        //    <sourcecode> is code
        const childPath = key === '#text' ? path : `${path}.${key}`
        const childInCode = inCode || key === 'artwork' || key === 'sourcecode'
        walk(child, childPath, childInCode)
      }
    }
  }
  walk(doc.data.rfc, 'rfc', false)
  // -> The RFCs the document updates or obsoletes, which the text header names
  code.push(String(doc.data.rfc?._attr?.updates ?? ''), String(doc.data.rfc?._attr?.obsoletes ?? ''))
  const mentions = texts => {
    const text = texts.join('\n')
    return {
      rfcs: new Set([...text.matchAll(/\bRFC\s?0*(\d+)\b/gi)].map(match => match[1])),
      labels: new Set([...text.matchAll(/\[([^[\]]{1,100})\]/g)].map(match => match[1].replace(/\s+/g, '').toLowerCase())),
      drafts: new Set([...text.matchAll(/\bdraft-[a-z0-9]+(?:-[a-z0-9]+)+/gi)].map(match => comparableDraftName(match[0])))
    }
  }
  return { prose: mentions(prose), code: mentions(code) }
}

/**
 * @typedef {Object} TypedMentions
 * @property {Set<string>} rfcs RFC numbers, without leading zeros
 * @property {Set<string>} labels Bracketed labels, without spaces, in lower case
 * @property {Set<string>} drafts Draft names, see comparableDraftName()
 */

/**
 * Whether typed mentions name a reference, by its anchor
 *
 * @param {TypedMentions} mentions Typed mentions, from getTypedMentions()
 * @param {string} anchor Anchor of the reference ("RFC8174", "I-D.ietf-foo-bar", "TLS13")
 * @returns {boolean} True if the reference is mentioned
 */
function isTypedMention (mentions, anchor) {
  const name = String(anchor).trim()
  const rfc = name.match(/^RFC0*(\d+)$/i)?.[1]
  return mentions.labels.has(name.replace(/\s+/g, '').toLowerCase()) ||
    Boolean(rfc && mentions.rfcs.has(rfc)) ||
    (/^I-D\./i.test(name) && mentions.drafts.has(comparableDraftName(name)))
}

/**
 * Validate that all references declared in the References section are used in the text.
 *
 * This function checks whether all references listed in the References section are actually
 * mentioned in the document's text. If a reference is listed but not used, it generates
 * a warning regardless of the validation mode. In a text document, a placeholder the RFC Editor
 * replaces with an RFC number ("[RFCXXXX]") cited without being declared gets a comment.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of warnings if references are not used; empty if valid
 */
export async function validateReferencesInText (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  switch (doc.type) {
    case 'txt': {
      // -> One reference per entry of the references section, named by its label: an RFC number mentioned
      //    inside an entry ("STD 5, RFC 791" in the [RFC0791] entry, "RFC 1700" in a title) is not one.
      //    An [RFCn] entry is used if the text cites RFC n; another declared label, if the text cites it.
      //    (Entries labelled [I-D.…] or [draft-…] are not declared, see lib/parsers/txt.mjs.)
      const { referenceEntries, nonReferenceSectionRfc, referenceSectionDraftReferences, nonReferenceSectionDraftReferences } = doc.data.extractedElements
      const citedRfcs = new Set(nonReferenceSectionRfc.map(rfc => String(rfc).replace(/^0+/, '')))
      const declaredLabels = new Set(referenceSectionDraftReferences.map(el => el.value))
      const checked = new Set()
      for (const entry of referenceEntries) {
        if (entry.subsection === 'appendix' || checked.has(entry.value)) { continue }
        checked.add(entry.value)
        const rfc = TEXT_RFC_LABEL_RE.exec(entry.value)?.[1]
        let used
        if (rfc) {
          used = citedRfcs.has(rfc)
        } else if (declaredLabels.has(entry.value)) {
          used = nonReferenceSectionDraftReferences.includes(entry.value)
        } else {
          continue
        }
        if (!used) {
          result.push(new ValidationWarning(
            'REFERENCE_NOT_USED',
            `The reference ${entry.value} is listed in the References section but is not mentioned in the document text.`,
            {
              ref: 'https://authors.ietf.org/en/required-content#references',
              lines: linesOption(getLocations(doc, 'referenceEntries', entry.value))
            }
          ))
        }
      }

      // -> A placeholder for the RFC number of this or a companion document is not a missing reference
      for (const ref of doc.data.extractedElements.placeholderReferences ?? []) {
        result.push(new ValidationComment(
          'PLACEHOLDER_REFERENCE',
          `Document has ${ref}, a placeholder reference; the RFC Editor will replace it.`,
          {
            ref: 'https://authors.ietf.org/en/required-content#references',
            lines: linesOption(getLocations(doc, 'placeholderReferences', ref))
          }
        ))
      }

      break
    }

    case 'xml': {
      const declaredReferences = getReferencesSections(doc)
        .flatMap(section => [...section.references, ...section.referencegroups])
      const definedReferences = declaredReferences
        .map(ref => ref?._attr?.anchor)
        .filter(Boolean)
      const usedReferences = findAllDescendantsWith(doc.data.rfc, (value, key) => {
        if (key !== 'xref') return false

        if (Array.isArray(value)) {
          return value.some(item => item._attr?.target)
        }

        return value._attr?.target
      }).flatMap(match =>
        Array.isArray(match.value)
          ? match.value.map(item => item._attr?.target).filter(Boolean)
          : match.value._attr?.target ? [match.value._attr.target] : []
      )

      // -> An RFC 8792 folding header in <artwork> or <sourcecode> counts as a use of RFC 8792,
      //    as an <xref> cannot be placed there
      const hasFoldingHeader = findAllDescendantsWith(doc.data.rfc, (value, key) => key === 'artwork' || key === 'sourcecode')
        .flatMap(match => Array.isArray(match.value) ? match.value : [match.value])
        .some(value => RFC8792_FOLDING_HEADER.test(getElementText(value)))
      if (hasFoldingHeader) {
        usedReferences.push(...declaredReferences.filter(isRfc8792Reference).map(ref => ref._attr.anchor))
      }

      // -> A reference without an <xref> is used when <artwork> or <sourcecode>, where an <xref> can't be
      //    placed, or the updates or obsoletes attribute mentions it as typed text. Mentioned as typed text
      //    only in prose, it is cited as text; not mentioned at all, it is not used.
      const typed = getTypedMentions(doc)
      const unusedReferences = []
      const checkUnreferenced = (anchor, path) => {
        if (isTypedMention(typed.code, anchor)) { return }
        unusedReferences.push({ anchor, path, asText: isTypedMention(typed.prose, anchor) })
      }
      definedReferences.filter(ref => !usedReferences.includes(ref)).forEach(anchor => checkUnreferenced(anchor))

      // -> References brought in by xi:include, an external entity or <?rfc include?>, of an RFC or a draft,
      //    named by the anchor of their bibliography entry and matched to <xref> targets by the document
      //    they cite (members of a <referencegroup> are used through the group)
      const xrefRfcs = new Set(usedReferences.map(target => String(target).match(/^RFC0*(\d+)$/i)?.[1]).filter(Boolean))
      const xrefDrafts = new Set(usedReferences.filter(target => /^(I-D\.|draft-)/i.test(target)).map(comparableDraftName))
      const grouped = getGroupedRawIncludes(doc)
      for (const include of listXmlReferences(doc)) {
        if (include.source === 'reference' || include.path.includes('.referencegroup[')) { continue }
        if (include.source !== 'xi:include' && (grouped.rfcs.has(include.rfc) || grouped.drafts.has(comparableDraftName(include.draft ?? '')))) { continue }
        if (include.rfc) {
          const anchor = `RFC${include.rfc.padStart(4, '0')}`
          if (!xrefRfcs.has(include.rfc) && !(include.rfc === '8792' && hasFoldingHeader)) {
            checkUnreferenced(anchor, include.path)
          }
        } else if (include.draft) {
          const anchor = `I-D.${comparableDraftName(include.draft)}`
          if (!xrefDrafts.has(comparableDraftName(include.draft))) {
            checkUnreferenced(anchor, include.path)
          }
        }
      }

      unusedReferences.forEach(({ anchor, path, asText }) => {
        result.push(asText
          ? new ValidationWarning(
            'REFERENCE_CITED_AS_TEXT',
            `${anchor} is mentioned only as typed text; cite it with <xref>.`,
            { ref: 'https://authors.ietf.org/en/references-in-rfcxml', ...(path ? { path } : {}) }
          )
          : new ValidationWarning(
            'REFERENCE_NOT_USED',
            `The reference ${anchor} is listed in the References section but is not mentioned in the document text.`,
            { ref: 'https://authors.ietf.org/en/required-content#references', ...(path ? { path } : {}) }
          ))
      })

      break
    }
  }

  return result
}
