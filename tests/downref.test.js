import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationWarning, ValidationError, ValidationComment } from '../lib/helpers/error.mjs'
import { baseXMLDoc, baseTXTDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'
import { validateDownrefs, validateNormativeReferences } from '../lib/modules/downref.mjs'
import fetchMock from 'jest-fetch-mock'

expect.extend({
  toContainError
})

beforeEach(() => {
  fetchMock.enableMocks()
})

afterEach(() => {
  fetchMock.resetMocks()
})

describe('validateDownrefs', () => {
  beforeEach(() => {
    fetchMock.disableMocks()
  })

  describe('TXT Document Type', () => {
    test('valid references with no downrefs', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [{ value: '4086' }, { value: '8141' }])
      set(doc, 'data.extractedElements.referenceSectionDraftReferences', [{ value: 'draft-ietf-quic-http-34' }])

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('invalid downref for an RFC', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [{ value: '1234', subsection: 'normative_references' }])
      set(doc, 'data.header.category', 'Internet Standard')

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toContainError('DOWNREF_TO_LOWER_STATUS', ValidationError)
    })

    test('FORGIVE_CHECKLIST mode returns zero warnings', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [{ value: '1094' }])
      set(doc, 'data.extractedElements.referenceSectionDraftReferences', [{ value: 'draft-ietf-quic-http-34' }])

      const result = await validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toHaveLength(0)
    })
  })

  describe('XML Document Type', () => {
    test('valid XML references without downrefs', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            { _attr: { anchor: 'RFC8141' } },
            { _attr: { anchor: 'RFC9114' } }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('invalid XML ref for a draft', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            { _attr: { anchor: 'draft-ietf-emu-aka-pfs-34' } }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('FORGIVE_CHECKLIST mode returns warnings for XML', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            { _attr: { anchor: 'draft-ietf-quic-http-34' } },
            { _attr: { anchor: 'RFC7322' } }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toContainError('DOWNREF_TO_LOWER_STATUS', ValidationWarning)
    })

    test('valid XML references without downrefs (multiple references in a section)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            { _attr: { anchor: 'RFC9114' } },
            { _attr: { anchor: 'RFC8888' } },
            { _attr: { anchor: 'RFC7655' } }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('invalid XML downref when multiple references exist in a section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            { _attr: { anchor: 'RFC2119' } },
            { _attr: { anchor: 'RFC8174' } },
            { _attr: { anchor: 'RFC4187' } } // This is a downref
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })

      expect(result).toContainError('DOWNREF_TO_LOWER_STATUS_IN_REGISTRY', ValidationError)
    })

    test('FORGIVE_CHECKLIST mode returns warnings when multiple references exist', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            { _attr: { anchor: 'RFC4187' } },
            { _attr: { anchor: 'draft-ietf-quic-http-34' } }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toContainError('DOWNREF_TO_LOWER_STATUS_IN_REGISTRY', ValidationWarning)
    })
  })
})

describe('validateNormativeReferences', () => {
  describe('TXT Document Type', () => {
    test('valid normative references', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '4086', subsection: 'normative_references' },
        { value: '8141', subsection: 'normative_references' }
      ])

      fetchMock.mockResponse(JSON.stringify({ status: 'Proposed Standard' }))

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('normative reference with undefined status', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '4086', subsection: 'normative_references' }
      ])

      fetchMock.mockResponse(JSON.stringify({}))

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNDEFINED_STATUS',
          'RFC 4086 does not have a defined status or could not be fetched.',
          { ref: 'https://www.rfc-editor.org/info/rfc4086' }
        )
      ])
    })

    test('normative reference with unknown status', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '8141', subsection: 'normative_references' }
      ])

      fetchMock.mockResponse(JSON.stringify({ status: 'Unknown Status' }))

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNKNOWN_STATUS',
          'RFC 8141 has an unrecognized status: "Unknown Status".',
          { ref: 'https://www.rfc-editor.org/info/rfc8141' }
        )
      ])
    })
  })

  describe('XML Document Type', () => {
    test('valid normative references', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { reference: [{ _attr: { anchor: 'RFC4086' } }] },
        { reference: [{ _attr: { anchor: 'RFC8141' } }] }
      ])

      fetchMock.mockResponse(JSON.stringify({ status: 'Proposed Standard' }))

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('normative reference with undefined status', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { name: 'Normative references', reference: [{ _attr: { anchor: 'RFC4086' } }] }
      ])

      fetchMock.mockResponse(JSON.stringify({}))

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNDEFINED_STATUS',
          'RFC 4086 does not have a defined status or could not be fetched.',
          { ref: 'https://www.rfc-editor.org/info/rfc4086' }
        )
      ])
    })

    test('normative reference with unknown status', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { name: 'Normative references', reference: [{ _attr: { anchor: 'RFC8141' } }] }
      ])

      fetchMock.mockResponse(JSON.stringify({ status: 'Unknown Status' }))

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNKNOWN_STATUS',
          'RFC 8141 has an unrecognized status: "Unknown Status".',
          { ref: 'https://www.rfc-editor.org/info/rfc8141' }
        )
      ])
    })
  })
})
