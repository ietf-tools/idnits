import { describe, expect, test } from 'vitest'
import { CERTAINTY } from '../lib/model/indexes.mjs'
import { getRfcNumber } from '../lib/model/metadata.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
import { txtStreamDraft, txtStreamRfc, xmlStreamDoc } from './fixtures/stream-docs.mjs'

describe('the RFC number of a text document is inferred', () => {
  test('from the Request for Comments: line, without leading zeros, read once per document', async () => {
    const doc = await parseTXT(txtStreamRfc('Internet Engineering Task Force (IETF)', '0791'), 'rfc791.txt')
    const answer = getRfcNumber(doc)
    expect(answer).toEqual({ certainty: CERTAINTY.INFERRED, number: '791', location: {} })
    expect(getRfcNumber(doc)).toBe(answer)
  })

  test('none for a draft', async () => {
    const doc = await parseTXT(txtStreamDraft('draft-ietf-foo-bar-02'), 'draft-ietf-foo-bar-02.txt')
    expect(getRfcNumber(doc)).toEqual({ certainty: CERTAINTY.INFERRED, number: null, location: {} })
  })
})

describe('the RFC number of an XML document is declared', () => {
  test('by the number attribute of <rfc>', async () => {
    const { doc } = await parse(xmlStreamDoc({ number: '9051' }), 'rfc9051.xml')
    expect(getRfcNumber(doc)).toEqual({ certainty: CERTAINTY.DECLARED, number: '9051', location: { path: 'rfc.number' } })
  })

  test('else by the RFC <seriesInfo>', async () => {
    const { doc } = await parse(xmlStreamDoc({ number: '9051' }).replace(' number="9051"', ''), 'rfc9051.xml')
    expect(getRfcNumber(doc)).toEqual({ certainty: CERTAINTY.DECLARED, number: '9051', location: { path: 'rfc.front.seriesInfo' } })
  })

  test('none for a draft', async () => {
    const { doc } = await parse(xmlStreamDoc(), 'draft-smith-foo-bar-02.xml')
    expect(getRfcNumber(doc)).toEqual({ certainty: CERTAINTY.DECLARED, number: null, location: {} })
  })
})
