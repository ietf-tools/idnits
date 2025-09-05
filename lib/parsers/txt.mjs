import { ValidationError } from '../helpers/error.mjs'
import { DateTime } from 'luxon'
import { FQDN_RE } from '../modules/fqdn.mjs'
import { IPV4_LOOSE_RE, IPV6_LOOSE_RE } from '../modules/ip.mjs'
import { rfcStatusHierarchy } from '../config/rfc-status-hierarchy.mjs'

// Regex patterns
const LINE_VALUES_EXTRACT_RE = /^(?<left>.*)\s{2,}(?<right>.*)$/
const AUTHOR_NAME_RE = /^[a-z]\.\s[a-z]+$/i
const DATE_RE = /^(?:(?<day>[0-9]{1,2})\s)?(?<month>[a-z]{3,})\s(?<year>[0-9]{4})$/i
const SECTION_PATTERN = /^\d+\.\s+.+$/
const SUBSECTION_PATTERN = /^\d+\.\d+\.\s+(.+)$/ig
const TOC_PATTERN = /\.+\s*\d+$/
const RFC_REFERENCE_RE = /\bRFC\s?(\d+)\b|\[RFC(\d+)\]/gi
const DRAFT_REFERENCE_RE_IN_TEXT = /(?<=^|[\s\]])\[(?!(?:RFC\d+|draft-[A-Za-z0-9-]+|I-D\.[A-Za-z0-9-]+))[A-Za-z0-9.-]+\]/gi
const PAGES_RE = /\[Page \d+\]$/gm
const COPYRIGHT_NOTICE_RE = /^\d+\.\s*Copyright Notice$/i
const STATUS_OF_THIS_MEMO_RE = /^\d+\.\s*Status of This Memo$/i
const ABSTRACT_RE = /^\d+\.\s*Abstract$/i
const BRACKETED_RFC_REFERENCE_RE = /\[RFC(\d+)\]/
const FIRST_LINE_RE = /^(BM|PK)/
const SPACING_PATTERN = /[A-Za-z][a-z]\s{2,}[a-z]/
const TABLE_OF_CONTENTS = /^Table of Contents\s*$/i
const EXPIRES_FOOTER_RE = /Expires\s+((\d{1,2})?\s?(January|February|March|April|May|June|July|August|September|October|November|December)\s\d{4})\s+\[Page\s+\d+\]/gi
const DRAFT_URL_RE = /<https?:\/\/[^>\s]*\b(draft-[A-Za-z0-9-]+)\b[^>\s]*>/gi

