// Large XML Internet-Draft, to time a whole run (scripts/time-large-docs.mjs): the same content as the
// text one (large-doc-txt.js), in xml2rfc v3 vocabulary, with the given number of body sections and
// references. Not used by the tests, which keep to small documents.

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
 * A <reference> to an RFC
 *
 * @param {number} rfc RFC number
 * @returns {string} The element
 */
function referenceElement (rfc) {
  return `      <reference anchor="RFC${rfc}" target="https://www.rfc-editor.org/info/rfc${rfc}">
        <front>
          <title>Specification Number ${rfc}</title>
          <author initials="A." surname="Author" fullname="A. Author"/>
          <date year="2000" month="January"/>
        </front>
        <seriesInfo name="RFC" value="${rfc}"/>
        <seriesInfo name="DOI" value="10.17487/RFC${rfc}"/>
      </reference>`
}

/**
 * Generate a large XML Internet-Draft
 *
 * @param {Object} [opts] Size of the document
 * @param {number} [opts.sections=1000] Number of body sections
 * @param {number} [opts.references=1000] Number of references
 * @returns {string} XML of the document
 */
export function largeXmlDoc ({ sections = 1000, references = 1000 } = {}) {
  const normative = Math.ceil(references / 2)
  const body = []
  for (let idx = 0; idx < sections; idx++) {
    const cited = rfcNumber(idx % Math.max(references, 1))
    body.push(`    <section anchor="section-${idx + 2}">
      <name>Section ${idx + 2}</name>
      <t>An implementation <bcp14>SHOULD</bcp14> send a message to www.example.com or to 192.0.2.1, as described in <xref target="RFC${cited}"/>.</t>
    </section>`)
  }
  const normativeRefs = []
  const informativeRefs = []
  for (let idx = 0; idx < references; idx++) {
    if (idx < normative) {
      normativeRefs.push(referenceElement(rfcNumber(idx)))
    } else {
      informativeRefs.push(referenceElement(rfcNumber(idx)))
    }
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<rfc xmlns:xi="http://www.w3.org/2001/XInclude" ipr="trust200902" docName="draft-ietf-beep-boop-01" category="std" submissionType="IETF" version="3">
  <front>
    <title>A Large Document for Timing</title>
    <author initials="A." surname="Author" fullname="Alice Author">
      <organization>IETF</organization>
      <address>
        <email>alice@example.com</email>
      </address>
    </author>
    <date year="2025" month="January" day="1"/>
    <area>Internet</area>
    <workgroup>idr</workgroup>
    <abstract>
      <t>This document is generated to time a whole run of the checks on a large document. It has many sections and many references.</t>
    </abstract>
  </front>
  <middle>
    <section anchor="introduction">
      <name>Introduction</name>
      <t>This document <bcp14>MUST</bcp14> be read with the documents it cites, such as <xref target="RFC${rfcNumber(0)}"/>.</t>
    </section>
${body.join('\n')}
    <section anchor="iana">
      <name>IANA Considerations</name>
      <t>This document has no IANA actions.</t>
    </section>
    <section anchor="security">
      <name>Security Considerations</name>
      <t>This document adds no new security considerations.</t>
    </section>
  </middle>
  <back>
    <references>
      <name>References</name>
      <references>
        <name>Normative References</name>
${normativeRefs.join('\n')}
      </references>
      <references>
        <name>Informative References</name>
${informativeRefs.join('\n')}
      </references>
    </references>
  </back>
</rfc>
`
}
