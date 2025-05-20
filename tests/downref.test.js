import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationWarning, ValidationError, ValidationComment } from '../lib/helpers/error.mjs'
import { baseXMLDoc, baseTXTDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'
import { validateDownrefs, validateInformativeReferences, validateNormativeReferences, validateUnclassifiedReferences, validatePublishedDraftReferences } from '../lib/modules/downref.mjs'
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
      set(doc, 'data.extractedElements.draftStatusReferences', [{ value: 'draft-ietf-quic-http-34' }])

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
      set(doc, 'data.extractedElements.draftStatusReferences', [{ value: 'draft-ietf-quic-http-34' }])

      const result = await validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toHaveLength(0)
    })

    test('FORGIVE_CHECKLIST mode returns warning on non RFC non draft reference', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [{ value: '1094', subsection: 'normative_references' }])
      set(doc, 'data.extractedElements.draftStatusReferences', [{ value: 'ISO10589', subsection: 'normative_references' }])

      const result = await validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toHaveLength(1)
      expect(result).toContainError('POSSIBLE_DOWNREF', ValidationWarning)
    })
  })

  describe('XML Document Type', () => {
    test('valid XML references without downrefs', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            {
              _attr: { anchor: 'RFC8141' },
              seriesInfo: [
                { _attr: { name: 'RFC', value: '8141' } }
              ]
            },
            {
              _attr: { anchor: 'RFC9114' },
              seriesInfo: [
                { _attr: { name: 'RFC', value: '9114' } }
              ]
            }
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
            {
              _attr: { anchor: 'draft-ietf-emu-aka-pfs-34' },
              seriesInfo: [
                { _attr: { name: 'Internet-Draft', value: 'draft-ietf-emu-aka-pfs-34' } }
              ]
            }
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
            {
              _attr: { anchor: 'draft-ietf-quic-http-34' },
              seriesInfo: [
                { _attr: { name: 'Internet-Draft', value: 'draft-ietf-quic-http-34' } }
              ]
            },
            {
              _attr: { anchor: 'RFC7322' },
              seriesInfo: [
                { _attr: { name: 'RFC', value: '7322' } }
              ]
            }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toContainError('POSSIBLE_DOWNREF', ValidationWarning)
    })

    test('valid XML references without downrefs (multiple references in a section)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            {
              _attr: { anchor: 'RFC9114' },
              seriesInfo: [{ _attr: { name: 'RFC', value: '9114' } }]
            },
            {
              _attr: { anchor: 'RFC8888' },
              seriesInfo: [{ _attr: { name: 'RFC', value: '8888' } }]
            },
            {
              _attr: { anchor: 'RFC7655' },
              seriesInfo: [{ _attr: { name: 'RFC', value: '7655' } }]
            }
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
            {
              _attr: { anchor: 'RFC2119' },
              seriesInfo: [{ _attr: { name: 'RFC', value: '2119' } }]
            },
            {
              _attr: { anchor: 'RFC8174' },
              seriesInfo: [{ _attr: { name: 'RFC', value: '8174' } }]
            },
            {
              _attr: { anchor: 'RFC4187' }, // This is a downref
              seriesInfo: [{ _attr: { name: 'RFC', value: '4187' } }]
            }
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
            {
              _attr: { anchor: 'RFC4187' },
              seriesInfo: [{ _attr: { name: 'RFC', value: '4187' } }]
            },
            {
              _attr: { anchor: 'draft-ietf-quic-http-34' },
              seriesInfo: [
                { _attr: { name: 'Internet-Draft', value: 'draft-ietf-quic-http-34' } }
              ]
            }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toContainError('DOWNREF_TO_LOWER_STATUS_IN_REGISTRY', ValidationWarning)
    })

    test('FORGIVE_CHECKLIST mode returns warnings when multiple references exist', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            {
              _attr: { anchor: 'RFC4187' },
              seriesInfo: [
                { _attr: { name: 'RFC',           value: '4187' } }
              ]
            },
            {
              _attr: { anchor: 'draft-ietf-quic-http-34' },
              seriesInfo: [
                { _attr: { name: 'Internet-Draft', value: 'draft-ietf-quic-http-34' } }
              ]
            }
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

      fetchMock.mockResponse(JSON.stringify({ status: 'Proposed Standard', obsoleted_by: [] }))

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

      fetchMock.mockResponse(JSON.stringify({ status: 'Unknown Status', obsoleted_by: [] }))

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNKNOWN_STATUS',
          'RFC 8141 has an unrecognized status: "Unknown Status".',
          { ref: 'https://www.rfc-editor.org/info/rfc8141' }
        )
      ])
    })

    test('normative reference to an obsolete RFC', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '4086', subsection: 'normative_references' }
      ])

      fetchMock.mockResponse(
        JSON.stringify({ status: 'Proposed Standard', obsoleted_by: ['9000'] })
      )

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'OBSOLETE_DOCUMENT',
          message: expect.stringContaining('RFC 4086 is obsolete and has been replaced by: 9000.')
        })
      )
    })

    test('FORGIVE_CHECKLIST mode for an obsolete RFC', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '4086', subsection: 'normative_references' }
      ])

      fetchMock.mockResponse(
        JSON.stringify({ status: 'Proposed Standard', obsoleted_by: ['9000'] })
      )

      const result = await validateNormativeReferences(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'OBSOLETE_DOCUMENT',
          message: expect.stringContaining('RFC 4086 is obsolete and has been replaced by: 9000.')
        })
      )
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

      fetchMock.mockResponse(JSON.stringify({ status: 'Unknown Status', obsoleted_by: [] }))

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

