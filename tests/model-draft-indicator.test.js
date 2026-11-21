import { describe, expect, test } from 'vitest'
import { CERTAINTY } from '../lib/model/indexes.mjs'
import { getDraftIndicator } from '../lib/model/metadata.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
import { txtStreamDraft, txtStreamRfc, xmlStreamDoc } from './fixtures/stream-docs.mjs'

describe('whether a text document says it is an Internet-Draft is inferred', () => {
  test('from the Internet-Draft header line, read once per document', async () => {
    const doc = await parseTXT(txtStreamDraft('draft-ietf-foo-bar-02'), 'draft-ietf-foo-bar-02.txt')
    const answer = getDraftIndicator(doc)
    expect(answer).toEqual({ certainty: CERTAINTY.INFERRED, present: true, location: {} })
    expect(getDraftIndicator(doc)).toBe(answer)
  })

  test('even when the parser takes it for an RFC by its file name', async () => {
    const doc = await parseTXT(txtStreamDraft('draft-ietf-foo-bar-02'), 'rfc9051.txt')
    expect(doc.docKind).toBe('rfc')
    expect(getDraftIndicator(doc).present).toBe(true)
  })

  test('not for an RFC', async () => {
    const doc = await parseTXT(txtStreamRfc('Internet Engineering Task Force (IETF)', '9051'), 'rfc9051.txt')
    expect(getDraftIndicator(doc)).toEqual({ certainty: CERTAINTY.INFERRED, present: false, location: {} })
  })
})

describe('whether an XML document says it is an Internet-Draft is declared', () => {
  test('by an Internet-Draft <seriesInfo>', async () => {
    const { doc } = await parse(xmlStreamDoc(), 'draft-smith-foo-bar-02.xml')
    expect(getDraftIndicator(doc)).toEqual({ certainty: CERTAINTY.DECLARED, present: true, location: { path: 'rfc.front.seriesInfo' } })
  })

  test('not without one', async () => {
    const { doc } = await parse(xmlStreamDoc({ number: '9051' }), 'rfc9051.xml')
    expect(getDraftIndicator(doc)).toEqual({ certainty: CERTAINTY.DECLARED, present: false, location: {} })
  })
})
