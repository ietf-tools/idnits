import { describe, expect, test } from 'vitest'
import { CERTAINTY } from '../lib/model/indexes.mjs'
import { getBcp14Boilerplate, getBcp14References, getKeywords } from '../lib/model/keywords.mjs'
import { parse } from '../lib/parsers/xml.mjs'

const BOILERPLATE = 'The key words "<bcp14>MUST</bcp14>" and "<bcp14>NOT RECOMMENDED</bcp14>" in this document are to be interpreted as described in BCP 14 <xref target="RFC2119"/>.'

/**
 * A text document as parsed, with the keywords its parser found and where
 *
 * @param {Object} [parts] Parts of the document
 * @param {Array<{keyword: string, line: number, pos: number}>} [parts.keywords=[]] Keywords found on lines
 * @param {string[]} [parts.listed=[]] Keywords the boilerplate lists, found on line 10
 * @param {Object} [parts.references={}] Labels found in lines (rfc2119, rfc8174, bcp14)
 * @param {string} [parts.body=''] Text of the document
 * @returns {Object} Parsed text document
 */
function txtDoc ({ keywords = [], listed = [], references = {}, body = '' } = {}) {
  const locations = { keywords2119: {}, boilerplate2119Keywords: {}, bracketedRfcNonReferences: {} }
  for (const { keyword, line, pos } of keywords) {
    locations.keywords2119[keyword] ??= []
    locations.keywords2119[keyword].push({ line, pos })
  }
  listed.forEach((keyword, idx) => {
    locations.boilerplate2119Keywords[keyword] = [{ line: 10, pos: idx + 1 }]
  })
  if (references.rfc2119) {
    locations.bracketedRfcNonReferences['[rfc2119]'] = [{ line: 11, pos: 5 }]
  }
  return {
    type: 'txt',
    body,
    data: {
      extractedElements: {
        keywords2119: keywords.map(({ keyword, line }) => ({ keyword, line })),
        boilerplate2119Keywords: listed,
        locations
      },
      boilerplate: { rfc2119: listed.length > 0, rfc8174: false, bcp14: false },
      references: { rfc2119: false, rfc8174: false, bcp14: false, ...references }
    }
  }
}

/**
 * Parse an XML draft with the given <middle> and <back> children
 *
 * @param {Object} parts Markup of the parts
 * @param {string} [parts.middle=''] Children of <middle>
 * @param {string} [parts.back=''] Children of <back>
 * @returns {Promise<Object>} Parsed document
 */
async function parseXmlDraft ({ middle = '', back = '' }) {
  const { doc } = await parse(`<?xml version="1.0" encoding="utf-8"?>
<rfc version="3" docName="draft-test-00">
  <front><title>Test</title></front>
  <middle>${middle}</middle>
  <back>${back}</back>
</rfc>`, 'draft-test-00.xml')
  return doc
}

describe('BCP 14 keywords of a text document are inferred, located by line', () => {
  test('each keyword found, the boilerplate\'s too', () => {
    const doc = txtDoc({ keywords: [{ keyword: 'MUST', line: 10, pos: 1 }, { keyword: 'MUST', line: 20, pos: 4 }], listed: ['MUST'] })
    expect(getKeywords(doc)).toEqual({
      used: true,
      keywords: [
        { keyword: 'MUST', certainty: CERTAINTY.INFERRED, inBoilerplate: false, location: { lines: [{ line: 10, pos: 1 }] } },
        { keyword: 'MUST', certainty: CERTAINTY.INFERRED, inBoilerplate: false, location: { lines: [{ line: 20, pos: 4 }] } }
      ]
    })
  })

  test('none used when no more are found than the boilerplate lists', () => {
    const doc = txtDoc({ keywords: [{ keyword: 'MUST', line: 10, pos: 1 }], listed: ['MUST'] })
    expect(getKeywords(doc).used).toBe(false)
  })

  test('the boilerplate is located by the keywords it lists', () => {
    const doc = txtDoc({ listed: ['MUST', 'NOT RECOMMENDED'] })
    expect(getBcp14Boilerplate(doc)).toEqual({
      certainty: CERTAINTY.INFERRED,
      present: true,
      notRecommended: true,
      location: { lines: [{ line: 10, pos: 1 }, { line: 10, pos: 2 }] }
    })
    expect(getBcp14Boilerplate(txtDoc())).toMatchObject({ present: false, notRecommended: false, location: {} })
  })

  test('references are cited by their labels, located by line', () => {
    const doc = txtDoc({ references: { rfc2119: true, bcp14: true }, body: 'x\n\fsee [BCP14]\nsee [BCP14]' })
    expect(getBcp14References(doc)).toEqual([
      { id: 'RFC2119', certainty: CERTAINTY.INFERRED, cited: true, location: { lines: [{ line: 11, pos: 5 }] } },
      { id: 'BCP14', certainty: CERTAINTY.INFERRED, cited: true, location: { lines: [{ line: 3, pos: 5 }] } }
    ])
  })

  test('the answers are read once per document', () => {
    const doc = txtDoc({ listed: ['MUST'] })
    expect(getKeywords(doc)).toBe(getKeywords(doc))
    expect(getBcp14Boilerplate(doc)).toBe(getBcp14Boilerplate(doc))
    expect(getBcp14References(doc)).toBe(getBcp14References(doc))
  })
})

