import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationWarning } from '../lib/helpers/error.mjs'
import {
  validateDate,
  validateCategory,
  validateObsoleteUpdateRef,
  validateVersion
} from '../lib/modules/metadata.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'
import { DateTime } from 'luxon'
import fetchMock from 'jest-fetch-mock'

fetchMock.enableMocks()

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
      fetch.mockResponse('Not Found', { status: 404 })
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('OBSOLETES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('obsoletes an already obsoleted RFC', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        obsoletes: '1234, 2345'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document obsoletes RFC 1234 and 2345.')
      fetch.mockResponse(JSON.stringify({ obsoleted_by: ['3456'] }))
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
      fetch.mockResponse('Not Found', { status: 404 })
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('UPDATES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_RFC_NOT_FOUND', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('updates an already obsoleted RFC', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        updates: '1234, 2345'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document updates RFC 1234 and 2345.')
      fetch.mockResponse(JSON.stringify({ obsoleted_by: ['3456'] }))
      await expect(validateObsoleteUpdateRef(doc)).resolves.toContainError('UPDATES_OSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATES_OSOLETED_RFC', ValidationWarning)
      await expect(validateObsoleteUpdateRef(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('updates an already updated RFC', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        updates: '1234, 2345'
      })
      set(doc, 'data.rfc.front.abstract.t', 'This document updates RFC 1234 and 2345.')
      fetch.mockResponse(JSON.stringify({ updated_by: ['3456'] }))
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
      fetch.mockResponse(JSON.stringify({ rev: '00' }))
      await expect(validateVersion(doc)).resolves.toHaveLength(0)
    })
    test('valid version on non-existant doc', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        docName: 'draft-ietf-beep-boop-00'
      })
      fetch.mockResponse('Not Found', { status: 404 })
      await expect(validateVersion(doc)).resolves.toHaveLength(0)
    })
    test('duplicate version', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        docName: 'draft-ietf-beep-boop-01'
      })
      fetch.mockResponse(JSON.stringify({ rev: '01' }))
      await expect(validateVersion(doc)).resolves.toContainError('DUPLICATE_DOC_VERSION', ValidationWarning)
      await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('DUPLICATE_DOC_VERSION', ValidationWarning)
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('DUPLICATE_DOC_VERSION', ValidationWarning)
    })
    test('unexpected version (lower than latest)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        docName: 'draft-ietf-beep-boop-02'
      })
      fetch.mockResponse(JSON.stringify({ rev: '08' }))
      await expect(validateVersion(doc)).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
      await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
    })
    test('unexpected version (leaves a gap)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        docName: 'draft-ietf-beep-boop-04'
      })
      fetch.mockResponse(JSON.stringify({ rev: '02' }))
      await expect(validateVersion(doc)).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
      await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
    })
    test('unexpected version on non-existant doc', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc._attr', {
        docName: 'draft-ietf-beep-boop-01'
      })
      fetch.mockResponse('Not Found', { status: 404 })
      await expect(validateVersion(doc)).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
      await expect(validateVersion(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
      await expect(validateVersion(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('UNEXPECTED_DOC_VERSION', ValidationWarning)
    })
  })
})
