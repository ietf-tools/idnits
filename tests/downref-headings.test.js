import { describe, expect, test } from 'vitest'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
import { CANONICAL_TXT } from './generators/doc-txt.js'
import { getSubsectionHeadings } from '../lib/modules/downref.mjs'

describe('Subsection headings of the references section, as the downref checks read them', () => {
  // From draft-ietf-mailmaint-imap-objectid-bis-06, draft-caini-dtn-quiccl-01 and RFC 758
  test('an unnumbered heading is one only where a heading can start', async () => {
    const text = `${CANONICAL_TXT}
1.  Introduction

   This document cites RFC 2119.

2.  References

2.1.  Normative References

   [RFC2119]  Bradner, S., "Key words for use in RFCs to Indicate
              Requirement Levels", BCP 14, RFC 2119,
              DOI 10.17487/RFC2119, March 1997,
              <https://www.rfc-editor.org/rfc/rfc2119>.

3.
Informative References

   [RFC8621]  Jenkins, N. and C. Newman, "The JSON Meta Application
              Protocol (JMAP) for Mail", RFC 8621,
              DOI 10.17487/RFC8621, August 2019,
              <https://www.rfc-editor.org/rfc/rfc8621>.

Appendix A.  Changes

   *  Added a note on flags; added RFC 8621 as a
      normative reference

RFC 758                                                      August 1979
IEN 117                                                 Assigned Numbers
References
`
    const doc = await parseTXT(text, 'draft-ietf-beep-boop-01.txt')
    const lines = text.split('\n')
    const headings = getSubsectionHeadings(doc).map((heading) => [lines[heading.line - 1], heading.name])
    expect(headings).toEqual([
      ['2.  References', 'unclassified_references'],
      ['2.1.  Normative References', 'normative_references'],
      ['Informative References', 'informative_references'],
      ['Appendix A.  Changes', 'appendix']
    ])
  })
})
