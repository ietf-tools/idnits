import { describe, expect, test } from 'vitest'
import { CERTAINTY } from '../lib/model/indexes.mjs'
import { getMentions } from '../lib/model/mentions.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'

// Lines of a text draft with an address found twice and an IPv6 address
const TXT = `
   The server at 192.0.2.300 answers.

   Then 192.0.2.300 and 2001:db8::1 answer.
`

/**
 * Parse an XML draft with the given <middle> and <back>
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

describe('mentions in a text document are inferred, located by line', () => {
  test('every time a mention is found, at its own line', async () => {
    const doc = await parseTXT(TXT, 'draft-test-00.txt')
    expect(await getMentions(doc, 'ipv4')).toEqual([
      { text: '192.0.2.300', certainty: CERTAINTY.INFERRED, location: { lines: [{ line: 2, pos: 18 }] } },
      { text: '192.0.2.300', certainty: CERTAINTY.INFERRED, location: { lines: [{ line: 4, pos: 9 }] } }
    ])
    expect(await getMentions(doc, 'ipv6')).toEqual([
      { text: '2001:db8::1', certainty: CERTAINTY.INFERRED, location: { lines: [{ line: 4, pos: 25 }] } }
    ])
  })

  test('a mention of unknown location, and the answer read once per document', async () => {
    const doc = { type: 'txt', data: { extractedElements: { ipv4: ['192.0.2.1'] } } }
    const mentions = await getMentions(doc, 'ipv4')
    expect(mentions).toEqual([{ text: '192.0.2.1', certainty: CERTAINTY.INFERRED, location: { lines: undefined } }])
    expect(await getMentions(doc, 'ipv4')).toBe(mentions)
    expect(await getMentions(doc, 'ipv6')).toEqual([])
  })
})

describe('mentions in an XML document are inferred, located by path', () => {
  test('every time a mention is found, with the value it is in', async () => {
    const doc = await parseXmlDraft({
      middle: '<section><name>Addresses</name><t>Use 192.0.2.1 or 2001:db8::1.</t><t>Not 192.0.2.300.</t></section>'
    })
    const ipv4 = await getMentions(doc, 'ipv4')
    const ipv6 = await getMentions(doc, 'ipv6')
    expect(ipv4).toMatchObject([
      { text: '192.0.2.1', certainty: CERTAINTY.INFERRED, location: { path: 'rfc.middle.section.t[0]' } },
      { text: '192.0.2.300', certainty: CERTAINTY.INFERRED, location: { path: 'rfc.middle.section.t[1]' } }
    ])
    expect(ipv6).toMatchObject([{ text: '2001:db8::1', certainty: CERTAINTY.INFERRED, location: { path: 'rfc.middle.section.t[0]' } }])
    // -> Mentions in the same value share its number, and the numbers follow document order
    expect(ipv6[0].valueIndex).toBe(ipv4[0].valueIndex)
    expect(ipv4[1].valueIndex).toBeGreaterThan(ipv4[0].valueIndex)
  })

  test('the text of cited references is left out', async () => {
    const doc = await parseXmlDraft({
      back: `<references><name>Normative References</name>
        <reference anchor="A" target="http://192.0.2.1/"><front><title>At 192.0.2.2</title></front></reference>
      </references>`
    })
    expect(await getMentions(doc, 'ipv4')).toEqual([])
  })
})
