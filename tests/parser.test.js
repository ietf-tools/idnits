import { afterAll, beforeAll, describe, expect, vi, test } from 'vitest'
import { generateTXTDoc } from './generators/doc-txt.js'
import {
  abstractTXTBlock,
  tableOfContentsTXTBlock,
  introductionTXTBlock,
  metaTXTBlock,
  securityConsiderationsTXTBlock,
  authorAddressTXTBlock,
  referenceTXTBlock,
  abstractWithReferencesTXTBlock,
  textWithFQRNTXTBlock,
  textWithIPsTXTBlock,
  textWithRFC2119KeywordsTXTBlock,
  RFC2119BoilerplateTXTBlock,
  RFC8174BoilerplateTXTBlock,
  metaWithoutObsoleteAndUpdatesTXTBlock,
  textWithFormFeedTXTBlock,
  textWithoutFormFeedTXTBlock,
  textWithFormFeedOnLineTXTBlock,
  textAcceptableParagraphPointingTheListOfCurrentId,
  metaWithoutDocumentNameTXTBlock,
  textAcceptableParagraphCallingOutSixMonthValidity,
  textAcceptableParagraphNotingThatDraftTXTBlock,
  metaWithoutIdIndicatorTXTBlock,
  copyrightNoticeTXTBlock,
  copyrightNoticeWithCurrentYearTXTBlock,
  textLicense6biiTXTBlock,
  textLicense6ciiTXTBlock,
  textLicense6ciTXTBlock,
  copyrightNoticeNumberedTXTBlock,
  statusOfMemoTXTBlock,
  statusOfMemoNumberedTXTBlock,
  abstractNumberedTXTBlock,
  metaObsoleteAndUpdatesHasCharactersTXTBlock,
  ianaConsiderationsTXTBlock,
  textWithoutPageNumberedTXTBlock,
  textWithPageNumberedTXTBlock,
  referencesTXTBlockShort,
  PageBlock,
  expiresLineFooterTXTBlock,
  PageBreak,
  trust28Dec2009Section6aTXTBlock,
  normativeReferenceSectionTXTBlock,
  informativeReferenceSectionTXTBlock,
  RFC2119Alt1BoilerplateTXTBlock,
  RFC2119Alt2BoilerplateTXTBlock,
  BCP14BoilerplateTXTBlock
} from './fixtures/txt-blocks/section-blocks.mjs'
import { getLocations, pageBreakLineType, parse } from '../lib/parsers/txt.mjs'
import { validateReferencesInText } from '../lib/modules/sections.mjs'

beforeAll(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterAll(() => {
  vi.restoreAllMocks()
})

// Excerpt from draft-bg-onions-update-network-service-models-01: unpaginated, so its table of
// contents has no page numbers and no dot leaders
const unpaginatedDraftTXT = `Network Working Group                                      O. G. D. Dios
Internet-Draft                                                Telefonica
Intended status: Informational                                S. Barguil
Expires: 7 January 2027                                            Nokia
                                                             6 July 2026


           An Update of Service and Network YANG Data Models
          draft-bg-onions-update-network-service-models-01

Abstract

   Service & Network data models have been implemented in recent years
   to facilitate the deployment of connectivity services such as Layer 2
   and Layer 3 VPN services in provider networks.

Table of Contents

   1.  Introduction
   2.  Conventions and Definitions
   3.  Service and Network YANG Data Models in the IETF
   4.  Observations and new requirements
     4.1.  Enhancements to LxSM and LxNM
       4.1.1.  L3NM Enhancements
       4.1.2.  ## L2NM Enhancements
     4.2.  New Functionalities Required to Fully Support Connectivity
           Services
     4.3.  Status of the Intended Network Service
     4.4.  Summary
   5.  Security Considerations
   6.  IANA Considerations
   7.  References
     7.1.  Normative References
     7.2.  Informative References
   Acknowledgments
   Authors' Addresses

1.  Introduction

   Service and Network YANG data models [RFC8199][RFC8309] such as the
   Layer 3 Network Model (L3NM) [RFC9182] and the Layer 2 Network Model
   (L2NM) [RFC9291] have been implemented to automate the deployment of
   VPN services by providers.

5.  Security Considerations

   TODO Security

6.  IANA Considerations

   This document has no IANA actions.

7.  References

7.1.  Normative References

   [RFC2119]  Bradner, S., "Key words for use in RFCs to Indicate
              Requirement Levels", BCP 14, RFC 2119,
              DOI 10.17487/RFC2119, March 1997,
              <https://www.rfc-editor.org/rfc/rfc2119>.

7.2.  Informative References

   [RFC4364]  Rosen, E. and Y. Rekhter, "BGP/MPLS IP Virtual Private
              Networks (VPNs)", RFC 4364, DOI 10.17487/RFC4364, February
              2006, <https://www.rfc-editor.org/rfc/rfc4364>.

Acknowledgments

   This documents is based on the issues compiled in Github lxnm
   repository.

Authors' Addresses

   Oscar Gonzalez de Dios
   Telefonica
   Email: oscar.gonzalezdedios@telefonica.com
`

/**
 * First non-blank line after the table of contents found by the parser
 *
 * @param {string} txt Parsed text
 * @param {Object} toc Table of contents markers
 * @returns {string} The line
 */
function lineAfterToc (txt, toc) {
  return txt.split(/\r?\n/).slice(toc.end).find(line => line.trim())
}

/**
 * Number (1-based) of the first line of a text holding a string
 *
 * @param {string} txt Parsed text
 * @param {string} text String to find
 * @returns {number} The line number
 */
function lineNumber (txt, text) {
  return txt.split(/\r?\n/).findIndex(line => line.includes(text)) + 1
}

describe('A possible code comment is detected outside of a marked code block', () => {
  test('The comment is detected and marked as a possible code comment out of code block', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      <CODE BEGINS>
      ...
      <CODE ENDS>
      # This is a possible code comment
      /* This is another possible code comment */
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.inlineCode).toHaveLength(2)
    expect(result.data.possibleIssues.inlineCode).toEqual(expect.arrayContaining([
      // (at the comment marker, after the indentation before a "#")
      expect.objectContaining({ line: 42, pos: 7 }),
      expect.objectContaining({ line: 43, pos: 7 })
    ]))
  })

  test('The comment is detected inside of code block', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      <CODE BEGINS>
      # Comment inside code block
      <CODE ENDS>
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.inlineCode).toHaveLength(0)
  })

  test('Consecutive comment lines are all detected', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      # First possible code comment
      # Second possible code comment
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.inlineCode).toHaveLength(2)
    expect(result.data.possibleIssues.inlineCode).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: 39 }),
      expect.objectContaining({ line: 40 })
    ]))
  })

  test('An RFC 8792 folding header starting with "#" is not a code comment', async () => {
    // From draft-ietf-httpapi-digest-fields-problem-types-06
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
   debugging or error reporting, as shown in the following example.

   # NOTE: '\\' line wrapping per RFC 8792

   HTTP/1.1 400 Bad Request
   Content-Type: application/problem+json
   Want-Content-Digest: sha-512=3, sha-256=10
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.inlineCode).toHaveLength(0)
  })

  test('An RFC 8792 two-backslash folding header is not a code comment, other "#" lines still are', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
   # NOTE: '\\\\' line wrapping per RFC 8792

   # This is a possible code comment
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.inlineCode).toEqual([
      expect.objectContaining({ line: lineNumber(txt, '# This is a possible code comment'), pos: 4 })
    ])
  })
})

describe('Missing abstract section', () => {
  test('The abstract section is missing', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.content.abstract).toHaveLength(0)
  })

  test('The abstract section is present', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractTXTBlock}
    ${introductionTXTBlock}
    ${securityConsiderationsTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.content.abstract).not.toBeNull()
    expect(result.data.content.abstract).toEqual(expect.arrayContaining([expect.stringContaining('Abstract')]))
  })

  // Excerpt from draft-lin-idr-cats-flowspec-ts-05: the abstract text is not indented
  const unindentedAbstractTXT = [
    'IDR                                                              C. Lin',
    'Internet Draft                                     New H3C Technologies',
    'Intended status: Standards Track                                 H. Yao',
    'Expires: January 08, 2027                                  China Mobile',
    '                                                           July 6, 2026',
    '',
    '             BGP Flowspec for Computing-Aware Traffic Steering',
    '                     draft-lin-idr-cats-flowspec-ts-05',
    '',
    'Abstract',
    '',
    'A BGP Flow Specification is an n-tuple consisting of several matching',
    'criteria that can be applied to IP traffic. Computing-Aware Traffic',
    'Steering (CATS) is a framework which optimizes traffic steering to a',
    'given service instance by taking into account the dynamic nature of',
    'both computing and network resources. This document specifies a new BGP',
    'Flow Spec Component Type in order to support CATS traffic forwarding.',
    '',
    'Status of this Memo',
    '',
    '   This Internet-Draft is submitted in full conformance with the',
    '   provisions of BCP 78 and BCP 79.',
    ''
  ].join('\r\n')

  test('The abstract text is not indented', async () => {
    const result = await parse(unindentedAbstractTXT, 'draft-lin-idr-cats-flowspec-ts-05.txt')
    expect(result.data.content.abstract).toHaveLength(7)
    expect(result.data.content.abstract.at(-1)).toBe('Flow Spec Component Type in order to support CATS traffic forwarding.')
  })

  // Excerpt from draft-ietf-detnet-glbf-01: the abstract has several paragraphs and crosses a page break
  const abstractAcrossPagesTXT = `DETNET                                                    T. Eckert, Ed.
Internet-Draft                                Futurewei Technologies USA
Intended status: Standards Track                                A. Clemm
Expires: 21 January 2027                                       Sympotech
                                                            20 July 2026


                       draft-ietf-detnet-glbf-01

Abstract

   This memo proposes a mechanism called "guaranteed Latency Based
   Forwarding" (gLBF) as part of DetNet for hop-by-hop packet forwarding
   with per-hop deterministically bounded latency and minimal jitter.

   In addition to reducing the jitter compared to TSN-ATS by additional
   buffering (dampening) in the network, gLBF also eliminates the need
   for per-flow, per-hop state maintenance required by TSN-ATS.  This
   avoids the need to signal per-flow state to every hop from the
   controller-plane and associated scaling problems.  It also reduces
   implementation cost for high-speed networking hardware due to the



Eckert, et al.           Expires 21 January 2027                [Page 1]
\f
Internet-Draft                 detnet-glbf                     July 2026


   avoidance of additional high-speed speed read/write memory access to
   retrieve, process and update per-flow state variables for a large
   number of flows.

Status of This Memo

   This Internet-Draft is submitted in full conformance with the
   provisions of BCP 78 and BCP 79.
`

  test('The abstract continues across paragraphs and page breaks', async () => {
    const result = await parse(abstractAcrossPagesTXT, 'draft-ietf-detnet-glbf-01.txt')
    expect(result.data.content.abstract).toHaveLength(13)
    expect(result.data.content.abstract.at(-1)).toBe('number of flows.')
    expect(result.data.content.abstract).not.toEqual(expect.arrayContaining([expect.stringMatching(/\[Page 1\]|July 2026/)]))
  })

  // Excerpts from draft-juwan-ars-00, whose body repeats the abstract as a numbered section
  const abstractRepeatedInBodyTXT = `Independent Submission                                          J. Hwang
Internet-Draft                                            22 August 2026
Intended status: Informational
Expires: 23 February 2027


               ARS-1 -- Generic Archival Reference System
                           draft-juwan-ars-00

Abstract

   ARS-1 defines a deterministic, human-oriented, cryptographically
   derived reference protocol for assigning stable public References to
   durable digital entities.  Typical references look like NX-174932,
   CJ3-106, MR-X4928, or KX4-7B19Q2.

Status of This Memo

   This Internet-Draft is submitted in full conformance with the
   provisions of BCP 78 and BCP 79.

1.  Introduction

   *Status:* v1.0-rc2 (Frozen) *Protocol class:* Generic archival
   reference and permalink protocol

2.  Abstract

   ARS-1 defines a deterministic, human-oriented, cryptographically
   derived reference protocol for assigning stable public References to
   durable digital entities.
`

  test('A body section repeating the abstract is not the abstract', async () => {
    const result = await parse(abstractRepeatedInBodyTXT, 'draft-juwan-ars-00.txt')
    expect(result.data.content.abstract).toHaveLength(5)
    expect(result.data.markers.abstract.start).toBe(10)
    expect(result.data.possibleIssues.isAbstractNumbered).toBe(false)
  })
})

describe('Missing introduction section', () => {
  test('The introduction section is missing', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.content.introduction).toHaveLength(0)
  })

  test('The introduction section is present', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractTXTBlock}
    ${introductionTXTBlock}
    ${securityConsiderationsTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.content.introduction).not.toBeNull()
    expect(result.data.content.introduction).toEqual(expect.arrayContaining([expect.stringContaining('The purpose of this document is to define the structure and standards')]))
  })
})

describe('Missing Author Address section', () => {
  test('The Author Address section is missing', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.markers.authorAddress.start).toBe(0)
  })

  test('The Author Address section is present', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractTXTBlock}
    ${introductionTXTBlock}
    ${authorAddressTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.markers.authorAddress.start).toBeGreaterThan(0)
  })
})

describe('References (if any present) are not categorized as Normative or Informative', () => {
  test('References are not categorized', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      7. References
      7.1. Unknown references
      7.2 Uncategorizes references
    `

    const result = await parse(txt, 'txt')
    expect(result.data.content.references).toEqual(expect.not.arrayContaining([expect.stringContaining('Normative References'), expect.stringContaining('Informative References')]))
  })

  test('Reference section is not present', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.content.references).toHaveLength(0)
  })

  test('Parsing reference section named "Normative References', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${normativeReferenceSectionTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.content.references).toEqual(expect.arrayContaining([expect.stringContaining('Normative References')]))
  })

  test('Parsing reference section named "Informative References', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${informativeReferenceSectionTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.content.references).toEqual(expect.arrayContaining([expect.stringContaining('Informative References')]))
  })

  test('References are categorized', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractTXTBlock}
    ${introductionTXTBlock}
    ${securityConsiderationsTXTBlock}
    ${referenceTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.content.references).toEqual(expect.arrayContaining([expect.stringContaining('Normative References'), expect.stringContaining('Informative References')]))
  })

  test('Author\'s section is present in format Author\'s Address', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${referenceTXTBlock}
      Author's Address

      Billie Wilington, New York City, NY 10001, USA
    `

    const result = await parse(txt, 'txt')
    expect(result.data.markers.authorAddress.start).toBeTruthy()
  })

  test('Author\'s section is present in plural form', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractTXTBlock}
    ${introductionTXTBlock}
    ${securityConsiderationsTXTBlock}
    ${referenceTXTBlock}
    Authors' Addresses

    Billie Wilington, New York City, NY 10001, USA
  `

    const result = await parse(txt, 'txt')
    expect(result.data.markers.authorAddress.start).toBeTruthy()
  })

  test('Should include all reference section titles in content, even if there are multiple titles', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      2. Informative References

      [RFC4360]  Sangli, S., Tappan, D., and Y. Rekhter, "BGP Extended
                Communities Attribute", RFC 4360, DOI 10.17487/RFC4360,
                February 2006, <https://www.rfc-editor.org/info/rfc4360>.

      [RFC5701]  Rekhter, Y., "IPv6 Address Specific BGP ExtendedCommunity
                Attribute", RFC 5701, DOI 10.17487/RFC5701, November 2009,
                <https://www.rfc-editor.org/info/rfc5701>.

      3. Normative References

      [RFC4360]  Sangli, S., Tappan, D., and Y. Rekhter, "BGP Extended
                Communities Attribute", RFC 4360, DOI 10.17487/RFC4360,
                February 2006, <https://www.rfc-editor.org/info/rfc4360>.

      [RFC5701]  Rekhter, Y., "IPv6 Address Specific BGP ExtendedCommunity
                Attribute", RFC 5701, DOI 10.17487/RFC5701, November 2009,
                <https://www.rfc-editor.org/info/rfc5701>.
    `

    const result = await parse(txt, 'txt')
    expect(result.data.content.references).toEqual(
      expect.arrayContaining(['3. Normative References', '2. Informative References'])
    )
  })
  test('Table of contents of an unpaginated document does not open the References section', async () => {
    const result = await parse(unpaginatedDraftTXT, 'txt')
    const referencesTitles = result.data.content.references.filter(line => /^(?:\d+\.\s+)?(?:(?:Normative|Informative)\s+)?References$/i.test(line))
    expect(referencesTitles).toEqual(['7.  References'])
    expect(lineAfterToc(unpaginatedDraftTXT, result.data.markers.toc)).toBe('1.  Introduction')
  })
})

