import { beforeAll, afterEach, afterAll, describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationWarning, ValidationComment } from '../lib/helpers/error.mjs'
import {
  validateDate,
  validateCategory,
  validateObsoleteUpdateRef,
  validateVersion
} from '../lib/modules/metadata.mjs'
import { baseTXTDoc, baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'
import { DateTime } from 'luxon'
import { abstractTXTBlock } from './fixtures/txt-blocks/section-blocks.mjs'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

expect.extend({
  toContainError
})

export const mockRestHandlers = [
  http.get('https://www.rfc-editor.org/rfc/rfc1235.json', () => {
    return HttpResponse.json({ obsoleted_by: ['3456'] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc1264.json', () => {
    return HttpResponse.json({ obsoleted_by: ['3456'] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc1236.json', () => {
    return HttpResponse.json({ updated_by: ['3456'] })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-ietf-beep-boop/', () => {
    return HttpResponse.json({ rev: '00' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-ietf-beep-baap/', () => {
    return HttpResponse.json({ rev: '08' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-ietf-beep-biip/', () => {
    return HttpResponse.json({ rev: '02' })
  }),
  http.all('*', () => {
    return new HttpResponse(null, { status: 404 })
  })
]

const server = setupServer(...mockRestHandlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('document should have valid date', () => {
  describe('document should have valid obsolete/update references in text', () => {
    test('RFC in obsoletes metadata but missing in abstract', async () => {
      const doc = {
        type: 'txt',
        data: {
          content: {
            abstract: ['This document updates RFC 1234.']
          },
          extractedElements: {
            obsoletesRfc: ['5678'],
            updatesRfc: ['1234']
          }
        }
      }

      const result = await validateObsoleteUpdateRef(doc)

      expect(result).toContainEqual(
        new ValidationComment(
          'OBSOLETES_NOT_IN_ABSTRACT',
          'RFC 5678 is listed as "obsoleted" in metadata but is not mentioned in the abstract.',
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'data.content.abstract'
          }
        )
      )
    })

    test('RFC in updates metadata but missing in abstract', async () => {
      const doc = {
        type: 'txt',
        data: {
          content: {
            abstract: ['This document obsoletes RFC 5678.']
          },
          extractedElements: {
            obsoletesRfc: ['5678'],
            updatesRfc: ['1234']
          }
        }
      }

      const result = await validateObsoleteUpdateRef(doc)

      expect(result).toContainEqual(
        new ValidationComment(
          'UPDATES_NOT_IN_ABSTRACT',
          'RFC 1234 is listed as "updated" in metadata but is not mentioned in the abstract.',
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'data.content.abstract'
          }
        )
      )
    })

    test('RFC mentioned in abstract but not in obsoletes metadata', async () => {
      const doc = {
        type: 'txt',
        data: {
          content: {
            abstract: ['This document obsoletes RFC 5678.']
          },
          extractedElements: {
            obsoletesRfc: [],
            updatesRfc: []
          }
        }
      }

      const result = await validateObsoleteUpdateRef(doc)

      expect(result).toEqual([
        new ValidationComment(
          'MENTIONED_NOT_IN_OBSOLETES',
          'RFC 5678 is mentioned as "obsoleted" or "replaced" in the abstract but not listed in metadata.',
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'data.content.abstract'
          }
        )
      ])
    })

    test('RFC mentioned in abstract but not in updates metadata', async () => {
      const doc = {
        type: 'txt',
        data: {
          content: {
            abstract: ['This document updates RFC 1234.']
          },
          extractedElements: {
            obsoletesRfc: [],
            updatesRfc: []
          }
        }
      }

      const result = await validateObsoleteUpdateRef(doc)

      expect(result).toEqual([
        new ValidationComment(
          'MENTIONED_NOT_IN_UPDATES',
          'RFC 1234 is mentioned as "updated" in the abstract but not listed in metadata.',
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'data.content.abstract'
          }
        )
      ])
    })

    test('Abstract is empty, but metadata contains obsoletes/updates', async () => {
      const doc = {
        type: 'txt',
        data: {
          content: {
            abstract: []
          },
          extractedElements: {
            obsoletesRfc: ['5678'],
            updatesRfc: ['1234']
          }
        }
      }

      const result = await validateObsoleteUpdateRef(doc)

      expect(result).toContainEqual(
        new ValidationComment(
          'OBSOLETES_NOT_IN_ABSTRACT',
          'RFC 5678 is listed as "obsoleted" in metadata but is not mentioned in the abstract.',
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'data.content.abstract'
          }
        )
      )
      expect(result).toContainEqual(
        new ValidationComment(
          'UPDATES_NOT_IN_ABSTRACT',
          'RFC 1234 is listed as "updated" in metadata but is not mentioned in the abstract.',
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'data.content.abstract'
          }
        )
      )
    })

    test('All obsoletes/updates are properly mentioned in abstract', async () => {
      const doc = {
        type: 'txt',
        data: {
          content: {
            abstract: [
              'This document obsoletes RFC 5678 and updates RFC 1234. Both changes aim to improve compatibility.'
            ]
          },
          extractedElements: {
            obsoletesRfc: ['5678'],
            updatesRfc: ['1234']
          }
        }
      }

      const result = await validateObsoleteUpdateRef(doc)

      expect(result).not.toContainError('OBSOLETES_NOT_IN_ABSTRACT')
      expect(result).not.toContainError('UPDATES_NOT_IN_ABSTRACT')
    })

    test('No obsoletes/updates metadata and no mentions in abstract', async () => {
      const doc = {
        type: 'txt',
        data: {
          content: {
            abstract: ['This document provides new guidelines for implementation.']
          },
          extractedElements: {
            obsoletesRfc: [],
            updatesRfc: []
          }
        }
      }

      const result = await validateObsoleteUpdateRef(doc)

      expect(result).toEqual([])
    })

    test('Abstract mentions RFCs only as references but no metadata mismatch', async () => {
      const doc = {
        type: 'txt',
        data: {
          content: {
            abstract: [
              'This document provides additional insights for RFC 2119 and its applicability.'
            ]
          },
          extractedElements: {
            obsoletesRfc: [],
            updatesRfc: []
          }
        }
      }

      const result = await validateObsoleteUpdateRef(doc)

      expect(result).toEqual([])
    })

    test('Obsoletes a non-existant RFC', async () => {
      const doc = baseTXTDoc
      doc.data.extractedElements.obsoletesRfc = ['1234, 2345']
      doc.data.content.abstract = abstractTXTBlock.split('\n')

      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('OBSOLETES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })

    test('Obsoletes an already obsoleted RFC', async () => {
      const doc = baseTXTDoc
      doc.data.extractedElements.obsoletesRfc = ['1235']
      doc.data.content.abstract = abstractTXTBlock.split('\n')

      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('OBSOLETES_OBSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_OBSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })

    test('Updates a non-existant RFC', async () => {
      const doc = baseTXTDoc
      doc.data.extractedElements.updatesRfc = ['1234, 2345']
      doc.data.content.abstract = abstractTXTBlock.split('\n')

      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('UPDATES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })

    test('Updates an already obsoleted RFC', async () => {
      const doc = baseTXTDoc

      doc.data.extractedElements.updatesRfc = ['1264']
      doc.data.content.abstract = abstractTXTBlock.split('\n')

      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('UPDATES_OBSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_OBSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
  })

  describe('XML Document Type', () => {
    test('valid date', async () => {
      const doc = cloneDeep(baseXMLDoc)
      const today = DateTime.now()

      set(doc, 'data.rfc.front.date._attr', {
        year: today.year,
        month: today.monthLong,
        day: today.day
      })
      await expect(validateDate(doc)).resolves.toHaveLength(0)
    })
    test('non-ascii month is reported, not thrown', async () => {
      const doc = cloneDeep(baseXMLDoc)
      const today = DateTime.now()

      set(doc, 'data.rfc.front.date._attr', {
        year: today.year,
        month: '8月',
        day: today.day
      })
      await expect(validateDate(doc)).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
    })
    test('date missing', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front', {})
      await expect(validateDate(doc)).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
      await expect(validateDate(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
      await expect(validateDate(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
    })
    test('date in the past', async () => {
      const doc = cloneDeep(baseXMLDoc)
      const today = DateTime.now().minus({ days: 15 })
      set(doc, 'data.rfc.front.date._attr', {
        year: today.year,
        month: today.monthLong,
        day: today.day
      })
      await expect(validateDate(doc)).resolves.toContainError('DOC_DATE_IN_PAST', ValidationWarning)
      await expect(validateDate(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('DOC_DATE_IN_PAST', ValidationWarning)
      await expect(validateDate(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('DOC_DATE_IN_PAST', ValidationWarning)
    })
    test('date in the future', async () => {
      const doc = cloneDeep(baseXMLDoc)
      const today = DateTime.now().plus({ days: 15 })
      set(doc, 'data.rfc.front.date._attr', {
        year: today.year,
        month: today.monthLong,
        day: today.day
      })
      await expect(validateDate(doc)).resolves.toContainError('DOC_DATE_IN_FUTURE', ValidationWarning)
      await expect(validateDate(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('DOC_DATE_IN_FUTURE', ValidationWarning)
      await expect(validateDate(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('DOC_DATE_IN_FUTURE', ValidationWarning)
    })
  })

  describe('TXT Document Type', () => {
    test('valid date', async () => {
      const today = DateTime.now().setLocale('en-US')
      const doc = baseTXTDoc

      doc.data.header.date = {
        year: today.year,
        month: today.monthLong,
        day: today.day
      }
      await expect(validateDate(doc)).resolves.toHaveLength(0)
    })
    test('date missing', async () => {
      const doc = baseTXTDoc
      doc.data.header.date = {}
      await expect(validateDate(doc)).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
      await expect(validateDate(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
      await expect(validateDate(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
    })
    test('date in the past', async () => {
      const doc = baseTXTDoc
      const today = DateTime.now().setLocale('en-US').minus({ days: 15 })

      doc.data.header.date = {
        year: today.year,
        month: today.monthLong,
        day: today.day
      }
      await expect(validateDate(doc)).resolves.toContainError('DOC_DATE_IN_PAST', ValidationWarning)
      await expect(validateDate(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('DOC_DATE_IN_PAST', ValidationWarning)
      await expect(validateDate(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('DOC_DATE_IN_PAST', ValidationWarning)
    })
    test('date in the future', async () => {
      const doc = baseTXTDoc
      const today = DateTime.now().setLocale('en-US').plus({ days: 15 })

      doc.data.header.date = {
        year: today.year,
        month: today.monthLong,
        day: today.day
      }
      await expect(validateDate(doc)).resolves.toContainError('DOC_DATE_IN_FUTURE', ValidationWarning)
      await expect(validateDate(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('DOC_DATE_IN_FUTURE', ValidationWarning)
      await expect(validateDate(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('DOC_DATE_IN_FUTURE', ValidationWarning)
    })
    test('abbreviated month', async () => {
      const doc = baseTXTDoc
      const today = DateTime.now().setLocale('en-US').minus({ days: 15 })

      doc.data.header.date = {
        year: today.year,
        month: today.monthShort,
        day: today.day
      }
      await expect(validateDate(doc)).resolves.toContainError('DOC_DATE_IN_PAST', ValidationWarning)
    })
    test('unparseable month is reported, not thrown', async () => {
      const doc = baseTXTDoc
      const today = DateTime.now().setLocale('en-US')

      doc.data.header.date = {
        year: today.year,
        month: 'Augst',
        day: today.day
      }
      await expect(validateDate(doc)).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
    })
  })
})

describe('document should have valid category', () => {
  describe('XML Document Type', () => {
    test('valid category', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        category: 'std',
        docName: 'draft-ietf-beep-boop'
      })
      await expect(validateCategory(doc)).resolves.toHaveLength(0)
    })
    test('missing category for a draft', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        docName: 'draft-ietf-beep-boop'
      })
      await expect(validateCategory(doc)).resolves.toHaveLength(0)
    })
    test('missing category for a rfc doc', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        docName: 'beep-boop'
      })
      await expect(validateCategory(doc)).resolves.toContainError('MISSING_DOC_CATEGORY', ValidationWarning)
      await expect(validateCategory(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_DOC_CATEGORY', ValidationWarning)
      await expect(validateCategory(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('MISSING_DOC_CATEGORY', ValidationWarning)
    })
    test('invalid category', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        category: 'xyz123',
        docName: 'draft-beep-boop'
      })
      await expect(validateCategory(doc)).resolves.toContainError('INVALID_DOC_CATEGORY', ValidationWarning)
      await expect(validateCategory(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_DOC_CATEGORY', ValidationWarning)
      await expect(validateCategory(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('INVALID_DOC_CATEGORY', ValidationWarning)
    })
  })

  describe('TXT Document Type', () => {
    test('valid category', async () => {
      const doc = baseTXTDoc
      doc.data.header.intendedStatus = 'Standards Track'
      doc.data.slug = 'draft-ietf-beep-boop'

      await expect(validateCategory(doc)).resolves.toHaveLength(0)
    })
    test('missing category for a draft', async () => {
      const doc = baseTXTDoc
      doc.data.slug = 'draft-ietf-beep-boop'

      await expect(validateCategory(doc)).resolves.toHaveLength(0)
    })
    test('missing category for a rfc doc', async () => {
      const doc = baseTXTDoc
      doc.data.slug = 'beep-boop'
      doc.data.header.intendedStatus = null

      await expect(validateCategory(doc)).resolves.toContainError('MISSING_DOC_CATEGORY', ValidationWarning)
      await expect(validateCategory(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_DOC_CATEGORY', ValidationWarning)
      await expect(validateCategory(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('MISSING_DOC_CATEGORY', ValidationWarning)
    })
    test('invalid category', async () => {
      const doc = baseTXTDoc
      doc.data.header.intendedStatus = 'xyz123'
      doc.data.slug = 'draft-beep-boop'
      await expect(validateCategory(doc)).resolves.toContainError('INVALID_DOC_CATEGORY', ValidationWarning)
      await expect(validateCategory(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_DOC_CATEGORY', ValidationWarning)
      await expect(validateCategory(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('INVALID_DOC_CATEGORY', ValidationWarning)
    })
  })
})

describe('document should have valid obsoletes / updates references', () => {
  describe('XML Document Type', () => {
    test('valid obsoletes reference', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        obsoletes: '1234, 2345'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document obsoletes RFC 1234 and 2345.')
      await expect(validateObsoleteUpdateRef(doc, { offline: true })).resolves.toHaveLength(0)
    })
    test('valid updates reference', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        updates: '1234,2345'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document updates RFC 1234, 2345.')
      await expect(validateObsoleteUpdateRef(doc, { offline: true })).resolves.toHaveLength(0)
    })
    test('obsoletes in rfc but missing in abstract', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        obsoletes: '1234'
      })
      set(doc, 'data.rfc.front.abstract.t', 'Beep boop.')
      await expect(validateObsoleteUpdateRef(doc, { offline: true })).resolves.toContainError('OBSOLETES_NOT_IN_ABSTRACT', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { offline: true, mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_NOT_IN_ABSTRACT', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { offline: true, mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('obsoletes in abstract but missing in rfc', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.abstract.t', 'This document obsoletes RFC 1234.')
      await expect(validateObsoleteUpdateRef(doc, { offline: true })).resolves.toContainError('OBSOLETES_NOT_IN_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { offline: true, mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_NOT_IN_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { offline: true, mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('updates in rfc but missing in abstract', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        updates: '1234'
      })
      set(doc, 'data.rfc.front.abstract.t', 'Beep boop.')
      await expect(validateObsoleteUpdateRef(doc, { offline: true })).resolves.toContainError('UPDATES_NOT_IN_ABSTRACT', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { offline: true, mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_NOT_IN_ABSTRACT', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { offline: true, mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('updates in abstract but missing in rfc', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.abstract.t', 'This document updates RFC 1234.')
      await expect(validateObsoleteUpdateRef(doc, { offline: true })).resolves.toContainError('UPDATES_NOT_IN_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { offline: true, mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_NOT_IN_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { offline: true, mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('obsoletes a non-existant RFC', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        obsoletes: '1234, 2345'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document obsoletes RFC 1234 and 2345.')
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('OBSOLETES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('obsoletes an already obsoleted RFC', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        obsoletes: '1235, 2345'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document obsoletes RFC 1234 and 2345.')
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('OBSOLETES_OSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_OSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('updates a non-existant RFC', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        updates: '1234, 2345'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document updates RFC 1234 and 2345.')
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('UPDATES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('updates an already obsoleted RFC', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        updates: '1235, 2345'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document updates RFC 1234 and 2345.')
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('UPDATES_OSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_OSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('updates an already updated RFC', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        updates: '1236, 2345'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document updates RFC 1234 and 2345.')
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('UPDATES_UPDATED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_UPDATED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
  })
})

describe('document should have valid version', () => {
  describe('XML Document Type', () => {
    test('valid version on existing doc', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        docName: 'draft-ietf-beep-boop-01'
      })
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('valid version on non-existant doc', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        docName: 'draft-ietf-beep-buup-00'
      })
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('duplicate version', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        docName: 'draft-ietf-beep-boop-00'
      })
      await expect(validateVersion(doc)).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('DUPLICATE_DOC_VERSION', ValidationWarning)
    })
    test('unexpected version (lower than latest)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        docName: 'draft-ietf-beep-baap-02'
      })
      await expect(validateVersion(doc)).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
    })
    test('unexpected version (leaves a gap)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        docName: 'draft-ietf-beep-biip-04'
      })
      await expect(validateVersion(doc)).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
    })
    test('unexpected version on non-existant doc', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        docName: 'draft-ietf-beep-buup-01'
      })
      await expect(validateVersion(doc)).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
    })
  })

  describe('TXT Document Type', () => {
    test('valid version on existing doc', async () => {
      const doc = baseTXTDoc
      doc.data.slug = 'draft-ietf-beep-boop-01'
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('valid version on non-existant doc', async () => {
      const doc = baseTXTDoc
      baseTXTDoc.data.slug = 'draft-ietf-beep-buup-00'
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('duplicate version', async () => {
      const doc = baseTXTDoc
      doc.data.slug = 'draft-ietf-beep-boop-00'
      await expect(validateVersion(doc)).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('DUPLICATE_DOC_VERSION', ValidationWarning)
    })
    test('unexpected version (lower than latest)', async () => {
      const doc = baseTXTDoc
      doc.data.slug = 'draft-ietf-beep-baap-01'
      await expect(validateVersion(doc)).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
    })
    test('unexpected version (leaves a gap)', async () => {
      const doc = baseTXTDoc
      doc.data.slug = 'draft-ietf-beep-biip-04'
      await expect(validateVersion(doc)).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
    })
    test('unexpected version on non-existant doc', async () => {
      const doc = baseTXTDoc
      doc.data.slug = 'draft-ietf-beep-buup-01'
      await expect(validateVersion(doc)).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
    })
  })
})

describe('TXT Document Type', () => {
  test('valid version on existing doc', async () => {
    const doc = baseTXTDoc
    doc.data.slug = 'draft-ietf-beep-boop-01'
    await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('valid version on non-existant doc', async () => {
    const doc = baseTXTDoc
    doc.data.slug = 'draft-ietf-beep-buup-00'
    await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('duplicate version', async () => {
    const doc = baseTXTDoc
    doc.data.slug = 'draft-ietf-beep-boop-00'
    await expect(validateVersion(doc)).resolves.toHaveLength(0)
    await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('DUPLICATE_DOC_VERSION', ValidationWarning)
  })
  test('unexpected version (lower than latest)', async () => {
    const doc = baseTXTDoc
    doc.data.slug = 'draft-ietf-beep-baap-01'
    await expect(validateVersion(doc)).resolves.toHaveLength(0)
    await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
  })
  test('unexpected version (leaves a gap)', async () => {
    const doc = baseTXTDoc
    doc.data.slug = 'draft-ietf-beep-biip-04'
    await expect(validateVersion(doc)).resolves.toHaveLength(0)
    await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
  })
  test('unexpected version on non-existant doc', async () => {
    const doc = baseTXTDoc
    doc.data.slug = 'draft-ietf-beep-buup-01'
    await expect(validateVersion(doc)).resolves.toHaveLength(0)
    await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
  })
})
