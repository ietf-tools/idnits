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
const SUBSECTION_PATTERN = /^\d+\.\d+\.\s+(.+)$/i
const TOC_PATTERN = /\.+\s*\d+$/
// Dot leaders and page number ending a paginated table of contents entry ("1.  Introduction . . . .   3", "1. Introduction.....2")
const TOC_PAGE_NUMBER_RE = /(?:\s*\.)+\s*\d+$|\s{2,}\d+$/
const RFC_REFERENCE_RE = /\bRFC\s?(\d+)\b|\[RFC(\d+)\]/gi
// A citation label ("[STWO]")
const DRAFT_REFERENCE_RE_IN_TEXT = /\[(?!(?:RFC\d+|draft-[A-Za-z0-9-]+|I-D\.[A-Za-z0-9-]+))[A-Za-z0-9.-]+\]/gi
// What may come before a label that stands on its own: nothing, a space, or another label ("[A][B]")
const STANDALONE_LABEL_PREFIX_RE = /^$|[\s\]]$/
// A YANG tree diagram list node, whose keys are in brackets ("|  +--rw interface* [name]"), also when
// the line is wrapped before the node name ("segment-list* [name]") or before its keys ("|  |    [attr-type]")
const YANG_TREE_LIST_LINE_RE = /^(?:\|\s*)*(?:[+xo]--+(?:rw|ro|-?[wxn]|u|mp)?\s+)?[\w:.-]+\*\s+\[/
const YANG_TREE_KEYS_LINE_RE = /^(?:\|\s+)+\[[^\]]+\]$/
// An ASN.1 tag: before an IMPLICIT or EXPLICIT tagging ("[1] IMPLICIT AttributeCertificateV1"), or between
// a component name and its type ("seed [0] OCTET STRING", "tsa [0] GeneralName OPTIONAL,", "mustExclude [2] {")
const ASN1_TAGGING_AFTER_RE = /^\s+(?:IMPLICIT|EXPLICIT)\b/
const ASN1_COMPONENT_BEFORE_RE = /(?:^|[\s{,:])[a-z][\w-]*\s+$/
const ASN1_TYPE_AFTER_RE = /^\s+(?:(?:SEQUENCE|SET|CHOICE|INTEGER|OCTET|BIT|BOOLEAN|ENUMERATED|OBJECT|NULL|ANY)\b|[A-Za-z][\w-]*(?:\s*[,{(]|\s+(?:OPTIONAL|DEFAULT)\b)|[{(])/
// Ellipsis ("[...]")
const ELLIPSIS_LABEL_RE = /^\[\.+\]$/
// Character range or class: ranges in order between characters of a kind ("[a-z]", "[0-9A-F]", "[a-z0-9-]"),
// or a letter in both cases ("[Ee]")
const CHARACTER_RANGE_RE = /[a-z]-[a-z]|[A-Z]-[A-Z]|[0-9]-[0-9]/g
const CASE_PAIR_CLASS_RE = /^\[([A-Za-z])([A-Za-z])\]$/
// Placeholder for the RFC number of this or a companion document, which the RFC Editor replaces
// ("[RFCXXXX]", "[RFC-XXXX]", "[RFCYYYY]", "[RFC-to-be]", "[this-RFC]", "[This.I-D]", "[ThisDoc]")
const PLACEHOLDER_REFERENCE_RE = /^\[(?:RFC-?(?:([A-Z])\1{2,}|TBD|to-?be(?:-[A-Za-z-]+)?|this)|this[-.]?(?:RFC|I-?D|doc(?:ument)?|draft|spec)|TBD-this-(?:spec|document|RFC))\]$/i
// A numeric label ("[12]")
const NUMERIC_LABEL_RE = /^\[\d+\]$/
// What may come before the label of a reference entry: nothing, or a list bullet ("*  [FIPS186-5] National...")
const REFERENCE_ENTRY_LABEL_PREFIX_RE = /^(?:[*+o-]\s+)?$/
const COPYRIGHT_NOTICE_RE = /^\d+\.\s*Copyright Notice$/i
const STATUS_OF_THIS_MEMO_RE = /^\d+\.\s*Status of This Memo$/i
const ABSTRACT_RE = /^\d+\.\s*Abstract$/i
// Headings that follow the abstract, even when they are indented like its text or it is not indented
const ABSTRACT_END_HEADING_RE = /^(?:\d+\.\s*)?(?:Status of (?:This|the) (?:Memo|Document)|Copyright(?: and License)? Notice|Table of Contents)$/i
const BRACKETED_RFC_REFERENCE_RE = /\[RFC(\d+)\]/
const FIRST_LINE_RE = /^(BM|PK)/
// Internet-Draft indicator in the header, in any of its usual spellings: "Internet-Draft", "Internet Draft", "INTERNET-DRAFT"...
// No word boundary after it: a long organization name can run into it ("Internet-DraftChina Academy of...")
const ID_INDICATOR_RE = /^\s*internet[\s-]draft/i
const SPACING_PATTERN = /[A-Za-z][a-z]\s{2,}[a-z]/
const TABLE_OF_CONTENTS = /^Table of Contents\s*$/i
// Full or abbreviated month names ("September", "Sep", "Sept", "Nov.")
const MONTH_NAMES = 'January|February|March|April|May|June|July|August|September|October|November|December|(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\\.?'
// Separates the year from the month or day: "October 2026", "October, 2026", "November , 2026", "March 02,2026"
const YEAR_SEPARATOR = '(?:\\s*,\\s*|\\s+)'
// Expiry dates as written in drafts: "1 February 2027", "October 19, 2026", "January 08, 2027", "October 2026", "September, 2026", "11 Nov 2026"
const EXPIRES_DATE_PATTERN = `(?:(?<day>\\d{1,2})\\s+)?(?<month>${MONTH_NAMES})(?:\\s+(?<dayAfter>\\d{1,2}))?${YEAR_SEPARATOR}(?<year>\\d{4})`
const EXPIRES_DATE_RE = new RegExp(`(?:${EXPIRES_DATE_PATTERN})|(?<iso>\\d{4}-\\d{2}-\\d{2})`, 'i')
const EXPIRES_HEADER_RE = /^(?:Expires|Expiration date)\s*:(?<date>.*)$/i
const EXPIRES_FOOTER_RE = new RegExp(`Expires:?\\s+(?:${EXPIRES_DATE_PATTERN})\\b`, 'i')
// "[Page N]" ends a page footer; the running header that follows ends with the document date
const PAGE_FOOTER_RE = /\[[Pp]age\s*\d+\]\s*$/
const RUNNING_HEADER_RE = new RegExp(`\\b(?:\\d{1,2}\\s+)?(?:${MONTH_NAMES})(?:\\s+\\d{1,2})?${YEAR_SEPARATOR}\\d{4}\\s*$`)
// Running page header in three columns ("Internet-Draft   Short Title   March 2026"), when one precedes the first-page header
const FIRST_LINE_RUNNING_HEADER_RE = /^internet[\s-]draft\s{2,}\S.*\S\s{2,}\S/i
// Lines of the two-column first-page header that can follow a blank line in it: a right column only,
// a left column starting at the margin with a right column well apart, or a left column holding a header field
const HEADER_RIGHT_COLUMN_ONLY_RE = /^\s{36,}\S/
const HEADER_TWO_COLUMNS_RE = /^ {0,2}\S.*?\S {3,}(?=\S)/
const HEADER_RIGHT_COLUMN_START = 30
const HEADER_FIELD_RE = /^ {0,2}(?:internet[\s-]draft\b|network\s+working\s+group\b|request\s+for\s+comments\b|(?:intended\s+status|expires|expiration\s+date|category|obsoletes|updates|replaces|issn)\s*:)/i
const DRAFT_URL_RE = /<https?:\/\/[^>\s]*\b(draft-[A-Za-z0-9-]+)\b[^>\s]*>/gid
// A URL a line leaves open, to continue on the next one: in angle brackets not closed ("<https://www.rfc-"),
// or bare and broken after a hyphen, a slash or a folding backslash ("https://json-", "http://")
const OPEN_BRACKETED_URL_RE = /<\s?[a-z][a-z0-9+.-]*:[^<>\s]*$/i
const OPEN_BARE_URL_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s<>"']*[-/\\]$/i
// xml2rfc breaks a word longer than the room left on a 72-column line mid-word ("iesg@ie" then "tf.org"):
// a line of that length whose last word holds an "@" and ends in a letter or digit may end in a broken address
const SPLIT_LINE_LENGTH = 72
const SPLIT_EMAIL_START_RE = /(?:^|\s)[<("'[]?(?:mailto:)?(?<start>[^\s@<>()"'[\]]+@[a-z0-9.-]*[a-z0-9])$/i
// The address resumes in the same domain label and carries on to at least one more label ("tf.org", not "from")
const SPLIT_EMAIL_REST_RE = /^(?<rest>[a-z0-9][a-z0-9-]*\.[a-z0-9.-]*[a-z])(?:[.,;:!?)>\]"']*)(?=\s|$)/i
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i

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

// Inline code format: a C-style comment delimiter anywhere, or a line starting with "#"
const INLINE_CODE_FORMAT = /\/\*|\*\/|^ *#/i

// RFC 8792 Section 7.1.1 / 8.1.1 folding header: the line contains
// "NOTE: '\' line wrapping per RFC 8792" (or "'\\'" for the two-backslash strategy),
// whatever surrounds it (e.g. "# NOTE: ..." in shell-style examples). Same header text as
// RFC8792_FOLDING_HEADER in lib/modules/sections.mjs, which also requires "=" padding around it.
const RFC8792_FOLDING_HEADER = /NOTE: '\\\\?' line wrapping per RFC 8792/

// Section matchers
const sectionMatchers = [
  { name: 'introduction', regex: /^\d+\.\s+(Introduction|Overview|Background)$/i },
  { name: 'securityConsiderations', regex: /^\d+\.\s+Security Considerations$/i },
  { name: 'authorAddress', regex: AUTHOR_SECTION_RE },
  { name: 'references', regex: /^(?:\d+\.\s+)?(?:(?:Normative|Informative)\s+)?References$/i },
  { name: 'ianaConsiderations', regex: /^\d+\.\s+IANA Considerations$/i }
]

// A references kind is a subsection of the references section ("9.1.  Normative References", the
// trailing dot sometimes left out) or a top-level section of its own ("9.  Normative References"),
// numbered or not
const subsectionMatchers = [
  { name: 'normative_references', regex: /^(?:\d+\.(?:\d+\.?)?\s+)?Normative\s+References$/i },
  { name: 'informative_references', regex: /^(?:\d+\.(?:\d+\.?)?\s+)?Informative\s+References$/i },
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
  rfc2119: /The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", ?("NOT RECOMMENDED", )?"MAY", and "OPTIONAL" in this document are to be interpreted as described in( BCP 14,)? RFC ?2119[.,;]/i,
  rfc2119_alt: /The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", ?("NOT RECOMMENDED", )?"MAY", and "OPTIONAL" in this document are to be interpreted as described in "Key words for use in RFCs to Indicate Requirement Levels" \[RFC2119\]/i,
  rfc2119_alt1: /The key words\s+"MUST",\s+"MUST NOT",\s+"REQUIRED",\s+"SHALL",\s+"SHALL NOT",\s+"SHOULD",\s+"SHOULD NOT",\s+"RECOMMENDED",\s+"NOT RECOMMENDED",\s+"MAY",\s+and\s+"OPTIONAL"\s+in this document are to be interpreted as described in\s+\[BCP14\]\s+\(RFC2119\)\s+\(RFC8174\)\s+when, and only when, they appear in all capitals, as shown here\./i,
  rfc2119_alt2: /The key words\s+"MUST",\s+"MUST NOT",\s+"REQUIRED",\s+"SHALL",\s+"SHALL\s+NOT",\s+"SHOULD",\s+"SHOULD NOT",\s+"RECOMMENDED",\s+"NOT RECOMMENDED",\s+"MAY",\s+and\s+"OPTIONAL"\s+in this document are to be interpreted as described in\s+BCP\s*14\s*\[RFC2119\]\[RFC8174\]\s+when, and only when, they appear in all\s+capitals, as shown here[.;]?/i,
  rfc8174: /The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 \[RFC2119\] \[RFC8174\]/i,
  bcp14: /The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in\s*\[BCP14\]\s*\(RFC2119\)\s*\(RFC8174\)\s*when, and only when, they appear in all capitals, as shown here\./i
}

// Similar boilerplate regex pattern
const BOILERPLATE_PARTS = {
  rfc2119: [
    /The key words /,
    /"MUST", "MUST NOT", "REQUIRED", "SHALL"/,
    /"SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED"/,
    /"NOT RECOMMENDED", "MAY", and "OPTIONAL"/,
    /in this document are to be interpreted as described in/,
    /RFC ?2119[.,;]?/i
  ],
  rfc2119_alt: [
    /The key words /,
    /"MUST", "MUST NOT", "REQUIRED", "SHALL"/,
    /"SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED"/,
    /"NOT RECOMMENDED", "MAY", and "OPTIONAL"/,
    /in this document are to be interpreted as described in/,
    /"Key words for use in RFCs to Indicate Requirement Levels" \[RFC2119\]/i
  ],
  rfc2119_alt1: [
    /The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",/,
    /"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and/,
    /"OPTIONAL" in this document are to be interpreted as described in/,
    /[BCP14] (RFC2119) (RFC8174) when, and only when, they appear in all/,
    /capitals, as shown here./i
  ],
  rfc2119_alt2: [
    /The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",/,
    /"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and/,
    /"OPTIONAL" in this document are to be interpreted as described in BCP/,
    /14 [RFC2119][RFC8174] when, and only when, they appear in all/,
    /capitals, as shown here./i
  ],
  rfc8174: [
    /The key words /,
    /"MUST", "MUST NOT", "REQUIRED", "SHALL"/,
    /"SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED"/,
    /"NOT RECOMMENDED", "MAY", and "OPTIONAL"/,
    /in this document are to be interpreted as described in BCP 14/,
    /\[RFC2119\] \[RFC8174\]/i
  ],
  bcp14: [
    /The key words /,
    /"MUST", "MUST NOT", "REQUIRED", "SHALL"/,
    /"SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED"/,
    /"NOT RECOMMENDED", "MAY", and "OPTIONAL"/,
    /in this document are to be interpreted as described in\s*\[BCP14\]/,
    /\(RFC2119\)\s*\(RFC8174\)/i,
    /when, and only when, they appear in all capitals, as shown here\./
  ]
}

// License declaration
const licenseDeclarations = {
  revised_bsd_license: /Code Components extracted from this document must include Revised BSD License text as described in Section 4\.e of the Trust Legal Provisions and are provided without warranty as described in the Revised BSD License\./i,
  previous_tlp4_6_b_i: /Copyright\s+\(c\)\s+\d{4}\s+IETF Trust|Copyright\s+\(C\)\s+\d{4}\s+The Internet Society/i,
  trust_28_dec_2009_section_6_a: /This\s+Internet-Draft\s+is\s+submitted\s+in\s+full\s+conformance\s+with\s+the\s+provisions\s+of\s+BCP\s+78\s+and\s+BCP\s+79/i,
  tlp5_6_b_i_copyright: /Copyright\s+\(c\)\s+(\d{4})\s+IETF Trust\s+and\s+the\s+persons\s+identified\s+as\s+the\s+document\s+authors\.?\s+All\s+rights\s+reserved\.?/gi,
  license6_b_i: /This document is subject to BCP 78 and the IETF Trust[’']s Legal Provisions\s+Relating to IETF Documents\s+\(https?:\/\/trustee\.ietf\.org\/license-info\) in effect on the\s+date of publication of this document\. Please review these documents carefully, as\s+they describe your rights and restrictions with respect to this document\. Code\s+Components extracted from this document must include Revised BSD License\s+text as described in Section 4\.e of the Trust Legal Provisions and are provided\s+without warranty as described in the Revised BSD License\./gi,
  license6_b_ii: /This document is subject to BCP 78 and the IETF Trust[’']s Legal Provisions\s+Relating to IETF Documents\s+\(https?:\/\/trustee\.ietf\.org\/license-info\) in effect on the\s+date of publication of this document\. Please review these documents carefully, as\s+they describe your rights and restrictions with respect to this document\./gi,
  license6_c_i: /This document may not be modified, and derivative works of it may not be\s+created, except to format it for publication as an RFC or to translate it into\s+languages other than English\./i,
  license6_c_ii: /This document may not be modified, and derivative works of it may not be\s+created, and it may not be published except as an Internet-Draft\./i,
  acceptable_paragraph_noting_that_draft: /Internet-Drafts are working documents of the Internet Engineering Task Force \(IETF\)\./i,
  draft_paragraph_out6_month_validity: /Internet-Drafts are draft documents valid for a maximum of six months and may be updated, replaced, or obsoleted by other documents at any time\. It is inappropriate to use Internet-Drafts as reference material or to cite them other than as "work in progress(?:\."|"\.)\s*/i,
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

// Document name, found as Datatracker finds it (ietf/utils/draft.py, PlaintextDraft._parse_draftname):
// the first name with a two-digit revision on the first page. Datatracker right-strips each line, so a
// name ends a line there; whitespace is also accepted here so that a name followed by more text on the
// same line ("draft-foo-bar-00     A. Author") is found too.
const DRAFT_NAME_RE = /(draft-[a-z0-9-]*)-(\d\d)(?=\w|\.txt|\s|$)/
// Header lines naming other documents ("Obsoletes: draft-foo-bar-00"), not searched for the document name
const OTHER_DOCUMENTS_HEADER_RE = /^\s*(?:Obsoletes|Updates|Replaces)\s*:/i
// Failing that, a name without a revision in the first lines, as the Datatracker uploader accepts
const DRAFT_NAME_NO_REVISION_RE = /draft-\S+/
const FIRST_PAGE_FALLBACK_LINES = 56
const DRAFT_NAME_NO_REVISION_LINES = 80

// Lists of extracted elements whose values are located in the document
const LOCATION_KINDS = [
  'fqdnDomains',
  'ipv4',
  'ipv6',
  'keywords2119',
  'boilerplate2119Keywords',
  'obsoletesRfc',
  'updatesRfc',
  'nonReferenceSectionRfc',
  'referenceSectionRfc',
  'bracketedRfcNonReferences',
  'bracketedRfcReferences',
  'nonReferenceSectionDraftReferences',
  'referenceSectionDraftReferences',
  'placeholderReferences',
  'draftStatusReferences'
]

/**
 * Where a value extracted from a text document is found in it, every time it is found there
 *
 * Locations are those of the original document (doc.body, split into lines at each newline): both the line
 * and the position in the line (column of its first character) count from 1. A value found
 * in normalized text (headers, boilerplate, URLs wrapped across lines) is located where it starts.
 *
 * @example
 * getLocations(doc, 'fqdnDomains', 'foo.com') // [{ line: 120, pos: 14 }, { line: 342, pos: 3 }]
 * getLocations(doc, 'nonReferenceSectionRfc', '2119') // where "RFC 2119" or "[RFC2119]" starts
 *
 * @param {Object} doc Parsed text document
 * @param {string} kind Name of the list of extracted elements the value comes from ("fqdnDomains", "ipv4"...)
 * @param {string} value Value from that list (for a list of objects, its value or keyword)
 * @returns {Array<{line: number, pos: number}>} Locations, in document order; empty when there are none
 */
export function getLocations (doc, kind, value) {
  const byValue = doc?.data?.extractedElements?.locations?.[kind]
  return byValue && Object.hasOwn(byValue, value) ? byValue[value] : []
}

/**
 * Record where a value is found
 *
 * @param {Object} locations Locations by kind, then by value
 * @param {string} kind Kind of value
 * @param {string} value Value found
 * @param {number} line Line (1-based)
 * @param {number} pos Position in the line (1-based column)
 */
function addLocation (locations, kind, value, line, pos) {
  locations[kind] ??= {}
  const byValue = locations[kind]
  if (!Object.hasOwn(byValue, value)) byValue[value] = []
  byValue[value].push({ line, pos })
}

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
  const normalized = normalizeText(rawText)
  const normalizedText = normalized.text
  // Where each line of the document starts, to locate what is found in it or in the normalized text
  const lineStarts = lineStartOffsets(rawText)
  const pages = rawText?.split(/\f/)

  const data = {
    pageCount: 1,
    header: {
      authors: [],
      date: null,
      source: null,
      expires: null,
      expiresHasDay: null
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
      splitEmailAddresses: [],
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
      placeholderReferences: [],
      draftStatusReferences: [],
      copyrightDates: [],
      license6_b_ii: [],
      license6_b_i: [],
      bracketedRfcNonReferences: [],
      bracketedRfcReferences: [],
      lastPageExpiration: null,
      lastPageExpirationHasDay: null,
      // Where each value of the lists above is found in the document, every time: see getLocations()
      locations: Object.fromEntries(LOCATION_KINDS.map((kind) => [kind, {}]))
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
  // Labels found outside the references section where brackets are often not a citation: attached to the
  // preceding text ("([STWO])", "SHA3-256[FIPS202]"), in source code, in a YANG tree diagram or an ASN.1 tag...
  const labelsIfDeclared = new Set()
  let prevLine = null
  let currentPageLineCount = 0
  // Title of the first table of contents entry, which the body repeats as its first heading
  let firstTocEntry = null
  // Whether the next non-blank line of the table of contents is the running header of a new page
  let tocRunningHeaderNext = false
  // Indentation of the first line of abstract text
  let abstractIndent = null
  // Whether the next non-blank line of the abstract is the running header of a new page
  let abstractRunningHeaderNext = false
  // URL the previous line of text leaves open: 'bracketed', 'bare' or null
  let openUrl = null
  // Start of an email address the previous line may have broken mid-word: { start, line, pos } or null
  let openEmail = null
  // Offset in the document of each line of the references section, once trimmed
  const referenceLineOrigins = []
  // Where labels kept aside until the declared references are known are found
  const labelsIfDeclaredLocations = {}
  const { locations } = data.extractedElements
  const locateOffset = (offset) => offsetLocation(lineStarts, offset)
  const addOffsetLocation = (kind, value, offset) => {
    const { line, pos } = locateOffset(documentOffset(normalized, offset))
    addLocation(locations, kind, value, line, pos)
  }
  try {
    const markers = {
      header: { start: 0, end: 0, lastAuthor: 0, closed: false },
      title: 0,
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
          // More than one pattern can match the same boilerplate
          const { line, pos } = locateOffset(documentOffset(normalized, match.index + keywordMatch.index))
          if (!getLocations({ data }, 'boilerplate2119Keywords', keyword).some((loc) => loc.line === line && loc.pos === pos)) {
            addLocation(locations, 'boilerplate2119Keywords', keyword, line, pos)
          }
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
    obsoletesRfc.plainNumbers.forEach((num, i) => addOffsetLocation('obsoletesRfc', num, obsoletesRfc.indexes[i]))
    data.possibleIssues.obsoletesWithLetter.push(...obsoletesRfc.rfcWithPrefix)

    const updatesRfcs = extractRfcNumbers(normalizedText, UPDATES_RE)
    data.extractedElements.updatesRfc.push(...updatesRfcs.plainNumbers)
    updatesRfcs.plainNumbers.forEach((num, i) => addOffsetLocation('updatesRfc', num, updatesRfcs.indexes[i]))
    data.possibleIssues.updatesRfcWithLetter.push(...updatesRfcs.rfcWithPrefix)

    // Searching for license declaration
    data.contains.revisedBsdLicense = licenseDeclarations.revised_bsd_license.test(normalizedText)

    // Page separator counting
    const rawLines = rawText.split(/\r?\n/)
    data.contains.pagesFound = rawLines.filter(line => pageBreakLineType(line) === 'footer').length

    // Searching for submission compliance line and pages
    for (let i = 0; i < pages.length; i++) {
      const normalizedPage = pages[i].replace(/\s+/g, ' ').trim()
      if (licenseDeclarations.trust_28_dec_2009_section_6_a.test(normalizedPage)) {
        data.contains.submissionCompliance = true
        data.possibleIssues.submissionCompliancePage = i + 1
        break
      }
    }

    // Document name
    data.slug = extractDraftName(rawText)

    // Searching acceptable paragraph noting that IDs are working documents
    data.contains.acceptableParagraphNotingThatDraft = licenseDeclarations.acceptable_paragraph_noting_that_draft.test(normalizedText)

    // Extracting expiration date from the last page footer carrying one
    // (from the raw text: normalizeText() strips page footers)
    const lastPageExpiration = rawLines
      .filter(line => pageBreakLineType(line) === 'footer')
      .map(line => parseExpiresDate(line.match(EXPIRES_FOOTER_RE)?.[0]))
      .findLast(Boolean)

    if (lastPageExpiration) {
      data.extractedElements.lastPageExpiration = lastPageExpiration.date
      data.extractedElements.lastPageExpirationHasDay = lastPageExpiration.hasDay
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

    /**
     * Extract the metadata found in the left column of a header line
     *
     * @param {string} left Left column of the header line
     */
    function extractHeaderLeftValues (left) {
      // --> Date
      const match = left.match(DATE_RE)

      if (match) {
        const day = parseInt(match[1], 10)
        const month = match[2]
        const year = parseInt(match[3], 10)

        data.header.date = { day, month, year }
      }

      // --> Document Kind
      if (ID_INDICATOR_RE.test(left)) {
        docKind = 'draft'
        data.contains.idIndication = true
      } else if (left.startsWith('Request for Comments')) {
        data.header.rfcNumber = left.split(':')?.[1]?.trim()
        docKind = 'rfc'
      } else if (filename.startsWith('rfc')) {
        const match = filename.match(/rfc(\d+)\.txt$/i)
        if (match) {
          data.header.rfcNumber = match[1]
          docKind = 'rfc'
        }
      }

      // --> Intended status
      if (left.startsWith('Intended')) {
        const rawIntendedStatus = left.split(':')?.[1]?.trim()
        const cleanIntendedStatus = extractStatusName(rawIntendedStatus)
        data.header.intendedStatus = cleanIntendedStatus || rawIntendedStatus
      }

      // --> Obsoletes
      if (left.startsWith('Obsoletes')) {
        const obsoletesValues = left.split(':')?.[1]?.trim()
        data.header.obsoletes = obsoletesValues.indexOf(',') >= 0 ? obsoletesValues.split(',').map(o => o.trim()) : [obsoletesValues]
      }

      // --> Category
      if (left.startsWith('Category')) {
        const rawCategory = left.split(':')?.[1]?.trim()
        const cleanCategory = extractStatusName(rawCategory)
        data.header.category = cleanCategory || rawCategory
      }

      // --> ISSN
      if (left.startsWith('ISSN')) {
        data.header.issn = left.split(':')?.[1]?.trim()
      }

      // --> Expires
      const expiresLine = EXPIRES_HEADER_RE.exec(left.trim())
      if (expiresLine) {
        const expires = parseExpiresDate(expiresLine.groups.date.trim().split(/\s{2,}/)[0])

        if (expires) {
          data.header.expires = expires.date
          data.header.expiresHasDay = expires.hasDay
        }
      }
    }

    for (const line of rawText.split(/\r?\n/)) {
      const trimmedLine = line.trim()
      lineIdx++
      // Positions in the trimmed line are this much further in the line
      const indent = line.length - line.trimStart().length

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
        // In the table of contents, a new page starts with its running header unless this line holds it
        if (currentSection === 'toc') {
          tocRunningHeaderNext = !trimmedLine
        } else if (abstractRunningHeaderNext) {
          abstractRunningHeaderNext = !trimmedLine
        }
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
      // (located where the first run of extra spaces starts)
      const spacing = SPACING_PATTERN.exec(line)
      if (spacing && !ID_INDICATOR_RE.test(trimmedLine)) {
        data.possibleIssues.linesWithSpaces.push({ line: lineIdx, pos: spacing.index + 3 })
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
      // (an RFC 8792 folding header is not a code comment, even when it starts with "#")
      if (!inCodeBlock && !RFC8792_FOLDING_HEADER.test(line)) {
        const match = INLINE_CODE_FORMAT.exec(line)
        if (match) {
          // (located at the comment marker, after any indentation before a "#")
          data.possibleIssues.inlineCode.push({
            line: lineIdx,
            pos: match.index + match[0].search(/\S/) + 1
          })
        }
      }

      // Search for bad section title identations. Starts search after detecting abstract section to avoid false positives
      // (the line ending the table of contents is checked when it ends the table)
      if (currentSection !== 'toc') {
        data.possibleIssues.unexpectedIndentation.push(...unexpectedIndentation(line, lineIdx))
      }

      // Extract rfc references from whole text except the reference section
      while ((rfcMatch = RFC_REFERENCE_RE.exec(trimmedLine)) !== null) {
        const rfcNumber = rfcMatch[1] || rfcMatch[2]
        const rfcPos = indent + rfcMatch.index + 1
        if (currentSection !== 'references' || currentSubSection === 'appendix') {
          if (rfcNumber) {
            addLocation(locations, 'nonReferenceSectionRfc', rfcNumber, lineIdx, rfcPos)
          }
          if (rfcNumber && !data.extractedElements.nonReferenceSectionRfc.includes(rfcNumber)) {
            data.extractedElements.nonReferenceSectionRfc.push(rfcNumber)
          }
        } else if (BRACKETED_RFC_REFERENCE_RE.exec(trimmedLine)) {
          if (rfcNumber) {
            addLocation(locations, 'referenceSectionRfc', rfcNumber, lineIdx, rfcPos)
          }
          if (rfcNumber && !data.extractedElements.referenceSectionRfc.find((el) => el.value === rfcNumber)) {
            data.extractedElements.referenceSectionRfc.push({
              value: rfcNumber,
              subsection: currentSubSection
            })
          }
        }

        // Detect bracketed RFC references
        // (in source code, one the references section does not declare is not reported: the RFC still counts as used)
        if (rfcMatch[0]) {
          if (BRACKETED_RFC_REFERENCE_RE.test(rfcMatch[0])) {
            if (currentSection === 'references') {
              data.extractedElements.bracketedRfcReferences.push(rfcMatch[0])
              addLocation(locations, 'bracketedRfcReferences', rfcMatch[0], lineIdx, rfcPos)
            } else if (!inCodeBlock) {
              data.extractedElements.bracketedRfcNonReferences.push(rfcMatch[0])
              addLocation(locations, 'bracketedRfcNonReferences', rfcMatch[0], lineIdx, rfcPos)
            }
          }
        }
      }

      // Detect draft references
      while ((draftMatch = DRAFT_REFERENCE_RE_IN_TEXT.exec(trimmedLine)) !== null) {
        const draftName = draftMatch[0]
        const labelPos = indent + draftMatch.index + 1
        if (currentSection !== 'references' || currentSubSection === 'appendix') {
          // Brackets attached to the preceding text are as often a character class ("([0-9a-f])", "^[a-z]"),
          // an index ("a[0]") or ABNF as a citation ("([RRBNC])", "rights.[UN-HRC]", "SHA3-256[FIPS202]"):
          // kept aside until the declared references are known
          // Likewise for brackets standing on their own in source code, an ellipsis ("[...]"), a character class
          // ("[a-z]"), the keys of a YANG tree diagram list ("+--rw interface* [name]") or an ASN.1 tag ("[0] IMPLICIT")
          if (!STANDALONE_LABEL_PREFIX_RE.test(trimmedLine.slice(0, draftMatch.index)) ||
            inCodeBlock || isNonCitationBracket(draftName, trimmedLine, draftMatch.index)) {
            labelsIfDeclared.add(draftName)
            addLocation(labelsIfDeclaredLocations, 'labels', draftName, lineIdx, labelPos)
          } else {
            addLocation(locations, 'nonReferenceSectionDraftReferences', draftName, lineIdx, labelPos)
            if (!data.extractedElements.nonReferenceSectionDraftReferences.includes(draftName)) {
              data.extractedElements.nonReferenceSectionDraftReferences.push(draftName)
            }
          }
        } else if (REFERENCE_ENTRY_LABEL_PREFIX_RE.test(trimmedLine.slice(0, draftMatch.index))) {
          // In the references section, only the label starting an entry declares a reference: a bracketed
          // text inside the entry is part of it (a legal citation's year, "[2021] EWCA Crim 577")
          addLocation(locations, 'referenceSectionDraftReferences', draftName, lineIdx, labelPos)
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
        addLocation(locations, 'keywords2119', match[0], lineIdx, indent + match.index + 1)
      })

      // Check for invalid keyword combinations
      const invalidMatches = [...line.matchAll(INVALID_COMBINATIONS_PATTERN)]
      invalidMatches.forEach(match => {
        // (the match starts with the whitespace before the keyword)
        data.possibleIssues.misspeled2119Keywords.push({ invalidKeyword: match[0], line: lineIdx, pos: match.index + 2 })
      })

      // FQDN Domain extraction
      // A URL wrapped from the previous line takes the first word of this one:
      // "<https://www.rfc-" then "editor.org/info/rfc2119>." mentions no domain "editor.org"
      // An email address broken mid-word at the end of the line just before ("iesg@ie" then "tf.org")
      // is reported as such, and its second part is no domain mention
      let emailRest = openEmail?.line === lineIdx - 1 && trimmedLine.match(SPLIT_EMAIL_REST_RE)?.groups.rest
      if (emailRest && EMAIL_RE.test(openEmail.start + emailRest)) {
        data.extractedElements.splitEmailAddresses.push({
          address: openEmail.start + emailRest,
          parts: [openEmail.start, emailRest],
          line: openEmail.line,
          pos: openEmail.pos
        })
      } else {
        emailRest = null
      }
      const startEmail = line.length === SPLIT_LINE_LENGTH && line.match(SPLIT_EMAIL_START_RE)
      openEmail = startEmail
        ? { start: startEmail.groups.start, line: lineIdx, pos: line.length - startEmail.groups.start.length + 1 }
        : null
      const urlEnd = openUrl ? trimmedLine.search(/[\s>]/) : emailRest ? trimmedLine.search(/\s|$/) : 0
      const domainText = urlEnd < 0 ? '' : trimmedLine.slice(urlEnd)
      if (urlEnd < 0) {
        // The URL fills the line, and still runs on unless it ends there
        if (openUrl === 'bare' && !/[-/\\]$/.test(trimmedLine)) {
          openUrl = null
        }
      } else {
        openUrl = OPEN_BRACKETED_URL_RE.test(domainText) ? 'bracketed' : OPEN_BARE_URL_RE.test(domainText) ? 'bare' : null
      }
      for (const match of domainText.matchAll(FQDN_RE)) {
        const domain = match.groups.domain.toLowerCase()
        addLocation(locations, 'fqdnDomains', domain, lineIdx, indent + urlEnd + match.index + 1)
        if (!data.extractedElements.fqdnDomains.includes(domain)) {
          data.extractedElements.fqdnDomains.push(domain)
        }
      }

      // IPv4 and IPv6 extraction
      const ipv4Matches = [...trimmedLine.matchAll(IPV4_LOOSE_RE)]
      if (ipv4Matches.length > 0) {
        ipv4Matches.forEach(match => {
          data.extractedElements.ipv4.push(match[0])
          addLocation(locations, 'ipv4', match[0], lineIdx, indent + match.index + 1)
        })
      }

      const ipv6Matches = [...trimmedLine.matchAll(IPV6_LOOSE_RE)]
      if (ipv6Matches.length > 0) {
        ipv6Matches.forEach(match => {
          data.extractedElements.ipv6.push(match[0])
          addLocation(locations, 'ipv6', match[0], lineIdx, indent + match.index + 1)
        })
      }

      // Header
      // --------------------------------------------------------------
      if (!markers.header.start) {
        // -> Running page header above the first-page header
        if (FIRST_LINE_RUNNING_HEADER_RE.test(trimmedLine) && RUNNING_HEADER_RE.test(trimmedLine)) {
          continue
        }
        // -> First Line
        markers.header.start = lineIdx
        markers.header.end = lineIdx
        const values = LINE_VALUES_EXTRACT_RE.exec(trimmedLine)
        // --> Source
        data.header.source = values?.groups.left
        extractHeaderLeftValues(values?.groups.left ?? trimmedLine)
        // --> Author
        data.header.authors.push({
          name: values?.groups.right
        })
        markers.header.lastAuthor = lineIdx
        continue
      } else if (!markers.header.closed) {
        // -> Blank line(s) followed by a line that isn't a header line: title
        if (lineIdx > markers.header.end + 1 && !isHeaderLine(line)) {
          markers.header.closed = true
          markers.title = lineIdx
          data.title = trimmedLine
        } else {
          markers.header.end = lineIdx

          // A header field indented by up to two spaces ("  Expires: November 2026") is a left column
          const extractedValues = LINE_VALUES_EXTRACT_RE.exec(line)
          const leftColumnOnly = extractedValues && !extractedValues.groups.left.trim() && HEADER_FIELD_RE.test(line)
          const values = extractedValues && !leftColumnOnly ? extractedValues.groups : { left: trimmedLine, right: null }

          if (values.left) {
            extractHeaderLeftValues(values.left)
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
      if (COPYRIGHT_NOTICE_RE.test(trimmedLine)) {
        data.possibleIssues.isCopyrightNoticeNumbered = true
      }

      // Abstract
      // --------------------------------------------------------------
      // The abstract runs across blank lines and page breaks to the next heading: a line indented less
      // than its text that starts a paragraph, or one of the headings that follow it. Only the first
      // abstract heading counts: a body section can repeat it.
      if (!markers.abstract.start && (trimmedLine === 'Abstract' || ABSTRACT_RE.test(trimmedLine))) {
        markers.abstract.start = lineIdx
        currentSection = 'abstract'
        data.content.abstract = []
        if (ABSTRACT_RE.test(trimmedLine)) {
          data.possibleIssues.isAbstractNumbered = true
        }
      } else if (markers.abstract.start && !markers.abstract.closed) {
        // The page footer and the running header after it are not abstract text
        const isPageBreakLine = pageBreakLineType(line) === 'footer' || abstractRunningHeaderNext
        abstractRunningHeaderNext = pageBreakLineType(line) === 'footer'
        if (isPageBreakLine) {
          continue
        }
        const indent = line.length - line.trimStart().length
        const startsParagraph = !rawLines[lineIdx - 2]?.trim()
        abstractIndent ??= indent
        if (
          ABSTRACT_END_HEADING_RE.test(trimmedLine) ||
          (startsParagraph && indent < abstractIndent) ||
          (indent === 0 && SECTION_PATTERN.test(trimmedLine) && !TOC_PATTERN.test(trimmedLine))
        ) {
          markers.abstract.end = lineIdx - 1
          markers.abstract.closed = true
        }
      }

      // Header lines belong to no section
      if (!markers.header.closed) {
        continue
      }

      // Table of Contents
      // --------------------------------------------------------------
      // Entries are indented, wrap onto further lines and, in an unpaginated document, carry no page
      // numbers. The table ends at the first heading of the body: a line at the margin that is not an
      // entry, or a repeat of the first entry when the body headings are indented too.
      if (!markers.toc.start && TABLE_OF_CONTENTS.test(line)) {
        markers.toc.start = lineIdx
        currentSection = 'toc'
        continue
      } else if (currentSection === 'toc' && !markers.toc.closed) {
        const entryTitle = tocEntryTitle(trimmedLine)
        // The running header after a page footer may lack a date
        const isPageBreakLine = Boolean(pageBreakLineType(line)) || tocRunningHeaderNext
        const isEntry = /^\s/.test(line) || TOC_PATTERN.test(line.trimEnd())
        if (entryTitle === firstTocEntry || (!isEntry && !isPageBreakLine)) {
          markers.toc.closed = true
          markers.toc.end = lineIdx - 1
          currentSection = null
          data.possibleIssues.unexpectedIndentation.push(...unexpectedIndentation(line, lineIdx))
        } else {
          tocRunningHeaderNext = pageBreakLineType(line) === 'footer'
          if (!isPageBreakLine) {
            firstTocEntry ??= entryTitle
          }
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
        if (currentSection === 'references') {
          referenceLineOrigins.push(lineStarts[lineIdx - 1] + indent)
        }
      }
    }

    // Close the last section
    if (currentSection && !markers[currentSection].closed) {
      markers[currentSection].end = lineIdx
      markers[currentSection].closed = true
    }

    data.markers = markers

    // A label where brackets are often not a citation is one when the references section declares it
    const declaredLabels = new Set(data.extractedElements.referenceSectionDraftReferences.map((el) => el.value))
    for (const label of labelsIfDeclared) {
      if (declaredLabels.has(label) && !data.extractedElements.nonReferenceSectionDraftReferences.includes(label)) {
        data.extractedElements.nonReferenceSectionDraftReferences.push(label)
      }
      if (declaredLabels.has(label)) {
        locations.nonReferenceSectionDraftReferences[label] = [...getLocations({ data }, 'nonReferenceSectionDraftReferences', label), ...labelsIfDeclaredLocations.labels[label]]
          .sort((a, b) => a.line - b.line || a.pos - b.pos)
      }
    }

    // Labels not declared that are not reported as missing references: a number when the document cites
    // its references by name (an array index, a list item...), an RFC Editor placeholder for the RFC
    // number of this or a companion document ("[RFCXXXX]"), which gets its own comment
    const citesByName = (declaredLabels.size > 0 || data.extractedElements.referenceSectionRfc.length > 0) &&
      ![...declaredLabels].some((label) => NUMERIC_LABEL_RE.test(label))
    data.extractedElements.nonReferenceSectionDraftReferences = data.extractedElements.nonReferenceSectionDraftReferences.filter((label) => {
      if (declaredLabels.has(label)) return true
      if (PLACEHOLDER_REFERENCE_RE.test(label)) {
        data.extractedElements.placeholderReferences.push(label)
        locations.placeholderReferences[label] = locations.nonReferenceSectionDraftReferences[label]
        delete locations.nonReferenceSectionDraftReferences[label]
        return false
      }
      if (citesByName && NUMERIC_LABEL_RE.test(label)) {
        delete locations.nonReferenceSectionDraftReferences[label]
        return false
      }
      return true
    })

    // Extracting draft references from reference section
    const refLines = data.content.references
    const draftsBySub = extractDraftsBySubsection(refLines, referenceLineOrigins, (draft, offset) => {
      const { line, pos } = locateOffset(offset)
      addLocation(locations, 'draftStatusReferences', draft, line, pos)
    })
    data.extractedElements.draftStatusReferences.push(...draftsBySub)
  } catch (err) {
    throw new ValidationError('TXT_PARSING_FAILED', `Error while parsing Line ${lineIdx}: ${err.message}`)
  }

  return {
    // Default to a draft when the header indicates neither a draft nor an RFC
    docKind: docKind ?? 'draft',
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
 * @returns {{rfcWithPrefix: Array<string>, plainNumbers: Array<string>, indexes: Array<number>}} Extracted RFC numbers,
 *   those written with an "RFC" prefix, and the index in the text of each of the plain numbers
 */
function extractRfcNumbers (text, regex) {
  const matches = {
    rfcWithPrefix: [],
    plainNumbers: [],
    indexes: []
  }

  let match
  while ((match = regex.exec(text)) !== null) {
    const rfcList = match[0]
    if (rfcList) {
      for (const numberMatch of rfcList.matchAll(/\b(RFC\s*[0-9]+|[0-9]+)\b/gi)) {
        const num = numberMatch[0].trim()
        if (/^RFC\s*[0-9]+$/i.test(num)) {
          matches.rfcWithPrefix.push(num)
          matches.plainNumbers.push(num.replace(/^RFC\s*/i, ''))
        } else {
          matches.plainNumbers.push(num)
        }
        matches.indexes.push(match.index + numberMatch.index)
      }
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
 * Whether a bracketed text is a character range or class rather than a citation label:
 * ranges in order between characters of a kind, with nothing else than single characters between them
 * ("[a-z]", "[0-9A-Fa-f]", "[a-z0-9-]", but not "[I-D]" or "[SP800-38D]"), or a letter in both cases ("[Ee]")
 *
 * @param {string} label Bracketed text ("[a-z]")
 * @returns {boolean} Whether it is a character range or class
 */
function isCharacterClass (label) {
  const pair = label.match(CASE_PAIR_CLASS_RE)
  if (pair) {
    return pair[1] !== pair[2] && pair[1].toLowerCase() === pair[2].toLowerCase()
  }
  const content = label.slice(1, -1)
  const ranges = content.match(CHARACTER_RANGE_RE) ?? []
  if (!ranges.length || ranges.some((range) => range[0] > range[2])) return false
  return !/[A-Za-z0-9]{2}/.test(content.replace(CHARACTER_RANGE_RE, ' '))
}

/**
 * Whether a bracketed text standing on its own is, from its line, not meant as a citation:
 * an ellipsis, a character range or class, the keys of a YANG tree diagram list or an ASN.1 tag
 *
 * @param {string} label Bracketed text ("[name]")
 * @param {string} line Trimmed line holding it
 * @param {number} index Position of the bracketed text in the line
 * @returns {boolean} Whether it is not meant as a citation
 */
function isNonCitationBracket (label, line, index) {
  if (ELLIPSIS_LABEL_RE.test(label) || isCharacterClass(label) ||
    YANG_TREE_LIST_LINE_RE.test(line) || YANG_TREE_KEYS_LINE_RE.test(line)) return true
  if (!NUMERIC_LABEL_RE.test(label)) return false
  const before = line.slice(0, index)
  const after = line.slice(index + label.length)
  return ASN1_TAGGING_AFTER_RE.test(after) || (ASN1_COMPONENT_BEFORE_RE.test(before) && ASN1_TYPE_AFTER_RE.test(after))
}

/**
 * Recognise the lines a paginated plaintext document repeats at each page break:
 * the page footer ending in "[Page N]" and the running header that ends with the
 * document date ("July 2026", "21 July 2026", "July 21, 2026", "July 21,2026", "July, 2026").
 * A running header is only meaningful as the first non-blank line after a footer.
 *
 * @param {string} line A single line of text
 * @returns {('footer'|'header'|null)} The kind of page break line, or null
 */
export function pageBreakLineType (line) {
  if (PAGE_FOOTER_RE.test(line)) return 'footer'
  if (RUNNING_HEADER_RE.test(line)) return 'header'
  return null
}

/**
 * Section titles indented on a line, located at the first non-blank character
 *
 * @param {string} line A single line of text
 * @param {number} lineIdx Line number
 * @returns {Array<{name: string, line: number, pos: number}>} One issue per indented section title found
 */
function unexpectedIndentation (line, lineIdx) {
  return sectionIndentationRules
    .filter(({ regex }) => regex.test(line))
    .map(({ name }) => ({ name, line: lineIdx, pos: line.length - line.trimStart().length + 1 }))
}

/**
 * Title of a table of contents entry, without its dot leaders and page number
 *
 * @param {string} line A trimmed line of the table of contents
 * @returns {string} The entry title, with its whitespace collapsed
 */
function tocEntryTitle (line) {
  return line.replace(TOC_PAGE_NUMBER_RE, '').replace(/\s+/g, ' ')
}

/**
 * Whether a line after a blank line in the first-page header still belongs to the header
 *
 * @param {string} line A single line of text
 * @returns {boolean} True for a header line, false for the title or the first body line
 */
function isHeaderLine (line) {
  const expandedLine = line.replace(/\t/g, '        ').trimEnd()
  if (HEADER_RIGHT_COLUMN_ONLY_RE.test(expandedLine) || HEADER_FIELD_RE.test(expandedLine)) {
    return true
  }
  const twoColumns = HEADER_TWO_COLUMNS_RE.exec(expandedLine)
  return Boolean(twoColumns) && twoColumns[0].length >= HEADER_RIGHT_COLUMN_START
}

/**
 * Parse an expiry date as written in a draft's header or page footer
 *
 * @param {string} text Text containing the date
 * @returns {{date: DateTime, hasDay: boolean}|null} The date (the 1st of the month when no day is given), or null
 */
function parseExpiresDate (text) {
  const match = text && EXPIRES_DATE_RE.exec(text)
  if (!match) return null

  const { iso, month, year } = match.groups
  const day = match.groups.day ?? match.groups.dayAfter
  const date = iso
    ? DateTime.fromISO(iso, { zone: 'utc' })
    : DateTime.fromFormat(`${day ?? 1} ${month.slice(0, 3)} ${year}`, 'd LLL yyyy', { zone: 'utc' })

  return date.isValid ? { date, hasDay: Boolean(iso || day) } : null
}

/**
 * Extract the document name (with its revision) from the first page
 *
 * The first page is the text up to the first form feed, or the first 56 lines when there is none.
 * When no name with a revision is found there, a name without one in the first 80 lines is returned
 * (without any .txt extension), so that its missing revision is reported against the filename.
 * Unlike Datatracker, Obsoletes/Updates/Replaces header lines are skipped: they name other documents.
 *
 * @param {string} rawText Input text
 * @returns {string|null} Document name, or null if none was found
 */
function extractDraftName (rawText) {
  const toText = lines => lines.map(line => OTHER_DOCUMENTS_HEADER_RE.test(line) ? '' : line.trimEnd()).join('\n')
  const lines = rawText.split(/\r\n|\r|\n/)
  const firstPage = rawText.includes('\f') ? toText(rawText.split('\f')[0].split(/\r\n|\r|\n/)) : toText(lines.slice(0, FIRST_PAGE_FALLBACK_LINES))
  const match = DRAFT_NAME_RE.exec(firstPage)
  if (match) {
    return `${match[1]}-${match[2]}`
  }
  const nameWithoutRevision = DRAFT_NAME_NO_REVISION_RE.exec(toText(lines.slice(0, DRAFT_NAME_NO_REVISION_LINES)))
  return nameWithoutRevision ? nameWithoutRevision[0].replace(/\.txt$/, '') : null
}

/**
 * Normalize text from the form of multi-line text with \n to the form of a single-line long string,
 * keeping track of where each character of the result comes from (see documentOffset())
 *
 * @param {string} rawText Text to normalize
 * @param {Array<Segments>} [steps] Where the characters of the text come from in the document, when it is not the document itself
 * @returns {TrackedText} Normalized text
 */
function normalizeText (rawText, steps = []) {
  let tracked = { text: rawText, steps }
  // ("\r\n" rather than "\r?\n": a newline left as it is moves no character)
  tracked = replaceTracked(tracked, /\r\n/g, '\n')
  tracked = replaceTracked(tracked, /-\s*\n\s*/g, '-')
  tracked = replaceTracked(tracked, /\/\s*\n\s*/g, '/')
  tracked = replaceTracked(tracked, /\f/g, '')
  const lines = tracked.text.split('\n')

  // Drop each page footer together with the running header of the next page
  const kept = []
  for (let i = 0; i < lines.length; i++) {
    if (pageBreakLineType(lines[i]) === 'footer') {
      let next = i + 1
      while (next < lines.length && !lines[next].trim()) next++
      if (pageBreakLineType(lines[next] ?? '') === 'header') {
        i = next
        continue
      }
    }
    kept.push(i)
  }

  // Each line kept comes with the newline ending it, which joins it to the next line kept
  const joined = { out: [], in: [] }
  let lineStart = 0
  let length = 0
  for (let i = 0, k = 0; i < lines.length && k < kept.length; i++) {
    if (kept[k] === i) {
      if (i === 0 || kept[k - 1] !== i - 1) {
        joined.out.push(length)
        joined.in.push(lineStart)
      }
      length += lines[i].length + 1
      k++
    }
    lineStart += lines[i].length + 1
  }
  tracked = { text: kept.map((i) => lines[i]).join('\n'), steps: [...tracked.steps, joined] }

  // Collapse whitespace: a single space is left as it is
  tracked = replaceTracked(tracked, / \s+|[^\S ]\s*/g, ' ')

  // Trim: whitespace is down to a single space at either end
  const from = tracked.text.startsWith(' ') ? 1 : 0
  const to = Math.max(from, tracked.text.endsWith(' ') ? tracked.text.length - 1 : tracked.text.length)
  return { text: tracked.text.slice(from, to), steps: [...tracked.steps, { out: [0], in: [from] }] }
}

/**
 * @typedef {Object} Segments Where the characters of a text come from in the text it was made from:
 *   from out[k] on, they come from in[k] on, one for one
 * @property {Array<number>} out Starts of the segments in the text
 * @property {Array<number>} in Starts of the segments in the text it was made from
 */

/**
 * @typedef {Object} TrackedText A text made from the document
 * @property {string} text Text
 * @property {Array<Segments>} steps Where the characters of the text come from, each step from the one before, the first from the document
 */

/**
 * Replace every match of a pattern with a character (or nothing), keeping track of where the
 * characters of the result come from: the replacing character comes from the start of the match
 *
 * @param {TrackedText} tracked Text
 * @param {RegExp} re Global pattern to replace, without capturing groups
 * @param {string} replacement A single character, or an empty string
 * @returns {TrackedText} Text with the matches replaced
 */
function replaceTracked ({ text, steps }, re, replacement) {
  const segments = { out: [0], in: [0] }
  let shift = 0
  const replaced = text.replace(re, (match, offset) => {
    const out = offset - shift
    segments.out.push(out, out + replacement.length)
    segments.in.push(offset, offset + match.length)
    shift += match.length - replacement.length
    return replacement
  })
  return { text: replaced, steps: [...steps, segments] }
}

/**
 * Offset in the document of a character of a text made from it
 *
 * @param {TrackedText} tracked Text
 * @param {number} offset Offset of the character in the text
 * @returns {number} Offset of the character in the document
 */
function documentOffset ({ steps }, offset) {
  for (let i = steps.length - 1; i >= 0; i--) {
    const segments = steps[i]
    let low = 0
    let high = segments.out.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (segments.out[mid] <= offset) low = mid
      else high = mid - 1
    }
    offset = segments.in[low] + offset - segments.out[low]
  }
  return offset
}

/**
 * Offset in the text at which each of its lines starts, lines being split as the parser splits them
 *
 * @param {string} text Document text
 * @returns {Array<number>} Offset of the start of each line
 */
function lineStartOffsets (text) {
  const starts = [0]
  const newline = /\r?\n/g
  let match
  while ((match = newline.exec(text)) !== null) {
    starts.push(match.index + match[0].length)
  }
  return starts
}

/**
 * Line and position in the line (column) of an offset in the document, both 1-based
 *
 * @param {Array<number>} lineStarts Offset of the start of each line
 * @param {number} offset Offset in the document
 * @returns {{line: number, pos: number}} Location
 */
function offsetLocation (lineStarts, offset) {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (lineStarts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return { line: low + 1, pos: offset - lineStarts[low] + 1 }
}

function groupBySubsection (refLines, refOrigins) {
  const groups = {}
  let current = null

  refLines.forEach((line, i) => {
    const m = subsectionMatchers.find(({ regex }) => regex.test(line))
    if (m) {
      current = m.name
      groups[current] = { lines: [], origins: [] }
      return
    }
    if (current) {
      groups[current].lines.push(line)
      groups[current].origins.push(refOrigins[i])
    }
  })

  return groups
}

/**
 * Drafts linked to from each references subsection
 *
 * @param {Array<string>} refLines Lines of the references section, trimmed
 * @param {Array<number>} refOrigins Offset in the document at which each line starts, once trimmed
 * @param {function(string, number): void} onDraft Called with each draft linked to, and its offset in the document
 * @returns {Array<{value: string, subsection: string}>} Drafts, once per subsection
 */
function extractDraftsBySubsection (refLines, refOrigins, onDraft) {
  const bySub = groupBySubsection(refLines, refOrigins)
  const result = []

  for (const [subsection, { lines, origins }] of Object.entries(bySub)) {
    // Each line is followed by a newline coming from just after its end
    const lineSegments = { out: [], in: [] }
    let length = 0
    lines.forEach((line, i) => {
      lineSegments.out.push(length)
      lineSegments.in.push(origins[i])
      length += line.length + 1
    })
    const normalized = normalizeText(lines.join('\n'), [lineSegments])
    const drafts = Array.from(normalized.text.matchAll(DRAFT_URL_RE), m => {
      onDraft(m[1], documentOffset(normalized, m.indices[1][0]))
      return m[1]
    })
    for (const draft of new Set(drafts)) {
      result.push({ value: draft, subsection })
    }
  }

  return result
}