describe('Abstract contains references', () => {
  test('Abstract contains references', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.content.abstract).toEqual(expect.arrayContaining([expect.stringContaining('Abstract'), expect.stringContaining('[1]')]))
  })
})

describe('Parsing FQRN', () => {
  test('Extracting FQRN domains from text', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${textWithFQRNTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.fqdnDomains).toEqual(expect.arrayContaining(['www.random.arpa', 'www.invalid.arpa']))
  })

  test('No FQRN domains found in text', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.fqdnDomains).toEqual([])
  })

  test('Extracts only valid domains with letter-only TLD', async () => {
    const txt = `
      foo.bar.com
      a.a.com
      aa1.12m
      sub.domain.io
      alpha.beta.gamma.xyz
    `
    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.fqdnDomains).toEqual(
      expect.arrayContaining([
        'foo.bar.com'
      ])
    )
    expect(result.data.extractedElements.fqdnDomains).toHaveLength(1)
  })

  test('Ignores numeric-TLD and weird patterns', async () => {
    const txt = `
      bad.123
      fine.1a
      no-tld.
      weird.TLD1
      Q.850
    `
    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.fqdnDomains).toEqual([])
  })

  test('Handles domains', async () => {
    const txt = `
      Please visit foo.bar.com, or contact us at site.org.
      Also sub.domain.io; and alpha.beta.gamma.xyz.
    `
    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.fqdnDomains).toEqual(
      expect.arrayContaining([
        'foo.bar.com',
        'site.org'
      ])
    )
    expect(result.data.extractedElements.fqdnDomains).toHaveLength(2)
  })

  test('Does not extract email addresses or trailing @', async () => {
    const txt = `
      some text with user@example.com
      another text someone@host.org
      third text just@
    `
    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.fqdnDomains).toEqual([])
  })

  test('Ignores the continuation of a URL wrapped onto the next lines', async () => {
    // From draft-bichot-msync-20, draft-ietf-jsonschema-json-schema-03 and draft-ietf-mlcodec-test-battery-00
    const txt = `
   [RFC2236] W. Fenner, "Internet Group Management Protocol, Version 2",
              RFC 2236, November 1997, <https://www.rfc-
              editor.org/info/rfc2236>

   https://json-schema.org/draft/2020-12/meta/core (https://json-
   schema.org/draft/2020-12/meta/core).

              "Benchmarking Neural Speech Codec Intelligibility with
              SITool", INTERSPEECH 2025, 2025, <https://www.isca-
              archive.org/interspeech_2025/
              leschanowsky25_interspeech.pdf>.
    `
    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.fqdnDomains).toEqual([])
  })

  test('Extracts a domain on the line after a URL that ends', async () => {
    // From draft-ietf-rpp-requirements-04
    const txt = `
              Nottingham, M., "Building Protocols with HTTP", BCP 56,
              RFC 9205, DOI 10.17487/RFC9205, June 2022,
              <https://www.rfc-editor.org/info/rfc9205>.

   [OpenAPI]  openapis.org, "OpenAPI Specification", 2025,
              <https://www.openapis.org/>.
    `
    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.fqdnDomains).toEqual(['openapis.org'])
  })

  test('Lists a domain once whatever its case', async () => {
    // From draft-iab-ip-geo-workshop-report-04
    const txt = `
   [PAN]      Pan, J. and J. Zhao, "GeoFeed in the wild: A case study on
              StarlinkISP.net", November 2025,
              <https://www.ietf.org/slides/slides-ipgeows-paper-geofeed-
              in-the-wild-a-case-study-on-starlinkispnet-00.pdf>.

   *  J.  Pan, J.  Zhao: GeoFeed in the wild: A case study on
      StarlinkISP.net [PAN]
    `
    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.fqdnDomains).toEqual(['starlinkisp.net'])
  })

  test('Locates every mention of a domain in the document', async () => {
    // From draft-iab-ip-geo-workshop-report-04
    const txt = `
   [PAN]      Pan, J. and J. Zhao, "GeoFeed in the wild: A case study on
              StarlinkISP.net", November 2025,
              <https://www.ietf.org/slides/slides-ipgeows-paper-geofeed-
              in-the-wild-a-case-study-on-starlinkispnet-00.pdf>.

   *  J.  Pan, J.  Zhao: GeoFeed in the wild: A case study on
      StarlinkISP.net [PAN]
    `
    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.locations.fqdnDomains).toEqual({
      'starlinkisp.net': [{ line: 3, pos: 15 }, { line: 8, pos: 7 }]
    })
    expect(getLocations(result, 'fqdnDomains', 'starlinkisp.net')).toEqual([{ line: 3, pos: 15 }, { line: 8, pos: 7 }])
    expect(getLocations(result, 'fqdnDomains', 'www.ietf.org')).toEqual([])
  })

  test('Takes an email address broken mid-word at the end of a full line as one address', async () => {
    // From draft-ietf-scitt-architecture-20: xml2rfc broke "iesg@ietf.org" to fit the 72-column line
    const txt = `
   Person and email address to contact for further information:  iesg@ie
      tf.org
   Intended usage:  COMMON
    `
    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.splitEmailAddresses).toEqual([
      { address: 'iesg@ietf.org', parts: ['iesg@ie', 'tf.org'], line: 2, pos: 66 }
    ])
    expect(result.data.extractedElements.fqdnDomains).toEqual([])
  })

  test('Does not join an email address that is whole or not at the end of a full line', async () => {
    // From draft-drake-email-hardware-attestation-02, draft-ietf-calext-vcard4-bis-00,
    // draft-morrison-identity-attributed-commits-03 and draft-ietf-vcon-vcon-core-04 (a line folded by hand)
    const txt = `
   wsmbt, which holds the handle "crusty", sending as crusty@mailpal.com
   from a Windows 10 host with an Intel firmware TPM (PTT).  Mode 1 is

   template, defined in the sections below, is sent to vcarddav@ietf.org
   and iana@iana.org.  Within two weeks, the designated expert is

   value ~release@example.org corresponds to alter:~release@example.org.
   The zone is taken from org-scope alone and never from the spelling of

           On Friday, September 23, 2022, 9:44:40 PM UTC, Bob <b@exa
           mple.com> wrote:  \\r\\n \\r\\n Alice:Please find the image a
    `
    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.splitEmailAddresses).toEqual([])
  })
})

describe('Parsing IPs', () => {
  test('Extracting IPs from text', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${textWithIPsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.ipv4).toEqual(expect.arrayContaining(['8.8.8.8', '123.45.67.89', '256.0.0.1', '192.0.2.300']))
    expect(result.data.extractedElements.ipv6).toEqual(expect.arrayContaining(['2001:0000:130F:0000:0000:09C0:876A:130B', '1234:5678:90ab::']))
  })

  test('No IPs found in text', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.ipv4).toEqual([])
    expect(result.data.extractedElements.ipv6).toEqual([])
  })

  test('Locates every IP address in the document', async () => {
    // From draft-denis-dns-stamps-02
    const txt = `
   *  IPv4: 192.0.2.1 or 192.0.2.1:5353

   *  IPv6: [2001:db8::1] or [2001:db8::1]:5353
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.ipv4).toEqual(['192.0.2.1', '192.0.2.1'])
    expect(result.data.extractedElements.locations.ipv4).toEqual({
      '192.0.2.1': [{ line: 2, pos: 13 }, { line: 2, pos: 26 }]
    })
    expect(result.data.extractedElements.locations.ipv6).toEqual({
      '2001:db8::1': [{ line: 4, pos: 14 }, { line: 4, pos: 31 }]
    })
  })
})

describe('Testing parsing RFC2119 keywords and boilerplates', () => {
  test('Parsing RFC2119 keywords', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${textWithRFC2119KeywordsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.keywords2119).toEqual(expect.arrayContaining([
      { keyword: 'MUST', line: 46 },
      { keyword: 'MUST NOT', line: 46 },
      { keyword: 'REQUIRED', line: 46 },
      { keyword: 'SHALL', line: 46 },
      { keyword: 'SHALL NOT', line: 46 },
      { keyword: 'SHOULD', line: 46 },
      { keyword: 'NOT RECOMMENDED', line: 49 }
    ]))
    expect(result.data.extractedElements.boilerplate2119Keywords).toEqual([])
  })

  test('Parsing RFC2119 boilerplate keywords', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${RFC2119BoilerplateTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.boilerplate2119Keywords).toEqual([
      'MUST',
      'MUST NOT',
      'REQUIRED',
      'SHALL',
      'SHALL NOT',
      'SHOULD',
      'SHOULD NOT',
      'RECOMMENDED',
      'MAY',
      'OPTIONAL'
    ])
  })

  test('Locates keywords, in the boilerplate where they start', async () => {
    // From draft-ietf-teas-ns-ip-mpls-10: "NOT RECOMMENDED" is broken across lines in the boilerplate
    const txt = `
1.1.  Terminology

   In this document, the key words "MUST", "MUST NOT", "REQUIRED",
   "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT
   RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
   interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only
   when, they appear in all capitals, as shown here.
    `

    const result = await parse(txt, 'txt')
    const { locations } = result.data.extractedElements
    expect(locations.keywords2119.MUST).toEqual([{ line: 4, pos: 37 }])
    expect(locations.keywords2119.RECOMMENDED).toEqual([{ line: 5, pos: 51 }, { line: 6, pos: 4 }])
    expect(locations.boilerplate2119Keywords.MUST).toEqual([{ line: 4, pos: 37 }])
    expect(locations.boilerplate2119Keywords.RECOMMENDED).toEqual([{ line: 5, pos: 51 }])
    expect(locations.boilerplate2119Keywords['NOT RECOMMENDED']).toEqual([{ line: 5, pos: 66 }])
  })

  test('Detecting RFC2119 boilerplate', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${RFC2119BoilerplateTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.boilerplate.rfc2119).toBe(true)
  })

  test('Detecting RFC2119 boilerplate alt1', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${RFC2119Alt1BoilerplateTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.boilerplate.rfc2119).toBe(true)
  })

  test('Detecting RFC2119 boilerplate alt2', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${RFC2119Alt1BoilerplateTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.boilerplate.rfc2119).toBe(true)
  })

  test('Detecting missing RFC2119 boilerplate', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.boilerplate.rfc2119).toBe(false)
  })

  test('Detecting missing RFC2119 boilerplate alt1', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${RFC2119Alt1BoilerplateTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.boilerplate.rfc2119).toBe(true)
  })

  test('Detecting missing RFC2119 boilerplate alt2', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${RFC2119Alt2BoilerplateTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.boilerplate.rfc2119).toBe(true)
  })

  test('Detecting RFC2119 reference', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${textWithRFC2119KeywordsTXTBlock}
      [RFC2119]
    `

    const result = await parse(txt, 'txt')
    expect(result.data.references.rfc2119).toBe(true)
  })

  test('Detecting missing RFC2119 reference', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${textWithRFC2119KeywordsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.references.rfc2119).toBe(false)
  })

  test('Detecting RFC8174 boilerplate', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${RFC8174BoilerplateTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.boilerplate.rfc8174).toBe(true)
  })

  test('Detecting missing RFC8174 boilerplate', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.boilerplate.rfc8174).toBe(false)
  })

  test('Detecting RFC8174 reference', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${textWithRFC2119KeywordsTXTBlock}
      [RFC8174]
    `

    const result = await parse(txt, 'txt')
    expect(result.data.references.rfc8174).toBe(true)
  })

  test('Detecting missing RFC8174 reference', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${textWithRFC2119KeywordsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.references.rfc8174).toBe(false)
  })

  test('Detecting BCP14 and references', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${BCP14BoilerplateTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.boilerplate.bcp14).toBe(true)
    expect(result.data.references.bcp14).toBe(true)
  })
})

describe('Parsing similar to RFC2119 boilerplate text', () => {
  test('Similar to boilerplate text is detected, but it is not a boilerplate', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${textWithRFC2119KeywordsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.boilerplate.rfc2119).toEqual(false)
    expect(result.data.boilerplate.rfc8174).toEqual(false)
    expect(result.data.boilerplate.similar2119boilerplate).toEqual(true)
  })
})

describe('Parsing author address', () => {
  test('Parsing author address', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${authorAddressTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.content.authorAddress).toEqual(expect.arrayContaining([expect.stringContaining('Authors\' Addresses')]))
  })

  test('Parsing author address with invalid character', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      Authors‘ Addresses
    `

    const result = await parse(txt, 'txt')
    expect(result.data.content.authorAddress).toEqual(expect.arrayContaining([expect.stringContaining('Authors‘ Addresses')]))
  })
})

describe('Parsing obsolete and update metadata', () => {
  test('Parsing obsolete metadata', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.obsoletesRfc).toEqual(['5678', '1234', '2345', '3456'])
    expect(result.data.extractedElements.updatesRfc).toEqual(['6789', '7890', '8901', '9012'])
  })

  test('Parsing tetxt without obsolete and update metadata', async () => {
    const txt = `
      ${metaWithoutObsoleteAndUpdatesTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.obsoletesRfc).toHaveLength(0)
    expect(result.data.extractedElements.updatesRfc).toHaveLength(0)
  })

  test('Locates the RFCs a document updates in its header', async () => {
    // From draft-ietf-6man-slaac-renum-14
    const txt = `IPv6 Maintenance (6man) Working Group                            F. Gont
Internet-Draft                                              SI6 Networks
Updates: 4191, 4861, 4862, 8106, 9096, 8781,                     J. Zorz
         9463 (if approved)                                     6connect
Intended status: Standards Track                            R. Patterson
Expires: 6 January 2027                                           Sky UK
                                                             5 July 2026
`

    const result = await parse(txt, 'txt')
    // The list wraps past the second author, the number on the next line still part of it
    expect(result.data.extractedElements.updatesRfc).toEqual(['4191', '4861', '4862', '8106', '9096', '8781', '9463'])
    expect(result.data.extractedElements.locations.updatesRfc).toEqual({
      4191: [{ line: 3, pos: 10 }],
      4861: [{ line: 3, pos: 16 }],
      4862: [{ line: 3, pos: 22 }],
      8106: [{ line: 3, pos: 28 }],
      9096: [{ line: 3, pos: 34 }],
      8781: [{ line: 3, pos: 40 }],
      9463: [{ line: 4, pos: 10 }]
    })
  })

  test('Ends the list of RFCs a document updates at its left column', async () => {
    // From draft-dekok-protocol-error-01
    const txt = `RADEXT Working Group                                            A. DeKok
Internet-Draft                                        InkBridge Networks
Updates: 2865, 2866, 5176, 6613, 6614, 7360,                 3 July 2026
         7930 (if approved)
Intended status: Best Current Practice
Expires: 4 January 2027
`

    const result = await parse(txt, 'txt')
    // The day of the date in the right column is no RFC
    expect(result.data.extractedElements.updatesRfc).toEqual(['2865', '2866', '5176', '6613', '6614', '7360', '7930'])
    expect(result.data.extractedElements.locations.updatesRfc['7360']).toEqual([{ line: 3, pos: 40 }])
    expect(result.data.extractedElements.locations.updatesRfc['7930']).toEqual([{ line: 4, pos: 10 }])
  })

  test('Ends the list of RFCs a document obsoletes at the next header field', async () => {
    // From draft-ietf-procon-2026bis-11
    const txt = `procon                                                           R. Salz
Internet-Draft                                       Akamai Technologies
Obsoletes: 2026, 5657, 6410, 7100, 7127, 8789,                S. Bradner
           9282 (if approved)               Harvard University (retired)
Updates: 7475 (if approved)                                  1 July 2026
Intended status: Best Current Practice
Expires: 2 January 2027
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.obsoletesRfc).toEqual(['2026', '5657', '6410', '7100', '7127', '8789', '9282'])
    expect(result.data.extractedElements.updatesRfc).toEqual(['7475'])
    expect(result.data.extractedElements.locations.obsoletesRfc['9282']).toEqual([{ line: 4, pos: 12 }])
    expect(result.data.extractedElements.locations.updatesRfc).toEqual({ 7475: [{ line: 5, pos: 10 }] })
  })
})

