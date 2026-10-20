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
import { parse } from '../lib/parsers/xml.mjs'
import { cloneDeep, set } from 'lodash-es'
import { DateTime } from 'luxon'
import { abstractTXTBlock } from './fixtures/txt-blocks/section-blocks.mjs'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { parse as parseTxt } from '../lib/parsers/txt.mjs'
import { txtStreamDraft, txtStreamRfc, xmlStreamDoc } from './fixtures/stream-docs.mjs'

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
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-smith-foo-bar/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/ise/' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/rfc1111/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/ietf/' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/rfc2222/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/ise/' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/rfc791/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/legacy/' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/rfc3333/', () => {
    return HttpResponse.json({ stream: null })
  }),
  http.all('*', () => {
    return new HttpResponse(null, { status: 404 })
  })
]

const server = setupServer(...mockRestHandlers)
const requests = []
server.events.on('request:start', ({ request }) => { requests.push(request.url) })

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  requests.length = 0
})
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
            updatesRfc: ['1234'],
            locations: { obsoletesRfc: { 5678: [{ line: 10, pos: 12 }] }, updatesRfc: {} }
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
            lines: [{ line: 10, pos: 12 }]
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
            ref: 'https://authors.ietf.org/en/required-content#abstract'
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
            ref: 'https://authors.ietf.org/en/required-content#abstract'
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
            ref: 'https://authors.ietf.org/en/required-content#abstract'
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
            ref: 'https://authors.ietf.org/en/required-content#abstract'
          }
        )
      )
      expect(result).toContainEqual(
        new ValidationComment(
          'UPDATES_NOT_IN_ABSTRACT',
          'RFC 1234 is listed as "updated" in metadata but is not mentioned in the abstract.',
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract'
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
      expect((await validateObsoleteUpdateRef(doc)).find(r => r.name === 'OBSOLETES_RFC_NOT_FOUND').message).toMatch(/^The Obsoletes header line lists RFC .+ but /)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })

    test('Obsoletes an already obsoleted RFC', async () => {
      const doc = baseTXTDoc
      doc.data.extractedElements.obsoletesRfc = ['1235']
      doc.data.content.abstract = abstractTXTBlock.split('\n')

      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('OBSOLETES_OBSOLETED_RFC', ValidationWarning)
      expect((await validateObsoleteUpdateRef(doc)).find(r => r.name === 'OBSOLETES_OBSOLETED_RFC').message).toMatch(/^The Obsoletes header line lists RFC .+ but /)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_OBSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })

    test('Updates a non-existant RFC', async () => {
      const doc = baseTXTDoc
      doc.data.extractedElements.updatesRfc = ['1234, 2345']
      doc.data.content.abstract = abstractTXTBlock.split('\n')

      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('UPDATES_RFC_NOT_FOUND', ValidationWarning)
      expect((await validateObsoleteUpdateRef(doc)).find(r => r.name === 'UPDATES_RFC_NOT_FOUND').message).toMatch(/^The Updates header line lists RFC .+ but /)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })

    test('Updates an already obsoleted RFC', async () => {
      const doc = baseTXTDoc

      doc.data.extractedElements.updatesRfc = ['1264']
      doc.data.content.abstract = abstractTXTBlock.split('\n')

      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('UPDATES_OBSOLETED_RFC', ValidationWarning)
      expect((await validateObsoleteUpdateRef(doc)).find(r => r.name === 'UPDATES_OBSOLETED_RFC').message).toMatch(/^The Updates header line lists RFC .+ but /)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_OBSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
  })

  describe('XML Document Type', () => {
    test('valid date', async () => {
      const doc = cloneDeep(baseXMLDoc)
      const today = DateTime.now().setLocale('en-US')

      set(doc, 'data.rfc.front.date._attr', {
        year: today.year,
        month: today.monthLong,
        day: today.day
      })
      await expect(validateDate(doc)).resolves.toHaveLength(0)
    })
    test('non-ascii month is reported, not thrown', async () => {
      const doc = cloneDeep(baseXMLDoc)
      const today = DateTime.now().setLocale('en-US')

      set(doc, 'data.rfc.front.date._attr', {
        year: today.year,
        month: '8月',
        day: today.day
      })
      await expect(validateDate(doc)).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
    })
    test('numeric month', async () => {
      for (const month of ['8', '08']) {
        const doc = cloneDeep(baseXMLDoc)
        set(doc, 'data.rfc.front.date._attr', { year: 2020, month, day: 1 })
        await expect(validateDate(doc)).resolves.toContainError('DOC_DATE_IN_PAST', ValidationWarning)
      }
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.date._attr', { year: 2020, month: '13', day: 1 })
      await expect(validateDate(doc)).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
    })
    const parseDate = async (date) => {
      const { doc } = await parse(`<rfc docName="draft-ietf-beep-boop-00" version="3">
  <front><title>Test</title>${date}</front>
</rfc>`, 'draft-ietf-beep-boop-00.xml')
      return doc
    }
    test('date missing', async () => {
      const doc = await parseDate('')
      await expect(validateDate(doc)).resolves.toContainError('MISSING_DOC_DATE', ValidationComment)
      await expect(validateDate(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_DOC_DATE', ValidationComment)
      await expect(validateDate(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('MISSING_DOC_DATE', ValidationComment)
      const result = await validateDate(doc)
      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('rfc.front.date')
    })
    test('empty <date/> is today', async () => {
      const doc = await parseDate('<date/>')
      await expect(validateDate(doc)).resolves.toHaveLength(0)
    })
    test('partial date is completed from today', async () => {
      const doc = await parseDate(`<date year="${DateTime.now().year}"/>`)
      await expect(validateDate(doc)).resolves.toHaveLength(0)
    })
    test('non-numeric day is reported, not thrown', async () => {
      const doc = await parseDate('<date year="2026" month="February" day="x"/>')
      await expect(validateDate(doc)).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
    })
    test('non-numeric or out-of-range year is reported, not thrown', async () => {
      for (const year of ['x', '0']) {
        const doc = await parseDate(`<date year="${year}" month="February" day="1"/>`)
        await expect(validateDate(doc)).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
      }
    })
    test('impossible date is reported', async () => {
      for (const day of ['31', '32']) {
        const doc = await parseDate(`<date year="2026" month="February" day="${day}"/>`)
        await expect(validateDate(doc)).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
      }
    })
    test('date in the past', async () => {
      const doc = cloneDeep(baseXMLDoc)
      const today = DateTime.now().setLocale('en-US').minus({ days: 15 })
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
      const today = DateTime.now().setLocale('en-US').plus({ days: 15 })
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
    test('month written as "Sept", "Sep." or "September,"', async () => {
      for (const month of ['Sept', 'Sep.', 'September,']) {
        const doc = cloneDeep(baseTXTDoc)
        doc.data.header.date = { year: 2020, month, day: 1 }
        await expect(validateDate(doc)).resolves.toContainError('DOC_DATE_IN_PAST', ValidationWarning)
      }
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
    test('serial-comma lists in the abstract count every RFC', async () => {
      // Abstracts of draft-ietf-6man-slaac-renum-14 and draft-ietf-procon-2026bis-11
      const updates = cloneDeep(baseXMLDoc)
      set(updates, 'data.rfc._attr', {
        updates: '4191, 4861, 4862, 8106, 8781, 9096, 9463'
      })
      set(updates, 'data.rfc.front.abstract.t', 'It formally updates RFC 4191, RFC 4861,\n   RFC 4862, RFC 8106, RFC 8781, RFC 9096, and RFC 9463.')
      await expect(validateObsoleteUpdateRef(updates, { offline: true })).resolves.toHaveLength(0)

      const obsoletes = cloneDeep(baseXMLDoc)
      set(obsoletes, 'data.rfc._attr', {
        obsoletes: '2026, 5657, 6410, 7100, 7127, 8789, 9282'
      })
      set(obsoletes, 'data.rfc.front.abstract.t', 'This document obsoletes RFC 2026, RFC 5657, RFC 6410, RFC 7100, RFC\n   7127, RFC 8789, and RFC 9282.')
      await expect(validateObsoleteUpdateRef(obsoletes, { offline: true })).resolves.toHaveLength(0)
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
      expect((await validateObsoleteUpdateRef(doc)).find(r => r.name === 'OBSOLETES_RFC_NOT_FOUND').message).toMatch(/^The <rfc> field states that it obsoletes RFC \d+ but /)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('obsoletes an already obsoleted RFC', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        obsoletes: '1235, 2345'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document obsoletes RFC 1234 and 2345.')
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('OBSOLETES_OBSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_OBSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('obsoletes several already obsoleted RFCs', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        obsoletes: '1235, 1264'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document obsoletes RFC 1235 and 1264.')
      const result = await validateObsoleteUpdateRef(doc)
      expect(result.filter(r => r.name === 'OBSOLETES_OBSOLETED_RFC')).toHaveLength(2)
      await expect(validateObsoleteUpdateRef(doc)).resolves.toEqual(result)
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
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('UPDATES_OBSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_OBSOLETED_RFC', ValidationWarning)
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
    test('no docName (reported as DOCNAME_MISSING)', async () => {
      const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3">
  <front><title>Test</title><seriesInfo name="Internet-Draft" value=""/></front>
</rfc>`, 'draft-ietf-beep-boop-01.xml')
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
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

describe('document should not obsolete or update RFCs of another stream without notice', () => {
  const crossStream = result => result.filter(r => r.name === 'CROSS_STREAM_OBSOLETES_UPDATES')
  const xml = async (opts, filename = 'draft-smith-foo-bar-02.xml') => (await parse(xmlStreamDoc(opts), filename)).doc

  test('reports an RFC of another stream in every mode', async () => {
    // Defaults to IETF, but Datatracker has the draft in the ISE stream
    const doc = await xml({ obsoletes: '1111', updates: '2222' })
    const result = crossStream(await validateObsoleteUpdateRef(doc))
    expect(result).toEqual([
      new ValidationWarning('CROSS_STREAM_OBSOLETES_UPDATES', 'This document (Independent Submission stream) attempts to obsolete RFC 1111, an RFC from another stream (IETF). Specific rules may apply to this process, and you will need sign-off from both stream heads before this document can proceed.', {
        ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#obsoletes',
        path: 'rfc.obsoletes'
      })
    ])
    for (const mode of [MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]) {
      expect(crossStream(await validateObsoleteUpdateRef(doc, { mode }))).toEqual(result)
    }
  })
  test('runs only the cross-stream check in submission mode', async () => {
    const doc = await xml({ obsoletes: '1111', updates: '1235' })
    await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('UPDATES_OBSOLETED_RFC', ValidationWarning)
    const result = await validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })
    expect(result.map(r => r.name)).toEqual(['CROSS_STREAM_OBSOLETES_UPDATES'])
  })
  test('reports nothing for RFCs of the same stream', async () => {
    const doc = await xml({ docName: 'draft-ietf-foo-bar-02', obsoletes: '1111', updates: '1111' })
    expect(crossStream(await validateObsoleteUpdateRef(doc))).toHaveLength(0)
    const ise = await xml({ docName: 'draft-ietf-foo-bar-02', submissionType: 'independent', updates: '2222' })
    expect(crossStream(await validateObsoleteUpdateRef(ise))).toHaveLength(0)
  })
  test('reports an RFC of a known stream as a comment when the document stream is unknown', async () => {
    const doc = await xml({ docName: 'draft-smith-foo-unknown-00', updates: '2222' })
    expect(crossStream(await validateObsoleteUpdateRef(doc))).toEqual([
      new ValidationComment('CROSS_STREAM_OBSOLETES_UPDATES', 'This document attempts to update RFC 2222, which is in the Independent Submission stream. If this document is not in that stream, specific rules may apply to this process, and you will need sign-off from both stream heads before this document can proceed.', {
        ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates',
        path: 'rfc.updates'
      })
    ])
  })
  test('reports a Legacy RFC as a comment whatever the document stream', async () => {
    const doc = await xml({ submissionType: 'IAB', obsoletes: '791' })
    expect(crossStream(await validateObsoleteUpdateRef(doc))).toEqual([
      new ValidationComment('CROSS_STREAM_OBSOLETES_UPDATES', 'This document attempts to obsolete RFC 791, which is in the Legacy stream (published before the current RFC streams were defined). Check whether specific rules apply to this process.', {
        ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#obsoletes',
        path: 'rfc.obsoletes'
      })
    ])
    const unknown = await xml({ docName: 'draft-smith-foo-unknown-00', obsoletes: '791' })
    await expect(validateObsoleteUpdateRef(unknown)).resolves.toContainError('CROSS_STREAM_OBSOLETES_UPDATES', ValidationComment)
  })
  test('ignores RFCs Datatracker has no stream for or doesn\'t know', async () => {
    const doc = await xml({ obsoletes: '3333', updates: '4444' })
    expect(crossStream(await validateObsoleteUpdateRef(doc))).toHaveLength(0)
  })
  test('makes no request when offline', async () => {
    const doc = await xml({ obsoletes: '1111', updates: '2222' })
    await validateObsoleteUpdateRef(doc, { offline: true })
    await expect(validateObsoleteUpdateRef(doc, { offline: true, mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    expect(requests).toHaveLength(0)
  })
  test('checks the Obsoletes: and Updates: lines of a text draft', async () => {
    const doc = await parseTxt(txtStreamDraft('draft-ietf-foo-bar-02', { obsoletes: '1111', updates: '2222' }), 'draft-ietf-foo-bar-02.txt')
    expect(crossStream(await validateObsoleteUpdateRef(doc))).toEqual([
      new ValidationWarning('CROSS_STREAM_OBSOLETES_UPDATES', 'This document (IETF stream) attempts to update RFC 2222, an RFC from another stream (Independent Submission). Specific rules may apply to this process, and you will need sign-off from both stream heads before this document can proceed.', {
        ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates',
        lines: [{ line: 7, pos: 1 }]
      })
    ])
  })
  test('takes the stream of a text RFC from its header', async () => {
    const doc = await parseTxt(txtStreamRfc('Independent Submission', '9991', { obsoletes: '1111', updates: '2222' }), 'rfc9991.txt')
    expect(crossStream(await validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST }))).toEqual([
      new ValidationWarning('CROSS_STREAM_OBSOLETES_UPDATES', 'This document (Independent Submission stream) attempts to obsolete RFC 1111, an RFC from another stream (IETF). Specific rules may apply to this process, and you will need sign-off from both stream heads before this document can proceed.', {
        ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#obsoletes',
        lines: [{ line: 6, pos: 1 }]
      })
    ])
  })
})
