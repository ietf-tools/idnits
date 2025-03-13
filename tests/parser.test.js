import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals'
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
  metaObsoleteAndUpdatesHasCharactersTXTBlock,
  ianaConsiderationsTXTBlock
} from './fixtures/txt-blocks/section-blocks.mjs'
import { parse } from '../lib/parsers/txt.mjs'

beforeAll(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {})
})

afterAll(() => {
  console.info.mockRestore()
})

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
      expect.objectContaining({ line: 42 }),
      expect.objectContaining({ line: 43 })
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
    expect(result.data.content.abstract).toBeNull()
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
    expect(result.data.content.introduction).toBeNull()
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
    expect(result.data.content.references).toBeNull()
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
    expect(result.data.extractedElements.fqdnDomains).toEqual(expect.arrayContaining(['www.ietf.org', 'example.com', 'random.arpa', 'invalid.arpa']))
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

  test('Correctly categorizes normative and informative draft references', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractWithReferencesTXTBlock}
      ${introductionTXTBlock}
      ${securityConsiderationsTXTBlock}
      7. References
      7.1. Normative References
      [I-D.ietf-httpbis-semantics] Fielding, R., "HTTP Semantics", draft-ietf-httpbis-semantics-19, October 2021.
      [I-D.ietf-quic-http] Bishop, M., "HTTP over QUIC", draft-ietf-quic-http-34, May 2021.
      7.2. Informative References
      [I-D.ietf-httpbis-cache] Nottingham, M., "HTTP Caching", draft-ietf-httpbis-cache-09, November 2020.
      [I-D.ietf-httpbis-client-hints] Grigorik, I., "Client Hints", draft-ietf-httpbis-client-hints-10, January 2021.
    `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.referenceSectionDraftReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: '[I-D.ietf-httpbis-semantics]', subsection: 'normative_references' }),
        expect.objectContaining({ value: '[I-D.ietf-quic-http]', subsection: 'normative_references' }),
        expect.objectContaining({ value: '[I-D.ietf-httpbis-cache]', subsection: 'informative_references' }),
        expect.objectContaining({ value: '[I-D.ietf-httpbis-client-hints]', subsection: 'informative_references' })
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
      [I-D.ietf-httpbis-cache] Nottingham, M., "HTTP Caching", draft-ietf-httpbis-cache-09, November 2020.
      [I-D.ietf-httpbis-client-hints] Grigorik, I., "Client Hints", draft-ietf-httpbis-client-hints-10, January 2021.
    `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.referenceSectionDraftReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: '[I-D.ietf-httpbis-cache]', subsection: 'unclassified_references' }),
        expect.objectContaining({ value: '[I-D.ietf-httpbis-client-hints]', subsection: 'unclassified_references' })
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
    `

    const result = await parse(txt, 'txt')

    expect(result.data.extractedElements.bracketedRfcNonReferences).toEqual(
      expect.arrayContaining(['[RFC1234]'])
    )
    expect(result.data.extractedElements.bracketedRfcNonReferences).toHaveLength(1)
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

    expect(result.data.content.ianaConsiderations).toBe(null)
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
        expect.objectContaining({ line: 24, pos: 52 }),
        expect.objectContaining({ line: 25, pos: 62 })
      ])
    )
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

describe('Document has hyphenated line-breaks', () => {
  test('The document does not contain line breaks.', async () => {
    const txt = `
      ${metaTXTBlock}
      ${tableOfContentsTXTBlock}
      ${abstractTXTBlock}
      ${introductionTXTBlock}
    `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.hyphenatedLines).toHaveLength(0)
  })

  test('Document has hyphenated line-breaks', async () => {
    const txt = `
    ${metaTXTBlock}
    ${tableOfContentsTXTBlock}
    line has hyphenated line-\nbreaks
  `

    const result = await parse(txt, 'txt')
    expect(result.data.possibleIssues.hyphenatedLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 29, pos: 29 })
      ])
    )
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