describe('Parsing Category and Intended Status from document header', () => {
  test('Parses Category correctly', async () => {
    const txt = `
      ${metaTXTBlock.replace('Intended status: Standards Track', 'Category: Standards Track')}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${textWithRFC2119KeywordsTXTBlock}
    `

    const result = await parse(txt, 'test-document.txt')
    expect(result.data.header.category).toBe('Standards Track')
  })

  test('Parses Intended Status correctly', async () => {
    const txt = `
      ${metaTXTBlock.replace('Intended status: Standards Track', 'Intended status: Experimental')}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${textWithRFC2119KeywordsTXTBlock}
    `

    const result = await parse(txt, 'test-document.txt')
    expect(result.data.header.intendedStatus).toBe('Experimental')
  })

  test('Handles missing status or category', async () => {
    const txt = `
      ${metaTXTBlock.replace('Intended status: Standards Track', '')}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${textWithRFC2119KeywordsTXTBlock}
    `

    const result = await parse(txt, 'test-document.txt')
    expect(result.data.header.category).toBeUndefined()
  })

  test('Handles Unknown Intended status', async () => {
    const txt = `
      ${metaTXTBlock.replace('Standards Track', 'Unknown')}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${textWithRFC2119KeywordsTXTBlock}
    `

    const result = await parse(txt, 'test-document.txt')
    expect(result.data.header.intendedStatus).toBe('Unknown')
  })
})

describe('Parsing references with categorization', () => {
  test('Correctly categorizes normative and informative RFC references', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      7. References
      7.1. Normative References
      [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, DOI 10.17487/RFC2119, March 1997.
      [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, DOI 10.17487/RFC8174, May 2017.
      7.2. Informative References
      [RFC3552] Rescorla, E., "Guidelines for Writing RFC Text on Security Considerations", BCP 72, RFC 3552, DOI 10.17487/RFC3552, July 2003.
      [RFC7322] Flanagan, H., "RFC Style Guide", RFC 7322, DOI 10.17487/RFC7322, September 2014.
    `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.referenceSectionRfc).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: '2119', subsection: 'normative_references' }),
        expect.objectContaining({ value: '8174', subsection: 'normative_references' }),
        expect.objectContaining({ value: '3552', subsection: 'informative_references' }),
        expect.objectContaining({ value: '7322', subsection: 'informative_references' })
      ])
    )
  })

  test('Detects references that are not categorized as normative or informative', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      7. References
      [RFC5234] Crocker, D., "Augmented BNF for Syntax Specifications: ABNF", RFC 5234, January 2008.
      [RFC8446] Rescorla, E., "The Transport Layer Security (TLS) Protocol Version 1.3", RFC 8446, August 2018.
    `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.referenceSectionRfc).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: '5234', subsection: null }),
        expect.objectContaining({ value: '8446', subsection: null })
      ])
    )
  })

  test('Parses text without reference section correctly', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.referenceSectionRfc).toHaveLength(0)
    expect(result.data.extractedElements.referenceSectionDraftReferences).toHaveLength(0)
  })

  test('Detects unclassified references in reference section', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      7. References
      7.1. Additional References
      [RFC5234] Crocker, D., "Augmented BNF for Syntax Specifications: ABNF", RFC 5234, January 2008.
      [RFC8446] Rescorla, E., "TLS 1.3", RFC 8446, August 2018.
    `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.bracketedRfcReferences).toEqual(
      expect.arrayContaining(['[RFC5234]', '[RFC8446]'])
    )
    expect(result.data.extractedElements.bracketedRfcReferences).toHaveLength(2)
  })

  test('Parses references in all text with square brackets', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      7. References
      7.1. Miscellaneous References
   [I-D.ietf-bess-evpn-igmp-mld-proxy]
              Sajassi, A., Thoria, S., Mishra, M. P., Drake, J., and W.
              Lin, "Internet Group Management Protocol (IGMP) and
              Multicast Listener Discovery (MLD) Proxies for Ethernet
              VPN (EVPN)", Work in Progress, Internet-Draft,draft-ietf
              bess-evpn-igmp-mld-proxy-21, 22 March 2022,
              <https://datatracker.ietf.org/doc/html/draft-ietf-bess-
              evpn-igmp-mld-proxy-21>.

   [I-D.ietf-bess-bgp-multicast-controller]
              Zhang, Z. J., Raszuk, R., Pacella, D., and A. Gulko,
              "Controller Based BGP Multicast Signaling", Work in
              Progress, Internet-Draft, draft-ietf-bess-bgp-multicast
              controller-09, 11 April 2022,
              <https://datatracker.ietf.org/doc/html/draft-ietf-bess-
              bgp-multicast-controller-09>.
    `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.draftStatusReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'draft-ietf-bess-evpn-igmp-mld-proxy-21', subsection: 'unclassified_references' }),
        expect.objectContaining({ value: 'draft-ietf-bess-bgp-multicast-controller-09', subsection: 'unclassified_references' })
      ])
    )
  })

  test('Parses reference section without categorization', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      7. References
      [RFC9110] Fielding, R., "HTTP Semantics", RFC 9110, June 2022.
      [RFC9205] Kucherawy, M., "The Use of the Require-Recipient-Valid-Since Header Field in Email", RFC 9205, September 2022.
    `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.referenceSectionRfc).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: '9110', subsection: null }),
        expect.objectContaining({ value: '9205', subsection: null })
      ])
    )
  })

  test('Should parse bare reference section', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      References
      [RFC1234] Example, E., "Example RFC", RFC 1234, January 2023.
    `

    const result = await parse(txt, 'txt')

    expect(result.data.markers.references.start).toBeTruthy()
  })

  test('Parses reference with square brackets', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      7. References
      [RFC5234] Crocker, D., "Augmented BNF for Syntax Specifications: ABNF", RFC 5234, January 2008.
      [RFC8446] Rescorla, E., "The Transport Layer Security (TLS) Protocol Version 1.3", RFC 8446, August 2018.
    `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.bracketedRfcReferences).toEqual(
      expect.arrayContaining(['[RFC5234]', '[RFC8446]'])
    )
    expect(result.data.extractedElements.bracketedRfcReferences).toHaveLength(2)
  })

  test('Parses references in all text with square brackets', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      [RFC1234]
    `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.bracketedRfcNonReferences).toEqual(
      expect.arrayContaining(['[RFC1234]'])
    )
    expect(result.data.extractedElements.bracketedRfcNonReferences).toHaveLength(1)
  })

  test('Parser should mark references in appendix section as used references in text', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      4. References
      [RFC1234] Example reference

      Appendix A. Additional Information
      [RFC1234] Example reference in appendix
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionRfc).toEqual(
      expect.arrayContaining(['1234'])
    )
  })

  // From draft-abinabraham-vrrp-unicast-03
  test('Classifies references in top-level Normative and Informative References sections', async () => {
    const txt = `${metaTXTBlock}
13.  Acknowledgements

   The authors thank Acee Lindem for his work on RFC 9568 and draft-
   ietf-rtgwg-vrrp-rfc8347bis, which provide the foundation for this
   extension, and for comments that clarified the underlying link model
   during the presentation at IETF 126.

14.  Normative References

   [RFC2119]  Bradner, S., "Key words for use in RFCs to Indicate
              Requirement Levels", BCP 14, RFC 2119,
              DOI 10.17487/RFC2119, March 1997,
              <https://www.rfc-editor.org/info/rfc2119>.

   [RFC9568]  Lindem, A. and A. Dogra, "Virtual Router Redundancy
              Protocol (VRRP) Version 3 for IPv4 and IPv6", RFC 9568,
              DOI 10.17487/RFC9568, April 2024,
              <https://www.rfc-editor.org/info/rfc9568>.

15.  Informative References

   [I-D.ietf-rtgwg-vrrp-rfc8347bis]
              Lindem, A., "A YANG Data Model for the Virtual Router
              Redundancy Protocol (VRRP)", Work in Progress, Internet-
              Draft, draft-ietf-rtgwg-vrrp-rfc8347bis-15, 13 February
              2026, <https://datatracker.ietf.org/doc/draft-ietf-rtgwg-
              vrrp-rfc8347bis/>.

   [RFC7942]  Sheffer, Y. and A. Farrel, "Improving Awareness of Running
              Code: The Implementation Status Section", BCP 205,
              RFC 7942, DOI 10.17487/RFC7942, July 2016,
              <https://www.rfc-editor.org/info/rfc7942>.



Dogra, et al.             Expires 15 March 2027                [Page 12]
\f
Internet-Draft                Unicast VRRP                September 2026


   [RFC8347]  Liu, X., Ed., Kyparlis, A., Parikh, R., Lindem, A., and M.
              Zhang, "A YANG Data Model for the Virtual Router
              Redundancy Protocol (VRRP)", RFC 8347,
              DOI 10.17487/RFC8347, March 2018,
              <https://www.rfc-editor.org/info/rfc8347>.

Authors' Addresses

   Aditya Dogra
   Cisco Systems
   Email: addogra@cisco.com
`

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.referenceSectionRfc).toEqual([
      { value: '2119', subsection: 'normative_references' },
      { value: '9568', subsection: 'normative_references' },
      { value: '7942', subsection: 'informative_references' },
      { value: '8347', subsection: 'informative_references' }
    ])
    expect(result.data.extractedElements.draftStatusReferences).toEqual([
      { value: 'draft-ietf-rtgwg-vrrp-rfc8347bis', subsection: 'informative_references' }
    ])
    expect(result.data.extractedElements.nonReferenceSectionRfc).toContain('9568')
  })

  // From draft-wkumari-not-a-draft-26
  test('Classifies references in an unnumbered Normative References section following an appendix', async () => {
    const txt = `${metaTXTBlock}
   Note that feline intervention may cause significant packet loss when
   utilizing [RFC1149].  This may be mitigated using [RFC2549].

7.  Acknowledgements

   The author wishes to thank the ancient elders of Zorb for explaining
   this history to him.

Appendix A.  Changes / Author Notes.

   {RFC Editor: Please remove this section before publication }

   From -00 to -01.

   *  Integrated comments from Erik Muller (who, apparently, is a true
      believer).  Erik also provided updated Security Considerations
      text, referencing the IANA.

Normative References

   [RFC1149]  Waitzman, D., "Standard for the transmission of IP
              datagrams on avian carriers", RFC 1149,
              DOI 10.17487/RFC1149, April 1990,
              <https://www.rfc-editor.org/rfc/rfc1149>.

   [RFC2549]  Waitzman, D., "IP over Avian Carriers with Quality of
              Service", RFC 2549, DOI 10.17487/RFC2549, April 1999,
              <https://www.rfc-editor.org/rfc/rfc2549>.

Author's Address

   Warren Kumari
   Email: warren@kumari.net
`

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.referenceSectionRfc).toEqual([
      { value: '1149', subsection: 'normative_references' },
      { value: '2549', subsection: 'normative_references' }
    ])
  })

  // From draft-ietf-spring-sr-policy-group-01
  test('Classifies references in subsections numbered without a trailing dot', async () => {
    const txt = `${metaTXTBlock}
11. Security Considerations

   This document does not introduce any security considerations.

12. References

12.1 Normative References

   [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate
             Requirement Levels", BCP 14, RFC 2119, DOI
             10.17487/RFC2119, March 1997, <https://www.rfc-
             editor.org/info/rfc2119>.

   [RFC8402] Filsfils, C., Ed., Previdi, S., Ed., Ginsberg, L.,
             Decraene, B., Litkowski, S., and R. Shakir, "Segment
             Routing Architecture", RFC 8402, DOI 10.17487/RFC8402,
             July 2018, <https://www.rfc-editor.org/info/rfc8402>.

12.2 Informative References

   [RFC7942] Sheffer, Y. and A. Farrel, "Improving Awareness of Running
             Code: The Implementation Status Section", BCP 205, RFC
             7942, DOI 10.17487/RFC7942, July 2016, <https://www.rfc-
             editor.org/info/rfc7942>.
`

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.referenceSectionRfc).toEqual([
      { value: '2119', subsection: 'normative_references' },
      { value: '8402', subsection: 'normative_references' },
      { value: '7942', subsection: 'informative_references' }
    ])
  })
})

