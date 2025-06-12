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
      ${referenceTXTBlock}
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
      ${referenceTXTBlock}
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
})

describe('Parsing expires line', () => {
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
      expect.arrayContaining([expect.objectContaining({ pos: 0 })])
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
      expect.arrayContaining([expect.objectContaining({ pos: 0 }), expect.objectContaining({ pos: 0 })])
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
