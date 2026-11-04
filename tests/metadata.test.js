import { beforeAll, afterEach, afterAll, describe, expect, test, vi } from 'vitest'
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
    return HttpResponse.json({ obsoleted_by: ['RFC3456'] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc1264.json', () => {
    return HttpResponse.json({ obsoleted_by: ['RFC3456'] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc1236.json', () => {
    return HttpResponse.json({ updated_by: ['RFC3456'] })
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
      expect((await validateObsoleteUpdateRef(doc)).find(r => r.name === 'OBSOLETES_OBSOLETED_RFC').message).toBe('The Obsoletes header line lists RFC 1235 but it\'s already obsoleted by RFC 3456.')
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
      expect((await validateObsoleteUpdateRef(doc)).find(r => r.name === 'UPDATES_OBSOLETED_RFC').message).toBe('The Updates header line lists RFC 1264 but it\'s already obsoleted by RFC 3456.')
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
    test('impossible date is reported', async () => {
      for (const day of [31, 30, 99]) {
        const doc = cloneDeep(baseTXTDoc)
        doc.data.header.date = { year: 2026, month: 'February', day }
        for (const mode of [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]) {
          await expect(validateDate(doc, { mode })).resolves.toContainError('MISSING_DOC_DATE', ValidationWarning)
        }
      }
    })
    test('month-year date checked on the 31st takes the last day of the month', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      // Noon on 31 March in the local time zone, which the check reads: noon UTC is already
      // 1 April in zones twelve or more hours ahead
      vi.setSystemTime(new Date(2026, 2, 31, 12, 0, 0))
      vi.resetModules()
      try {
        const { validateDate: validateDateOn31st } = await import('../lib/modules/metadata.mjs')
        const doc = cloneDeep(baseTXTDoc)
        doc.data.header.date = { year: 2026, month: 'February' }
        const result = await validateDateOn31st(doc)
        expect(result).not.toContainError('MISSING_DOC_DATE', ValidationWarning)
        expect(result).toContainError('DOC_DATE_IN_PAST', ValidationWarning)
        expect(result[0].message).toContain('31 days')
      } finally {
        vi.useRealTimers()
        vi.resetModules()
      }
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
  const allModes = async (doc, code) => {
    for (const mode of [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]) {
      await expect(validateCategory(doc, { mode })).resolves.toContainError(code, ValidationWarning)
    }
  }
  describe('XML Document Type', () => {
    const xmlDoc = (attr, docKind = 'draft') => {
      const doc = cloneDeep(baseXMLDoc)
      doc.docKind = docKind
      set(doc, 'data.rfc._attr', attr)
      return doc
    }
    test('valid category', async () => {
      await expect(validateCategory(xmlDoc({ category: 'std', docName: 'draft-ietf-beep-boop' }))).resolves.toHaveLength(0)
    })
    test('missing category for a draft', async () => {
      await allModes(xmlDoc({ docName: 'draft-ietf-beep-boop-03' }), 'MISSING_DOC_CATEGORY')
    })
    test('missing category for a draft whose docName lacks the draft- prefix', async () => {
      await allModes(xmlDoc({ docName: 'my-draft-00' }), 'MISSING_DOC_CATEGORY')
    })
    test('missing category for an RFC that keeps the draft name', async () => {
      await allModes(xmlDoc({ number: '9999', docName: 'draft-ietf-foo-12' }, 'rfc'), 'MISSING_DOC_CATEGORY')
    })
    test('missing category for an RFC without docName', async () => {
      await allModes(xmlDoc({ number: '9999' }, 'rfc'), 'MISSING_DOC_CATEGORY')
    })
    test('invalid category', async () => {
      await allModes(xmlDoc({ category: 'xyz123', docName: 'draft-beep-boop' }), 'INVALID_DOC_CATEGORY')
    })
  })

  describe('TXT Document Type', () => {
    const txtDoc = (header, docKind) => {
      const doc = cloneDeep(baseTXTDoc)
      doc.docKind = docKind
      Object.assign(doc.data.header, { intendedStatus: null, category: null }, header)
      return doc
    }
    test('valid intended status on a draft', async () => {
      await expect(validateCategory(txtDoc({ intendedStatus: 'Standards Track' }, 'draft'))).resolves.toHaveLength(0)
    })
    test('missing intended status on a draft', async () => {
      const doc = txtDoc({}, 'draft')
      await allModes(doc, 'MISSING_DOC_CATEGORY')
      const [finding] = await validateCategory(doc)
      expect(finding.message).toBe('The draft has no Intended status: line.')
    })
    test('a Category: line on a draft is not an intended status', async () => {
      const doc = txtDoc({ category: 'Informational' }, 'draft')
      for (const mode of [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]) {
        const result = await validateCategory(doc, { mode })
        expect(result).toHaveLength(1)
        expect(result).toContainError('MISSING_DOC_CATEGORY', ValidationWarning)
        expect(result[0].message).toBe('The draft gives its status on a Category: line; Internet-Drafts use an Intended status: line.')
      }
    })
    test('invalid intended status on a draft', async () => {
      await allModes(txtDoc({ intendedStatus: 'xyz123' }, 'draft'), 'INVALID_DOC_CATEGORY')
    })
    test('valid category on an RFC', async () => {
      await expect(validateCategory(txtDoc({ category: 'Standards Track' }, 'rfc'))).resolves.toHaveLength(0)
    })
    test('missing category on an RFC', async () => {
      const doc = txtDoc({}, 'rfc')
      await allModes(doc, 'MISSING_DOC_CATEGORY')
      const [finding] = await validateCategory(doc)
      expect(finding.message).toContain('Category:')
    })
    test('invalid category on an RFC', async () => {
      await allModes(txtDoc({ category: 'xyz123' }, 'rfc'), 'INVALID_DOC_CATEGORY')
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
    // From draft-ietf-grow-bmp-tlv-21
    test('an RFC named by an <xref> in the abstract is mentioned', async () => {
      const xml = (abstract, attrs) => `<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-foo-bar-00" ${attrs}>
  <front>
    <title>Foo</title>
    <!-- <abstract><t>This document updates RFC 9999.</t></abstract> -->
    <abstract>
      <t>${abstract}</t>
    </abstract>
  </front>
  <middle/>
</rfc>`
      const contentXml = xml('This document updates <xref target="RFC7854">RFC\n      7854</xref> to support TLV data.', 'updates="7854" obsoletes="1234"')
      const { doc: withContent } = await parse(contentXml, 'draft-foo-bar-00.xml')
      const result = await validateObsoleteUpdateRef(withContent, { offline: true })
      expect(result).not.toContainError('UPDATES_NOT_IN_ABSTRACT')
      expect(result).toContainError('OBSOLETES_NOT_IN_ABSTRACT', ValidationWarning)
      expect(result).not.toContainError('UPDATES_NOT_IN_RFC')

      const targetXml = xml('This document obsoletes <xref target="RFC1234"/> and updates <xref target="RFC7854"/>&#160;and <xref target="RFC8000"/>.', 'updates="7854"')
      const { doc: withTarget } = await parse(targetXml, 'draft-foo-bar-00.xml')
      const result2 = await validateObsoleteUpdateRef(withTarget, { offline: true })
      expect(result2).not.toContainError('UPDATES_NOT_IN_ABSTRACT')
      const names = result2.map(r => r.name).sort()
      expect(names).toEqual(['OBSOLETES_NOT_IN_RFC', 'UPDATES_NOT_IN_RFC'])
      expect(result2.find(r => r.name === 'UPDATES_NOT_IN_RFC').message).toContain('RFC 8000')

      // From draft-ietf-mailmaint-imap-objectid-bis-06: attributes written "RFC8474"
      const prefixedXml = xml('This document obsoletes <xref target="RFC8474"/> and updates <xref target="RFC9698"/>.', 'obsoletes="RFC8474" updates="RFC3501, RFC9698"')
      const { doc: prefixed } = await parse(prefixedXml, 'draft-foo-bar-00.xml')
      const result3 = await validateObsoleteUpdateRef(prefixed, { offline: true })
      const messages = result3.map(r => r.message)
      expect(messages).toEqual(["The document states that it updates RFC 3501 but doesn't explicitely mention it in the <abstract> section."])
    })
    test('a "<!--" inside CDATA starts no comment in the abstract\'s source', async () => {
      const xml = (title, code) => `<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-foo-bar-00" obsoletes="1234">
  <front>
    <title>${title}</title>
    <abstract>
      <t>This document obsoletes <xref target="RFC1234"/>.</t>
    </abstract>
  </front>
  <middle><section><name>Code</name><sourcecode>${code}</sourcecode></section></middle>
</rfc>`
      // -> Not a comment from the title to the code, which would hide the abstract
      const { doc } = await parse(xml('<![CDATA[Foo <!-- Bar]]>', '<![CDATA[a --> b]]>'), 'draft-foo-bar-00.xml')
      await expect(validateObsoleteUpdateRef(doc, { offline: true })).resolves.toHaveLength(0)
      // -> Read in time linear in the length of the source (this took 7 s)
      const { doc: many } = await parse(xml('Foo', `<![CDATA[${'<!--'.repeat(100000)}]]>`), 'draft-foo-bar-00.xml')
      await expect(validateObsoleteUpdateRef(many, { offline: true })).resolves.toHaveLength(0)
    })
    test('the abstract is found in time linear in the length of the source', async () => {
      const xml = (elements) => `<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-foo-bar-00" obsoletes="1234">
  <front>
    <title>Foo</title>
  </front>
  <middle><section><name>A</name><t>This document obsoletes RFC 1234.</t>${elements}</section></middle>
</rfc>`
      // -> 100,000 start tags with no "</abstract>" after them (this took 15 s), and as many of another
      //    element whose name starts with "abstract"
      for (const element of ['<abstract/>', '<abstract-x/>']) {
        const { doc } = await parse(xml(element.repeat(100000)), 'draft-foo-bar-00.xml')
        await expect(validateObsoleteUpdateRef(doc, { offline: true })).resolves.toContainError('OBSOLETES_NOT_IN_ABSTRACT', ValidationWarning)
      }
    })
    test('reads the abstract phrasings that name obsoleted and updated RFCs', async () => {
      const names = async (abstract, attrs) => {
        const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-foo-bar-00" ${attrs}>
  <front>
    <title>Foo</title>
    <abstract>
      <t>${abstract}</t>
    </abstract>
  </front>
  <middle/>
</rfc>`, 'draft-foo-bar-00.xml')
        return (await validateObsoleteUpdateRef(doc, { offline: true })).map(r => `${r.name} ${r.message.match(/RFC (\d+)/)[1]}`)
      }
      // From draft-ietf-teas-rsvp-auth-v2-02, draft-sriram-savnet-intrasav-solution-00, RFC 9580 and RFC 9846
      await expect(names('This document obsoletes both <xref target="RFC2747"/> and <xref target="RFC3097"/>.', 'obsoletes="2747, 3097"')).resolves.toEqual([])
      await expect(names('This document updates BCP 38 (<xref target="RFC2827"/>) and BCP 84 (<xref target="RFC3704"/>,\n        <xref target="RFC8704"/>).', 'updates="2827, 3704, 8704"')).resolves.toEqual([])
      await expect(names('This document obsoletes RFCs 4880 ("OpenPGP Message Format"), 5581 ("The Camellia Cipher in OpenPGP"), and 6637 ("Elliptic Curve Cryptography (ECC) in OpenPGP").', 'obsoletes="4880, 5581, 6637"')).resolves.toEqual([])
      await expect(names('This document obsoletes RFC 5246 (specifying TLS 1.2) and RFCs 5077, 6961, 7627, and 8422.', 'obsoletes="5246, 5077, 6961, 7627, 8422"')).resolves.toEqual([])
      // From RFC 9788, RFC 9926 and RFC 9685
      await expect(names('This document updates the S/MIME specification (RFC 8551) to offer a different mechanism.', 'updates="8551"')).resolves.toEqual([])
      await expect(names('This document updates the Routing Protocol for Low-Power and Lossy Networks (RPL), as specified in RFCs 6550 and 9010.', 'updates="6550, 9010"')).resolves.toEqual([])
      await expect(names('This document updates the 6LoWPAN extensions to IPv6 Neighbor Discovery (specified in RFCs 4861 and 8505).', 'updates="4861, 8505"')).resolves.toEqual([])
      // An RFC named elsewhere in the abstract, or by someone else's updates, isn't named as updated
      await expect(names('BGP (RFC 4271) is widely deployed. This document updates the BGP decision process.', 'updates="4271"')).resolves.toEqual(['UPDATES_NOT_IN_ABSTRACT 4271'])
      await expect(names('It includes the updates to RFC 6712 specified in Section 3 of RFC 9480.', 'obsoletes="6712"')).resolves.toEqual(['OBSOLETES_NOT_IN_ABSTRACT 6712'])
      await expect(names('A Manifest Information Model for Firmware Updates in Internet of Things (IoT) Devices (RFC 9124) is extended.', '')).resolves.toEqual([])
      // ... and an RFC named after a phrase doesn't need to be listed (from draft-ietf-ediint-rfc4130bis-05)
      await expect(names('This document updates IANA registries originally created by RFC 3335 and RFC 4130.', '')).resolves.toEqual([])
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
      expect(result.find(r => r.name === 'OBSOLETES_OBSOLETED_RFC').message).toBe('The <rfc> field states that it obsoletes RFC 1235 but it\'s already obsoleted by RFC 3456.')
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
      expect((await validateObsoleteUpdateRef(doc)).find(r => r.name === 'UPDATES_UPDATED_RFC').message).toContain('already updated by RFC 3456.')
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_UPDATED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    // From draft-ietf-mailmaint-imap-objectid-bis-06 (obsoletes="RFC8474") and draft-ietf-anima-brski-prm-25
    test('looks up an RFC written "RFC1235" by its number', async () => {
      const { doc } = await parse(xmlStreamDoc({ obsoletes: 'RFC1235', updates: 'rfc 1236, RFC1236, draft-ietf-foo-bar' }), 'draft-smith-foo-bar-02.xml')
      const result = (await validateObsoleteUpdateRef(doc)).filter(r => /_RFC$|_RFC_NOT_FOUND$/.test(r.name))
      expect(result.map(r => r.message)).toEqual([
        'The <rfc> field states that it obsoletes RFC 1235 but it\'s already obsoleted by RFC 3456.',
        'This document updates RFC 1236. That RFC is already updated by RFC 3456. Verify that this document does not conflict with those.'
      ])
      expect(requests.filter(url => url.includes('rfc-editor')).sort()).toEqual([
        'https://www.rfc-editor.org/rfc/rfc1235.json',
        'https://www.rfc-editor.org/rfc/rfc1236.json'
      ])
    })
    // From draft-ietf-teas-rsvp-auth-v2-02 (obsoletes="2747 3097"), draft-ftzhswj-cats-northbound-api-00
    // (updates="2026-5-29"), draft-ietf-lamps-cms-euf-cma-signeddata-03 (updates="[5652]") and draft-veridom-omp-02
    test('reports a value that is neither an RFC number nor an Internet-Draft name', async () => {
      const { doc } = await parse(xmlStreamDoc({ obsoletes: '1235 1264', updates: '2026-5-29, [1236], draft-veridom-omp-00' }), 'draft-smith-foo-bar-02.xml')
      const warnings = [
        new ValidationWarning('OBSOLETES_NOT_RFC_NUMBER', 'The <rfc> obsoletes attribute lists "1235 1264", which is not an RFC number (read as RFC 1235, RFC 1264). The attribute is a comma-separated list of RFC numbers or Internet-Draft names.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#obsoletes',
          path: 'rfc.obsoletes'
        }),
        new ValidationWarning('UPDATES_NOT_RFC_NUMBER', 'The <rfc> updates attribute lists "2026-5-29", which is not an RFC number. The attribute is a comma-separated list of RFC numbers or Internet-Draft names.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates',
          path: 'rfc.updates'
        }),
        new ValidationWarning('UPDATES_NOT_RFC_NUMBER', 'The <rfc> updates attribute lists "[1236]", which is not an RFC number (read as RFC 1236). The attribute is a comma-separated list of RFC numbers or Internet-Draft names.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates',
          path: 'rfc.updates'
        })
      ]
      const lookups = r => /_NOT_RFC_NUMBER$|_RFC_NOT_FOUND$|_OBSOLETED_RFC$|_UPDATED_RFC$/.test(r.name)
      expect((await validateObsoleteUpdateRef(doc, { offline: true })).filter(lookups)).toEqual(warnings)
      expect(requests).toHaveLength(0)
      // -> The RFC numbers a miswritten value plainly means are still looked up; the other values are not
      const result = (await validateObsoleteUpdateRef(doc)).filter(lookups)
      expect(result.slice(0, 3)).toEqual(warnings)
      expect(result.slice(3).map(r => r.name)).toEqual(['OBSOLETES_OBSOLETED_RFC', 'OBSOLETES_OBSOLETED_RFC', 'UPDATES_UPDATED_RFC'])
      expect(requests.filter(url => url.includes('rfc-editor')).sort()).toEqual([
        'https://www.rfc-editor.org/rfc/rfc1235.json',
        'https://www.rfc-editor.org/rfc/rfc1236.json',
        'https://www.rfc-editor.org/rfc/rfc1264.json'
      ])
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    // From draft-jabley-dnsop-ordered-answer-section-01 (updates="10341035": RFCs 1034 and 1035 run together)
    test('reports a number that can\'t be an RFC number, without looking it up', async () => {
      const { doc } = await parse(xmlStreamDoc({ obsoletes: 'RFC0, 1235', updates: '10341035' }), 'draft-smith-foo-bar-02.xml')
      const lookups = r => /_NOT_RFC_NUMBER$|_RFC_NOT_FOUND$|_OBSOLETED_RFC$|_UPDATED_RFC$/.test(r.name)
      const result = (await validateObsoleteUpdateRef(doc)).filter(lookups)
      expect(result.map(r => r.message)).toEqual([
        'The <rfc> obsoletes attribute lists "RFC0", which is not an RFC number. The attribute is a comma-separated list of RFC numbers or Internet-Draft names.',
        'The <rfc> updates attribute lists "10341035", which is not an RFC number. The attribute is a comma-separated list of RFC numbers or Internet-Draft names.',
        'The <rfc> field states that it obsoletes RFC 1235 but it\'s already obsoleted by RFC 3456.'
      ])
      expect(requests.filter(url => url.includes('rfc-editor')).sort()).toEqual([
        'https://www.rfc-editor.org/rfc/rfc1235.json'
      ])
    })
    // From RFC 8996 (updates="…, 4111,\u200B 4162, …")
    test('ignores a zero-width space in a value', async () => {
      const { doc } = await parse(xmlStreamDoc({ updates: '1235,\u200B 1236' }), 'draft-smith-foo-bar-02.xml')
      const result = await validateObsoleteUpdateRef(doc)
      expect(result.filter(r => /_NOT_RFC_NUMBER$|_RFC_NOT_FOUND$/.test(r.name))).toEqual([])
      expect(requests.filter(url => url.includes('rfc-editor')).sort()).toEqual([
        'https://www.rfc-editor.org/rfc/rfc1235.json',
        'https://www.rfc-editor.org/rfc/rfc1236.json'
      ])
    })
  })
  describe('TXT Document Type', () => {
    test('reads "Updates: RFC 1236" as RFC 1236', async () => {
      const doc = await parseTxt(txtStreamDraft('draft-ietf-foo-bar-02', { obsoletes: 'RFC 1235', updates: 'RFC1236' }), 'draft-ietf-foo-bar-02.txt')
      expect(doc.data.extractedElements.obsoletesRfc).toEqual(['1235'])
      expect(doc.data.extractedElements.updatesRfc).toEqual(['1236'])
      const result = await validateObsoleteUpdateRef(doc)
      expect(result).toContainError('OBSOLETES_OBSOLETED_RFC', ValidationWarning)
      expect(result.find(r => r.name === 'OBSOLETES_OBSOLETED_RFC').message).toContain('lists RFC 1235 but')
      expect(result).not.toContainError('OBSOLETES_RFC_NOT_FOUND')
      expect(result).not.toContainError('UPDATES_RFC_NOT_FOUND')
    })
    test('reads the abstract phrasings that name obsoleted and updated RFCs', async () => {
      // A text draft with the given header lines and abstract
      const draft = (headers, abstract) => parseTxt(`


Network Working Group                                           A. Smith
Internet-Draft                                                   Example
${headers}Intended status: Standards Track                          16 October 2026
Expires: 19 April 2027


                         The Foo Protocol Revised
                         draft-ietf-foo-bar-02

Abstract

   ${abstract}
`, 'draft-ietf-foo-bar-02.txt')
      const codes = async (headers, abstract) => (await validateObsoleteUpdateRef(await draft(headers, abstract), { offline: true })).map(r => `${r.name} ${r.message.match(/RFC (\d+)/)[1]}`)

      // From draft-ietf-teas-rsvp-auth-v2-02 and draft-sriram-savnet-intrasav-solution-00
      await expect(codes('Obsoletes: 2747, 3097 (if approved)\n', 'This document obsoletes both RFC2747 and RFC3097.')).resolves.toEqual([])
      await expect(codes('Updates: 2827, 3704, 8704 (if approved)\n', 'This document updates BCP 38 ([RFC2827]) and BCP 84\n   ([RFC3704], [RFC8704]).')).resolves.toEqual([])
      // From draft-ietf-emailcore-rfc5321bis-44 and RFC 9260
      await expect(codes('Obsoletes: 1846, 7504, 7505 (if approved)\n', 'This document supersedes RFCs 1846, 7504, and 7505.')).resolves.toEqual([])
      await expect(codes('Obsoletes: 6096, 7053 (if approved)\n', 'Therefore, RFCs 6096 and 7053 are also obsoleted by this document.')).resolves.toEqual([])
      // An RFC named elsewhere in the abstract isn't named as updated
      await expect(codes('Updates: 4271 (if approved)\n', 'BGP [RFC4271] is widely deployed. This document defines a new\n   attribute.')).resolves.toEqual(['UPDATES_NOT_IN_ABSTRACT 4271'])
      await expect(codes('Updates: 7935 (if approved)\n', 'It does not update RFC 7935.')).resolves.toEqual(['UPDATES_NOT_IN_ABSTRACT 7935'])
      // An RFC named after a phrase counts for a listed RFC, but doesn't need one listed (from RFC 9659 and
      // draft-wang-grow-bmp-bgp-rib-stats-ext-01)
      await expect(codes('Updates: 8878 (if approved)\n', 'This document updates the window size limit in RFC 8878.')).resolves.toEqual([])
      await expect(codes('', 'This document updates the registry established by RFC 7854.')).resolves.toEqual([])
      // From draft-guorong-utxo-dns-01
      await expect(codes('', 'It defines fallback mechanisms, updating RFC 1034, RFC 1035, and RFC\n   7217.')).resolves.toEqual(['MENTIONED_NOT_IN_UPDATES 1034', 'MENTIONED_NOT_IN_UPDATES 1035', 'MENTIONED_NOT_IN_UPDATES 7217'])
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
  test('locates the Updates: line of an indented text header', async () => {
    const draft = txtStreamDraft('draft-ietf-foo-bar-02', { obsoletes: '1111', updates: '2222' })
    // Indent the header lines by two spaces; blank lines and the indented title stay as they are
    const indentedLines = []
    for (const line of draft.split('\n')) {
      if (/^\S/.test(line)) {
        indentedLines.push(`  ${line}`)
      } else {
        indentedLines.push(line)
      }
    }
    const doc = await parseTxt(indentedLines.join('\n'), 'draft-ietf-foo-bar-02.txt')
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

describe('lookups that fail are not reported as documents that do not exist', () => {
  const failing = (url) => http.get(url, () => new HttpResponse('down', { status: 503 }))

  test('no *_RFC_NOT_FOUND when rfc-editor.org fails', async () => {
    server.use(failing('https://www.rfc-editor.org/rfc/rfc4444.json'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr', { obsoletes: '4444', updates: '4444' })
    set(doc, 'data.rfc.front.abstract.t', 'This document obsoletes and updates RFC 4444.')
    const result = await validateObsoleteUpdateRef(doc)
    expect(result.filter(r => r.name.endsWith('_RFC_NOT_FOUND'))).toEqual([])
    expect(warn).toHaveBeenCalledWith('Request to www.rfc-editor.org failed: HTTP 503')
    warn.mockRestore()
  })

  test('no "should be version 00" when Datatracker fails', async () => {
    server.use(failing('https://datatracker.ietf.org/api/v1/doc/document/draft-ietf-beep-bfail/'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr', { docName: 'draft-ietf-beep-bfail-03' })
    await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    expect(warn).toHaveBeenCalledWith('Request to datatracker.ietf.org failed: HTTP 503')
    warn.mockRestore()
  })
})
