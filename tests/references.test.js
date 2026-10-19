import { describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { ValidationComment, ValidationWarning } from '../lib/helpers/error.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
import { validateRfcReferenceUrls } from '../lib/modules/references.mjs'

const REF = 'https://www.rfc-editor.org/styleguide/part2/#ref_rfcs'

/**
 * Expect a finding in normal and forgive-checklist mode, and none in submission mode
 *
 * @param {Object} doc Parsed document
 * @param {ValidationWarning|ValidationComment} expected Finding
 */
async function expectInAllButSubmission (doc, expected) {
  await expect(validateRfcReferenceUrls(doc, { mode: MODES.NORMAL })).resolves.toEqual([expected])
  await expect(validateRfcReferenceUrls(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toEqual([expected])
  await expect(validateRfcReferenceUrls(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
}

describe('References to RFCs link to the RFC\'s info page', () => {
  describe('XML Document Type', () => {
    test('explicit targets to the text of RFCs are reported once, at the first', async () => {
      // From draft-schemacommons-acpm-00
      const { doc } = await parse(`<rfc version="3" category="std" docName="draft-schemacommons-acpm-00"><back>
    <references>
      <name>References</name>
      <references>
        <name>Normative References</name>
        <reference anchor="RFC2119"
                   target="https://www.rfc-editor.org/rfc/rfc2119">
          <front>
            <title>Key words for use in RFCs to Indicate Requirement Levels</title>
            <author initials="S." surname="Bradner" fullname="S. Bradner"/>
            <date year="1997" month="March"/>
          </front>
          <seriesInfo name="BCP" value="14"/>
          <seriesInfo name="RFC" value="2119"/>
        </reference>
        <reference anchor="RFC8174"
                   target="https://www.rfc-editor.org/rfc/rfc8174.html">
          <front>
            <title>Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words</title>
            <author initials="B." surname="Leiba" fullname="B. Leiba"/>
            <date year="2017" month="May"/>
          </front>
          <seriesInfo name="BCP" value="14"/>
          <seriesInfo name="RFC" value="8174"/>
        </reference>
      </references>
      <references>
        <name>Informative References</name>
        <reference anchor="RFC9110" target="https://www.rfc-editor.org/info/rfc9110">
          <front><title>HTTP Semantics</title><date year="2022" month="June"/></front>
          <seriesInfo name="RFC" value="9110"/>
        </reference>
        <reference anchor="RFC3986">
          <front><title>Uniform Resource Identifier (URI): Generic Syntax</title><date year="2005" month="January"/></front>
          <seriesInfo name="RFC" value="3986"/>
        </reference>
      </references>
    </references>
  </back></rfc>`, 'draft-schemacommons-acpm-00.xml')

      await expectInAllButSubmission(doc, new ValidationWarning('RFC_REFERENCE_URL_FORMAT', 'References to RFCs should link to the RFC\'s info page, https://www.rfc-editor.org/info/rfcN. Found 2 links to RFC text instead: https://www.rfc-editor.org/rfc/rfc2119 (and 1 more); for that one, use https://www.rfc-editor.org/info/rfc2119.', {
        ref: REF,
        path: 'rfc.back.references[0].references[0].reference[0]._attr.target'
      }))
    })

    test('a target in a reference group, over http and with an extension, is reported', async () => {
      // From rfc8753: the target of a reference, in a v2 references section
      const { doc } = await parse(`<rfc category="std" docName="draft-ietf-idna-test-00"><back>
  <references title="Normative References">
    <referencegroup anchor="BCP14" target="https://www.rfc-editor.org/info/bcp14">
      <reference anchor="RFC5892" target="http://www.rfc-editor.org/rfc/rfc5892.txt">
        <front><title>The Unicode Code Points and Internationalized Domain Names for Applications (IDNA)</title><date year="2010" month="August"/></front>
        <seriesInfo name="RFC" value="5892"/>
      </reference>
    </referencegroup>
  </references>
</back></rfc>`, 'draft-ietf-idna-test-00.xml')

      await expectInAllButSubmission(doc, new ValidationWarning('RFC_REFERENCE_URL_FORMAT', 'References to RFCs should link to the RFC\'s info page, https://www.rfc-editor.org/info/rfcN. Found 1 link to RFC text instead: http://www.rfc-editor.org/rfc/rfc5892.txt; for that one, use https://www.rfc-editor.org/info/rfc5892.', {
        ref: REF,
        path: 'rfc.back.references[0].referencegroup[0].reference[0]._attr.target'
      }))
    })

    test('info pages, other sites, deep links and included references are not reported', async () => {
      const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE rfc [
<!ENTITY RFC8446 SYSTEM "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8446.xml">
]>
<rfc version="3" category="std" docName="draft-test-references-00" xmlns:xi="http://www.w3.org/2001/XInclude"><back>
  <references>
    <name>Normative References</name>
    <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml"/>
    &RFC8446;
    <reference anchor="RFC7696" target="http://www.rfc-editor.org/info/rfc7696">
      <front><title>Guidelines for Cryptographic Algorithm Agility and Selecting Mandatory-to-Implement Algorithms</title><date year="2015" month="November"/></front>
      <seriesInfo name="RFC" value="7696"/>
    </reference>
    <reference anchor="RFC6749" target="https://datatracker.ietf.org/doc/html/rfc6749">
      <front><title>The OAuth 2.0 Authorization Framework</title><date year="2012" month="October"/></front>
      <seriesInfo name="RFC" value="6749"/>
    </reference>
    <reference anchor="RFC9110-s15" target="https://www.rfc-editor.org/rfc/rfc9110#section-15">
      <front><title>HTTP Semantics, Section 15</title><date year="2022" month="June"/></front>
    </reference>
  </references>
</back></rfc>`, 'draft-test-references-00.xml')

      await expect(validateRfcReferenceUrls(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    })
  })

  describe('TXT Document Type', () => {
    test('links to the text of RFCs in the references section are reported once, with their locations', async () => {
      // From draft-ietf-grow-bmp-over-quic-00: xml2rfc wrapped the first URL after "rfc-"
      const doc = await parseTXT(`
   session according to [RFC9000], see <https://www.rfc-editor.org/rfc/rfc9000>.

9. References

9.1. Normative References

   [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate
             Requirement Levels", BCP 14, RFC 2119, DOI
             10.17487/RFC2119, March 1997, <https://www.rfc-
             editor.org/rfc/rfc2119>.

   [RFC7854] Scudder, J., Ed., Fernando, R., and S. Stuart, "BGP
             Monitoring Protocol (BMP)", RFC 7854, DOI
             10.17487/RFC7854, June 2016, <https://www.rfc-
             editor.org/info/rfc7854>.

   [RFC8446] Rescorla, E., "The Transport Layer Security (TLS) Protocol
             Version 1.3", RFC 8446, DOI 10.17487/RFC8446, August 2018,
             <https://www.rfc-editor.org/rfc/rfc8446>.
`, 'draft-ietf-grow-bmp-over-quic-00.txt')

      await expectInAllButSubmission(doc, new ValidationComment('RFC_REFERENCE_URL_FORMAT', 'References to RFCs should link to the RFC\'s info page, https://www.rfc-editor.org/info/rfcN. Found 2 links to RFC text instead: https://www.rfc-editor.org/rfc/rfc2119 (and 1 more); for that one, use https://www.rfc-editor.org/info/rfc2119. xml2rfc currently renders references without a target this way and will switch to /info/: if this document was produced by xml2rfc from XML without explicit targets, nothing needs changing in the source.', {
        ref: REF,
        lines: [{ line: 10, pos: 45 }, { line: 20, pos: 15 }]
      }))
    })

    test('bare links wrapped at "-" or "/", in parentheses, are joined', async () => {
      // From draft-araut-oauth-transaction-tokens-for-agents-02
      const doc = await parseTXT(`
   This document has no IANA actions.

6.  References

6.1.  Normative References

   RFC2119 (https://datatracker.ietf.org/doc/html/rfc2119) Bradner, S.,
   "Key words for use in RFCs to Indicate Requirement Levels", BCP 14,
   RFC 2119, DOI 10.17487/RFC2119, March 1997, https://www.rfc-
   editor.org/rfc/rfc2119 (https://www.rfc-editor.org/rfc/rfc2119).

   RFC9068 (https://tools.ietf.org/html/rfc9068) Bertocci, V., "JSON Web
   Token (JWT) Profile for OAuth 2.0 Access Tokens", RFC 9068, DOI
   10.17487/RFC9068, October 2021, https://www.rfc-editor.org/rfc/
   rfc9068 (https://www.rfc-editor.org/rfc/rfc9068).
`, 'draft-araut-oauth-transaction-tokens-for-agents-02.txt')

      const [finding] = await validateRfcReferenceUrls(doc, { mode: MODES.NORMAL })
      expect(finding).toBeInstanceOf(ValidationComment)
      expect(finding.message).toContain('Found 4 links to RFC text instead: https://www.rfc-editor.org/rfc/rfc2119 (and 3 more)')
      expect(finding.lines).toEqual([{ line: 10, pos: 48 }, { line: 11, pos: 28 }, { line: 15, pos: 36 }, { line: 16, pos: 13 }])
    })

    test('a link wrapped across a page break is joined', async () => {
      // From draft-das-rats-attestation-bnd-execution-finality-04, with the link of an RFC reference
      const doc = await parseTXT(`
   This document has no IANA actions.

10.  References

10.1.  Informative References

   [RFC9334]  Birkholz, H., Thaler, D., Richardson, M., Smith, N., and
              W. Pan, "Remote ATtestation procedureS (RATS) Architecture",
              RFC 9334, DOI 10.17487/RFC9334, January 2023, <https://www.rfc-



Das                       Expires 15 March 2027                [Page 62]
\f
Internet-Draft    Attestation-Bound Execution Finality    September 2026


              editor.org/rfc/rfc9334>.
`, 'draft-das-rats-attestation-bnd-execution-finality-04.txt')

      const [finding] = await validateRfcReferenceUrls(doc, { mode: MODES.NORMAL })
      expect(finding).toBeInstanceOf(ValidationComment)
      expect(finding.message).toContain('Found 1 link to RFC text instead: https://www.rfc-editor.org/rfc/rfc9334; for that one, use https://www.rfc-editor.org/info/rfc9334.')
      expect(finding.lines).toEqual([{ line: 10, pos: 62 }])
    })

    test('info pages, deep links and links outside the references section are not reported', async () => {
      const doc = await parseTXT(`
   See Section 4 of RFC 9110 <https://www.rfc-editor.org/rfc/rfc9110>.

8.  References

8.1.  Normative References

   [RFC7696]  Housley, R., "Guidelines for Cryptographic Algorithm
              Agility and Selecting Mandatory-to-Implement Algorithms",
              BCP 201, RFC 7696, DOI 10.17487/RFC7696, November 2015,
              <http://www.rfc-editor.org/info/rfc7696>.

   [HTTP-15]  Fielding, R., Ed., "HTTP Semantics, Section 15",
              <https://www.rfc-editor.org/rfc/rfc9110#section-15>.

Appendix A.  Example

   A link to <https://www.rfc-editor.org/rfc/rfc9110.html>.
`, 'draft-test-references-00.txt')

      await expect(validateRfcReferenceUrls(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    })
  })
})
