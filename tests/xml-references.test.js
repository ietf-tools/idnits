import { describe, expect, test } from 'vitest'
import { parse } from '../lib/parsers/xml.mjs'

// A v2 document as kramdown-rfc writes it: references pulled in by external
// entities and <?rfc include?> instructions (quotes not always balanced), in
// sections named with title=
const V2_DOC = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE rfc SYSTEM "rfc2629.dtd" [
<!ENTITY RFC2119 SYSTEM "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml">
<!ENTITY I-D.ietf-quic-http SYSTEM "https://bib.ietf.org/public/rfc/bibxml3/reference.I-D.ietf-quic-http.xml">
]>
<?rfc toc="yes"?>
<rfc category="std" docName="draft-test-references-00" ipr="trust200902">
  <front><title>Test</title></front>
  <middle>
    <section title="Introduction">
      <t>Text.</t>
      <figure><artwork><![CDATA[
<?rfc include="reference.RFC.1111"?>
]]></artwork></figure>
    </section>
  </middle>
  <back>
    <references title="Normative References">
      &RFC2119;
      <?rfc include="reference.RFC.8174'?>
      <reference anchor="QUIC">
        <front><title>QUIC</title><author/><date/></front>
        <seriesInfo name="RFC" value="9000"/>
      </reference>
    </references>
    <references title="Informative References">
      <!-- <?rfc include="reference.RFC.2222"?> -->
      <?rfc include='https://xml.resource.org/public/rfc/bibxml/reference.RFC.6991.xml'?>
      <?rfc include="reference.I-D.draft-ietf-tls-esni-25"?>
      &I-D.ietf-quic-http;
      <reference anchor="IANA">
        <front><title>Registry</title><author/><date/></front>
      </reference>
    </references>
  </back>
</rfc>
`

describe('XML parser should capture processing instructions', () => {
  test('with their offset in the raw text, outside comments and CDATA sections', async () => {
    const { doc } = await parse(V2_DOC, 'draft-test-references-00.xml')

    expect(doc.processingInstructions.map(pi => [pi.target, pi.content])).toEqual([
      ['rfc', 'toc="yes"'],
      ['rfc', 'include="reference.RFC.8174\''],
      ['rfc', "include='https://xml.resource.org/public/rfc/bibxml/reference.RFC.6991.xml'"],
      ['rfc', 'include="reference.I-D.draft-ietf-tls-esni-25"']
    ])
    for (const pi of doc.processingInstructions) {
      expect(doc.body.startsWith(`<?${pi.target}`, pi.offset)).toBe(true)
    }
  })
})