describe('Parsing the entries of the references section', () => {
  const entry = (value, subsection, cites = {}) => ({ value, subsection, rfcs: [], bcps: [], stds: [], drafts: [], external: false, ...cites })

  // From draft-rosomakho-tls-cert-update-02
  test('Splits each subsection into entries, located at their label, across a page break', async () => {
    const txt = `${metaTXTBlock}
10.  References

10.1.  Normative References

   [DTLS]     Rescorla, E., Tschofenig, H., and N. Modadugu, "The
              Datagram Transport Layer Security (DTLS) Protocol Version
              1.3", RFC 9147, DOI 10.17487/RFC9147, April 2022,
              <https://www.rfc-editor.org/rfc/rfc9147>.

   [EXPORTED-AUTH]
              Sullivan, N., "Exported Authenticators in TLS", RFC 9261,
              DOI 10.17487/RFC9261, July 2022,
              <https://www.rfc-editor.org/rfc/rfc9261>.

   [RFC2119]  Bradner, S., "Key words for use in RFCs to Indicate
              Requirement Levels", BCP 14, RFC 2119,
              DOI 10.17487/RFC2119, March 1997,
              <https://www.rfc-editor.org/rfc/rfc2119>.




Rosomakho & Reddy       Expires 20 December 2026               [Page 13]

Internet-Draft        Certificate Update in TLS 1.3            June 2026


   [RFC8174]  Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC
              2119 Key Words", BCP 14, RFC 8174, DOI 10.17487/RFC8174,
              May 2017, <https://www.rfc-editor.org/rfc/rfc8174>.

   [TLS]      Rescorla, E., "The Transport Layer Security (TLS) Protocol
              Version 1.3", RFC 8446, DOI 10.17487/RFC8446, August 2018,
              <https://www.rfc-editor.org/rfc/rfc8446>.

10.2.  Informative References

   [QUIC]     Iyengar, J., Ed. and M. Thomson, Ed., "QUIC: A UDP-Based
              Multiplexed and Secure Transport", RFC 9000,
              DOI 10.17487/RFC9000, May 2021,
              <https://www.rfc-editor.org/rfc/rfc9000>.
`

    const result = await parse(txt, 'txt')
    const lineOf = (text) => txt.split('\n').findIndex((line) => line.startsWith(`   ${text}`)) + 1

    // -> RFCs cited under another label are found ([TLS] is RFC 8446), and an RFC named in a title is not cited
    expect(result.data.extractedElements.referenceEntries).toEqual([
      entry('[DTLS]', 'normative_references', { rfcs: ['9147'] }),
      entry('[EXPORTED-AUTH]', 'normative_references', { rfcs: ['9261'] }),
      entry('[RFC2119]', 'normative_references', { rfcs: ['2119'], bcps: ['14'] }),
      entry('[RFC8174]', 'normative_references', { rfcs: ['8174'], bcps: ['14'] }),
      entry('[TLS]', 'normative_references', { rfcs: ['8446'] }),
      entry('[QUIC]', 'informative_references', { rfcs: ['9000'] })
    ])
    for (const label of ['[DTLS]', '[EXPORTED-AUTH]', '[RFC8174]', '[TLS]', '[QUIC]']) {
      expect(getLocations(result, 'referenceEntries', label)).toEqual([{ line: lineOf(label), pos: 4 }])
    }
  })

  // From draft-bokovoy-kitten-pkinit-pqc-02 and draft-abak-ai-evaluation-claim-preservation-00
  test('Finds the Internet-Drafts and BCPs entries cite, and the entries that cite none of these nor an RFC', async () => {
    const txt = `${metaTXTBlock}
17.  References

17.1.  Normative References

   [BCP14]    Best Current Practice 14,
              <https://www.rfc-editor.org/info/bcp14>.
              At the time of writing, this BCP comprises the following:

              Bradner, S., "Key words for use in RFCs to Indicate
              Requirement Levels", BCP 14, RFC 2119,
              DOI 10.17487/RFC2119, March 1997,
              <https://www.rfc-editor.org/info/rfc2119>.

              Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC
              2119 Key Words", BCP 14, RFC 8174, DOI 10.17487/RFC8174,
              May 2017, <https://www.rfc-editor.org/info/rfc8174>.

   [FIPS203]  National Institute of Standards and Technology (NIST),
              "Module-Lattice-Based Key-Encapsulation Mechanism
              Standard", FIPS PUB 203, August 2024,
              <https://doi.org/10.6028/NIST.FIPS.203>.

   [I-D.ietf-lamps-pq-composite-kem]
              Ounsworth, M., Gray, J., Pala, M., Klaußner, J., and S.
              Fluhrer, "Composite ML-KEM for use in X.509 Public Key
              Infrastructure", Work in Progress, Internet-Draft, draft-
              ietf-lamps-pq-composite-kem-21, 1 September 2026,
              <https://datatracker.ietf.org/doc/html/draft-ietf-lamps-
              pq-composite-kem-21>.

   [RFC5652]  Housley, R., "Cryptographic Message Syntax (CMS)", STD 70,
              RFC 5652, DOI 10.17487/RFC5652, September 2009,
              <https://www.rfc-editor.org/rfc/rfc5652>.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.referenceEntries).toEqual([
      entry('[BCP14]', 'normative_references', { rfcs: ['2119', '8174'], bcps: ['14'] }),
      entry('[FIPS203]', 'normative_references', { external: true }),
      entry('[I-D.ietf-lamps-pq-composite-kem]', 'normative_references', { drafts: ['draft-ietf-lamps-pq-composite-kem-21'] }),
      entry('[RFC5652]', 'normative_references', { rfcs: ['5652'], stds: ['70'] })
    ])
  })

  // From draft-ietf-ccamp-layer1-types-20 and draft-wkumari-opsawg-json-geofeed-format-01
  test('Finds no RFC in a name, of a draft or in a URL, nor in a title', async () => {
    const txt = `${metaTXTBlock}
12.  References

12.1.  Normative References

   [I-D.ietf-teas-rfc8776-update]
              Busi, I., Guo, A., Liu, X., Saad, T., and I. Bryskin,
              "Common YANG Data Types for Traffic Engineering", Work in
              Progress, Internet-Draft, draft-ietf-teas-rfc8776-update-
              24, 12 June 2026, <https://datatracker.ietf.org/doc/html/
              draft-ietf-teas-rfc8776-update-24>.

   [KLINE-GEO]
              Kline, E., "Anecdotal History of RFC 8805", November 2025,
              <https://www.ietf.org/slides/slides-ipgeows-paper-
              anecdotal-history-of-rfc-00.pdf>.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.referenceEntries).toEqual([
      entry('[I-D.ietf-teas-rfc8776-update]', 'normative_references', { drafts: ['draft-ietf-teas-rfc8776-update-24'] }),
      entry('[KLINE-GEO]', 'normative_references', { external: true })
    ])
  })

  // From draft-dnoveck-nfsv4-rfc5662bis-08
  test('Takes numeric labels as any other', async () => {
    const txt = `${metaTXTBlock}
6.  Normative References

   [1]        Bradner, S., "Key words for use in RFCs to Indicate
              Requirement Levels", BCP 14, RFC 2119, March 1997,
              <https://www.rfc-editor.org/rfc/rfc2119>.

   [2]        IETF Trust, "Legal Provisions Relating to IETF Documents",
              November 2008.

   [3]        Eisler, M., "XDR: External Data Representation Standard",
              STD 67, RFC 4506, May 2006,
              <https://www.rfc-editor.org/rfc/rfc4506>.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.referenceEntries).toEqual([
      entry('[1]', 'normative_references', { rfcs: ['2119'], bcps: ['14'] }),
      entry('[2]', 'normative_references', { external: true }),
      entry('[3]', 'normative_references', { rfcs: ['4506'], stds: ['67'] })
    ])
  })

  // From draft-sharif-attp-01
  test('Takes the label of a bulleted entry', async () => {
    const txt = `${metaTXTBlock}
17.  References

17.1.  Normative References

   *  [FIPS186-5] National Institute of Standards and Technology,
      "Digital Signature Standard (DSS)", FIPS PUB 186-5, 2023.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.referenceEntries).toEqual([
      entry('[FIPS186-5]', 'normative_references', { external: true })
    ])
    expect(getLocations(result, 'referenceEntries', '[FIPS186-5]')).toEqual([{ line: txt.split('\n').findIndex((line) => line.includes('[FIPS186-5]')) + 1, pos: 7 }])
  })

  // From draft-abak-agent-control-delivery-evidence-01
  test('Ends the entries at text to the left of their labels, such as an unnumbered appendix', async () => {
    const txt = `${metaTXTBlock}
14.  References

14.1.  Normative References

   [SCHROCK-FIXTURE-MSG]
              Schrock, I., "SCITT review: proposed freeze-race and
              multi-target control-delivery fixture", SCITT mailing-list
              message, 31 August 2026,
              <https://mailarchive.ietf.org/arch/msg/scitt/
              YcoTPgdpSl2RNWvcsB1p3c4VpAM/>.

Contributed Freeze-Race Fixture Summary

   This appendix summarizes the proposed format-neutral fixture
   contributed by Iman Schrock of EMILIA Protocol in
   [SCHROCK-FIXTURE-MSG].  The fixture identifier and SHA-256 are
   preserved for provenance.

   [RFC9943] is not an entry either.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.referenceEntries).toEqual([
      entry('[SCHROCK-FIXTURE-MSG]', 'normative_references', { external: true })
    ])
  })

  // From draft-ietf-nfsv4-internationalization-17
  test('Keeps the section going past a wrapped line of an entry that starts with a year', async () => {
    const txt = `${metaTXTBlock}
15.  References

15.1.  Normative References

   [RFC8881]  Noveck, D., Ed. and C. Lever, "Network File System (NFS)
              Version 4 Minor Version 1 Protocol", RFC 8881,
              DOI 10.17487/RFC8881, August 2020,
              <https://www.rfc-editor.org/info/rfc8881>.

   [UNICODE]  The Unicode Consortium, "The Unicode Standard, Version
              17.0.0", (South San Francisco: The Unicode Consortium,
              2025. ISBN 978-1-936213-15-1), September 2025,
              <http://www.unicode.org/versions/Unicode17.0.0/>.

   [UNICODE-CASEF]
              The Unicode Consortium, "CaseFolding-17.0.0.txt", (South
              San Franciso: The Unicode Consortium, 2024 ISBN
              978-1-936213-26-9), July 2025,
              <https://www.unicode.org/Public/17.0.0/ucd/
              CaseFolding.txt>.

15.2.  Informative References

   [RFC6943]  Thaler, D., Ed., "Issues in Identifier Comparison for
              Security Purposes", RFC 6943, DOI 10.17487/RFC6943, May
              2013, <https://www.rfc-editor.org/info/rfc6943>.
`

    const result = await parse(txt, 'txt')
    const lines = txt.split('\n')
    // -> "2025. ISBN ..." continues [UNICODE]: the entries after it, and the next subsection, are still references
    expect(result.data.markers.references.end).toBe(lines.length)
    expect(result.data.extractedElements.referenceEntries).toEqual([
      entry('[RFC8881]', 'normative_references', { rfcs: ['8881'] }),
      entry('[UNICODE]', 'normative_references', { external: true }),
      entry('[UNICODE-CASEF]', 'normative_references', { external: true }),
      entry('[RFC6943]', 'informative_references', { rfcs: ['6943'] })
    ])
    expect(result.data.extractedElements.referenceSectionDraftReferences.map((el) => el.value)).toContain('[UNICODE-CASEF]')
    expect(result.data.extractedElements.referenceSectionRfc.map((el) => el.value)).toContain('6943')
  })

  // From draft-gueron-cfrg-dndkgcm-05
  test('Ends the section at the next numbered heading when the headings are indented', async () => {
    const txt = `${metaTXTBlock}
   9. References

   9.1. Normative References

  [AES]     National Institute of Standards and Technology, "Advanced
            Encryption Standard (AES)", FIPS 197, November 2001.

   9.2. Informative References

  [ADG+22]  Albertini, A., Duong, T., Gueron, S., Kolbl, S., Luykx, A.,
            Schmieg, S., "How to Abuse and Fix Authenticated Encryption
            Without Key Commitment", in Proceedings of the 31st USENIX
            Security Symposium (USENIX Security 22), pp. 3291-3308,
            2022. [Online]. Available:
            https://www.usenix.org/system/files/usenixsecurity22-
            albertini.pdf

  [DGRW18]  Dodis, J., Grubbs, P., Ristenpart, T., Woodage, J., "Fast
            Message Franking: From Invisible Salamanders to
            Encryptment", CRYPTO 2018, Proceedings, Part I, Lecture
            Notes in Computer Science, vol. 10991, pp. 155-186,
            Springer, 2018. [Online]. Available:
            https://doi.org/10.1007/978-3-319-96884-1_6

   10. Acknowledgments

   The author would like to thank Jean Paul Degabriele, Gerald Doussot,
`

    const result = await parse(txt, 'txt')
    const lines = txt.split('\n')
    expect(result.data.markers.references.start).toBe(lines.indexOf('   9. References') + 1)
    expect(result.data.markers.references.end).toBe(lines.indexOf('   10. Acknowledgments'))
    expect(result.data.content.references).not.toContain('10. Acknowledgments')
    expect(result.data.extractedElements.referenceEntries).toEqual([
      entry('[AES]', 'normative_references', { external: true }),
      entry('[ADG+22]', 'informative_references', { external: true }),
      entry('[DGRW18]', 'informative_references', { external: true })
    ])
  })

  // From draft-gueron-cfrg-dndkgcm-05
  test('Declares only the labels starting an entry, not bracketed text starting a wrapped line of one', async () => {
    const txt = `${metaTXTBlock}
   1. Introduction

   b) Reusing vetted and optimized AES-GCM implementations to leverage
     existing hardware instructions (e.g., AES-NI [Gue10] and PCLMULQDQ
     [GK08]).

   9. References

   9.2. Informative References

  [Gue10]   Gueron, S., "Intel Advanced Encryption Standard (AES)
            Instructions Set", Intel White Paper, Rev. 3, 1-94, 2010.
            [Online]. Available:
            https://www.intel.com/content/dam/doc/white-paper/advanced-
            encryption-standard-new-instructions-set-paper.pdf

  [GK08]    Gueron, S., Kounavis, M., "Carry-Less Multiplication and
            Its Usage for Computing the GCM Mode", Intel White Paper,
            Rev. 2.02, 1-84, 2014. [Online]. Available:
            https://www.intel.com/content/dam/develop/external/us/en/do
            cuments/clmul-wp-rev-2-02-2014-04-20.pdf
`

    const result = await parse(txt, 'txt')
    const lineOf = (text) => txt.split('\n').findIndex((line) => line.startsWith(`  ${text}`)) + 1
    expect(result.data.extractedElements.referenceSectionDraftReferences).toEqual([
      { value: '[Gue10]', subsection: 'informative_references' },
      { value: '[GK08]', subsection: 'informative_references' }
    ])
    expect(getLocations(result, 'referenceSectionDraftReferences', '[Gue10]')).toEqual([{ line: lineOf('[Gue10]'), pos: 3 }])
    expect(getLocations(result, 'referenceSectionDraftReferences', '[Online]')).toEqual([])
    expect(await validateReferencesInText(result)).toEqual([])
  })

  // From draft-dunbar-dmsc-gw-scenarios-gap-analysis-04
  test('Takes the entries after a running header without a date', async () => {
    const txt = `${metaTXTBlock}
11. References

11.1. Normative References

   [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate
             Requirement Levels", BCP 14, RFC 2119, March 1997.


11.2. Informative References

   [MCP]      Model Context Protocol, "Model Context Protocol
             Specification",
             https://modelcontextprotocol.io/specification/


Dunbar, et al.           Expires Dec 14, 2027           [Page 35]
\f
Internet-Draft          GW Deployment Scenario


   [CAID] Schrock, I., "The Canonical Action Identifier (CAID)",
             draft-schrock-canonical-action-identifier-02,
             August 2026, work in progress.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.referenceEntries.map((el) => el.value)).toEqual(['[RFC2119]', '[MCP]', '[CAID]'])
    expect(result.data.extractedElements.referenceSectionDraftReferences.map((el) => el.value)).toEqual(['[MCP]', '[CAID]'])
  })
})

describe('License validation for documents containing code blocks', () => {
  test('Detects Revised BSD License declaration in a document with code blocks', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      <CODE BEGINS>
      console.log('Hello, world!');
      <CODE ENDS>
      ${securityConsiderationsTXTBlock}
      This document is subject to BCP 78 and the IETF Trust's Legal Provisions Relating to IETF Documents (https://trustee.ietf.org/license-info) in effect on the date of publication of this document.
      Code Components extracted from this document must include Revised BSD License text as described in Section 4.e of the Trust Legal Provisions and are provided without warranty as described in the Revised BSD License.
    `

    const result = await parse(txt, 'txt')

    expect(result.data.contains.codeBlocks).toBe(true)
    expect(result.data.contains.revisedBsdLicense).toBe(true)
  })

  test('Detects missing Revised BSD License declaration in a document with code blocks', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      <CODE BEGINS>
      console.log('Hello, world!');
      <CODE ENDS>
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')

    expect(result.data.contains.codeBlocks).toBe(true)
    expect(result.data.contains.revisedBsdLicense).toBe(false)
  })

  test('Detects document with license declaration but without code blocks', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      This document is subject to BCP 78 and the IETF Trust's Legal Provisions Relating to IETF Documents (https://trustee.ietf.org/license-info) in effect on the date of publication of this document.
      Code Components extracted from this document must include Revised BSD License text as described in Section 4.e of the Trust Legal Provisions and are provided without warranty as described in the Revised BSD License.
    `

    const result = await parse(txt, 'txt')

    expect(result.data.contains.codeBlocks).toBe(false)
    expect(result.data.contains.revisedBsdLicense).toBe(true)
  })

  test('Detects document without license declaration and without code blocks', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')

    expect(result.data.contains.codeBlocks).toBe(false)
    expect(result.data.contains.revisedBsdLicense).toBe(false)
  })
})

describe('Parsing document intended status', () => {
  test('Correctly extracts intended document status', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'test.txt')
    expect(result.data.header.intendedStatus).toBe('Standards Track')
  })

  test('Handles INVALID document status', async () => {
    const txt = `
      ${metaTXTBlock.replace('Intended status: Standards Track', 'Category: InvalidStatus')}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'test.txt')
    expect(result.data.header.category).toBe('InvalidStatus')
  })

  test('Handles incorrect document status', async () => {
    const txt = `
      ${metaTXTBlock.replace('Intended status: Standards Track', 'Category: Standards Track')}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'test.txt')
    expect(result.data.header.category).toBe('Standards Track')
  })
})

