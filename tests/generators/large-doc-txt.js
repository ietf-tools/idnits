// Large text Internet-Draft, to time a whole run (scripts/time-large-docs.mjs): a header, an abstract,
// a table of contents, the given number of body sections and references, and pages of 56 lines with
// their footer and running header. Every line is at most 72 characters. Not used by the tests, which
// keep to small documents.

const PAGE_LINES = 56
const FIRST_PAGE = `idr                                                            A. Author
Internet-Draft                                                      IETF
Intended status: Standards Track                          1 January 2025
Expires: 5 July 2025


                      A Large Document for Timing
                       draft-ietf-beep-boop-01

Abstract

   This document is generated to time a whole run of the checks on a
   large document.  It has many sections and many references.

Status of This Memo

   This Internet-Draft is submitted in full conformance with the
   provisions of BCP 78 and BCP 79.

   Internet-Drafts are working documents of the Internet Engineering
   Task Force (IETF).  Note that other groups may also distribute
   working documents as Internet-Drafts.  The list of current Internet-
   Drafts is at https://datatracker.ietf.org/drafts/current/.

   Internet-Drafts are draft documents valid for a maximum of six months
   and may be updated, replaced, or obsoleted by other documents at any
   time.  It is inappropriate to use Internet-Drafts as reference
   material or to cite them other than as "work in progress."

   This Internet-Draft will expire on 5 July 2025.

Copyright Notice

   Copyright (c) 2025 IETF Trust and the persons identified as the
   document authors.  All rights reserved.

   This document is subject to BCP 78 and the IETF Trust's Legal
   Provisions Relating to IETF Documents (https://trustee.ietf.org/
   license-info) in effect on the date of publication of this document.
   Please review these documents carefully, as they describe your rights
   and restrictions with respect to this document.  Code Components
   extracted from this document must include Revised BSD License text as
   described in Section 4.e of the Trust Legal Provisions and are
   provided without warranty as described in the Revised BSD License.`

/**
 * Number of the RFC cited by a reference of the generated document
 *
 * @param {number} idx Index of the reference (0-based)
 * @returns {number} RFC number, from 1000 on
 */
function rfcNumber (idx) {
  return 1000 + idx
}

/**
 * Lines of the body of the generated document: the sections, the references and the authors' addresses
 *
 * @param {number} sections Number of body sections, besides the introduction and considerations
 * @param {number} references Number of references, half normative and half informative
 * @returns {string[]} Lines, without page breaks
 */
function bodyLines (sections, references) {
  const lines = []
  const normative = Math.ceil(references / 2)
  lines.push('1.  Introduction', '')
  lines.push('   This document MUST be read with the documents it cites, such as', `   [RFC${rfcNumber(0)}].`, '')
  for (let idx = 0; idx < sections; idx++) {
    lines.push(`${idx + 2}.  Section ${idx + 2}`, '')
    lines.push('   An implementation SHOULD send a message to www.example.com or to')
    lines.push(`   192.0.2.1, as described in [RFC${rfcNumber(idx % Math.max(references, 1))}].`, '')
  }
  const last = sections + 2
  lines.push(`${last}.  IANA Considerations`, '', '   This document has no IANA actions.', '')
  lines.push(`${last + 1}.  Security Considerations`, '', '   This document adds no new security considerations.', '')
  lines.push(`${last + 2}.  References`, '')
  lines.push(`${last + 2}.1.  Normative References`, '')
  for (let idx = 0; idx < references; idx++) {
    if (idx === normative) {
      lines.push(`${last + 2}.2.  Informative References`, '')
    }
    const rfc = rfcNumber(idx)
    lines.push(`   [RFC${rfc}]  Author, A., "Specification Number ${rfc}", RFC ${rfc},`)
    lines.push(`              DOI 10.17487/RFC${rfc}, January 2000,`)
    lines.push(`              <https://www.rfc-editor.org/info/rfc${rfc}>.`, '')
  }
  lines.push("Author's Address", '', '   Alice Author', '   IETF', '   Email: alice@example.com')
  return lines
}

/**
 * Split the lines of the body into pages of PAGE_LINES lines, each ending with a footer and a form feed
 * and the next one starting with a running header
 *
 * @param {string[]} lines Lines of the document after its first page
 * @param {number} firstPage Number of the first page
 * @returns {string[]} Lines, with the page breaks
 */
function paginate (lines, firstPage) {
  const paged = []
  const bodyPerPage = PAGE_LINES - 6
  for (let start = 0, page = firstPage; start < lines.length; start += bodyPerPage, page++) {
    paged.push('\fInternet-Draft         A Large Document for Timing         January 2025', '')
    paged.push(...lines.slice(start, start + bodyPerPage))
    paged.push('', '', `Author                     Expires 5 July 2025               [Page ${page}]`)
  }
  return paged
}

/**
 * Generate a large text Internet-Draft
 *
 * @param {Object} [opts] Size of the document
 * @param {number} [opts.sections=1000] Number of body sections
 * @param {number} [opts.references=1000] Number of references
 * @returns {string} Text of the document
 */
export function largeTxtDoc ({ sections = 1000, references = 1000 } = {}) {
  const firstPage = FIRST_PAGE.split('\n')
  firstPage.push('', '', 'Author                     Expires 5 July 2025                [Page 1]')
  return [...firstPage, ...paginate(bodyLines(sections, references), 2)].join('\n') + '\n'
}
