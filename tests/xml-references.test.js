import { describe, expect, test } from 'vitest'
import { parse } from '../lib/parsers/xml.mjs'
import { collectXmlReferences, getCitedDrafts, getCitedRfcs, listXmlReferences } from '../lib/helpers/xml-references.mjs'

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

  test('takes a section named "Informational References" as informative', async () => {
    const { doc } = await parse(`<rfc version="3"><back>
      <references><name>Informational References</name>
        <reference anchor="RFC6991"><front><title>T</title></front><seriesInfo name="RFC" value="6991"/></reference>
      </references>
    </back></rfc>`, 'draft-test-references-00.xml')

    expect(collectXmlReferences(doc)).toEqual([{ section: 'informative', rfc: '6991', draft: null, source: 'reference' }])
  })

  test('takes what a <reference> cites from the bibliography entry it includes', async () => {
    const { doc } = await parse(INNER_INCLUDE_DOC, 'draft-test-references-00.xml')

    expect(collectXmlReferences(doc)).toEqual([
      { section: 'normative', rfc: '4861', draft: null, source: 'reference' },
      { section: 'normative', rfc: '9000', draft: null, source: 'reference' },
      { section: 'normative', rfc: '8200', draft: null, source: 'reference' },
      { section: 'informative', rfc: null, draft: 'draft-acee-idr-lldp-peer-discovery', source: 'reference' }
    ])
    expect(listXmlReferences(doc).map(({ anchor, rfc, bcp, external }) => ({ anchor, rfc, bcp, external }))).toEqual([
      { anchor: 'IPV6NEIGH', rfc: '4861', bcp: null, external: false },
      { anchor: 'QUIC', rfc: '9000', bcp: null, external: false },
      { anchor: 'RFC8200', rfc: '8200', bcp: null, external: false },
      { anchor: 'KEYWORDS', rfc: null, bcp: '14', external: false },
      { anchor: 'LOCAL', rfc: null, bcp: null, external: true },
      { anchor: 'BGP-LLDP', rfc: null, bcp: null, external: false }
    ])
  })
})

// References whose content is a bibliography entry pulled in with xi:include and an xpointer, as in
// draft-ietf-6man-sub-link-scope-multicast-01: the entry gives what the reference cites, unless the reference
// has a <seriesInfo> of its own; an include that is no bibliography entry leaves it to the anchor
const INNER_INCLUDE_DOC = `<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" category="std" docName="draft-test-references-00" xmlns:xi="http://www.w3.org/2001/XInclude">
  <front><title>Test</title></front>
  <middle><section><name>Introduction</name><t>Text.</t></section></middle>
  <back>
    <references>
      <name>Normative References</name>
      <reference anchor="IPV6NEIGH">
        <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.4861.xml" xpointer="xpointer(/reference/*)"/>
      </reference>
      <reference anchor="QUIC">
        <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.4861.xml" xpointer="xpointer(/reference/*)"/>
        <seriesInfo name="RFC" value="9000"/>
      </reference>
      <reference anchor="RFC8200">
        <xi:include href="refs/ipv6.xml" xpointer="xpointer(/reference/*)"/>
      </reference>
      <reference anchor="KEYWORDS">
        <xi:include href="https://bib.ietf.org/public/rfc/bibxml-rfcsubseries/reference.BCP.14.xml" xpointer="xpointer(/reference/*)"/>
      </reference>
      <reference anchor="LOCAL">
        <xi:include href="refs/local.xml" xpointer="xpointer(/reference/*)"/>
      </reference>
    </references>
    <references>
      <name>Informative References</name>
      <reference anchor="BGP-LLDP">
        <xi:include href="https://xml2rfc.ietf.org/public/rfc/bibxml3/reference.I-D.acee-idr-lldp-peer-discovery" xpointer="xpointer(/reference/*)"/>
      </reference>
    </references>
  </back>
</rfc>
`