// Author regexps
const AUTHORS_OR_EDITORS_ADDRESSES_RE = /^(Authors?|Editors?)[\u2018\u2019\u201B'`"] Addresses$/i
const AUTHOR_INFORMATION_RE = /^[0-9a-z.]*\s*author information$/i
const AUTHOR_CONTACT_INFORMATION_RE = /^[0-9a-z.]*\s*(author|editor)(?:[\u2018\u2019\u201B'`"]s?|s)?\s+contact information$/i
const CONTACT_INFORMATION_RE = /^[0-9a-z.]*\s*contact information$/i
const AUTHOR_EDITORS_RE = /^[0-9a-z.]*\s*(author|editor)s?:?$/i
const AUTHOR_ADDRESS_OPTIONAL_PLURAL_RE = /^(Author|Authors|Editor|Editors)['’`ʼ]s?\s+Address(?:es)?$/i

const AUTHOR_SECTION_RE = new RegExp(
  `(${AUTHORS_OR_EDITORS_ADDRESSES_RE.source}|` +
  `${AUTHOR_INFORMATION_RE.source}|` +
  `${AUTHOR_CONTACT_INFORMATION_RE.source}|` +
  `${CONTACT_INFORMATION_RE.source}|` +
  `${AUTHOR_EDITORS_RE.source}|` +
  `${AUTHOR_ADDRESS_OPTIONAL_PLURAL_RE.source})`,
  'i'
)

// Inline code format
const INLINE_CODE_FORMAT = /\/\*|\*\/|^ *#/ig

// Section matchers
const sectionMatchers = [
  { name: 'introduction', regex: /^\d+\.\s+(Introduction|Overview|Background)$/i },
  { name: 'securityConsiderations', regex: /^\d+\.\s+Security Considerations$/i },
  { name: 'authorAddress', regex: AUTHOR_SECTION_RE },
  { name: 'references', regex: /^(?:\d+\.\s+)?(?:(?:Normative|Informative)\s+)?References$/i },
  { name: 'ianaConsiderations', regex: /^\d+\.\s+IANA Considerations$/i }
]

const subsectionMatchers = [
  { name: 'normative_references', regex: /^\d+\.\d+\.\s+Normative\s+References$/i },
  { name: 'informative_references', regex: /^\d+\.\d+\.\s+Informative\s+References$/i },
  { name: 'unclassified_references', regex: /^\d+\.\d+\.\s+([a-zA-Z]+\s+)*Reference(s)?$/i },
  { name: 'appendix', regex: /^Appendix\b/i }
]

const sectionIndentationRules = [
  { name: 'Abstract', regex: /^ +(?:[0123.]+)?[ \t]*abstract$/i },
  { name: 'Introduction', regex: /^ +(?:[0123.]+)?[ \t]*(?:introduction|overview|scope|(?:historical )?background)$/i },
  { name: 'Security Considerations', regex: /^ +(?:[0-9.]+)?[ \t]*security considerations?$/i },
  { name: 'IANA Considerations', regex: /^ +(?:[0-9a-z.]+)?[ \t]*iana considerations?$/i },
  { name: "Author's Addresses", regex: /^ +(?:[0-9A-Z.]*)?[ \t]*(?:author|editor)(?:'s|s')? addresses?$/i },
  { name: 'Status of This Memo', regex: /^ +(?:[0-9.]+)?[ \t]*status of (?:this )?memo/i },
  { name: 'References', regex: /^ +(?:[0-9.]+)?[ \t]*(?:(?:normative|informative)[ \t]+)?references[ \t]*\.?$/i },
  { name: 'Appendix', regex: /^ +appendix[ \t]+[a-z0-9.]+/i }
]

// Boilerplate regex patterns
const BOILERPLATE_PATTERNS = {
  rfc2119: /The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", ?("NOT RECOMMENDED", )?"MAY", and "OPTIONAL" in this document are to be interpreted as described in( BCP 14,)? RFC ?2119[.,;]/ig,
  rfc2119_alt: /The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", ?("NOT RECOMMENDED", )?"MAY", and "OPTIONAL" in this document are to be interpreted as described in "Key words for use in RFCs to Indicate Requirement Levels" \[RFC2119\]/ig,
  rfc2119_alt1: /The key words\s+"MUST",\s+"MUST NOT",\s+"REQUIRED",\s+"SHALL",\s+"SHALL NOT",\s+"SHOULD",\s+"SHOULD NOT",\s+"RECOMMENDED",\s+"NOT RECOMMENDED",\s+"MAY",\s+and\s+"OPTIONAL"\s+in this document are to be interpreted as described in\s+\[BCP14\]\s+\(RFC2119\)\s+\(RFC8174\)\s+when, and only when, they appear in all capitals, as shown here\./ig,
  rfc2119_alt2: /The key words\s+"MUST",\s+"MUST NOT",\s+"REQUIRED",\s+"SHALL",\s+"SHALL\s+NOT",\s+"SHOULD",\s+"SHOULD NOT",\s+"RECOMMENDED",\s+"NOT RECOMMENDED",\s+"MAY",\s+and\s+"OPTIONAL"\s+in this document are to be interpreted as described in\s+BCP\s*14\s*\[RFC2119\]\[RFC8174\]\s+when, and only when, they appear in all\s+capitals, as shown here[.;]?/ig,
  rfc8174: /The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 \[RFC2119\] \[RFC8174\]/ig,
  bcp14: /The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in\s*\[BCP14\]\s*\(RFC2119\)\s*\(RFC8174\)\s*when, and only when, they appear in all capitals, as shown here\./ig
}

// Similar boilerplate regex pattern
const BOILERPLATE_PARTS = {
  rfc2119: [
    /The key words /g,
    /"MUST", "MUST NOT", "REQUIRED", "SHALL"/g,
    /"SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED"/g,
    /"NOT RECOMMENDED", "MAY", and "OPTIONAL"/g,
    /in this document are to be interpreted as described in/g,
    /RFC ?2119[.,;]?/i
  ],
  rfc2119_alt: [
    /The key words /g,
    /"MUST", "MUST NOT", "REQUIRED", "SHALL"/g,
    /"SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED"/g,
    /"NOT RECOMMENDED", "MAY", and "OPTIONAL"/g,
    /in this document are to be interpreted as described in/g,
    /"Key words for use in RFCs to Indicate Requirement Levels" \[RFC2119\]/gi
  ],
  rfc2119_alt1: [
    /The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",/g,
    /"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and/g,
    /"OPTIONAL" in this document are to be interpreted as described in/g,
    /[BCP14] (RFC2119) (RFC8174) when, and only when, they appear in all/g,
    /capitals, as shown here./gi
  ],
  rfc2119_alt2: [
    /The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",/g,
    /"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and/g,
    /"OPTIONAL" in this document are to be interpreted as described in BCP/g,
    /14 [RFC2119][RFC8174] when, and only when, they appear in all/g,
    /capitals, as shown here./gi
  ],
  rfc8174: [
    /The key words /g,
    /"MUST", "MUST NOT", "REQUIRED", "SHALL"/g,
    /"SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED"/g,
    /"NOT RECOMMENDED", "MAY", and "OPTIONAL"/g,
    /in this document are to be interpreted as described in BCP 14/g,
    /\[RFC2119\] \[RFC8174\]/ig
  ],
  bcp14: [
    /The key words /g,
    /"MUST", "MUST NOT", "REQUIRED", "SHALL"/g,
    /"SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED"/g,
    /"NOT RECOMMENDED", "MAY", and "OPTIONAL"/g,
    /in this document are to be interpreted as described in\s*\[BCP14\]/g,
    /\(RFC2119\)\s*\(RFC8174\)/ig,
    /when, and only when, they appear in all capitals, as shown here\./g
  ]
}

// License declaration
const licenseDeclarations = {
  revised_bsd_license: /Code Components extracted from this document must include Revised BSD License text as described in Section 4\.e of the Trust Legal Provisions and are provided without warranty as described in the Revised BSD License\./gi,
  previous_tlp4_6_b_i: /Copyright\s+\(c\)\s+\d{4}\s+IETF Trust|Copyright\s+\(C\)\s+\d{4}\s+The Internet Society/gi,
  trust_28_dec_2009_section_6_a: /This\s+Internet-Draft\s+is\s+submitted\s+in\s+full\s+conformance\s+with\s+the\s+provisions\s+of\s+BCP\s+78\s+and\s+BCP\s+79/gi,
  tlp5_6_b_i_copyright: /Copyright\s+\(c\)\s+(\d{4})\s+IETF Trust\s+and\s+the\s+persons\s+identified\s+as\s+the\s+document\s+authors\.?\s+All\s+rights\s+reserved\.?/gi,
  license6_b_i: /This document is subject to BCP 78 and the IETF Trust[’']s Legal Provisions\s+Relating to IETF Documents\s+\(https?:\/\/trustee\.ietf\.org\/license-info\) in effect on the\s+date of publication of this document\. Please review these documents carefully, as\s+they describe your rights and restrictions with respect to this document\. Code\s+Components extracted from this document must include Revised BSD License\s+text as described in Section 4\.e of the Trust Legal Provisions and are provided\s+without warranty as described in the Revised BSD License\./gi,
  license6_b_ii: /This document is subject to BCP 78 and the IETF Trust[’']s Legal Provisions\s+Relating to IETF Documents\s+\(https?:\/\/trustee\.ietf\.org\/license-info\) in effect on the\s+date of publication of this document\. Please review these documents carefully, as\s+they describe your rights and restrictions with respect to this document\./gi,
  license6_c_i: /This document may not be modified, and derivative works of it may not be\s+created, except to format it for publication as an RFC or to translate it into\s+languages other than English\./gi,
  license6_c_ii: /This document may not be modified, and derivative works of it may not be\s+created, and it may not be published except as an Internet-Draft\./gi,
  acceptable_paragraph_noting_that_draft: /Internet-Drafts are working documents of the Internet Engineering Task Force \(IETF\)\./gi,
  draft_paragraph_out6_month_validity: /Internet-Drafts are draft documents valid for a maximum of six months and may be updated, replaced, or obsoleted by other documents at any time\. It is inappropriate to use Internet-Drafts as reference material or to cite them other than as "work in progress."\s*/gi,
  draft_paragraph_pointing_to_the_list_of_current_ids: /The list of current Internet-Drafts is at https:\/\/datatracker\.ietf\.org\/drafts\/current\/|The list of current Internet-Drafts can be accessed at http:\/\/www\.ietf\.org\/ietf\/1id-abstracts\.txt\./gi
}

// Keywords regex pattern
const KEYWORDS_PATTERN = /((NOT)\s)?(MUST|REQUIRED|SHALL|SHOULD|RECOMMENDED|OPTIONAL|MAY)(\s(NOT))?/g

// Invalid combinations regex pattern
const INVALID_COMBINATIONS_PATTERN = /\s(MUST not|SHALL not|SHOULD not|not RECOMMENDED|MAY NOT|NOT REQUIRED|NOT OPTIONAL)\s/g

// Obsolete and updates regex patterns
const OBSOLETES_RE = /(?:obsoletes|replaces)\s*:\s*((?:rfc\s*)?[0-9]+(?:,|\s|and)*\s*)+/gi
const UPDATES_RE = /updates\s*:\s*((?:rfc\s*)?[0-9]+(?:,|\s|and)*\s*)+/gi

// Consts values
const MAX_PAGE_LENGTH = 58
const TITLE_SECTION_LOOKAHEAD = 3
const HEADER_MAX_LINES = 18

/**
 * @typedef {Object} TXTDocObject
 * @property {Object} data Parsed TXT tree
 * @property {string} docKind Whether the document is an Internet Draft (draft) or an RFC (rfc)
 * @property {string} filename Filename of the document
 * @property {string} type Document file type (txt)
 * @property {number} version Document version number (2 or 3)
 * @property {string} versionCertainty Whether the version was explicity specified (strict) or guessed (guess)
 */

/**
 * Parse Text document
 *
 * @param {string} rawText Input text
 * @param {string} filename Filename of the document
 * @returns {TXTDocObject} Parsed document object
 */
export async function parse (rawText, filename) {
  const normalizedText = normalizeText(rawText)
  const pages = rawText?.split(/\f/)

  const data = {
    pageCount: 1,
    header: {
      authors: [],
      date: null,
      source: null,
      expires: null
    },
    content: {
      abstract: [],
      introduction: [],
      securityConsiderations: [],
      authorAddress: [],
      references: [],
      ianaConsiderations: []
    },
    contains: {
      copyrightSection6_b_i: false,
      copyrightLicenseValid: false,
      license6_c_i: false,
      license6_c_ii: false,
      revisedBsdLicense: false,
      codeBlocks: false,
      draftParagraphOutSixMonthValidity: false,
      acceptableParagraphNotingThatDraft: false,
      idIndication: false,
      revisedBsdLicense6_i: false,
      submissionCompliance: false,
      pagesFound: 0,
      previous6_b_i_copyright: false
    },
    title: null,
    slug: null,
    possibleIssues: {
      linesWithSpaces: [],
      unexpectedIndentation: [],
      inlineCode: [],
      misspeled2119Keywords: [],
      pageLineWithFormFeed: [],
      paragraphPointingToTheListOfCurrentId: [],
      copyrightLines6_i: [],
      isCopyrightNoticeNumbered: false,
      isStatusOfThisMemoNumbered: false,
      isAbstractNumbered: false,
      isPKorBM: false,
      updatesRfcWithLetter: [],
      obsoletesWithLetter: [],
      missingPageNumbering: [],
      submissionCompliancePage: null,
      isTableOfContentsExists: false,
      tooLongPages: []
    },
    extractedElements: {
      fqdnDomains: [],
      ipv4: [],
      ipv6: [],
      keywords2119: [],
      boilerplate2119Keywords: [],
      obsoletesRfc: [],
      updatesRfc: [],
      nonReferenceSectionRfc: [],
      referenceSectionRfc: [],
      nonReferenceSectionDraftReferences: [],
      referenceSectionDraftReferences: [],
      draftStatusReferences: [],
      copyrightDates: [],
      license6_b_ii: [],
      license6_b_i: [],
      bracketedRfcNonReferences: [],
      bracketedRfcReferences: [],
      lastPageExpiration: null
    },
    boilerplate: {
      rfc2119: BOILERPLATE_PATTERNS.rfc2119.test(normalizedText) || BOILERPLATE_PATTERNS.rfc2119_alt.test(normalizedText) || BOILERPLATE_PATTERNS.rfc2119_alt1.test(normalizedText) || BOILERPLATE_PATTERNS.rfc2119_alt2.test(normalizedText),
      rfc8174: BOILERPLATE_PATTERNS.rfc8174.test(normalizedText),
      bcp14: BOILERPLATE_PATTERNS.bcp14.test(normalizedText),
      similar2119boilerplate: false
    },
    references: {
      rfc2119: false,
      rfc8174: false,
      bcp14: false
    }
  }
  let docKind = null
  let lineIdx = 0
  let currentSection = null
  let currentSubSection = null
  let inCodeBlock = false
  let rfcMatch = null
  let draftMatch = null
  let prevLine = null
  let currentPageLineCount = 0
  try {
    const markers = {
      header: { start: 0, end: 0, lastAuthor: 0, closed: false },
      title: 0,
      slug: 0,
      abstract: { start: 0, end: 0, closed: false },
      toc: { start: 0, end: 0, closed: false },
      introduction: { start: 0, end: 0, closed: false },
      securityConsiderations: { start: 0, end: 0, closed: false },
      authorAddress: { start: 0, end: 0, closed: false },
      references: { start: 0, end: 0, closed: false },
      ianaConsiderations: { start: 0, end: 0, closed: false }
    }

    // Extracting mentioned rfc2119 keywords
    for (const pattern of Object.values(BOILERPLATE_PATTERNS)) {
      const match = normalizedText.match(pattern)
      if (match) {
        const keywordMatches = match[0].matchAll(KEYWORDS_PATTERN)
        for (const keywordMatch of keywordMatches) {
          const keyword = keywordMatch[0]
          if (!data.extractedElements.boilerplate2119Keywords.includes(keyword)) {
            data.extractedElements.boilerplate2119Keywords.push(keyword)
          }
        }
      }
    }

    // Searching acceptable paragraph pointing to the list of current ids
    const matchParagraphPointingToTheListOfCurrentId = [...normalizedText.matchAll(licenseDeclarations.draft_paragraph_pointing_to_the_list_of_current_ids)]

    if (matchParagraphPointingToTheListOfCurrentId.length) {
      data.possibleIssues.paragraphPointingToTheListOfCurrentId = matchParagraphPointingToTheListOfCurrentId.map((item) => item[0])
    }

    data.boilerplate.similar2119boilerplate =
      hasBoilerplateMatch(normalizedText, BOILERPLATE_PARTS.rfc2119, BOILERPLATE_PARTS.rfc2119_alt, BOILERPLATE_PARTS.rfc2119_alt1, BOILERPLATE_PARTS.rfc2119_alt2, BOILERPLATE_PARTS.rfc8174, BOILERPLATE_PARTS.bcp14) &&
      !(data.boilerplate.rfc2119 || data.boilerplate.rfc8174 || data.boilerplate.bcp14)

    // Extracting obsolete and updated rfc from header
    const obsoletesRfc = extractRfcNumbers(normalizedText, OBSOLETES_RE)
    data.extractedElements.obsoletesRfc.push(...obsoletesRfc.plainNumbers)
    data.possibleIssues.obsoletesWithLetter.push(...obsoletesRfc.rfcWithPrefix)

    const updatesRfcs = extractRfcNumbers(normalizedText, UPDATES_RE)
    data.extractedElements.updatesRfc.push(...updatesRfcs.plainNumbers)
    data.possibleIssues.updatesRfcWithLetter.push(...updatesRfcs.rfcWithPrefix)

    // Searching for license declaration
    data.contains.revisedBsdLicense = licenseDeclarations.revised_bsd_license.test(normalizedText)

    // Page separator counting
    const pagesMatches = rawText.match(PAGES_RE)

    data.contains.pagesFound = pagesMatches?.length ? pagesMatches.length : 0

    // Searching for submission compliance line and pages
    for (let i = 0; i < pages.length; i++) {
      licenseDeclarations.trust_28_dec_2009_section_6_a.lastIndex = 0
      const normalizedPage = pages[i].replace(/\s+/g, ' ').trim()
      if (licenseDeclarations.trust_28_dec_2009_section_6_a.test(normalizedPage)) {
        data.contains.submissionCompliance = true
        data.possibleIssues.submissionCompliancePage = i + 1
        break
      }
    }

    // Searching acceptable paragraph noting that IDs are working documents
    data.contains.acceptableParagraphNotingThatDraft = licenseDeclarations.acceptable_paragraph_noting_that_draft.test(normalizedText)

    // Extracting expiration date from the last page
    const lastPageExpiration = [...normalizedText.matchAll(EXPIRES_FOOTER_RE)].pop()

    if (lastPageExpiration) {
      const expiresStr = lastPageExpiration[1]

      const parsed = DateTime.fromFormat(expiresStr, 'd LLLL yyyy') ||
                     DateTime.fromFormat(expiresStr, 'LLLL d, yyyy')

      if (parsed.isValid) {
        data.extractedElements.lastPageExpiration = parsed
      }
    }

    // Searching for copyright line in normalized text
    const match = [...normalizedText.matchAll(licenseDeclarations.tlp5_6_b_i_copyright)]

    if (match.length > 0) {
      const copyrightText = match.map(m => m[0])

      data.possibleIssues.copyrightLines6_i = copyrightText

      if (copyrightText.length) data.contains.copyrightSection6_b_i = true

      const copyrightYears = match.map(m => Number(m[1]) || Number(m[2]))

      if (copyrightYears.length) data.extractedElements.copyrightDates = copyrightYears
    }

    // Search for 6.b license declaration
    const match6bi = [...normalizedText.matchAll(licenseDeclarations.license6_b_i)]

    // Search for 6.b.ii license declaration
    const match6bii = [...normalizedText.matchAll(licenseDeclarations.license6_b_ii)]
    if (match6bii.length > 0) {
      data.extractedElements.license6_b_ii = match6bii.map(m => m[0])
    }

    if (match6bi.length > 0) {
      data.contains.revisedBsdLicense6_i = true
      data.extractedElements.license6_b_i = match6bi.map(m => m[0])
    }

    // Serach for 6.c licenses declaration
    data.contains.license6_c_i = licenseDeclarations.license6_c_i.test(normalizedText)
    data.contains.license6_c_ii = licenseDeclarations.license6_c_ii.test(normalizedText)

    // Searching for copyright line
    data.contains.previous6_b_i_copyright = licenseDeclarations.previous_tlp4_6_b_i.test(normalizedText)

    // Searching acceptable paragraph calling out 6 month validity
    data.contains.draftParagraphOutSixMonthValidity = licenseDeclarations.draft_paragraph_out6_month_validity.test(normalizedText)

    for (const line of rawText.split('\n')) {
      const trimmedLine = line.trim()
      lineIdx++

      // Pages not numbered
      if (prevLine && !prevLine.includes('[Page') && line.includes('\f')) {
        data.possibleIssues.missingPageNumbering.push({ page: data.pageCount, lines: lineIdx })
      }

      prevLine = line

      // Page Break
      // --------------------------------------------------------------
      if (line.indexOf('\f') >= 0) {
        data.pageCount++

        if (line.includes('[Page') && line.includes('\f')) {
          data.possibleIssues.pageLineWithFormFeed.push({ page: data.pageCount - 1, lines: lineIdx })
        }

        if (currentPageLineCount > MAX_PAGE_LENGTH) {
          data.possibleIssues.tooLongPages.push({ page: data.pageCount - 1, lines: currentPageLineCount })
        }
        currentPageLineCount = 0
        continue
      } else {
        currentPageLineCount++
      }

      // Empty line
      // --------------------------------------------------------------
      if (!trimmedLine) {
        continue
      }

      // Check line spaces
      if (SPACING_PATTERN.test(trimmedLine) && !trimmedLine.trim().startsWith('Internet.Draft') && !trimmedLine.trim().startsWith('INTERNET.DRAFT')) {
        data.possibleIssues.linesWithSpaces.push({ line: lineIdx, pos: line.length })
      }

      // Code block detection
      if (/<CODE BEGINS>/i.test(trimmedLine)) {
        data.contains.codeBlocks = true
        inCodeBlock = true
      }

      if (/<CODE ENDS>/i.test(trimmedLine)) {
        inCodeBlock = false
      }

      // Check for inline code format outside code blocks
      if (!inCodeBlock) {
        const match = INLINE_CODE_FORMAT.exec(line)
        if (match) {
          data.possibleIssues.inlineCode.push({
            line: lineIdx,
            pos: ++match.index
          })
        }
      }

      // Search for bad section title identations. Starts search after detecting abstract section to avoid false positives
      if (currentSection !== 'toc') {
        sectionIndentationRules.forEach(({ name, regex }) => {
          if (regex.test(line)) {
            data.possibleIssues.unexpectedIndentation.push({ name, line: lineIdx, pos: 0 })
          }
        })
      }

      // Extract rfc references from whole text except the reference section
      while ((rfcMatch = RFC_REFERENCE_RE.exec(trimmedLine)) !== null) {
        const rfcNumber = rfcMatch[1] || rfcMatch[2]
        if (currentSection !== 'references' || currentSubSection === 'appendix') {
          if (rfcNumber && !data.extractedElements.nonReferenceSectionRfc.includes(rfcNumber)) {
            data.extractedElements.nonReferenceSectionRfc.push(rfcNumber)
          }
        } else if (BRACKETED_RFC_REFERENCE_RE.exec(trimmedLine)) {
          if (rfcNumber && !data.extractedElements.referenceSectionRfc.find((el) => el.value === rfcNumber)) {
            data.extractedElements.referenceSectionRfc.push({
              value: rfcNumber,
              subsection: currentSubSection
            })
          }
        }

        // Detect bracketed RFC references
        if (rfcMatch[0]) {
          if (BRACKETED_RFC_REFERENCE_RE.test(rfcMatch[0])) {
            if (currentSection === 'references') {
              data.extractedElements.bracketedRfcReferences.push(rfcMatch[0])
            } else {
              data.extractedElements.bracketedRfcNonReferences.push(rfcMatch[0])
            }
          }
        }
      }

      // Detect draft references
      while ((draftMatch = DRAFT_REFERENCE_RE_IN_TEXT.exec(trimmedLine)) !== null) {
        const draftName = draftMatch[0]
        if (currentSection !== 'references' || currentSubSection === 'appendix') {
          if (!data.extractedElements.nonReferenceSectionDraftReferences.includes(draftName)) {
            data.extractedElements.nonReferenceSectionDraftReferences.push(draftName)
          }
        } else {
          if (!data.extractedElements.referenceSectionDraftReferences.find((el) => el.value === draftName)) {
            data.extractedElements.referenceSectionDraftReferences.push({
              value: draftName,
              subsection: currentSubSection
            })
          }
        }
      }

      if (STATUS_OF_THIS_MEMO_RE.test(trimmedLine)) {
        data.possibleIssues.isStatusOfThisMemoNumbered = true
      }

      if (FIRST_LINE_RE.test(trimmedLine) && lineIdx === 1) {
        data.possibleIssues.isPKorBM = true
      }

      if (TABLE_OF_CONTENTS.test(trimmedLine)) {
        data.possibleIssues.isTableOfContentsExists = true
      }

      // Check for references
      if (/\[RFC2119\]/i.test(trimmedLine)) {
        data.references.rfc2119 = true
      }
      if (/\[RFC8174\]/i.test(trimmedLine)) {
        data.references.rfc8174 = true
      }
      if (/\[BCP14\]/i.test(trimmedLine)) {
        data.references.bcp14 = true
      }

      // Check for keywords
      const keywordMatches = [...trimmedLine.matchAll(KEYWORDS_PATTERN)]
      keywordMatches.forEach(match => {
        data.extractedElements.keywords2119.push({ keyword: match[0], line: lineIdx })
      })

      // Check for invalid keyword combinations
      const invalidMatches = [...line.matchAll(INVALID_COMBINATIONS_PATTERN)]
      invalidMatches.forEach(match => {
        data.possibleIssues.misspeled2119Keywords.push({ invalidKeyword: match[0], line: lineIdx, pos: ++match.index })
      })

      // FQDN Domain extraction
      const domainMatches = [...trimmedLine.matchAll(FQDN_RE)]
      if (domainMatches.length > 0) {
        domainMatches.forEach(match => {
          if (!data.extractedElements.fqdnDomains.includes(match.groups.domain)) {
            data.extractedElements.fqdnDomains.push(match.groups.domain.toLowerCase())
          }
        })
      }

      // IPv4 and IPv6 extraction
      const ipv4Matches = [...trimmedLine.matchAll(IPV4_LOOSE_RE)]
      if (ipv4Matches.length > 0) {
        ipv4Matches.forEach(match => data.extractedElements.ipv4.push(match[0]))
      }

      const ipv6Matches = [...trimmedLine.matchAll(IPV6_LOOSE_RE)]
      if (ipv6Matches.length > 0) {
        ipv6Matches.forEach(match => data.extractedElements.ipv6.push(match[0]))
      }

      // Header
      // --------------------------------------------------------------
      if (!markers.header.start) {
        // -> First Line
        markers.header.start = lineIdx
        markers.header.end = lineIdx
        const values = LINE_VALUES_EXTRACT_RE.exec(trimmedLine)
        // --> Source
        data.header.source = values?.groups.left
        // --> Author
        data.header.authors.push({
          name: values?.groups.right
        })
        markers.header.lastAuthor = lineIdx
        continue
      } else if (!markers.header.closed) {
        if (lineIdx > markers.header.end + 1) {
          markers.header.closed = true
          markers.title = lineIdx
          data.title = trimmedLine
        } else {
          markers.header.end = lineIdx

          const extractedValues = LINE_VALUES_EXTRACT_RE.exec(line)
          const values = extractedValues ? extractedValues.groups : { left: trimmedLine, right: null }

          if (values.left) {
            // --> Date
            const match = values.left.match(DATE_RE)

            if (match) {
              const day = parseInt(match[1], 10)
              const month = match[2]
              const year = parseInt(match[3], 10)

              data.header.date = { day, month, year }
            }

            // --> Document Kind
            if (values.left.includes('Internet-Draft')) {
              docKind = 'draft'
              data.contains.idIndication = true
            } else if (values.left.startsWith('Request for Comments')) {
              data.header.rfcNumber = values.left.split(':')?.[1]?.trim()
              docKind = 'rfc'
            } else if (filename.startsWith('rfc')) {
              const match = filename.match(/rfc(\d+)\.txt$/i)
              if (match) {
                data.header.rfcNumber = match[1]
                docKind = 'rfc'
              }
            } else {
              docKind = 'draft'
            }

            // --> Intended status
            if (values.left.startsWith('Intended')) {
              const rawIntendedStatus = values.left.split(':')?.[1]?.trim()
              const cleanIntendedStatus = extractStatusName(rawIntendedStatus)
              data.header.intendedStatus = cleanIntendedStatus || rawIntendedStatus
            }

            // --> Obsoletes
            if (values.left.startsWith('Obsoletes')) {
              const obsoletesValues = values.left.split(':')?.[1]?.trim()
              data.header.obsoletes = obsoletesValues.indexOf(',') >= 0 ? obsoletesValues.split(',').map(o => o.trim()) : [obsoletesValues]
            }

            // --> Category
            if (values.left.startsWith('Category')) {
              const rawCategory = values.left.split(':')?.[1]?.trim()
              const cleanCategory = extractStatusName(rawCategory)
              data.header.category = cleanCategory || rawCategory
            }

            // --> ISSN
            if (values.left.startsWith('ISSN')) {
              data.header.issn = values.left.split(':')?.[1]?.trim()
            }

            // --> Expires
            if (values.left.startsWith('Expires')) {
              const datePart = values.left.split(':')[1]?.trim().split(/\s{2,}/)[0]

              const DATE_RE = /(?:(?<month>[A-Za-z]{3,9})[\s]+(?<day>\d{1,2}),?\s*(?<year>\d{4}))|(?:(?<dayAlt>\d{1,2})[\s\-/]*(?<monthAlt>[A-Za-z]{3,9})[\s\-/,]*(?<yearAlt>\d{4}))|(?<iso>\d{4}-\d{2}-\d{2})/

              const dateValue = DATE_RE.exec(datePart)

              if (dateValue) {
                if (dateValue.groups.iso) {
                  data.header.expires = DateTime.fromISO(dateValue.groups.iso)
                } else {
                  const day = dateValue.groups.day || dateValue.groups.dayAlt || 1
                  const month = dateValue.groups.month || dateValue.groups.monthAlt
                  const year = dateValue.groups.year || dateValue.groups.yearAlt

                  data.header.expires = DateTime.fromFormat(
                    `${day} ${month} ${year}`,
                    'd LLLL yyyy'
                  )
                }
              }
            }
          }
          if (values.right) {
            // --> Date
            const dateValue = DATE_RE.exec(values.right)
            if (dateValue) {
              const day = parseInt(dateValue[1], 10)
              const month = dateValue[2]
              const year = parseInt(dateValue[3], 10)
              data.header.date = { day, month, year }
            }

            if (!data.header.date) {
              // --> Author
              const authorNameValue = AUTHOR_NAME_RE.exec(values.right)
              if (authorNameValue) {
                // --> Blank line = Previous author(s) have no affiliation
                if (lineIdx > markers.header.lastAuthor + 1) {
                  data.header.authors.findLast(el => {
                    if (el.org || el.org === '') {
                      return true
                    } else {
                      el.org = ''
                      return false
                    }
                  })
                }

                // --> Author Name
                data.header.authors.push({
                  name: authorNameValue[0]
                })
              } else if (values.right) {
                // --> Author Org
                data.header.authors.findLast(el => {
                  if (el.org || el.org === '') {
                    return true
                  } else {
                    el.org = values.right
                    return false
                  }
                })
              }
              markers.header.lastAuthor = lineIdx
            }
          }
        }
      }
      if ((data.title && lineIdx <= markers.title + TITLE_SECTION_LOOKAHEAD) || (!data.title && lineIdx < HEADER_MAX_LINES)) {
        if (trimmedLine.startsWith('draft-')) {
          markers.slug = lineIdx
          data.slug = trimmedLine
          continue
        }
      }

      if (COPYRIGHT_NOTICE_RE.test(trimmedLine)) {
        data.possibleIssues.isCopyrightNoticeNumbered = true
      }

      // Abstract
      // --------------------------------------------------------------
      if (trimmedLine === 'Abstract' || ABSTRACT_RE.test(trimmedLine)) {
        markers.abstract.start = lineIdx
        currentSection = 'abstract'
        data.content.abstract = []
        if (ABSTRACT_RE.test(trimmedLine)) {
          data.possibleIssues.isAbstractNumbered = true
        }
      } else if (markers.abstract.start && !markers.abstract.closed) {
        if (trimmedLine.startsWith('Status of') || !line.startsWith('  ')) {
          markers.abstract.end = lineIdx - 1
          markers.abstract.closed = true
        }
      }

      // Header
      // --------------------------------------------------------------
      if (!markers.header.start) {
        markers.header.start = lineIdx
        markers.header.end = lineIdx
        const values = LINE_VALUES_EXTRACT_RE.exec(trimmedLine)
        if (values) {
          data.header.source = values.groups.left
          data.header.authors.push({ name: values.groups.right })
        }
        markers.header.lastAuthor = lineIdx
        continue
      } else if (!markers.header.closed) {
        if (lineIdx > markers.header.end + 1) {
          markers.header.closed = true
          markers.title = lineIdx
          data.title = !trimmedLine.startsWith('draft-') ? trimmedLine : null
        } else {
          markers.header.end = lineIdx
        }
        continue
      }

      // Table of Contents
      // --------------------------------------------------------------
      if (!markers.toc.start && line === 'Table of Contents') {
        markers.toc.start = lineIdx
        currentSection = 'toc'
        continue
      } else if (currentSection === 'toc' && !markers.toc.closed) {
        if (!TOC_PATTERN.test(line)) {
          markers.toc.closed = true
          markers.toc.end = lineIdx - 1
          currentSection = null
        } else {
          continue
        }
      }

      // Other Sections
      // --------------------------------------------------------------

      // Section detection and content assignment
      if ((sectionMatchers.some(({ regex }) => regex.test(trimmedLine)) || AUTHOR_SECTION_RE.test(trimmedLine)) && !ABSTRACT_RE.test(trimmedLine)) {
        const matchedSection = sectionMatchers.find(({ regex }) => regex.test(trimmedLine))

        if (currentSection && !markers[currentSection].closed) {
          markers[currentSection].end = lineIdx - 1
          markers[currentSection].closed = true
        }

        if (matchedSection) {
          currentSection = matchedSection.name
          markers[currentSection].start = lineIdx
          markers[currentSection].closed = false
        } else {
          currentSection = null
        }
      } else if (SECTION_PATTERN.test(trimmedLine) && !TOC_PATTERN.test(trimmedLine)) {
        if (currentSection && !markers[currentSection].closed) {
          markers[currentSection].end = lineIdx - 1
          markers[currentSection].closed = true
        }

        currentSection = null
      }

      // Sub section detection
      if (SUBSECTION_PATTERN.test(trimmedLine) && !TOC_PATTERN.test(trimmedLine)) {
        if (subsectionMatchers.some(({ regex }) => regex.test(trimmedLine))) {
          const matchedSubsection = subsectionMatchers.find(({ regex }) => regex.test(trimmedLine))
          currentSubSection = matchedSubsection.name
        } else currentSubSection = null
      } else if (!TOC_PATTERN.test(trimmedLine)) {
        if (subsectionMatchers.some(({ regex }) => regex.test(trimmedLine))) {
          const matchedSubsection = subsectionMatchers.find(({ regex }) => regex.test(trimmedLine))
          currentSubSection = matchedSubsection.name
        }
      }

      // Add content to the current section
      if (currentSection && markers[currentSection].start && !markers[currentSection].closed) {
        data.content[currentSection].push(trimmedLine)
      }
    }

    // Close the last section
    if (currentSection && !markers[currentSection].closed) {
      markers[currentSection].end = lineIdx
      markers[currentSection].closed = true
    }

    data.markers = markers

    // Extracting draft references from reference section
    const refLines = data.content.references
    const draftsBySub = extractDraftsBySubsection(refLines)
    data.extractedElements.draftStatusReferences.push(...draftsBySub)
  } catch (err) {
    throw new ValidationError('TXT_PARSING_FAILED', `Error while parsing Line ${lineIdx}: ${err.message}`)
  }

  return {
    docKind,
    body: rawText,
    data,
    filename,
    type: 'txt'
  }
}

/**
 * Function to check if at least one match is found among the specified groups of patterns in the text
 *
 * @param {string} text Normalized text
 * @param {...Array<RegExp>} regexGroups Arrays of patterns to check
 * @returns {boolean} Whether at least one match is found
 */
function hasBoilerplateMatch (text, ...regexGroups) {
  for (const group of regexGroups) {
    let matchCount = 0
    for (const part of group) {
      if (part.test(text)) {
        matchCount++
      } else {
        break
      }
    }
    if (matchCount > 0) {
      return true
    }
  }
  return false
}

/**
 * Extract RFC numbers from the text
 *
 * @param {string} text Text to extract RFC numbers from
 * @param {RegExp} regex Regular expression to extract RFC numbers
 * @returns {Array<string>} Extracted RFC numbers
 */
function extractRfcNumbers (text, regex) {
  const matches = {
    rfcWithPrefix: [],
    plainNumbers: []
  }

  let match
  while ((match = regex.exec(text)) !== null) {
    const rfcList = match[0]
    if (rfcList) {
      const numbers = rfcList
        .match(/\b(RFC\s*[0-9]+|[0-9]+)\b/gi)
        ?.map(num => num.trim()) || []
      numbers.forEach(num => {
        if (/^RFC\s*[0-9]+$/i.test(num)) {
          matches.rfcWithPrefix.push(num)
          matches.plainNumbers.push(num.replace(/^RFC\s*/i, ''))
        } else {
          matches.plainNumbers.push(num)
        }
      })
    }
  }

  return matches
}

/**
 * Extracts the clean status name from a given status text using predefined regular expressions.
 *
 * This function iterates through an array of predefined RFC statuses, each containing
 * a name, regex pattern, and category. It tests the given status text against each regex
 * and returns the corresponding clean status name if a match is found.
 *
 * @param {string} statusText - The raw status text to be processed (e.g., "Standards Track Juniper Networks").
 * @returns {string|null} - The clean name of the status (e.g., "Proposed Standard") if matched,
 *                          or `null` if no matching status is found.
 *
 * Example:
 * const rawStatus = "Standards Track Juniper Networks";
 * const cleanStatus = extractStatusName(rawStatus);
 * console.log(cleanStatus); // Output: "Proposed Standard"
 */
function extractStatusName (statusText) {
  for (const status of rfcStatusHierarchy) {
    if (status.regex.test(statusText)) {
      return status.name
    }
  }
  return null
}

/**
 * Normalize text from the form of multi-line text with \n to the form of a single-line long string
 *
 * @param {string} rawText
 * @returns
 */
function normalizeText (rawText) {
  let rawFixed = rawText
    .replace(/\r?\n/g, '\n')
    .replace(/-\s*\n\s*/g, '-')
    .replace(/\/\s*\n\s*/g, '/')
    .replace(/\f/g, '')

  rawFixed = rawFixed.replace(
    /^.*\[Page\s*\d+\].*\r?\n(?:[ \t]*\r?\n)*^.*\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b\s+\d{4}.*\r?\n/gm,
    ''
  )

  return rawFixed.replace(/\s+/g, ' ').trim()
}

function groupBySubsection (refLines) {
  const groups = {}
  let current = null

  for (const line of refLines) {
    const m = subsectionMatchers.find(({ regex }) => regex.test(line))
    if (m) {
      current = m.name
      groups[current] = []
      continue
    }
    if (current) {
      groups[current].push(line)
    }
  }

  return groups
}

function extractDraftsBySubsection (refLines) {
  const bySub = groupBySubsection(refLines)
  const result = []

  for (const [subsection, lines] of Object.entries(bySub)) {
    const txt = normalizeText(lines.join('\n'))
    const drafts = Array.from(txt.matchAll(DRAFT_URL_RE), m => m[1])
    for (const draft of new Set(drafts)) {
      result.push({ value: draft, subsection })
    }
  }

  return result
}
