import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationWarning } from '../lib/helpers/error.mjs'
import {
  validateDate
} from '../lib/modules/metadata.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'
import { DateTime } from 'luxon'

expect.extend({
  toContainError
})

describe('document should have valid IP Address mentions', () => {
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
})