describe('Parsing document date', () => {
  test('Parses document date after a blank line in the header', async () => {
    // draft-acee-idr-lldp-peer-discovery-22: the right column carries on after a whitespace-only line
    const result = await parse(`
Network Working Group                                          A. Lindem
Internet-Draft                                                  K. Patel
Intended status: Standards Track                             Arrcus, Inc
Expires: 17 December 2026                                       S. Zandi
${' '.repeat(72)}
                                                                 J. Haas
                                                                     HPE
                                                                   X. Xu
                                                            China Mobile
                                                            15 June 2026


       BGP Logical Link Discovery Protocol (LLDP) Peer Discovery
                 draft-acee-idr-lldp-peer-discovery-22

Abstract
`, 'txt')

    expect(result.data.header.date).toEqual({ day: 15, month: 'June', year: 2026 })
    expect(result.data.header.authors.map(author => author.name)).toEqual(['A. Lindem', 'K. Patel', 'S. Zandi', 'J. Haas', 'X. Xu'])
    expect(result.data.title).toBe('BGP Logical Link Discovery Protocol (LLDP) Peer Discovery')
  })

  test('Ends the header at a title that starts like a header field', async () => {
    // draft-dnsop-rfc6303-bis-03
    const result = await parse(`
DNSOP                                                   T. Wicinski, Ed.
Internet-Draft                                               6 July 2026
Obsoletes: 9818 (if approved)
Updates: 6603, 6890 (if approved)
Intended status: Best Current Practice
Expires: 7 January 2027


Updates to Locally Served DNS Zones and IP Special-Purpose Address Space
                               Registries
                       draft-dnsop-rfc6303-bis-03

Abstract
`, 'txt')

    expect(result.data.header.date).toEqual({ day: 6, month: 'July', year: 2026 })
    expect(result.data.title).toBe('Updates to Locally Served DNS Zones and IP Special-Purpose Address Space')
  })

  test('Parses document date correctly', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')

    expect(result.data.header.date).toEqual(expect.objectContaining({ day: 21, month: 'January', year: 2025 }))
  })

  test('Parses date with missing day (day becomes NaN)', async () => {
    const metaBlock = `
Source   A. Author
January 2025
Title of Document
`
    const txt = `
      ${metaBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `
    const result = await parse(txt, 'test-doc.txt')
    expect(result.data.header.date.month).toEqual('January')
    expect(result.data.header.date.year).toEqual(2025)
    expect(isNaN(result.data.header.date.day)).toBe(true)
  })

  test('Parses valid date from header left part correctly', async () => {
    const metaBlock = `
Source   A. Author
21 January 2025
Title of Document
`
    const txt = `
      ${metaBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `
    const result = await parse(txt, 'test-doc.txt')
    expect(result.data.header.date).toEqual({ day: 21, month: 'January', year: 2025 })
  })

  test('Returns null if date string is invalid', async () => {
    const metaBlock = `
Source   A. Author
Invalid Date
Title of Document
`
    const txt = `
      ${metaBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `
    const result = await parse(txt, 'test-doc.txt')
    expect(result.data.header.date).toBeNull()
  })
})

describe('Parsing IANA considerations section', () => {
  test('Parses IANA considerations section correctly', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${textWithRFC2119KeywordsTXTBlock}
      ${ianaConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'test-document.txt')

    expect(result.data.content.ianaConsiderations).toEqual(expect.arrayContaining([
      '6. IANA Considerations',
      'No specific actions are required by IANA for this document.'
    ]))
  })

  test('Parses text without IANA Considerations section correctly', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')

    expect(result.data.content.ianaConsiderations).toHaveLength(0)
  })
})

describe('Parse document slug', () => {
  test('Parse document slug correctly', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.slug).toBe('draft-ietf-idr-rt-derived-community-05')
  })

  test('Parse document without slug correctly', async () => {
    const txt = `
      ${metaTXTBlock.replace('draft-ietf-idr-rt-derived-community-05', '')}
      ${tableOfContentsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.slug).toBe(null)
  })

  test('Parse document slug written with its .txt extension', async () => {
    const txt = `
      ${metaTXTBlock.replace('draft-ietf-idr-rt-derived-community-05', 'draft-ietf-idr-rt-derived-community-05.txt')}
      ${tableOfContentsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.slug).toBe('draft-ietf-idr-rt-derived-community-05')
  })

  test('Parse document slug sharing its line with other header values', async () => {
    // draft-diaz-lzip-14 and draft-dejong-remotestorage-27
    const lzip = await parse(`
Internet Engineering Task Force (IETF)                           A. Diaz
INTERNET-DRAFT  draft-diaz-lzip-14                           GNU Project
Category: Informational                                        July 2026
Expiration date: 2027-01-20


      Lzip Compressed Format and the 'application/lzip' Media Type
`, 'txt')
    expect(lzip.data.slug).toBe('draft-diaz-lzip-14')

    const remoteStorage = await parse(`
INTERNET DRAFT                                      Michiel B. de Jong
Document: draft-dejong-remotestorage-27                  (independent)
                                                             F. Kooman
                                                         (independent)
                                                              S. Kippe
Intended Status: Proposed Standard                       (independent)
Expires: 18 December 2026                                 12 June 2026


                          remoteStorage 1.0
`, 'txt')
    expect(remoteStorage.data.slug).toBe('draft-dejong-remotestorage-27')
  })

  test('Parse document slug followed by an author name on the same line', async () => {
    const txt = `
      ${metaTXTBlock.replace('draft-ietf-idr-rt-derived-community-05', 'draft-ietf-idr-rt-derived-community-05          Z. Zhang')}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.slug).toBe('draft-ietf-idr-rt-derived-community-05')
  })

  test('Parse document slug after an Obsoletes header naming an earlier draft', async () => {
    // draft-reilly-mws-01
    const result = await parse(`
Independent Submission                                 L.J. Reilly Jr.
Internet-Draft                REM Technologies & Consulting, LLC
Obsoletes: draft-reilly-mws-00 (if approved)
Intended status: Informational                           20 August 2026
Expires: 21 February 2027

      Machine-Web Symbiosis (MWS): An Architecture for Autonomous
          Agent Maintenance of Web Permanence and Integrity
                         draft-reilly-mws-01

Abstract
`, 'txt')
    expect(result.data.slug).toBe('draft-reilly-mws-01')
  })

  test('Parse document slug and title below a running header on the first line', async () => {
    // draft-coetzee-oauth-spt-txn-tokens-00
    const result = await parse(`Internet-Draft                SPT-Txn Tokens                  March 2026


OAuth Working Group (individual submission)                R. J. Coetzee
Internet-Draft                                  Violet Sky Security SEZC
Intended status: Experimental                               19 July 2026
Expires: 20 January 2027


      Transaction-Bound Authorization Tokens for Software and AI Agents
                 draft-coetzee-oauth-spt-txn-tokens-00

Abstract
`, 'txt')

    expect(result.data.slug).toBe('draft-coetzee-oauth-spt-txn-tokens-00')
    expect(result.data.title).toBe('Transaction-Bound Authorization Tokens for Software and AI Agents')
    expect(result.data.header.authors[0].name).toBe('R. J. Coetzee')
  })

  test('Parse document slug without a revision', async () => {
    const txt = `
      ${metaTXTBlock.replace('draft-ietf-idr-rt-derived-community-05', 'draft-ietf-idr-rt-derived-community.txt')}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.slug).toBe('draft-ietf-idr-rt-derived-community')
  })
})

describe('The document does not appear to be ragged-right', () => {
  test('The document appear to be ragged-right', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')

    expect(result.data.possibleIssues.linesWithSpaces).toHaveLength(0)
  })

  test('The document does not appear to be ragged-right', async () => {
    const line = 'The      translation      of      the     Test'
    const linesCount = 3

    const textBlock = Array(linesCount)
      .fill(line)
      .map((l, i) => ' '.repeat(i % 4 === 0 ? 0 : 16) + l)
      .join('\n')

    const txt = `
      ${metaTXTBlock}
      ${introductionTXTBlock}
      ${textBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.linesWithSpaces).toHaveLength(3)
    expect(result.data.possibleIssues.linesWithSpaces).toEqual(
      expect.arrayContaining([
        // (where the first run of extra spaces starts, after "The")
        expect.objectContaining({ line: 24, pos: 10 }),
        expect.objectContaining({ line: 25, pos: 20 })
      ])
    )
  })

  test.each(['Internet-Draft', 'Internet Draft', 'INTERNET-DRAFT', 'INTERNET DRAFT'])('The "%s" header line is not taken for ragged-right text', async (indicator) => {
    const txt = `
      ${metaTXTBlock.replace(/^Internet-Draft .*$/m, `${indicator}                                     individual`)}
      ${introductionTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.linesWithSpaces).toHaveLength(0)
  })
})

describe('Abstract section is numbered', () => {
  test('The abstract section is numbered', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractNumberedTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.isAbstractNumbered).toBeTruthy()
  })

  test('The abstract section is not numbered', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractTXTBlock}
    ${introductionTXTBlock}
    ${securityConsiderationsTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.isAbstractNumbered).toBeFalsy()
  })
})

describe('Document starts with PK or BM', () => {
  test('The document starts with PK', async () => {
    const txt = `PK
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.isPKorBM).toBeTruthy()
  })

  test('The document starts with BM', async () => {
    const txt = `BM
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.isPKorBM).toBeTruthy()
  })
  test('The document starts without PK and BM', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.isPKorBM).toBeFalsy()
  })
})

