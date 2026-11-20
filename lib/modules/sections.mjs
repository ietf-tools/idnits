import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { XML_SCHEMA } from '../config/schema.mjs'
import { has, isPlainObject } from 'lodash-es'
import { getReferencesSections } from '../helpers/references.mjs'
import { findDescendantWith } from '../helpers/traversal.mjs'
import { maskCommentsAndCdata } from '../helpers/xml-references.mjs'
import { CERTAINTY } from '../model/indexes.mjs'
import { getReferences, getUncitedReferences } from '../model/references.mjs'
import { getReferencesHeadings, getReferencesSubsections, getSection } from '../model/sections.mjs'
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
 * Report the references sections whose heading doesn't say whether they are normative or informative
 * references, and in an XML document the <references> elements without a name
 *
 * @param {Object} doc Document to validate
 * @param {number} mode Validation mode
 * @returns {Array} List of errors/warnings, empty in submission mode
 */
function unclassifiedReferencesFindings (doc, mode) {
  return getReferencesSubsections(doc).flatMap(subsection => {
    const opts = { ref: 'https://authors.ietf.org/required-content#references', ...subsection.location }
    // -> Only a declared section can lack a heading
    if (subsection.title === null) {
      return checklistFindings(mode, 'MISSING_REFERENCES_NAME', 'The references section is missing a <name> child element.', opts)
    }
    if (subsection.classified) {
      return []
    }
    if (subsection.certainty === CERTAINTY.DECLARED) {
      return checklistFindings(mode, 'INVALID_REFERENCES_NAME', 'The references section <name> element should be either Normative or Informative.', opts)
    }
    return checklistFindings(mode, 'UNCLASSIFIED_REFERENCES_SUBSECTION', `The subsection "${subsection.title}" is not classified as Normative or Informative.`, opts)
  })
}

/**
 * Finding for a missing references section
 *
 * A document need not have references (RFC 7322 doesn't require the section), so it is only noted. A citation
 * without a reference is reported on its own (in text, as REFERENCE_MISSING_IN_REFERENCE_SECTION). Nothing is
 * reported in submission mode.
 *
 * @param {number} mode Validation mode
 * @param {Object} location Where the section would be declared, as the options of a finding: none for text
 * @returns {Array} The finding, or empty in submission mode
 */
function missingReferencesSectionFindings (mode, location) {
  if (mode === MODES.SUBMISSION) {
    return []
  }
  return [new ValidationComment('MISSING_REFERENCES_SECTION', 'The references section is missing.', {
    ref: 'https://authors.ietf.org/required-content#references',
    ...location
  })]
}

/**
 * Validate the references section of a text document: that there is one, that it isn't empty, that its
 * references are classified as normative or informative (see unclassifiedReferencesFindings), and that it is
 * one section with subsections rather than several sections
 *
 * @param {Object} doc Parsed text document
 * @param {number} mode Validation mode, other than submission
 * @returns {Array} List of errors/warnings or empty if fully valid
 */
