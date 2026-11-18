import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { XML_SCHEMA } from '../config/schema.mjs'
import { has, isPlainObject } from 'lodash-es'
import { findAllDescendantsWith, findDescendantWith } from '../helpers/traversal.mjs'
import { getReferencesSections } from '../helpers/references.mjs'
import { listXmlReferences, maskCommentsAndCdata } from '../helpers/xml-references.mjs'
import { CERTAINTY } from '../model/indexes.mjs'
import { getReferencesHeadings, getSection } from '../model/sections.mjs'
import { bodyStartLine, contentLocations, getLocations } from '../parsers/txt.mjs'

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
 * Report a finding as most of the section checks do: an Error in normal mode, a Warning in
 * forgive-checklist mode and nothing in submission mode
 *
 * @param {number} mode Validation mode
 * @param {string} code Code to report
 * @param {string} message Message to report
 * @param {Object} opts Options of the finding (ref, lines, path)
 * @returns {Array<ValidationError|ValidationWarning>} The finding, or none in submission mode
 */
function checklistFindings (mode, code, message, opts) {
  switch (mode) {
    case MODES.NORMAL: {
      return [new ValidationError(code, message, opts)]
    }
    case MODES.FORGIVE_CHECKLIST: {
      return [new ValidationWarning(code, message, opts)]
    }
  }
  return []
}

/**
 * Validate what the abstract of a text document says: no references to RFCs other than those the
 * document updates or obsoletes, to sections or to Internet-Drafts, no URLs and no custom references
 *
 * @param {Object} doc Parsed text document
 * @param {number} mode Validation mode
 * @returns {Array} List of errors/warnings or empty if fully valid
 */
function validateTextAbstractContent (doc, mode) {
  const result = []
  const abstractLines = doc.data.content.abstract
  const abstractContent = abstractLines.join(' ') || ''
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
  const entryLocations = contentLocations(doc, abstractLines, doc.data.markers.abstract.start)
  const entryOffsets = []
  let entryOffset = 0
  for (const entry of abstractLines) {
    entryOffsets.push(entryOffset)
    entryOffset += entry.length + 1
  }
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
      result.push(...checklistFindings(mode, errorCode, errorMessage, {
        ref: 'https://authors.ietf.org/required-content#abstract',
        lines: linesOption(matchLocations(pattern, keep))
      }))
    }
  }

  if (notAllowedRfcReferences.length > 0) {
    validateReference(rfcReferencePattern, 'INVALID_ABSTRACT_SECTION_REF', 'The abstract section should not contain references to RFCs.', match => isNotAllowedRfc(match[0].match(/\d+/)[0]))
  }
  validateReference(urlPattern, 'INVALID_ABSTRACT_SECTION_URL', 'The abstract section should not contain URLs.')
  validateReference(sectionReferencePattern, 'INVALID_ABSTRACT_SECTION_REF', 'The abstract section should not contain references to sections or appendices.')
  validateReference(internetDraftReferencePattern, 'INVALID_ABSTRACT_SECTION_ID_REF', 'The abstract section should not contain references to Internet-Drafts.')
  validateReference(customReferencePattern, 'INVALID_ABSTRACT_SECTION_CUSTOM_REF', 'The abstract section should not contain custom references like [REST].')
  return result
}

/**
 * Validate the elements of the abstract of an XML document: only the children xml2rfc's grammar allows
 * there, and no <xref>
 *
 * @param {Object} abstract Parsed <abstract> element, with at least one child
 * @param {number} mode Validation mode
 * @returns {Array} List of errors/warnings or empty if fully valid
 */