describe('Parsing obsolete and update metadata with some characters', () => {
  test('Parsing obsolete metadata with some characters', async () => {
    const txt = `
      ${metaObsoleteAndUpdatesHasCharactersTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')

    expect(result.data.possibleIssues.updatesRfcWithLetter).toEqual(['RFC7890', 'RFC8901'])
    expect(result.data.possibleIssues.obsoletesWithLetter).toEqual(['RFC5678', 'RFC2345', 'RFC3456'])
    expect(result.data.possibleIssues.updatesRfcWithLetter).toHaveLength(2)
    expect(result.data.possibleIssues.obsoletesWithLetter).toHaveLength(3)
  })

  test('Parsing text obsolete and update metadata without with some characters ', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.updatesRfcWithLetter).toHaveLength(0)
    expect(result.data.possibleIssues.obsoletesWithLetter).toHaveLength(0)
  })
})

describe('Parsing TLP 6.a text', () => {
  test('No TLP 6.a text', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}
    ${introductionTXTBlock}
    ${securityConsiderationsTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.submissionCompliance).toBeFalsy()
  })

  test('TLP 6.a text appears', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}
    ${introductionTXTBlock}
    ${trust28Dec2009Section6aTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.submissionCompliance).toBeTruthy()
  })
})

describe('Parsing TLP 6.a line page', () => {
  test('Parsing TLP 6.a line page on the second page', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}
    ${introductionTXTBlock}
    ${PageBlock}
    ${trust28Dec2009Section6aTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.submissionCompliancePage).toEqual(2)
  })

  test('Should detect TLP 6.a on first page', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}
    ${introductionTXTBlock}
    ${trust28Dec2009Section6aTXTBlock}
    ${PageBlock}
    ${securityConsiderationsTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.submissionCompliancePage).toEqual(1)
  })
})

describe('Parsing TLP 5.0 6.a text', () => {
  test('No TLP 5.0 6.a text', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}
    ${introductionTXTBlock}
    ${securityConsiderationsTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.submissionCompliance).toBeFalsy()
  })

  test('TLP 5.0 6.a text appears', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}
    ${introductionTXTBlock}
    ${trust28Dec2009Section6aTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.submissionCompliance).toBeTruthy()
  })
})

describe('Parsing over long pages', () => {
  test('No over long pages', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}
    ${PageBreak}
    ${introductionTXTBlock}
    ${securityConsiderationsTXTBlock}
    ${PageBreak}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.tooLongPages).toHaveLength(0)
  })

  test('Over long pages', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}

    ${introductionTXTBlock}

    ${securityConsiderationsTXTBlock}

    ${RFC2119BoilerplateTXTBlock}

    ${RFC8174BoilerplateTXTBlock}

    ${authorAddressTXTBlock}

    ${PageBreak}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.tooLongPages).toHaveLength(1)
    expect(result.data.possibleIssues.tooLongPages).toEqual([expect.objectContaining({ page: 1, lines: 81 })])
  })

  test('Several over long pages', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}

    ${introductionTXTBlock}

    ${securityConsiderationsTXTBlock}

    ${RFC2119BoilerplateTXTBlock}

    ${RFC8174BoilerplateTXTBlock}

    ${authorAddressTXTBlock}

    ${PageBreak}

    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}

    ${introductionTXTBlock}

    ${securityConsiderationsTXTBlock}

    ${RFC2119BoilerplateTXTBlock}

    ${RFC8174BoilerplateTXTBlock}

    ${authorAddressTXTBlock}

    ${PageBreak}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.tooLongPages).toHaveLength(2)
    expect(result.data.possibleIssues.tooLongPages).toEqual([expect.objectContaining({ page: 1, lines: 81 }), expect.objectContaining({ page: 2, lines: 83 })])
  })
})

describe('Reference is declared, but not used in the document', () => {
  test('Parsing declared but not used references', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${referenceTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.referenceSectionRfc).toEqual([
      expect.objectContaining({ subsection: 'normative_references', value: '4360' }),
      expect.objectContaining({ subsection: 'normative_references', value: '5701' }),
      expect.objectContaining({ subsection: 'normative_references', value: '7153' }),
      expect.objectContaining({ subsection: 'normative_references', value: '7432' }),
      expect.objectContaining({ subsection: 'normative_references', value: '2345' })
    ])
    expect(result.data.extractedElements.referenceSectionDraftReferences).toEqual([
      expect.objectContaining({ value: '[Lalalala-Refere-Sponsor]' })
    ])
    expect(result.data.extractedElements.draftStatusReferences).toEqual([
      expect.objectContaining({ value: 'draft-ietf-bess-evpn-igmp-mld-proxy-21' }),
      expect.objectContaining({ value: 'draft-ietf-bess-bgp-multicast-controller-09' })
    ])
  })

  test('Parsing references in text (only one reference)', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toContain('[1]')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toHaveLength(1)
  })

  test('Should detect used draft reference in text right after closing bracket', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      [RFC1234][IANA]

      This is a reference to a draft [draft-ietf-bess-evpn-igmp-mld-proxy-21].
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toContain('[IANA]')
  })

  test('Should not treat “[0]” in code as a draft reference', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock.replace('[1]', '')}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}

          // some code example
          function pickBest() {
              return bestVia[0];
          }
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toHaveLength(0)
  })

  test('Parsing references in text (multiple references)', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      [RFC255], [RFC256], [RFC257], [RFC258]
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      [I-D.ietf-bess-evpn-igmp-mld-proxy], [I-D.ietf-bess-bgp-multicast-controller], [I-D.ietf-idr-legacy-rtc]
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toContain('[1]', '[I-D.ietf-bess-evpn-igmp-mld-proxy]', '[I-D.ietf-bess-bgp-multicast-controller]', '[I-D.ietf-idr-legacy-rtc]')
    expect(result.data.extractedElements.nonReferenceSectionRfc).toContain('255', '256', '257', '258')
  })

  test('Parsing text without reference section', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.referenceSectionRfc).toHaveLength(0)
    expect(result.data.extractedElements.referenceSectionDraftReferences).toHaveLength(0)
  })

  // From draft-vauban-x402-pqc-receipts-01
  test('Detects a reference label cited in parentheses', async () => {
    const txt = `${metaTXTBlock}
   This document defines a two-axis post-quantum cryptographic
   discipline for x402 receipts that addresses the long-term integrity
   gap.  The first axis applies at the proof-system layer : the stark-
   vauban-pay-v1 variant of [STARK-RECEIPTS] uses Stwo Circle STARK M31
   ([STWO]), a hash-based proving system whose soundness rests on the
   collision and second-preimage resistance of cryptographic hash
   functions rather than on algebraic hardness assumptions broken by
   Shor's algorithm.

Informative References

   [STWO]     "Stwo Circle STARK Prover (StarkWare Industries)", n.d.,
              <https://github.com/starkware-libs/stwo>.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toEqual(['[STARK-RECEIPTS]', '[STWO]'])
    expect(result.data.extractedElements.referenceSectionDraftReferences).toEqual([
      { value: '[STWO]', subsection: 'informative_references' }
    ])
  })

  // From draft-aevum-agentcard-00
  test('Does not take a character class in parentheses as a reference label', async () => {
    const txt = `${metaTXTBlock}
   1.   agent_id MUST be exactly 26 characters drawn from the Crockford
        Base32 alphabet ([0-9A-HJKMNP-TV-Z]).
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).not.toContain('[0-9A-HJKMNP-TV-Z]')
  })

  // From draft-sheth-pqc-dnssec-strategy-01
  test('Detects a declared reference label attached to the preceding word', async () => {
    const txt = `${metaTXTBlock}
   Currently standardized post-quantum secure algorithms that provide
   cryptographic confidence and resilient fallback.  Examples: SLH-DSA
   in Merkle Tree Ladder (MTL) mode [I-D.harvey-cfrg-mtl-mode],
   Falcon[FALCON], XMSS[RFC8391], LMS[RFC8554].

   provide routine performance with minimal operational impact.  They
   may leverage newer but less well-established mathematical concepts.
   Examples: MAYO[MAYO], SNOVA[SNOVA].

10.  References

10.2.  Informative References

   [FALCON]   Fouque, P., Hoffstein, J., Kirchner, P., Lyubashevsky, V.,
              Pornin, T., Prest, T., Ricosset, T., Seiler, G., Whyte,
              W., and Z. Zhang, "Falcon: Fast-Fourier Lattice-based
              Compact Signatures over NTRU", 10 January 2020,
              <https://falcon-sign.info/falcon.pdf>.

   [MAYO]     Beullens, W., Campos, F., Celi, S., Hess, B., and M.
              Kannwischer, "MAYO", 5 February 2025,
              <https://pqmayo.org/assets/specs/mayo-round2.pdf>.

   [SNOVA]    Wang, L., Chou, C., Ding, J., Kuan, Y., Leegwater, J., Li,
              M., Tseng, B., Tseng, P., and C. Wang, "SNOVA Proposal for
              NISTPQC: Additional Digital Signature Schemes", 25 January
              2025, <https://csrc.nist.gov/csrc/media/Projects/pqc-dig-
              sig/documents/round-2/spec-files/snova-spec-
              round2-web.pdf>.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toEqual(['[FALCON]', '[MAYO]', '[SNOVA]'])
    expect(result.data.extractedElements.referenceSectionDraftReferences).toEqual([
      { value: '[FALCON]', subsection: 'informative_references' },
      { value: '[MAYO]', subsection: 'informative_references' },
      { value: '[SNOVA]', subsection: 'informative_references' }
    ])
  })

  // From draft-liu-cadi-01
  test('Detects a declared reference label after a closing quote', async () => {
    const txt = `${metaTXTBlock}
         is also mentioned in CISA directive "Strategy for Migrating to
         Automated Post-Quantum Cryptography Discovery and Inventory
         Tools"[CISAACDI].

10.  References

10.2.  Informative References

   [CISAACDI] "Strategy for Migrating to Automated Post-Quantum
              Cryptography Discovery and Inventory Tools", August 2024,
              <https://www.cisa.gov/sites/default/files/2024-09/
              Strategy-for-Migrating-to-Automated-PQC-Discovery-and-
              Inventory-Tools.pdf>.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toEqual(['[CISAACDI]'])
    expect(result.data.extractedElements.referenceSectionDraftReferences).toEqual([
      { value: '[CISAACDI]', subsection: 'informative_references' }
    ])
  })

  // From draft-knodel-age-arch-01
  test('Detects a declared reference label after a full stop', async () => {
    const txt = `${metaTXTBlock}
   identification process over time, which have implications for human
   rights.[UN-HRC-29-32]

9.  Informative References

   [UN-HRC-29-32]
              United Nations Human Rights Council, "Report of the Office
              of the United Nations High Commissioner for Human Rights:
              The Right to Privacy in the Digital Age", 2015,
              <https://undocs.org/A/HRC/29/32>.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toEqual(['[UN-HRC-29-32]'])
    expect(result.data.extractedElements.referenceSectionDraftReferences).toEqual([
      { value: '[UN-HRC-29-32]', subsection: 'informative_references' }
    ])
  })

  // From draft-bhatti-ilnp-tcp-udp-checksums-01
  test('Does not take an array index as a reference label', async () => {
    const txt = `${metaTXTBlock}
       s_L64 += ntohs(((uint16_t *) src_L64)[i]);
       d_L64 += ntohs(((uint16_t *) dst_L64)[i]);
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).not.toContain('[i]')
  })

  // From draft-aiendpoint-ai-discovery-01
  test('Does not take a character class after an anchor as a reference label', async () => {
    const txt = `${metaTXTBlock}
      expression ^[a-z][a-z0-9_]*$ (lowercase ASCII letters, digits, and
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).not.toContain('[a-z]')
  })

  // From draft-sergeev-claim-boundaries-01
  test('Takes a declared reference label only from the start of a reference entry', async () => {
    const txt = `${metaTXTBlock}
   confidence as to that foundation" [HAMILTON].  The load-bearing

16.  Informative References

   [HAMILTON] Court of Appeal (Criminal Division), England and Wales,
              "Hamilton & Ors v Post Office Ltd", [2021] EWCA Crim 577,
              paragraphs 136-137, 23 April 2021,
              <https://caselaw.nationalarchives.gov.uk/ewca/
              crim/2021/577>.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.referenceSectionDraftReferences).toEqual([
      { value: '[HAMILTON]', subsection: 'informative_references' }
    ])
  })

  // From draft-sharif-attp-01
  test('Takes a declared reference label from a bulleted reference entry', async () => {
    const txt = `${metaTXTBlock}
17.  References

17.1.  Normative References

   *  [FIPS186-5] National Institute of Standards and Technology,
      "Digital Signature Standard (DSS)", FIPS PUB 186-5, 2023.

17.2.  Informative References

   *  [OWASP-AISVS] OWASP, "AI Security Verification Standard", 2026.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.referenceSectionDraftReferences).toEqual([
      { value: '[FIPS186-5]', subsection: 'normative_references' },
      { value: '[OWASP-AISVS]', subsection: 'informative_references' }
    ])
  })

  // From draft-vangeest-lamps-update-asn1-signed-type-01
  test('Counts a declared reference label in source code, but not other brackets there', async () => {
    const txt = `${metaTXTBlock}
   <CODE BEGINS>
   AsymmetricKeyPackageModuleV1-2026
     { iso(1) member-body(2) us(840) rsadsi(113549) pkcs(1) pkcs-9(9)
       smime(16) modules(0) id-mod-asymmetricKeyPkgV1-2026(TBD2) }

   DEFINITIONS IMPLICIT TAGS ::=

   BEGIN

     [[2: publicKey        [1] PublicKey OPTIONAL ]],
     ...
   }

   PrivateKeyInfo ::= OneAsymmetricKey

   -- PrivateKeyInfo is used by [P12]. If any items tagged as version
   -- 2 are used, the version must be v2, else the version should be
   -- v1. When v1, PrivateKeyInfo is the same as it was in [RFC5208].

   END
   <CODE ENDS>

7.  References

7.2.  Informative References

   [P12]      RSA Laboratories, "PKCS #12 v1.0: Personal Information
              Exchange Syntax", June 1999.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toEqual(['[P12]'])
  })

  // From draft-ietf-sidrops-rpki-erik-protocol-07
  test('Counts an RFC cited in source code as used, without taking it as a bracketed citation', async () => {
    const txt = `${metaTXTBlock}
   <CODE BEGINS>

   IMPORTS
     CONTENT-TYPE, ContentSet, Digest, DigestAlgorithmIdentifier
     FROM CryptographicMessageSyntax-2010 -- in [RFC6268]
     { iso(1) member-body(2) us(840) rsadsi(113549) pkcs(1)
       pkcs-9(9) smime(16) modules(0) id-mod-cms-2009(58) }

   <CODE ENDS>
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionRfc).toContain('6268')
    expect(result.data.extractedElements.bracketedRfcNonReferences).toEqual([])
  })

  // From draft-ietf-rtgwg-vrrp-rfc8347bis-23, draft-ietf-idr-bgp-model-21 and draft-gong-spring-sr-policy-group-yang-04
  test('Does not take the keys of a YANG tree diagram list as a reference label', async () => {
    const txt = `${metaTXTBlock}
             +--rw track
             |  +--rw interfaces
             |  |  +--rw interface* [interface]
             |  |     +--rw interface             if:interface-ref

                           |  |     +--ro unknown-attributes
                           |  |     |  +--ro unknown-attribute*
                           |  |     |          [attr-type]
                           |  |     |     +--ro optional?     boolean

          + sr-policy-groups
              group* [group-color]
                + name
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toEqual([])
  })

  // From draft-ietf-lamps-csr-attestation-29
  test('Does not take an ASN.1 tag as a reference label', async () => {
    const txt = `${metaTXTBlock}
      CertificateChoices ::= CHOICE {
        certificate Certificate,
        extendedCertificate [0] IMPLICIT ExtendedCertificate,
             -- Obsolete
        ...,
        [[3: v1AttrCert [1] IMPLICIT AttributeCertificateV1]],
             -- Obsolete
        [[4: v2AttrCert [2] IMPLICIT AttributeCertificateV2]],
        [[5: other      [3] IMPLICIT OtherCertificateFormat]] }
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toEqual([])
  })

  // From draft-ietf-regext-rdap-jscontact-27
  test('Does not take a number as a reference label in a document citing references by name', async () => {
    const txt = `${metaTXTBlock}
   jCard property:  "family name" component of n
   Reference:  Section 6.2.2 of [RFC6350]
   Path:  $..vcardArray[1][?(@[0]=='n')][3][0]

11.  References

11.1.  Normative References

   [RFC6350]  Perreault, S., "vCard Format Specification", RFC 6350,
              DOI 10.17487/RFC6350, August 2011,
              <https://www.rfc-editor.org/info/rfc6350>.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toEqual([])
    expect(result.data.extractedElements.nonReferenceSectionRfc).toEqual(['6350'])
  })

  // From draft-ietf-regext-rdap-jscontact-27
  test('Locates RFCs mentioned inside and outside the references section', async () => {
    const txt = `${metaTXTBlock}
   jCard property:  "family name" component of n
   Reference:  Section 6.2.2 of [RFC6350]
   Path:  $..vcardArray[1][?(@[0]=='n')][3][0]

11.  References

11.1.  Normative References

   [RFC6350]  Perreault, S., "vCard Format Specification", RFC 6350,
              DOI 10.17487/RFC6350, August 2011,
              <https://www.rfc-editor.org/info/rfc6350>.
`

    const result = await parse(txt, 'txt')
    const mention = lineNumber(txt, 'Reference:  Section 6.2.2')
    const entry = lineNumber(txt, '[RFC6350]  Perreault')
    const { locations } = result.data.extractedElements
    expect(locations.nonReferenceSectionRfc).toEqual({ 6350: [{ line: mention, pos: 33 }] })
    expect(locations.bracketedRfcNonReferences).toEqual({ '[RFC6350]': [{ line: mention, pos: 33 }] })
    expect(locations.referenceSectionRfc).toEqual({ 6350: [{ line: entry, pos: 4 }, { line: entry, pos: 60 }] })
    expect(locations.bracketedRfcReferences).toEqual({ '[RFC6350]': [{ line: entry, pos: 4 }] })
    // Numbers in brackets are not reference labels here, and are not located as such
    expect(locations.nonReferenceSectionDraftReferences).toEqual({})
  })

  // From draft-vangeest-lamps-update-asn1-signed-type-01
  test('Locates a label in source code once the references section declares it', async () => {
    const txt = `${metaTXTBlock}
   <CODE BEGINS>
   PrivateKeyInfo ::= OneAsymmetricKey

   -- PrivateKeyInfo is used by [P12]. If any items tagged as version
   -- 2 are used, the version must be v2, else the version should be
   -- v1. When v1, PrivateKeyInfo is the same as it was in [RFC5208].
   <CODE ENDS>

7.  References

7.2.  Informative References

   [P12]      RSA Laboratories, "PKCS #12 v1.0: Personal Information
              Exchange Syntax", June 1999.
`

    const result = await parse(txt, 'txt')
    expect(getLocations(result, 'nonReferenceSectionDraftReferences', '[P12]')).toEqual([
      { line: lineNumber(txt, 'is used by [P12]'), pos: 33 }
    ])
    expect(getLocations(result, 'referenceSectionDraftReferences', '[P12]')).toEqual([
      { line: lineNumber(txt, '[P12]      RSA'), pos: 4 }
    ])
  })

  // From draft-abak-agent-control-delivery-evidence-01
  test('Locates a draft linked to from the references section where its name starts, on a URL broken across lines', async () => {
    const txt = `${metaTXTBlock}
18.  Informative References

   [I-D.agentic-ai-usecases-requirements]
              Reddy.K, T., Sarker, Z., and K. Yao, "Agentic AI Use Cases
              and Requirements", Work in Progress, Internet-Draft,
              draft-agentic-ai-usecases-requirements-02, 25 August 2026,
              <https://datatracker.ietf.org/doc/draft-agentic-ai-
              usecases-requirements/>.
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.draftStatusReferences).toEqual([
      { value: 'draft-agentic-ai-usecases-requirements', subsection: 'informative_references' }
    ])
    expect(getLocations(result, 'draftStatusReferences', 'draft-agentic-ai-usecases-requirements')).toEqual([
      { line: lineNumber(txt, '<https://datatracker.ietf.org/doc/draft-agentic-ai-'), pos: 49 }
    ])
  })

  // From draft-ietf-dnsop-zone-cut-to-nowhere-00
  test('Does not take an ellipsis as a reference label', async () => {
    const txt = `${metaTXTBlock}
           ; the signed zone PUPPY.EXAMPLE.ORG exists,
           ; but in another namespace

           PUPPY  3600  IN  DS  [...]
                            NS  .
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toEqual([])
  })

  // From draft-ietf-oauth-v2-1-16 and draft-ietf-cdni-logging-extensions-04
  test('Does not take a character range or class as a reference label', async () => {
    const txt = `${metaTXTBlock}
   The code_verifier is a unique high-entropy cryptographically random
   string generated for each authorization request, using the unreserved
   characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~", with a
   minimum length of 43 characters and a maximum length of 128
   characters.

                       "transforms": [{
                               "type": "MI.LoggingTransformUrlParam",
                               "value": {
                                       "replace-param": "^.?[iI][dD]$|.*_[iI][dD]$",
                                       "strip-params": False
                               }
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toEqual([])
  })

  // From draft-ietf-anima-rfc8366bis-37
  test('Takes an RFC Editor placeholder in a table as a placeholder reference', async () => {
    const txt = `${metaTXTBlock}
   IANA is requested to register the following entries in the IETF YANG-
   SID Ranges registry:

      +=============+======+======================+=================+
      | Entry Point | Size | Module Name          | Reference       |
      +=============+======+======================+=================+
      |     2450    |  50  | ietf-voucher         | [This-Document] |
      +-------------+------+----------------------+-----------------+
      |     2500    |  50  | ietf-voucher-request | [This-Document] |
      +-------------+------+----------------------+-----------------+
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.nonReferenceSectionDraftReferences).toEqual([])
    expect(result.data.extractedElements.placeholderReferences).toEqual(['[This-Document]'])
    expect(result.data.extractedElements.locations.placeholderReferences).toEqual({
      '[This-Document]': [
        { line: lineNumber(txt, '2450'), pos: 53 },
        { line: lineNumber(txt, '2500'), pos: 53 }
      ]
    })
    expect(result.data.extractedElements.locations.nonReferenceSectionDraftReferences).toEqual({})
  })
})

describe('Page‐separator handling for split license and RFC headers', () => {
  test('TLP 6.b.i license block split by form‐feed is still recognized', async () => {
    const txt = `
${metaTXTBlock}
${tableOfContentsTXTBlock}

${copyrightNoticeTXTBlock}

// license starts...
This document is subject to BCP 78 and the IETF Trust's Legal
Provisions Relating to IETF Documents (https://trustee.ietf.org/
license-info)

Schmutzer, et al.        Expires 17 October 2025                [Page 1]
\f
Internet-Draft                CS-SR Policy                    April 2025

in effect on the date of publication of this document.
Code Components extracted from this document must include Revised BSD License text as described in Section 4.e of the Trust Legal Provisions and are

Schmutzer, et al.        Expires 17 October 2025                [Page 1]
\f
Internet-Draft                CS-SR Policy                    April 2025

provided without warranty as described in the Revised BSD License.

${introductionTXTBlock}
`

    const result = await parse(txt, 'txt')
    expect(result.data.contains.revisedBsdLicense6_i).toBe(true)
    expect(result.data.extractedElements.license6_b_i).toHaveLength(1)
    expect(result.data.extractedElements.license6_b_i[0])
      .toContain('Code Components extracted from this document must include Revised BSD License text as described in Section 4.e')
  })

  test('“RFC … [Page N]” headers without form‐feed do NOT split pages', async () => {
    const txt = `
${metaTXTBlock}
Schmutzer, et al.        Expires 17 October 2025               [Page 1]
RFC 7154               IETF Guidelines for Conduct            March 2014
${abstractTXTBlock}
${introductionTXTBlock}
`

    const result = await parse(txt, 'txt')
    expect(result.data.pageCount).toBe(1)
  })

  test('Paragraph split by a lowercase "[page N]" footer with trailing whitespace is still recognized', async () => {
    // Excerpt from draft-urien-tls-im-trusted-exporter-00 (CRLF line endings)
    const txt = `
${metaTXTBlock}
   Internet-Drafts are draft documents valid for a maximum of six months
   and may be updated, replaced, or obsoleted by other documents

   Urien                    Expires November 2026           [page 1] \f
   TLS 1.3 Identity Module Trusted Exporter                  May 2026 

   at any time.  It is inappropriate to use Internet-Drafts as reference
   material or to cite them other than as "work in progress."

${introductionTXTBlock}
`.replace(/\n/g, '\r\n')

    const result = await parse(txt, 'txt')
    expect(result.data.contains.draftParagraphOutSixMonthValidity).toBe(true)
  })

  test('Paragraph split by a page break whose running header reads "Month DD,YYYY" is still recognized', async () => {
    const txt = `
${metaTXTBlock}
   Internet-Drafts are draft documents valid for a maximum of six months
   and may be updated, replaced, or obsoleted by other documents at any

Li, et al.               Expires September, 2026                [Page 1]
\f
Internet-Draft         FlowSpec by Destination-QP          March 02,2026

   time.  It is inappropriate to use Internet-Drafts as reference
   material or to cite them other than as "work in progress."

${introductionTXTBlock}
`

    const result = await parse(txt, 'txt')
    expect(result.data.contains.draftParagraphOutSixMonthValidity).toBe(true)
  })

  test.each([
    ['Zhang, et al.           Expires 8 September 2023                [Page 1]', 'footer'],
    ['Gueron                  Expires March 16, 2027                 [Page 2] ', 'footer'],
    ['   Urien                    Expires November 2026           [page 1] \r', 'footer'],
    ['Internet-Draft               RT-derived ECs                   March 2023', 'header'],
    ['Internet-Draft              CATS OAM Use Cases            21 July 2026', 'header'],
    ['Internet-Draft                   MSYNC                      May 28, 2026', 'header'],
    ['Internet-Draft         FlowSpec by Destination-QP          March 02,2026', 'header'],
    ['   Internet-Draft       ICMP extension for SAVNET          July, 2026', 'header'],
    ['   TLS 1.3 Identity Module Trusted Exporter                  May 2026 \r', 'header'],
    ['Internet-Draft              WildCard Extensions                Sep 2026', 'header'],
    ['Internet-Draft         Informational Add-on for HTTP          Nov. 2013', 'header'],
    ['   the counter wraps around in nov 2048', null],
    ['   until the counter wraps around in may 2048', null],
    ['   published in March 2014 [RFC7154] and still in use.', null],
    ['   see page 4 of the specification', null]
  ])('pageBreakLineType(%j) is %j', (line, expected) => {
    expect(pageBreakLineType(line)).toBe(expected)
  })
})

describe('Status of this memo section is numbered', () => {
  test('The Status of this memo section is not numbered', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${introductionTXTBlock}
      ${statusOfMemoTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.isStatusOfThisMemoNumbered).toBeFalsy()
  })

  test('The Status of this memo section is numbered', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractTXTBlock}
    ${introductionTXTBlock}
    ${statusOfMemoNumberedTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.isStatusOfThisMemoNumbered).toBeTruthy()
  })
})

describe('Copyright Notice section is numbered', () => {
  test('Copyright Notice section is numbered', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${introductionTXTBlock}
      ${copyrightNoticeTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.isCopyrightNoticeNumbered).toBeFalsy()
  })

  test('Copyright Notice section is not numbered', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractTXTBlock}
    ${introductionTXTBlock}
    ${copyrightNoticeNumberedTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.isCopyrightNoticeNumbered).toBeTruthy()
  })
})

describe('Document pages numbered', () => {
  test('Document pages numbered', async () => {
    const txt = `
    ${metaTXTBlock}
    ${textWithPageNumberedTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.missingPageNumbering).toHaveLength(0)
  })

  test('Document pages not numbered', async () => {
    const txt = `
      ${metaTXTBlock}
      ${textWithoutPageNumberedTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.missingPageNumbering).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lines: 21, page: 1 })
      ])
    )
  })
})

describe('Pages are not separated by formfeeds', () => {
  test('Pages are not separated by formfeeds', async () => {
    const txt = `
    ${metaTXTBlock}
    ${textWithoutFormFeedTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.pageCount).toBe(1)
  })

  test('Pages are separated by formfeeds', async () => {
    const txt = `
      ${metaTXTBlock}
      ${textWithFormFeedTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.pageCount).toBe(2)
  })
})

describe('Formfeed and Page occur on a line, possibly separated by spaces', () => {
  test('Formfeed and Page not occur on a line', async () => {
    const txt = `
    ${metaTXTBlock}
    ${textWithFormFeedTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.pageLineWithFormFeed).toHaveLength(0)
  })

  test('Formfeed and Page occur on a line', async () => {
    const txt = `
      ${metaTXTBlock}
      ${textWithFormFeedOnLineTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.pageLineWithFormFeed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lines: 20, page: 1 })
      ])
    )
  })
})

describe('Parsing pages (page count)', () => {
  test('Document should have at least one page even without pagebreak', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.pageCount).toEqual(1)
  })

  test('Parsing page breaks', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      ${PageBlock}
      ${securityConsiderationsTXTBlock}
      ${PageBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.pageCount).toEqual(3)
  })

  test('Page footers with trailing whitespace or a lowercase "page" are counted', async () => {
    const txt = `
${metaTXTBlock}
${abstractTXTBlock}

Gueron                  Expires March 16, 2027                 [Page 1] 
\f
Internet-Draft                  DNDK-GCM                  September 2026

${introductionTXTBlock}

   Urien                    Expires November 2026           [page 2] 
`

    const result = await parse(txt, 'txt')
    expect(result.data.contains.pagesFound).toEqual(2)
  })

  test('Parser should detect table of contents in the document', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}
    ${introductionTXTBlock}
    ${securityConsiderationsTXTBlock}
    ${PageBlock}
    ${securityConsiderationsTXTBlock}
    ${PageBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.isTableOfContentsExists).toBeTruthy()
  })

  test('Parser should not detect table of contents if it doesn\'t exist', async () => {
    const txt = `
    ${metaTXTBlock}
    ${abstractWithReferencesTXTBlock}
    ${introductionTXTBlock}
    ${securityConsiderationsTXTBlock}
    ${PageBlock}
    ${securityConsiderationsTXTBlock}
    ${PageBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.isTableOfContentsExists).toBeFalsy()
  })
})

