import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationWarning } from '../lib/helpers/error.mjs'
import {
  validateDate,
  validateObsoleteUpdateRef
} from '../lib/modules/metadata.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'
import { DateTime } from 'luxon'

expect.extend({
  toContainError
})

describe('document should have valid date', () => {
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

describe('document should have valid obsoletes / updates references', () => {
  describe('XML Document Type', () => {
    test('valid obsoletes reference', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        obsoletes: '1234, 2345'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document obsoletes RFC 1234 and 2345.')
      await expect(validateObsoleteUpdateRef(doc)).resolves.toHaveLength(0)
    })
    test('valid updates reference', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        updates: '1234,2345'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document updates RFC 1234, 2345.')
      await expect(validateObsoleteUpdateRef(doc)).resolves.toHaveLength(0)
    })
    test('obsoletes in rfc but missing in abstract', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        obsoletes: '1234'
      })
      set(doc, 'data.rfc.front.abstract.t', 'Beep boop.')
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('OBSOLETES_NOT_IN_ABSTRACT', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_NOT_IN_ABSTRACT', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('obsoletes in abstract but missing in rfc', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.abstract.t', 'This document obsoletes RFC 1234.')
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('OBSOLETES_NOT_IN_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_NOT_IN_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('updates in rfc but missing in abstract', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        updates: '1234'
      })
      set(doc, 'data.rfc.front.abstract.t', 'Beep boop.')
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('UPDATES_NOT_IN_ABSTRACT', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_NOT_IN_ABSTRACT', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('updates in abstract but missing in rfc', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.abstract.t', 'This document updates RFC 1234.')
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('UPDATES_NOT_IN_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_NOT_IN_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
  })
})
