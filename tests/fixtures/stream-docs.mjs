// Documents for the stream tests, as text to be parsed. Each one obsoletes and
// updates RFCs so that the same documents serve the cross-stream tests.

/**
 * An XML document
 *
 * @param {Object} [opts]
 * @param {string} [opts.docName] docName of the <rfc> element
 * @param {string} [opts.submissionType] submissionType of the <rfc> element (none when undefined)
 * @param {string} [opts.number] RFC number: makes the document an RFC
 * @param {string} [opts.obsoletes] obsoletes of the <rfc> element
 * @param {string} [opts.updates] updates of the <rfc> element
 * @returns {string} XML text
 */
export function xmlStreamDoc ({ docName = 'draft-smith-foo-bar-02', submissionType, number, obsoletes = '', updates = '' } = {}) {
  const attrs = [
    `docName="${docName}"`,
    number && `number="${number}"`,
    'category="info"',
    submissionType && `submissionType="${submissionType}"`,
    `obsoletes="${obsoletes}"`,
    `updates="${updates}"`
  ].filter(Boolean).join(' ')
  const seriesInfo = number
    ? `<seriesInfo name="RFC" value="${number}"/>`
    : `<seriesInfo name="Internet-Draft" value="${docName}"/>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<rfc xmlns:xi="http://www.w3.org/2001/XInclude" version="3" ipr="trust200902" ${attrs}>
  <front>
    <title>The Foo Protocol Revised</title>
    ${seriesInfo}
    <author fullname="Alice Smith" initials="A." surname="Smith">
      <organization>Example</organization>
    </author>
    <date year="2026" month="October" day="16"/>
    <abstract>
      <t>This document obsoletes RFC ${obsoletes || 'none'} and updates RFC ${updates || 'none'}.</t>
    </abstract>
  </front>
  <middle>
    <section>
      <name>Introduction</name>
      <t>The Foo protocol needed revising.</t>
    </section>
  </middle>
</rfc>
`
}

/**
 * First page of a text Internet-Draft
 *
 * @param {string} name Draft name, with revision
 * @param {Object} [opts]
 * @param {string} [opts.obsoletes] Value of the Obsoletes: header line
 * @param {string} [opts.updates] Value of the Updates: header line
 * @returns {string} Draft text
 */
export function txtStreamDraft (name, { obsoletes = '1234', updates = '2345' } = {}) {
  return `


Network Working Group                                           A. Smith
Internet-Draft                                                   Example
Obsoletes: ${`${obsoletes} (if approved)`.padEnd(47)}16 October 2026
Updates: ${updates} (if approved)
Intended status: Informational
Expires: 19 April 2027


                         The Foo Protocol Revised
${name.padStart(24 + name.length)}

Abstract

   This document obsoletes RFC ${obsoletes} and updates RFC ${updates}.
`
}

/**
 * First page of a text RFC
 *
 * @param {string} source First line of the header
 * @param {string} number RFC number
 * @param {Object} [opts]
 * @param {string} [opts.obsoletes] Value of the Obsoletes: header line
 * @param {string} [opts.updates] Value of the Updates: header line
 * @returns {string} RFC text
 */
export function txtStreamRfc (source, number, { obsoletes = '1234', updates = '2345' } = {}) {
  return `


${source.padEnd(64)}A. Smith
Request for Comments: ${number.padEnd(42)}Example
Obsoletes: ${obsoletes.padEnd(49)}October 2026
Updates: ${updates}
Category: Informational
ISSN: 2070-1721


                         The Foo Protocol Revised

Abstract

   This document obsoletes RFC ${obsoletes} and updates RFC ${updates}.
`
}