describe('BCP 14 keywords of an XML document are declared in <bcp14>, located by path', () => {
  test('keywords in <bcp14> are declared, in prose inferred, the boilerplate\'s set apart', async () => {
    const doc = await parseXmlDraft({ middle: `<t>${BOILERPLATE}</t><t>Clients <bcp14>MUST</bcp14> retry and SHOULD wait.</t>` })
    expect(getKeywords(doc)).toEqual({
      used: true,
      keywords: [
        { keyword: 'MUST', certainty: CERTAINTY.DECLARED, inBoilerplate: true, location: { path: 'rfc.middle.t[0].bcp14[0]' } },
        { keyword: 'NOT RECOMMENDED', certainty: CERTAINTY.DECLARED, inBoilerplate: true, location: { path: 'rfc.middle.t[0].bcp14[1]' } },
        { keyword: 'MUST', certainty: CERTAINTY.DECLARED, inBoilerplate: false, location: { path: 'rfc.middle.t[1].bcp14' } },
        { keyword: 'SHOULD', certainty: CERTAINTY.INFERRED, inBoilerplate: false, location: { path: 'rfc.middle.t[1].#text' } }
      ]
    })
  })

  test('keywords of an untagged boilerplate are left out, those after it in the same text used', async () => {
    const doc = await parseXmlDraft({ middle: '<t>The key words "MUST" in this document are to be interpreted as in RFC 2119. Clients MAY retry.</t>' })
    expect(getKeywords(doc)).toEqual({
      used: true,
      keywords: [{ keyword: 'MAY', certainty: CERTAINTY.INFERRED, inBoilerplate: false, location: { path: 'rfc.middle.t' } }]
    })
  })

  test('keywords of cited references are left out', async () => {
    const doc = await parseXmlDraft({ back: '<references><name>Normative References</name><reference anchor="X"><front><title>Y</title><abstract><t>Clients MUST retry.</t></abstract></front></reference></references>' })
    expect(getKeywords(doc)).toEqual({ used: false, keywords: [] })
  })

  test('the boilerplate is inferred, located by the path of its paragraph', async () => {
    const doc = await parseXmlDraft({ middle: `<t>${BOILERPLATE}</t>` })
    expect(getBcp14Boilerplate(doc)).toEqual({
      certainty: CERTAINTY.INFERRED,
      present: true,
      notRecommended: true,
      location: { path: 'rfc.middle.t' }
    })
    const without = await parseXmlDraft({ middle: '<t>Clients MUST retry.</t>' })
    expect(getBcp14Boilerplate(without)).toMatchObject({ present: false, notRecommended: false, location: {} })
  })

  test('references are declared, cited when an <xref> targets them', async () => {
    const doc = await parseXmlDraft({
      middle: '<t>See <xref target="BCP14"/>.</t>',
      back: '<references><name>Normative References</name><reference anchor="RFC8174"><front><title>Z</title></front></reference></references>'
    })
    expect(getBcp14References(doc)).toEqual([
      { id: 'RFC8174', certainty: CERTAINTY.DECLARED, cited: false, location: {} },
      { id: 'BCP14', certainty: CERTAINTY.DECLARED, cited: true, location: {} }
    ])
  })
})