describe('validateUnclassifiedReferences', () => {
  describe('TXT Document Type', () => {
    test('unclassified reference to an obsolete RFC', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '4086', subsection: 'unclassified_references' }
      ])

      fetchMock.mockResponse(
        JSON.stringify({ status: 'Proposed Standard', obsoleted_by: ['9000'] })
      )

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.NORMAL })
      expect(result).toContainError('OBSOLETE_UNCLASSIFIED_REFERENCE', ValidationError)
    })

    test('FORGIVE_CHECKLIST mode for an obsolete unclassified RFC', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '4086', subsection: 'unclassified_references' }
      ])

      fetchMock.mockResponse(
        JSON.stringify({ status: 'Proposed Standard', obsoleted_by: ['9000'] })
      )

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toContainError('OBSOLETE_UNCLASSIFIED_REFERENCE', ValidationWarning)
    })
  })

  describe('XML Document Type', () => {
    test('unclassified reference to an obsolete RFC', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { name: 'Other References', reference: [{ _attr: { anchor: 'RFC4086' } }] }
      ])

      fetchMock.mockResponse(
        JSON.stringify({ status: 'Proposed Standard', obsoleted_by: ['9000'] })
      )

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.NORMAL })
      expect(result).toContainError('OBSOLETE_UNCLASSIFIED_REFERENCE', ValidationError)
    })

    test('FORGIVE_CHECKLIST mode for an obsolete unclassified RFC', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { name: 'Other References', reference: [{ _attr: { anchor: 'RFC4086' } }] }
      ])

      fetchMock.mockResponse(
        JSON.stringify({ status: 'Proposed Standard', obsoleted_by: ['9000'] })
      )

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toContainError('OBSOLETE_UNCLASSIFIED_REFERENCE', ValidationWarning)
    })

    test('unclassified reference with undefined status', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { name: 'Other References', reference: [{ _attr: { anchor: 'RFC1234' } }] }
      ])

      fetchMock.mockResponse(JSON.stringify({}))

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNDEFINED_STATUS',
          'RFC 1234 does not have a defined status or could not be fetched',
          { ref: 'https://www.rfc-editor.org/info/rfc1234' }
        )
      ])
    })

    test('unclassified reference with unknown status', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { name: 'Other References', reference: [{ _attr: { anchor: 'RFC5678' } }] }
      ])

      fetchMock.mockResponse(JSON.stringify({ obsoleted_by: [] }))

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNDEFINED_STATUS',
          'RFC 5678 does not have a defined status or could not be fetched',
          { ref: 'https://www.rfc-editor.org/info/rfc5678' }
        )
      ])
    })
  })
})