describe('Missing document name on first page', () => {
  test('The document name on first page is missing', async () => {
    const txt = `
    ${metaWithoutDocumentNameTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.slug).toBeNull()
  })

  test('The document name on first page is present', async () => {
    const txt = `
      ${metaTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.slug).toBe('draft-ietf-idr-rt-derived-community-05')
  })
})

describe('Missing acceptable paragraph calling out 6 month validity', () => {
  test('The acceptable paragraph calling out 6 month validity is missing', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.draftParagraphOutSixMonthValidity).toBeFalsy()
  })

  test('The acceptable paragraph calling out 6 month validity is present', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${textAcceptableParagraphCallingOutSixMonthValidity}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.draftParagraphOutSixMonthValidity).toBeTruthy()
  })

  test('The acceptable paragraph calling out 6 month validity is present with the period outside the quotes', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${textAcceptableParagraphCallingOutSixMonthValidity.replace('"work in progress."', '"work in progress".')}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.draftParagraphOutSixMonthValidity).toBeTruthy()
  })

  test('The acceptable paragraph calling out 6 month validity without the period is not accepted', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${textAcceptableParagraphCallingOutSixMonthValidity.replace('"work in progress."', '"work in progress"')}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.draftParagraphOutSixMonthValidity).toBeFalsy()
  })

  test('The acceptable paragraph calling out 6 month validity with different text is not accepted', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${textAcceptableParagraphCallingOutSixMonthValidity.replace('"work in progress."', '"work underway".')}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.draftParagraphOutSixMonthValidity).toBeFalsy()
  })
})

describe('Parsing expires line', () => {
  test('Parsing expires line after a blank line in the header', async () => {
    // draft-urien-tls-im-trusted-exporter-00, with its trailing spaces and CRLF line ends
    const result = await parse(`
  TLS Working Group                                            P. Urien
  Internet Draft                                          Telecom Paris
  Intended status: Experimental                              Ethertrust
${' '.repeat(72)}
                                                            28 May 2026
  Expires: November 2026

                    TLS 1.3 Identity Module Trusted Exporter
                   draft-urien-tls-im-trusted-exporter-00.txt


Abstract
`.replace(/\n/g, ' \r\n'), 'txt')

    expect(result.data.header.expires.toISODate()).toEqual('2026-11-01')
    expect(result.data.title).toBe('TLS 1.3 Identity Module Trusted Exporter')
  })

  test('Parsing expires line', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${copyrightNoticeNumberedTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.header.expires).toBeDefined()
    expect(result.data.header.expires.toISODate()).toEqual('2023-09-08')
    expect(result.data.extractedElements.lastPageExpiration).toBeNull()
  })

  test('No expires line', async () => {
    const txt = `
      ${metaTXTBlock.replace('Expires: 8 September 2023', '')}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${copyrightNoticeNumberedTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.header.expires).toBeNull()
    expect(result.data.extractedElements.lastPageExpiration).toBeNull()
  })

  test('Expiration date on first and last page are present', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
      ${expiresLineFooterTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.header.expires).toBeDefined()
    expect(result.data.header.expires.toISODate()).toEqual('2023-09-08')
    expect(result.data.extractedElements.lastPageExpiration).toBeDefined()
    expect(result.data.extractedElements.lastPageExpiration.toISODate()).toEqual('2023-03-07')
  })

  test.each([
    ['Expires: 8 September 2023', '2023-09-08', true],
    ['Expires: October 19, 2026', '2026-10-19', true],
    ['Expires: January 08, 2027', '2027-01-08', true],
    ['Expires: October 2026', '2026-10-01', false],
    ['Expires: September, 2026', '2026-09-01', false],
    ['Expires: 11 Nov 2026', '2026-11-11', true],
    ['Expires: Nov. 10, 2026', '2026-11-10', true],
    ['Expires: Sept 2026', '2026-09-01', false],
    ['Expires: November , 2026', '2026-11-01', false],
    ['Expires: 2027-01-20', '2027-01-20', true],
    ['Expiration date: 2027-01-20', '2027-01-20', true]
  ])('Header "%s" gives expiry %s', async (expiresLine, isoDate, hasDay) => {
    const txt = `
${metaTXTBlock.replace('Expires: 8 September 2023', expiresLine)}
${abstractTXTBlock}
`

    const result = await parse(txt, 'txt')
    expect(result.data.header.expires.toISODate()).toEqual(isoDate)
    expect(result.data.header.expiresHasDay).toBe(hasDay)
  })

  test.each([['\n'], ['\r\n']])('Indented header Expires line with trailing whitespace is parsed (line end %j)', async (lineEnd) => {
    const txt = `
${metaTXTBlock.replace('Expires: 8 September 2023                                      K. Patel', '  Expires: November 2026 ')}
${abstractTXTBlock}
`.replace(/\n/g, lineEnd)

    const result = await parse(txt, 'txt')
    expect(result.data.header.expires.toISODate()).toEqual('2026-11-01')
    expect(result.data.header.expiresHasDay).toBe(false)
  })

  test.each([
    ['Bashandy               Expires October 19, 2026                [Page 7]', '2026-10-19', true],
    ['Lin, et al.           Expires January 08, 2027                [Page 13]', '2027-01-08', true],
    ['Cheng, et al.          Expires December, 2026                 [Page 7]', '2026-12-01', false],
    ['   Urien                 Expires November 2026               [Page 6] ', '2026-11-01', false],
    ['Gueron                  Expires March 16, 2027                 [Page 45] ', '2027-03-16', true],
    ['Dunbar, et al.           Expires Dec 1, 2026            [Page 2]', '2026-12-01', true],
    ['Melegassi                 Expires 29 Nov 2026                  [Page 1]', '2026-11-29', true],
    ['Jaehwoon Lee              Expires Nov. 10, 2026               [Page 1]', '2026-11-10', true],
    ['Cheng, et al.       Expires November , 2026                    [Page 2]', '2026-11-01', false]
  ])('Last page footer "%s" gives expiry %s', async (footer, isoDate, hasDay) => {
    const txt = `
${metaTXTBlock}
${abstractTXTBlock}
${introductionTXTBlock}

${footer}
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.lastPageExpiration.toISODate()).toEqual(isoDate)
    expect(result.data.extractedElements.lastPageExpirationHasDay).toBe(hasDay)
  })

  test('Expiration date is found in a footer followed by a running header', async () => {
    // As in draft-dikshit-cats-oam-usecases-00, whose only footer is on page 1
    const txt = `
${metaTXTBlock}
${abstractTXTBlock}

Dikshit                 Expires 1 February 2027                 [Page 1]
\f
Internet-Draft              CATS OAM Use Cases                July 2026

${introductionTXTBlock}
`

    const result = await parse(txt, 'txt')
    expect(result.data.contains.pagesFound).toEqual(1)
    expect(result.data.extractedElements.lastPageExpiration.toISODate()).toEqual('2027-02-01')
    expect(result.data.extractedElements.lastPageExpirationHasDay).toBe(true)
  })

  test('Expiration date is taken from the last page footer', async () => {
    const txt = `
${metaTXTBlock}
${abstractTXTBlock}
${PageBlock}
${introductionTXTBlock}
${expiresLineFooterTXTBlock}
`

    const result = await parse(txt, 'txt')
    expect(result.data.extractedElements.lastPageExpiration.toISODate()).toEqual('2023-03-07')
  })
})

