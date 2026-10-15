import { describe, expect, test } from 'vitest'
import { parse } from '../lib/parsers/xml.mjs'
import { collectXmlReferences, getCitedDrafts, getCitedRfcs } from '../lib/helpers/xml-references.mjs'

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

// A v3 document with nested sections, xi:include and <referencegroup>
const V3_DOC = `<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" category="info" docName="draft-test-references-00" xmlns:xi="http://www.w3.org/2001/XInclude">
  <front><title>Test</title></front>
  <middle><section><name>Introduction</name><t>Text.</t></section></middle>
  <back>
    <references>
      <name>References</name>
      <references>
        <name>Normative References</name>
        <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.0791.xml"/>
        <referencegroup anchor="BCP14" target="https://www.rfc-editor.org/info/bcp14">
          <reference anchor="RFC2119"><front><title>Key words</title><author/><date/></front></reference>
          <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8174.xml"/>
        </referencegroup>
      </references>
      <references>
        <name>Informative References</name>
        <xi:include href="https://datatracker.ietf.org/doc/bibxml3/draft-ietf-foo-bar-02.xml"/>
        <reference anchor="I-D.ietf-baz">
          <front><title>Baz</title><author/><date/></front>
          <seriesInfo name="Internet-Draft" value="I-D.draft-ietf-baz-07"/>
        </reference>
      </references>
    </references>
    <references>
      <name>Other Documents</name>
      <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.6991.xml"/>
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

describe('collectXmlReferences', () => {
  test('finds references pulled in by external entities and <?rfc include?> in v2 sections', async () => {
    const { doc } = await parse(V2_DOC, 'draft-test-references-00.xml')

    expect(collectXmlReferences(doc)).toEqual([
      { section: 'normative', rfc: '9000', draft: null, source: 'reference' },
      { section: 'normative', rfc: '8174', draft: null, source: 'pi' },
      { section: 'normative', rfc: '2119', draft: null, source: 'entity' },
      { section: 'informative', rfc: '6991', draft: null, source: 'pi' },
      { section: 'informative', rfc: null, draft: 'draft-ietf-tls-esni-25', source: 'pi' },
      { section: 'informative', rfc: null, draft: 'draft-ietf-quic-http', source: 'entity' }
    ])
  })

  test('finds references in nested v3 sections, <referencegroup> and xi:include', async () => {
    const { doc } = await parse(V3_DOC, 'draft-test-references-00.xml')
    const references = collectXmlReferences(doc)

    expect(getCitedRfcs(references, ['normative'])).toEqual(['791', '2119', '8174'])
    expect(getCitedRfcs(references, ['informative'])).toEqual([])
    expect(getCitedRfcs(references, ['unclassified'])).toEqual(['6991'])
    expect(getCitedDrafts(references)).toEqual(['draft-ietf-baz-07', 'draft-ietf-foo-bar-02'])
  })
})
