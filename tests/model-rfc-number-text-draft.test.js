import { describe, expect, test } from 'vitest'
import { CERTAINTY } from '../lib/model/indexes.mjs'
import { getRfcNumber } from '../lib/model/metadata.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
import { txtStreamDraft, txtStreamRfc } from './fixtures/stream-docs.mjs'

const NO_NUMBER = { certainty: CERTAINTY.INFERRED, number: null, location: {} }

describe('a text document with the Internet-Draft header line has no RFC number', () => {
  test('even with a Request for Comments: line', async () => {
    const text = txtStreamDraft('draft-ietf-foo-bar-02').replace(/^(Internet-Draft .*)$/m, '$1\nRequest for Comments: 9051')
    const doc = await parseTXT(text, 'draft-ietf-foo-bar-02.txt')
    expect(doc.data.header.rfcNumber).toBe('9051')
    expect(getRfcNumber(doc)).toEqual(NO_NUMBER)
  })

  test('even when named rfcNNNN.txt', async () => {
    const doc = await parseTXT(txtStreamDraft('draft-ietf-foo-bar-02'), 'rfc9051.txt')
    expect(doc.data.header.rfcNumber).toBe('9051')
    expect(getRfcNumber(doc)).toEqual(NO_NUMBER)
  })
})

describe('a text RFC keeps its RFC number', () => {
  test('from the Request for Comments: line', async () => {
    const doc = await parseTXT(txtStreamRfc('Internet Engineering Task Force (IETF)', '9051'), 'paper.txt')
    expect(getRfcNumber(doc)).toEqual({ certainty: CERTAINTY.INFERRED, number: '9051', location: {} })
  })

  test('from its rfcNNNN.txt name without a Request for Comments: line', async () => {
    const text = txtStreamRfc('Internet Engineering Task Force (IETF)', '9051').replace(/^Request for Comments: .*\n/m, '')
    const doc = await parseTXT(text, 'rfc9051.txt')
    expect(getRfcNumber(doc)).toEqual({ certainty: CERTAINTY.INFERRED, number: '9051', location: {} })
  })
})