describe('TLP-5 6.b.i copyright date is not this year', () => {
  test('TLP-5 6.b.i copyright date is not this year', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${copyrightNoticeTXTBlock}
    ${introductionTXTBlock}
  `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.copyrightDates).toEqual(
      expect.arrayContaining([2023])
    )
  })

  test('TLP-5 6.b.i without copyright date', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${introductionTXTBlock}
  `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.copyrightDates).toEqual(
      expect.arrayContaining([])
    )
  })

  test('TLP-5 6.b.i copyright date is this year', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${copyrightNoticeWithCurrentYearTXTBlock}
    ${introductionTXTBlock}
  `

    const currentYear = new Date().getFullYear()
    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.copyrightDates).toEqual(
      expect.arrayContaining([currentYear])
    )
  })
})

describe('TLP-5 6.b.i or b.ii license notice is not present, or doesn\'t match stream IETF stream document sufficiently matches TLP-5 6.c.i or 6.c.ii text (restrictions on publication or derivative works)', () => {
  test('TLP-5 6.b.ii license notice is not present', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${introductionTXTBlock}
  `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.license6_b_ii).toStrictEqual([])
  })

  test('TLP-5 6.b.ii license notice is present', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${introductionTXTBlock}
    ${textLicense6biiTXTBlock}
  `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.license6_b_ii).toStrictEqual([textLicense6biiTXTBlock.replace(/\s+/g, ' ').trim()])
  })
  test('TLP-5 6.b.ii license notice is present more ones', async () => {
    const txt = `
    ${metaTXTBlock}
    ${textLicense6biiTXTBlock}
    ${tableOfContentsTXTBlock}
    ${introductionTXTBlock}
    ${textLicense6biiTXTBlock}
  `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.license6_b_ii).toHaveLength(2)
  })
  test('TLP-5 6.c.i license notice is not present', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${introductionTXTBlock}
  `

    const result = await parse(txt, 'txt')

    expect(result.data.contains.license6_c_i).toBeFalsy()
  })
  test('TLP-5 6.c.i license notice is present', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${textLicense6ciTXTBlock}
    ${introductionTXTBlock}
  `

    const result = await parse(txt, 'txt')

    expect(result.data.contains.license6_c_i).toBeTruthy()
  })
  test('TLP-5 6.c.ii license notice is not present', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${introductionTXTBlock}
  `

    const result = await parse(txt, 'txt')

    expect(result.data.contains.license6_c_ii).toBeFalsy()
  })

  test('TLP-5 6.c.ii license notice is present', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${textLicense6ciiTXTBlock}
    `

    const result = await parse(txt, 'txt')

    expect(result.data.contains.license6_c_ii).toBeTruthy()
  })
})

describe('TLP-5 6.b.i copyright line is not present', () => {
  test('TLP-5 6.b.i copyright line is present', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${copyrightNoticeTXTBlock}
    ${introductionTXTBlock}
  `

    const result = await parse(txt, 'txt')

    expect(result.data.contains.copyrightSection6_b_i).toBeTruthy()
  })

  test('TTLP-5 6.b.i copyright line is not present', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.copyrightSection6_b_i).toBeFalsy()
  })

  test('TLP-5 6.b.i copyright line is present twice', async () => {
    const txt = `
    ${metaTXTBlock}
    ${copyrightNoticeWithCurrentYearTXTBlock}
    ${tableOfContentsTXTBlock}
    ${copyrightNoticeTXTBlock}
    ${introductionTXTBlock}
  `

    const result = await parse(txt, 'txt')

    expect(result.data.possibleIssues.copyrightLines6_i).toHaveLength(2)
  })
})

describe('doesn\'t say INTERNET DRAFT in the upper left of the first page', () => {
  test('doesn\'t say INTERNET DRAFT in the upper left of the first page', async () => {
    const txt = `
    ${metaWithoutIdIndicatorTXTBlock}
  `

    const result = await parse(txt, 'txt')

    expect(result.data.contains.idIndication).toBeFalsy()
  })

  test('Say INTERNET DRAFT in the upper left of the first page', async () => {
    const txt = `
      ${metaTXTBlock}
    `

    const result = await parse(txt, 'txt')

    expect(result.data.contains.idIndication).toBeTruthy()
  })

  test('Say INTERNET DRAFT on the very first line of the document', async () => {
    const txt = `
      ${metaTXTBlock.replace(/^idr .*\n/m, '')}
    `

    const result = await parse(txt, 'txt')

    expect(result.data.header.authors[0].name).toBe('J. Haas')
    expect(result.data.contains.idIndication).toBeTruthy()
    expect(result.docKind).toBe('draft')
  })

  test.each(['Internet Draft', 'INTERNET-DRAFT', 'INTERNET DRAFT', 'internet-draft', 'Internet-Drafts'])('Say INTERNET DRAFT spelled "%s"', async (indicator) => {
    const txt = `
      ${metaTXTBlock.replace('Internet-Draft', indicator)}
    `

    const result = await parse(txt, 'txt')

    expect(result.data.contains.idIndication).toBeTruthy()
    expect(result.docKind).toBe('draft')
  })

  test('Say INTERNET DRAFT run into a long organization name', async () => {
    const txt = `
      ${metaTXTBlock.replace(/^Internet-Draft .*$/m, 'Internet-DraftChina Academy of Information and Communications Technology')}
    `

    const result = await parse(txt, 'txt')

    expect(result.data.contains.idIndication).toBeTruthy()
  })

  test('Doesn\'t take an RFC header for an INTERNET DRAFT', async () => {
    const txt = `
Internet Engineering Task Force (IETF)                         Z. Zhang
Request for Comments: 9999                                      J. Haas
Category: Standards Track                              Juniper Networks
ISSN: 2070-1721                                                K. Patel
                                                                 Arrcus
                                                           January 2025


            Extended Communities Derived from Route Targets
`

    const result = await parse(txt, 'test-document.txt')

    expect(result.data.contains.idIndication).toBeFalsy()
    expect(result.data.header.rfcNumber).toBe('9999')
    expect(result.docKind).toBe('rfc')
  })
})

describe('Missing acceptable paragraph noting that IDs are working documents', () => {
  test('The acceptable paragraph noting that IDs are working documents is missing', async () => {
    const txt = `
      ${metaTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.acceptableParagraphNotingThatDraft).toBeFalsy()
  })

  test('The acceptable paragraph noting that IDs are working documents is present', async () => {
    const txt = `
    ${metaTXTBlock}
    ${textAcceptableParagraphNotingThatDraftTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.acceptableParagraphNotingThatDraft).toBeTruthy()
  })
})

describe('Missing acceptable paragraph pointing the list of current I-Ds', () => {
  test('The acceptable paragraph pointing the list of current I-Ds is missing', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${introductionTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.paragraphPointingToTheListOfCurrentId).toHaveLength(0)
  })

  test('The acceptable paragraph pointing the list of current I-Ds is present', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractTXTBlock}
    ${textAcceptableParagraphPointingTheListOfCurrentId}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.paragraphPointingToTheListOfCurrentId).toHaveLength(1)
  })

  test('The acceptable paragraph pointing the list of current I-Ds is present twice', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${textAcceptableParagraphPointingTheListOfCurrentId}
    ${abstractTXTBlock}
    ${textAcceptableParagraphPointingTheListOfCurrentId}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.paragraphPointingToTheListOfCurrentId).toHaveLength(2)
  })
})

describe('Parsing unexpected indentations', () => {
  test('Correct text without unexpected indentations', async () => {
    const txt = `${metaTXTBlock}
${tableOfContentsTXTBlock}
${abstractWithReferencesTXTBlock}
${introductionTXTBlock}
${securityConsiderationsTXTBlock}`

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.unexpectedIndentation).toHaveLength(0)
  })

  test('Correct text without unexpected indentations in Author\'s Address section', async () => {
    const txt = `${metaTXTBlock}
${tableOfContentsTXTBlock}
${abstractWithReferencesTXTBlock}
${introductionTXTBlock}
${securityConsiderationsTXTBlock}
Author's Address

   Robert Sparks
   Email: rjsparks@nostrum.com`

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.unexpectedIndentation).toHaveLength(0)
  })

  test('Section title has unexpected indentation', async () => {
    const txt = `${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}
    ${introductionTXTBlock}
    ${securityConsiderationsTXTBlock}
 5. IANA Considerations
`
    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.unexpectedIndentation).toHaveLength(1)
    expect(result.data.possibleIssues.unexpectedIndentation).toEqual(
      // (at the first non-blank character)
      expect.arrayContaining([expect.objectContaining({ pos: 2 })])
    )
  })

  test('Section text has unexpected indentation in Introduction and Reference sections', async () => {
    const txt = `${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}
    ${introductionTXTBlock}
    ${securityConsiderationsTXTBlock}
   6. Normative References

  Text of section with bad indentation
  More text

  1. Historical background

  2. Background
`

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.unexpectedIndentation).toHaveLength(3)
    expect(result.data.possibleIssues.unexpectedIndentation).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'References', pos: 4 }), expect.objectContaining({ name: 'Introduction', pos: 3 })])
    )
  })

  test('Should avoid marking as an error reference text', async () => {
    const txt = `${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractWithReferencesTXTBlock}
    ${introductionTXTBlock}
    ${securityConsiderationsTXTBlock}
    ${referencesTXTBlockShort}`

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.unexpectedIndentation).toHaveLength(0)
  })

  test('Indented Status of This Memo should trigger unexpected indentation', async () => {
    const txt = `${metaTXTBlock}
     Status of This Memo`

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.unexpectedIndentation).toHaveLength(1)
    expect(result.data.possibleIssues.unexpectedIndentation[0].name).toMatch(/Status of This Memo/)
  })

  test('Indented Appendix section should trigger unexpected indentation', async () => {
    const txt = `${metaTXTBlock}
     Appendix A. Additional Information`

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.unexpectedIndentation).toHaveLength(1)
    expect(result.data.possibleIssues.unexpectedIndentation[0].name).toMatch(/Appendix/)
  })

  test('Indented Author’s Addresses (with editor) should trigger unexpected indentation', async () => {
    const txt = `${metaTXTBlock}
     Editor's Addresses`

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.unexpectedIndentation).toHaveLength(1)
    expect(result.data.possibleIssues.unexpectedIndentation[0].name).toMatch(/Author's Addresses/)
  })

  test('Table of contents of an unpaginated document has no unexpected indentation', async () => {
    const result = await parse(unpaginatedDraftTXT, 'txt')
    expect(result.data.possibleIssues.unexpectedIndentation).toHaveLength(0)
  })

  test('Table of contents across a page break with CRLF line ends has no unexpected indentation', async () => {
    // Excerpt from draft-dunbar-agent-attachment-01: CRLF line ends, and a running header without a date
    const txt = `Network Working Group                                   L. Dunbar
Internet Draft                                          Futurewei
Intended status: Informational                       K. Majumdar
Expires: November 1, 2026                              Oracle

                                                      May 1, 2026


                     Agent Attachment Protocol
                  draft-dunbar-agent-attachment-01

Abstract
   This document describes the Agent Attachment Protocol (AAP)
   that enables AI agents to establish attachment to an edge
   node and derive communication and attachment-related
   properties.

Table of Contents

   1. Introduction..............................................3
   2. Conventions used in this document.........................4
   3. Problem Statement.........................................5
   4. Use Cases.................................................6
      4.1. Smart Factory Control Agent..........................7
      4.2. Private 5G/6G Service Agent..........................7


Dunbar, et al.           Expires Dec 1, 2026            [Page 2]
\f
Internet-Draft             Agent-Attachment


      6.5. Exposure of Attachment Properties...................16
   7. Use of Attachment State (Informative)....................16
   8. Attachment State Maintenance and Teardown................19
   9. Security Considerations..................................20
   10. Manageability Considerations............................22
   11. IANA Considerations.....................................22
   12. References..............................................23
      12.1. Normative References...............................23
      12.2. Informative References.............................23
   13. Acknowledgments.........................................23
   Appendix A:.................................................23

1. Introduction

  The Agent Attachment Protocol (AAP) defines a mechanism for
  agents to establish attachment to an edge node and to derive
  communication and attachment-related properties associated
  with that attachment.
`.replace(/\n/g, '\r\n')

    const result = await parse(txt, 'txt')
    expect(result.data.markers.toc.start).toBe(18)
    expect(lineAfterToc(txt, result.data.markers.toc)).toBe('1. Introduction')
    expect(result.data.possibleIssues.unexpectedIndentation).toHaveLength(0)
  })

  test('Table of contents ends at the first entry repeated as an indented section title', async () => {
    // Excerpt from draft-cheng-rtgwg-srv6-multihome-egress-protection-12, whose section titles are indented
    const txt = `rtgwg Working Group                                            W. Cheng
Internet-Draft                                                  W.Jiang
Intended status: Experimental                              China Mobile
Expires:January 26, 2027                                         C. Lin
                                                   New H3C Technologies
                                                          July 23, 2026



              SRv6 Egress Protection in Multi-homed scenario
           draft-cheng-rtgwg-srv6-multihome-egress-protection-12


Abstract

   This document describes a SRv6 egress node protection mechanism in
   multi-homed scenarios.

Table of Contents


   1. Introduction...................................................2
   2. Terminology....................................................3
   6. Security Considerations.......................................10
   7. IANA Considerations...........................................10
   8. References....................................................11
   Authors' Addresses...............................................13



   1. Introduction

   The fast protection of a transit node of a Segment Routing (SR) path
   or tunnel is described in [I-D.ietf-rtgwg-segment-routing-ti-lfa].

   6. Security Considerations

   This document does not introduce any new security considerations.
`

    const result = await parse(txt, 'txt')
    expect(lineAfterToc(txt, result.data.markers.toc)).toBe('   1. Introduction')
    expect(result.data.possibleIssues.unexpectedIndentation.map(({ name, line }) => ({ name, line }))).toEqual([
      { name: 'Introduction', line: 31 },
      { name: 'Security Considerations', line: 36 }
    ])
  })

  test('Indented Overview section with numeric prefix should trigger unexpected indentation', async () => {
    const txt = `${metaTXTBlock}
   1. Overview`

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.unexpectedIndentation).toHaveLength(1)
    expect(result.data.possibleIssues.unexpectedIndentation[0].name).toMatch(/Introduction/)
  })
})

describe('Document has obsolete TLP section', () => {
  test('Document has obsolete TLP section', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractTXTBlock}
    Copyright (c) 2023 The Internet Society and the persons identified as the
    document authors.  All rights reserved.
    ${introductionTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.previous6_b_i_copyright).toBeTruthy()
    expect(result.data.contains.copyrightSection6_b_i).toBeFalsy()
  })

  test('Document does not have obsolete TLP section', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    ${abstractTXTBlock}
    ${introductionTXTBlock}
  `

    const result = await parse(txt, 'txt')
    expect(result.data.contains.previous6_b_i).toBeFalsy()
  })
})

describe('Parsing the same text repeatedly', () => {
  test('Gives the same license and boilerplate results each time', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${trust28Dec2009Section6aTXTBlock}
      ${textAcceptableParagraphNotingThatDraftTXTBlock}
      ${textAcceptableParagraphCallingOutSixMonthValidity}
      ${copyrightNoticeTXTBlock}
      ${textLicense6ciTXTBlock}
      ${textLicense6ciiTXTBlock}
      ${introductionTXTBlock}
      ${RFC2119BoilerplateTXTBlock}
      Code Components extracted from this document must include Revised BSD License text as described in Section 4.e of the Trust Legal Provisions and are provided without warranty as described in the Revised BSD License.
      # Possible code comment
    `

    const first = await parse(txt, 'txt')
    const second = await parse(txt, 'txt')

    expect(first.data.contains).toMatchObject({
      revisedBsdLicense: true,
      submissionCompliance: true,
      acceptableParagraphNotingThatDraft: true,
      license6_c_i: true,
      license6_c_ii: true,
      previous6_b_i_copyright: true,
      draftParagraphOutSixMonthValidity: true
    })
    expect(first.data.boilerplate.rfc2119).toBe(true)
    expect(second.data.contains).toEqual(first.data.contains)
    expect(second.data.boilerplate).toEqual(first.data.boilerplate)
    expect(second.data.possibleIssues).toEqual(first.data.possibleIssues)
  })
})

describe('parser output structure conforms to expected shape', () => {
  test('txt parser output matches snapshot', async () => {
    const doc = await generateTXTDoc()
    expect(doc).toMatchSnapshot()
  })
})