describe('Validating published as a RFC draft references', () => {
  describe('TXT Document Type', () => {
    test('should return no warnings for valid drafts with defined states', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.draftStatusReferences', [
        { value: 'draft-ietf-example-01' },
        { value: 'draft-ietf-example-02' }
      ])

      fetchMock.mockResponses(
        JSON.stringify({ state: 'Active' }),
        JSON.stringify({ state: 'Active' })
      )

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('should return warning for drafts with undefined states', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.draftStatusReferences', [
        { value: 'draft-ietf-undefined-state' }
      ])

      fetchMock.mockResponseOnce(JSON.stringify({}))

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'UNDEFINED_STATE',
          'The draft reference draft-ietf-undefined-state does not have a defined state or could not be fetched.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-undefined-state' }
        )
      ])
    })

    test('should strip leading I-D. prefix before validation (TXT)', async () => {
      const doc = cloneDeep(baseTXTDoc)
      // simulate a two-part reference with an I-D. prefix
      set(doc, 'data.extractedElements.draftStatusReferences', [
        { value: 'I-D.draft-ietf-rtgwg-segment-routing-ti-lfa' }
      ])

      fetchMock.mockResponseOnce(JSON.stringify({}))

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'UNDEFINED_STATE',
          'The draft reference draft-ietf-rtgwg-segment-routing-ti-lfa does not have a defined state or could not be fetched.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-rtgwg-segment-routing-ti-lfa' }
        )
      ])
    })

    test('should return warning for drafts published as RFCs', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.draftStatusReferences', [
        { value: 'draft-ietf-published-as-rfc' }
      ])

      fetchMock.mockResponseOnce(JSON.stringify({ state: 'RFC' }))

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'INVALID_STATE_FOR_DRAFT',
          'The draft reference draft-ietf-published-as-rfc is already published as an RFC and should not be referenced as a draft.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-published-as-rfc' }
        )
      ])
    })

    test('should return no warnings in SUBMISSION mode', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.draftStatusReferences', [
        { value: 'draft-ietf-example-01' }
      ])

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.SUBMISSION })
      expect(result).toHaveLength(0)
    })
  })

  describe('XML Document Type', () => {
    test('should return no warnings for valid draft references', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { reference: [{ _attr: { anchor: 'draft-ietf-example-01' } }] },
        { reference: [{ _attr: { anchor: 'draft-ietf-example-02' } }] }
      ])

      fetchMock.mockResponses(
        JSON.stringify({ state: 'Active' }),
        JSON.stringify({ state: 'Active' })
      )

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('should return warning for drafts with undefined states', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { reference: [{ _attr: { anchor: 'draft-ietf-undefined-state' } }] }
      ])

      fetchMock.mockResponseOnce(JSON.stringify({}))

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'UNDEFINED_STATE',
          'The draft reference draft-ietf-undefined-state does not have a defined state or could not be fetched.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-undefined-state' }
        )
      ])
    })

    test('should strip leading I-D. prefix before validation (XML)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      // simulate a reference that starts with "I-D."
      set(doc, 'data.rfc.back.references.references', [
        { reference: [{ _attr: { anchor: 'I-D.draft-ietf-rtgwg-segment-routing-ti-lfa' } }] }
      ])

      fetchMock.mockResponseOnce(JSON.stringify({}))

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'UNDEFINED_STATE',
          'The draft reference draft-ietf-rtgwg-segment-routing-ti-lfa does not have a defined state or could not be fetched.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-rtgwg-segment-routing-ti-lfa' }
        )
      ])
    })

    test('should return warning for drafts published as RFCs', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { reference: [{ _attr: { anchor: 'draft-ietf-published-as-rfc' } }] }
      ])

      fetchMock.mockResponseOnce(JSON.stringify({ state: 'RFC' }))

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'INVALID_STATE_FOR_DRAFT',
          'The draft reference draft-ietf-published-as-rfc is already published as an RFC and should not be referenced as a draft.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-published-as-rfc' }
        )
      ])
    })

    test('should return no warnings in SUBMISSION mode (XML)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { reference: [{ _attr: { anchor: 'draft-ietf-example-01' } }] }
      ])

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.SUBMISSION })
      expect(result).toHaveLength(0)
    })
  })
})

describe('validateInformativeReferences', () => {
  test('valid informative references', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.referenceSectionRfc', [
      { value: '4086', subsection: 'informative_references' },
      { value: '8141', subsection: 'informative_references' }
    ])

    fetchMock.mockResponse(JSON.stringify({ status: 'Informational', obsoleted_by: [] }))

    const result = await validateInformativeReferences(doc, { mode: MODES.NORMAL })
    expect(result).toHaveLength(0)
  })

  test('informative reference with undefined status', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.referenceSectionRfc', [
      { value: '4086', subsection: 'informative_references' }
    ])

    fetchMock.mockResponse(JSON.stringify({}))

    const result = await validateInformativeReferences(doc, { mode: MODES.NORMAL })
    expect(result).toEqual([
      new ValidationComment(
        'UNDEFINED_STATUS',
        'The informative reference RFC 4086 does not have a defined status or could not be fetched.',
        { ref: 'https://www.rfc-editor.org/info/rfc4086' }
      )
    ])
  })

  test('informative reference to an obsolete RFC', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.referenceSectionRfc', [
      { value: '4086', subsection: 'informative_references' }
    ])

    fetchMock.mockResponse(
      JSON.stringify({ status: 'Informational', obsoleted_by: ['9000'] })
    )

    const result = await validateInformativeReferences(doc, { mode: MODES.NORMAL })
    expect(result).toContainEqual(
      expect.objectContaining({
        name: 'OBSOLETE_INFORMATIVE_REFERENCE',
        message: expect.stringContaining('The informative reference RFC 4086 is obsolete and has been replaced by: 9000.')
      })
    )
  })

  test('FORGIVE_CHECKLIST mode for an obsolete informative RFC', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.referenceSectionRfc', [
      { value: '4086', subsection: 'informative_references' }
    ])

    fetchMock.mockResponse(
      JSON.stringify({ status: 'Informational', obsoleted_by: ['9000'] })
    )

    const result = await validateInformativeReferences(doc, { mode: MODES.FORGIVE_CHECKLIST })
    expect(result).toContainEqual(
      expect.objectContaining({
        name: 'OBSOLETE_INFORMATIVE_REFERENCE',
        message: expect.stringContaining('The informative reference RFC 4086 is obsolete and has been replaced by: 9000.')
      })
    )
  })
})