function validateXmlAbstractElements (abstract, mode) {
  const result = []
  for (const key of Object.keys(abstract).filter(k => k !== '_attr')) {
    if (!XML_SCHEMA.abstract.allowedChildren.includes(key)) {
      result.push(new ValidationError('INVALID_ABSTRACT_SECTION_CHILD', 'The abstract section must consist of <dl>, <ol>, <t> or <ul> elements only.', {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.1',
        path: `rfc.front.abstract.${key}`
      }))
      break
    }
  }
  const refEntryFound = findDescendantWith(abstract, (v, k) => { return k === 'xref' })
  if (refEntryFound) {
    result.push(...checklistFindings(mode, 'INVALID_ABSTRACT_SECTION_REF', 'The abstract section should not contain references.', {
      ref: 'https://authors.ietf.org/required-content#abstract',
      path: `rfc.front.abstract.${refEntryFound.path.join('.')}`
    }))
  }
  return result
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
  const abstract = getSection(doc, 'abstract')

  if (!abstract.present) {
    result.push(new ValidationError('MISSING_ABSTRACT_SECTION', 'The abstract section is missing.', {
      ref: 'https://authors.ietf.org/required-content#abstract',
      ...abstract.location
    }))
  } else if (abstract.empty) {
    // -> Declared empty, the abstract breaks the grammar; inferred, its heading has no text under it
    if (abstract.certainty === CERTAINTY.DECLARED) {
      result.push(emptySectionFinding(mode, 'INVALID_ABSTRACT_SECTION', 'The abstract section must consist of at least 1 <dl>, <ol>, <t> or <ul> element.', {
        ref: 'https://www.rfc-editor.org/rfc/rfc7991.html#section-2.1',
        ...abstract.location
      }))
    } else {
      result.push(emptySectionFinding(mode, 'EMPTY_ABSTRACT_SECTION', 'The abstract section is present but contains no meaningful content.', {
        ref: 'https://authors.ietf.org/required-content#abstract',
        ...abstract.location
      }))
    }
  } else if (doc.type === 'txt') {
    // -> Checks only one format can make: what the text says, or which elements it is made of
    result.push(...validateTextAbstractContent(doc, mode))
  } else {
    result.push(...validateXmlAbstractElements(abstract.node, mode))
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

  // -> Without a header and a title, the text parser can't tell where the sections are
  if (doc.type === 'txt' && (!doc.data.markers.header.start || !doc.data.markers.title)) {
    result.push(
      new ValidationError(
        'INVALID_DOCUMENT_STRUCTURE',
        'The document is missing a valid header or title, making further validation impossible.',
        {
          ref: 'https://authors.ietf.org/en/required-content#introduction'
        }
      )
    )
    return result
  }

  const introduction = getSection(doc, 'introduction')
  if (!introduction.present) {
    // -> Inferred, the section is missing when none of the headings looked for is there
    const message = introduction.certainty === CERTAINTY.INFERRED
      ? 'The first section is missing. Expected "Introduction", "Overview", or "Background".'
      : 'The introduction section is missing.'
    result.push(...checklistFindings(mode, 'MISSING_INTRODUCTION_SECTION', message, {
      ref: 'https://authors.ietf.org/en/required-content#introduction',
      ...introduction.location
    }))
  } else if (introduction.empty) {
    if (introduction.certainty === CERTAINTY.DECLARED) {
      result.push(emptySectionFinding(mode, 'INVALID_INTRODUCTION_SECTION', 'The introduction section is empty.', {
        ref: 'https://authors.ietf.org/en/required-content#introduction',
        ...introduction.location
      }))
    } else {
      result.push(emptySectionFinding(mode, 'EMPTY_INTRODUCTION_SECTION', 'The first section is present but contains no meaningful content.', {
        ref: 'https://authors.ietf.org/en/required-content#introduction',
        ...introduction.location
      }))
    }
  } else if (doc.type === 'xml') {
    result.push(...validateSectionChildren(introduction.node, 'INVALID_INTRODUCTION_SECTION_CHILD', 'introduction section', introduction.location.path))
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
  const security = getSection(doc, 'securityConsiderations')

  if (!security.present) {
    result.push(...checklistFindings(mode, 'MISSING_SECURITY_CONSIDERATIONS_SECTION', 'The security considerations section is missing.', {
      ref: 'https://authors.ietf.org/en/required-content#security-considerations',
      ...security.location
    }))
  } else if (security.empty) {
    if (security.certainty === CERTAINTY.DECLARED) {
      result.push(emptySectionFinding(mode, 'INVALID_SECURITY_CONSIDERATIONS_SECTION', 'The security considerations section is empty.', {
        ref: 'https://authors.ietf.org/en/required-content#security-considerations',
        ...security.location
      }))
    } else {
      result.push(emptySectionFinding(mode, 'EMPTY_SECURITY_CONSIDERATIONS_SECTION', 'The security considerations section is present but contains no meaningful content.', {
        ref: 'https://authors.ietf.org/en/required-content#security-considerations',
        ...security.location
      }))
    }
  } else if (doc.type === 'xml') {
    result.push(...validateSectionChildren(security.node, 'INVALID_SECURITY_CONSIDERATIONS_SECTION_CHILD', 'security considerations section', security.location.path))
  }

  return result
}

/**
 * Validate the <author> elements of an XML document
 *
 * @param {Array} authors Parsed <author> elements, at least one
 * @param {number} mode Validation mode
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
function validateXmlAuthors (authors, mode) {
  const result = []
  // Only some author checks apply to submissions, the others skip them
  const isSubmission = mode === MODES.SUBMISSION

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
      if (mode === MODES.NORMAL) {
        result.push(new ValidationError('MISSING_LATIN_AUTHOR_NAME', message, opts))
      } else {
        result.push(new ValidationWarning('MISSING_LATIN_AUTHOR_NAME', message, opts))
      }
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
  const authorSection = getSection(doc, 'authors')

  if (!authorSection.present) {
    result.push(...checklistFindings(mode, 'MISSING_AUTHOR_SECTION', 'The author section is missing.', {
      ref: 'https://authors.ietf.org/en/required-content#authors-addresses',
      ...authorSection.location
    }))
  } else if (doc.type === 'txt') {
    // -> The title of the section, which xml2rfc writes from the <author> elements
    const authorSectionTitle = doc.data.content.authorAddress[0]?.trim()
    const invalidPossessiveMark = /[^a-z\s‘’‛'`] (Addresses|contact information)$/i.test(authorSectionTitle ?? '')
    if (mode !== MODES.SUBMISSION && invalidPossessiveMark) {
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
  } else {
    result.push(...validateXmlAuthors(authorSection.node, mode))
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

  // -> At submission, only the "Informational References" misspelling, which the RFC Production Center
  //    corrects; the other modes report it as an unclassified section
  if (mode === MODES.SUBMISSION) {
    return informationalReferencesHeadings(doc)
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

      // -> In an appendix, a line of prose wrapped before a section number ("11.2.  Partial-failure
      //    semantics ...") is no subsection: it is indented further than the References heading and
      //    continues the line above, as the text parser decides
      const bodyLines = doc.body?.split(/\r?\n/) ?? []
      const indentOf = (text) => text.length - text.trimStart().length
      const headingLine = bodyLines[doc.data.markers.references.start - 1] ?? ''
      const headingIndent = indentOf(headingLine)
      const isWrappedLine = (location) => {
        if (!location) {
          return false
        }
        const lineIndent = indentOf(bodyLines[location.line - 1])
        const previousLine = bodyLines[location.line - 2] ?? ''
        return lineIndent > headingIndent && previousLine.trim() !== ''
      }
      let inAppendix = false

      for (const [idx, line] of referencesContent.entries()) {
        if (/^Appendix\b/i.test(line)) {
          inAppendix = true
        }
        const isWrappedProse = inAppendix && isWrappedLine(referencesLocations[idx])
        const match = subsectionPattern.test(line) && !isWrappedProse
        if (match) {
          inAppendix = false
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

// A references section headed "Informational References", which the RFC Production Center always turns
// into "Informative References"
const INFORMATIONAL_REFERENCES_RE = /^(?:\d+\.(?:\d+\.?)?\s+)?Informational\s+References?$/i

/**
 * Comments on references sections headed "Informational References" rather than "Informative References"
 *
 * @param {Object} doc Document to validate
 * @returns {Array} List of comments, empty if there is no such heading
 */
function informationalReferencesHeadings (doc) {
  return getReferencesHeadings(doc)
    .filter(heading => INFORMATIONAL_REFERENCES_RE.test(heading.title))
    .map(heading => {
      return new ValidationComment(
        'INFORMATIONAL_REFERENCES_HEADING',
        `The references section "${heading.title}" should be headed "Informative References".`,
        { ref: 'https://authors.ietf.org/required-content#references', ...heading.location }
      )
    })
}

/**
 * Finding for a missing IANA considerations section
 *
 * An RFC is already published, so its missing section is only noted, under its own code.
 * Nothing is reported in submission mode.
 *
 * @param {Object} doc Document being validated
 * @param {number} mode Validation mode
 * @param {Object} location Where the section would be declared, as the options of a finding (see getSection)
 * @returns {Array} The finding, or empty in submission mode
 */
function missingIanaConsiderationsFindings (doc, mode, location) {
  const message = 'The IANA considerations section is missing.'
  const opts = { ref: 'https://authors.ietf.org/en/required-content#iana-considerations', ...location }
  if (mode === MODES.SUBMISSION) {
    return []
  }
  if (doc.docKind === 'rfc') {
    return [new ValidationComment('RFC_MISSING_IANA_CONSIDERATIONS_SECTION', message, opts)]
  }
  if (mode === MODES.NORMAL) {
    return [new ValidationError('MISSING_IANA_CONSIDERATIONS_SECTION', message, opts)]
  }
  return [new ValidationWarning('MISSING_IANA_CONSIDERATIONS_SECTION', message, opts)]
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
  const iana = getSection(doc, 'ianaConsiderations')

  if (!iana.present) {
    result.push(...missingIanaConsiderationsFindings(doc, mode, iana.location))
  } else if (iana.empty) {
    result.push(emptySectionFinding(mode, 'INVALID_IANA_CONSIDERATIONS_SECTION', 'The IANA considerations section is empty.', {
      ref: 'https://authors.ietf.org/en/required-content#iana-considerations',
      ...iana.location
    }))
  } else if (doc.type === 'xml') {
    result.push(...validateSectionChildren(iana.node, 'INVALID_IANA_CONSIDERATIONS_SECTION_CHILD', 'IANA considerations section', iana.location.path))
  }

  return result
}

// An [RFCn] label of a text references entry ("[RFC0791]"), in the form the parser declares (BRACKETED_RFC_REFERENCE_RE)
const TEXT_RFC_LABEL_RE = /^\[RFC0*(\d+)\]$/
// An [I-D.…] or [draft-…] label of a text references entry, spaces allowed ("[I-D. foo-bar]")
const TEXT_DRAFT_LABEL_RE = /^\[\s*(?:I-D\.|draft-)/i

/**
 * Draft name without its I-D. or draft- prefix and its version, to compare references to a draft
 *
 * @param {string} name Draft name or anchor ("I-D.ietf-foo-bar", "draft-ietf-foo-bar-05")
 * @returns {string} Comparable name ("ietf-foo-bar")
 */
function comparableDraftName (name) {
  return String(name).trim().replace(/^I-D\./i, '').replace(/^draft-/i, '').replace(/-\d\d$/, '').toLowerCase()
}

// The start of a <referencegroup> element, and the end tag of one
const REFERENCEGROUP_START_RE = /<referencegroup\b/g
const REFERENCEGROUP_END_RE = /<\/referencegroup\s*>/g

/**
 * The raw text of the <referencegroup> elements of an XML text, each from its start tag to the first
 * end tag after it, read in one pass: once a start tag has no end tag after it, neither has any later one
 *
 * @param {string} text XML text, comments and CDATA sections masked
 * @returns {string[]} Raw text of each element, in order
 */
function referenceGroupTexts (text) {
  const groups = []
  REFERENCEGROUP_START_RE.lastIndex = 0
  while (true) {
    const start = REFERENCEGROUP_START_RE.exec(text)
    if (start === null) {
      break
    }
    REFERENCEGROUP_END_RE.lastIndex = start.index
    const end = REFERENCEGROUP_END_RE.exec(text)
    if (end === null) {
      break
    }
    const groupEnd = end.index + end[0].length
    groups.push(text.slice(start.index, groupEnd))
    REFERENCEGROUP_START_RE.lastIndex = groupEnd
  }
  return groups
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
  const masked = maskCommentsAndCdata(doc.body ?? '')
  for (const group of referenceGroupTexts(masked)) {
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
      //    An [RFCn] entry is used if the text cites RFC n. An [I-D.…] or [draft-…] entry is used if the text
      //    cites its label, spaces aside ("[I-D. foo-bar]"), or names its draft. Another declared label is used
      //    if the text cites it.
      const { referenceEntries, nonReferenceSectionRfc, referenceSectionDraftReferences, nonReferenceSectionDraftReferences } = doc.data.extractedElements
      const { nonReferenceSectionDraftLabels = [], nonReferenceSectionDraftNames = [] } = doc.data.extractedElements
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
        } else if (TEXT_DRAFT_LABEL_RE.test(entry.value)) {
          // (the drafts the entry names, or failing that its label: [I-D.foo-bar] is draft-foo-bar)
          const label = entry.value.replace(/\s+/g, '')
          const fromLabel = `draft-${comparableDraftName(label.slice(1, -1))}`
          used = nonReferenceSectionDraftLabels.includes(label) ||
            [...(entry.drafts ?? []), fromLabel].some(draft => nonReferenceSectionDraftNames.includes(draft.toLowerCase().replace(/-\d\d$/, '')))
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