// Normative references of drafts: a reference to a document from elsewhere (draft-bokovoy-kitten-pkinit-pqc-02),
// one to a draft given by its anchor and link only (draft-becker-cnsa2-ssh-profile-05), one whose content is
// included (draft-ietf-6man-sub-link-scope-multicast-01), one to a draft named in a <seriesInfo> of another name
// (draft-ietf-rift-auto-evpn-07), and bibliography entries of RFC subseries and of another series
// (draft-dunglas-mercure-08), pulled in by xi:include
const V3_EXTERNAL_DOC = `<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" category="std" docName="draft-test-references-00" xmlns:xi="http://www.w3.org/2001/XInclude">
  <front><title>Test</title></front>
  <middle><section><name>Introduction</name><t>Text.</t></section></middle>
  <back>
    <references>
      <name>References</name>
      <references>
        <name>Normative References</name>
        <reference anchor="FIPS203" target="https://doi.org/10.6028/NIST.FIPS.203">
          <front>
            <title>Module-Lattice-Based Key-Encapsulation Mechanism Standard</title>
            <author>
              <organization>National Institute of Standards and Technology (NIST)</organization>
            </author>
            <date year="2024" month="August"/>
          </front>
          <seriesInfo name="FIPS PUB" value="203"/>
        </reference>
        <reference anchor="I-D.jenkins-cnsa2-pkix-profile" target="https://datatracker.ietf.org/doc/draft-jenkins-cnsa2-pkix-profile/">
          <front>
            <title>Commercial National Security Algorithm Suite Certificate and Certificate Revocation List Profile</title>
            <author initials="M." surname="Jenkins" fullname="M. Jenkins"><organization/></author>
            <date month="January" year="2025"/>
          </front>
        </reference>
        <reference anchor="TLS">
          <front><title>The Transport Layer Security (TLS) Protocol Version 1.3</title><author/><date/></front>
          <seriesInfo name="DOI" value="10.17487/RFC8446"/>
        </reference>
        <reference anchor="MCinUC">
          <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.6085.xml" xpointer="xpointer(/reference/*)"/>
        </reference>
        <reference anchor="RIFT-KV">
          <front>
            <title>RIFT Key/Value Structure and Registry</title>
            <seriesInfo name="Work in Progress," value="draft-head-rift-kv-registry-05"/>
            <author initials="J." surname="Head" fullname="Jordan Head">
              <organization/>
            </author>
          </front>
        </reference>
        <xi:include href="https://bib.ietf.org/public/rfc/bibxml-rfcsubseries/reference.STD.0069.xml"/>
        <xi:include href="https://bib.ietf.org/public/rfc/bibxml-rfcsubseries/reference.BCP.38.xml"/>
        <xi:include href="https://bib.ietf.org/public/rfc/bibxml4/reference.W3C.REC-xml-20081126.xml"/>
        <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml"/>
        <xi:include href="refs/local.xml"/>
      </references>
    </references>
  </back>
</rfc>
`

describe('listXmlReferences', () => {
  const PATH = 'rfc.back.references[0].references[0]'

  test('lists every reference with what it cites and where it is', async () => {
    const { doc } = await parse(V3_EXTERNAL_DOC, 'draft-test-references-00.xml')

    expect(listXmlReferences(doc)).toEqual([
      { section: 'normative', rfc: null, draft: null, bcp: null, std: null, external: true, anchor: 'FIPS203', path: `${PATH}.reference[0]`, source: 'reference' },
      { section: 'normative', rfc: null, draft: null, bcp: null, std: null, external: false, anchor: 'I-D.jenkins-cnsa2-pkix-profile', path: `${PATH}.reference[1]`, source: 'reference' },
      { section: 'normative', rfc: null, draft: null, bcp: null, std: null, external: false, anchor: 'TLS', path: `${PATH}.reference[2]`, source: 'reference' },
      { section: 'normative', rfc: '6085', draft: null, bcp: null, std: null, external: false, anchor: 'MCinUC', path: `${PATH}.reference[3]`, source: 'reference' },
      { section: 'normative', rfc: null, draft: null, bcp: null, std: null, external: false, anchor: 'RIFT-KV', path: `${PATH}.reference[4]`, source: 'reference' },
      { section: 'normative', rfc: null, draft: null, bcp: null, std: '69', external: false, anchor: 'STD.0069', path: `${PATH}.xi:include[0]`, source: 'xi:include' },
      { section: 'normative', rfc: null, draft: null, bcp: '38', std: null, external: false, anchor: 'BCP.38', path: `${PATH}.xi:include[1]`, source: 'xi:include' },
      { section: 'normative', rfc: null, draft: null, bcp: null, std: null, external: true, anchor: 'W3C.REC-xml-20081126', path: `${PATH}.xi:include[2]`, source: 'xi:include' },
      { section: 'normative', rfc: '2119', draft: null, bcp: null, std: null, external: false, anchor: 'RFC.2119', path: `${PATH}.xi:include[3]`, source: 'xi:include' },
      { section: 'normative', rfc: null, draft: null, bcp: null, std: null, external: null, anchor: null, path: `${PATH}.xi:include[4]`, source: 'xi:include' }
    ])
  })

  test('lists the references pulled in by external entities and <?rfc include?> at their section', async () => {
    const { doc } = await parse(V2_DOC, 'draft-test-references-00.xml')
    const references = listXmlReferences(doc)

    expect(references.map(({ anchor, external, path, source }) => ({ anchor, external, path, source }))).toEqual([
      { anchor: 'QUIC', external: false, path: 'rfc.back.references[0].reference[0]', source: 'reference' },
      { anchor: 'RFC.8174', external: false, path: 'rfc.back.references[0]', source: 'pi' },
      { anchor: 'RFC.2119', external: false, path: 'rfc.back.references[0]', source: 'entity' },
      { anchor: 'IANA', external: true, path: 'rfc.back.references[1].reference[0]', source: 'reference' },
      { anchor: 'RFC.6991', external: false, path: 'rfc.back.references[1]', source: 'pi' },
      { anchor: 'I-D.draft-ietf-tls-esni-25', external: false, path: 'rfc.back.references[1]', source: 'pi' },
      { anchor: 'I-D.ietf-quic-http', external: false, path: 'rfc.back.references[1]', source: 'entity' }
    ])
    // -> collectXmlReferences() keeps those citing an RFC or a draft
    expect(collectXmlReferences(doc)).toHaveLength(6)
  })
})
