import { describe, expect, test } from '@jest/globals'
import { toContainError, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { detectDeprecatedElements, validateIprAttribute } from '../lib/modules/xml.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'

expect.extend({
  toContainError
})

describe('XML document should not use deprecated elements', () => {
  test('valid ipr value', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.t', 'test')
    await expect(detectDeprecatedElements(doc)).resolves.toHaveLength(0)
  })
  test('deprecated element at first level', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.c', 'test')
    await expect(detectDeprecatedElements(doc)).resolves.toContainError('DEPRECATED_ELEMENT', ValidationWarning)
  })
  test('deprecated element nested deep', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.front.title', 'test')
    set(doc, 'data.rfc.front.author.address.spanx', 'test')
    await expect(detectDeprecatedElements(doc)).resolves.toContainError('DEPRECATED_ELEMENT', ValidationWarning)
  })
})

describe('XML document should have a valid ipr attribute', () => {
  test('valid ipr value', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.ipr', 'trust200902')
    await expect(validateIprAttribute(doc)).resolves.toHaveLength(0)
  })
  test('missing ipr attribute', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc', {})
    await expect(validateIprAttribute(doc)).resolves.toContainError('MISSING_IPR_ATTRIBUTE', ValidationError)
  })
  test('invalid ipr attribute', async () => {
    const doc = cloneDeep(baseXMLDoc)
    // -> Empty value
    set(doc, 'data.rfc._attr.ipr', '')
    await expect(validateIprAttribute(doc)).resolves.toContainError('INVALID_IPR_VALUE', ValidationWarning)
    // -> Invalid value
    set(doc, 'data.rfc._attr.ipr', 'test')
    await expect(validateIprAttribute(doc)).resolves.toContainError('INVALID_IPR_VALUE', ValidationWarning)
  })
})

describe('XML stream document should only use allowed ipr values', () => {
  test('valid ipr value', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.ipr', 'trust200902')
    set(doc, 'data.rfc._attr.submissionType', 'IETF')
    await expect(validateIprAttribute(doc)).resolves.toHaveLength(0)
  })
  test('invalid noModificationTrust200902 ipr attribute', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.ipr', 'noModificationTrust200902')
    set(doc, 'data.rfc._attr.submissionType', 'IETF')
    await expect(validateIprAttribute(doc)).resolves.toContainError('FORBIDDEN_IPR_VALUE_FOR_STREAM', ValidationError)
  })
  test('invalid noDerivativesTrust200902 ipr attribute', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.ipr', 'noDerivativesTrust200902')
    set(doc, 'data.rfc._attr.submissionType', 'IETF')
    await expect(validateIprAttribute(doc)).resolves.toContainError('FORBIDDEN_IPR_VALUE_FOR_STREAM', ValidationError)
  })
})