function validateTextReferencesSection (doc, mode) {
  const { markers, content } = doc.data
  const referencesContent = content.references
  if (!markers.references.start) {
    return missingReferencesSectionFindings(mode, {})
  }

  const result = []
  if (referencesContent?.length < MIN_SECTION_CONTENT_LENGTH) {
    result.push(...checklistFindings(mode, 'EMPTY_REFERENCES_SECTION', 'The references section is present but contains no meaningful content.', {
      ref: 'https://authors.ietf.org/required-content#references',
      lines: lineLocation(doc, markers.references.start)
    }))
  }

  const plainReferenceFormat = /^(?:\d+\.\s+)?References$/i
  const referenceSectionTitlePattern = /^(\d+\.\s+)?((?:Normative|Informative)\s+)?References$/i
  // -> Headings sit at the margin: an indented "References" is artwork, a
  //    registry template or a table of contents entry
  const marginLines = new Set(doc.body.split(/\r?\n/).filter(line => !/^\s/.test(line)).map(line => line.trim()))
  const referenceSectionTitles = new Set()

  // -> Where each line of the section is, and where each title first is
  const referencesLocations = contentLocations(doc, referencesContent, bodyStartLine(doc))
  const titleLocations = new Map()
  for (const [idx, line] of referencesContent.entries()) {
    // -> A repeated title is a table of contents entry at the margin
    if (referenceSectionTitlePattern.test(line) && marginLines.has(line)) {
      const title = line.replace(/\s+/g, ' ')
      referenceSectionTitles.add(title)
      if (!titleLocations.has(title)) {
        titleLocations.set(title, referencesLocations[idx])
      }
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

  const subsections = getReferencesSubsections(doc)
  if (subsections.length === 0 && numberOfUnnumberedSubsections === 0 && plainReferenceFormat.test(referencesContent[0])) {
    result.push(...checklistFindings(mode, 'REFERENCE_TYPE_NOT_DECLARED', 'References must be identified as Normative or Informative.', {
      ref: 'https://authors.ietf.org/required-content#references',
      lines: linesOption(referencesLocations.slice(0, 1))
    }))
  } else {
    result.push(...unclassifiedReferencesFindings(doc, mode))
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
  return result
}

// An include element of XML, by its name (xi:include)
const XML_INCLUDE_KEY_RE = /^[^:]+:include$/

/**
 * Whether an XML document may get its references from a file it includes outside a <references> element: an
 * xi:include in <back>, a reference to an external entity or an <?rfc include?> instruction, which the parser
 * leaves out
 *
 * @param {Object} doc Parsed XML document
 * @returns {boolean} Whether it includes such a file
 */
function hasXmlIncludeOutsideReferences (doc) {
  const back = doc.data.rfc?.back
  if (isPlainObject(back) && Object.keys(back).some(key => XML_INCLUDE_KEY_RE.test(key))) {
    return true
  }
  // -> Declaring an external entity includes nothing until it is referenced outside a comment
  const referencedNames = new Set()
  for (const match of maskCommentsAndCdata(doc.body ?? '').matchAll(/&([^&;\s]+);/g)) {
    referencedNames.add(match[1])
  }
  if ((doc.externalEntities ?? []).some(entity => referencedNames.has(entity.name))) {
    return true
  }
  return (doc.processingInstructions ?? []).some(pi => pi.target === 'rfc' && /^include\s*=/.test(pi.content))
}

/**
 * Validate the references sections of an XML document: that there is a <references> element, that each one
 * lists references, and that they are classified as normative or informative (see
 * unclassifiedReferencesFindings)
 *
 * A <references> element is empty when it holds no <reference> or <referencegroup> element, no xi:include and
 * no external entity or <?rfc include?> instruction, nor any <references> element.
 *
 * @param {Object} doc Parsed XML document
 * @param {number} mode Validation mode, other than submission
 * @returns {Array} List of errors/warnings or empty if fully valid
 */
function validateXmlReferencesSection (doc, mode) {
  if (!has(doc, 'data.rfc.back.references')) {
    // -> An included file may hold the <references> elements
    if (hasXmlIncludeOutsideReferences(doc)) {
      return []
    }
    return missingReferencesSectionFindings(mode, { path: 'rfc.back.references' })
  }

  // -> The parser leaves out the files included through the text, so the model locates them at their <references>
  const rawIncludePaths = new Set()
  for (const reference of getReferences(doc)) {
    if (reference.source === 'entity' || reference.source === 'pi') {
      rawIncludePaths.add(reference.location.path)
    }
  }
  const result = []
  for (const { path, section, references, referencegroups } of getReferencesSections(doc)) {
    const hasInclude = Object.keys(section).some(key => XML_INCLUDE_KEY_RE.test(key)) || rawIncludePaths.has(path)
    if (references.length === 0 && referencegroups.length === 0 && !hasInclude) {
      result.push(...checklistFindings(mode, 'EMPTY_REFERENCES_SECTION', 'The references section is present but contains no meaningful content.', {
        ref: 'https://authors.ietf.org/required-content#references',
        path
      }))
    }
  }
  result.push(...unclassifiedReferencesFindings(doc, mode))
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
  // -> At submission, only the "Informational References" misspelling, which the RFC Production Center
  //    corrects; the other modes report it as an unclassified section
  if (mode === MODES.SUBMISSION) {
    return informationalReferencesHeadings(doc)
  }

  if (doc.type === 'txt') {
    // -> Each format tells whether there is a references section and whether it is empty in its own way, and
    //    only text has numbered headings
    return validateTextReferencesSection(doc, mode)
  }
  return validateXmlReferencesSection(doc, mode)
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
  const result = getUncitedReferences(doc).map(reference => {
    if (reference.citedAsText) {
      return new ValidationWarning(
        'REFERENCE_CITED_AS_TEXT',
        `${reference.label} is mentioned only as typed text; cite it with <xref>.`,
        { ref: 'https://authors.ietf.org/en/references-in-rfcxml', ...reference.location }
      )
    }
    // -> An inferred reference is named by the label of its entry, in brackets
    const name = reference.certainty === CERTAINTY.INFERRED ? `[${reference.label}]` : reference.label
    return new ValidationWarning(
      'REFERENCE_NOT_USED',
      `The reference ${name} is listed in the References section but is not mentioned in the document text.`,
      { ref: 'https://authors.ietf.org/en/required-content#references', ...reference.location }
    )
  })

  // -> A check only text makes: a placeholder for the RFC number of this or a companion document is not a
  //    missing reference
  if (doc.type === 'txt') {
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
  }

  return result
}
