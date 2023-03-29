import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateIprAttribute } from '../lib/modules/xml.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { set } from 'lodash-es'

expect.extend({
  toContainError
})

describe('XML document should have a valid ipr attribute', () => {
  test('valid ipr value', async () => {
    const doc = { ...baseXMLDoc }
    set(doc, 'data.rfc._attr.ipr', 'trust200902')
    expect(validateIprAttribute(doc)).toHaveLength(0)
  })
  test('missing ipr attribute', async () => {
    const doc = { ...baseXMLDoc }
    set(doc, 'data.rfc', {})
    expect(validateIprAttribute(doc)).toContainError('MISSING_IPR_ATTRIBUTE', ValidationError)
  })
  test('invalid ipr attribute', async () => {
    const doc = { ...baseXMLDoc }
    // -> Empty value
    set(doc, 'data.rfc._attr.ipr', '')
    expect(validateIprAttribute(doc)).toContainError('INVALID_IPR_VALUE', ValidationWarning)
    // -> Invalid value
    set(doc, 'data.rfc._attr.ipr', 'test')
    expect(validateIprAttribute(doc)).toContainError('INVALID_IPR_VALUE', ValidationWarning)
  })
})

describe('XML stream document should only use allowed ipr values', () => {
  test('valid ipr value', async () => {
    const doc = { ...baseXMLDoc }
    set(doc, 'data.rfc._attr.ipr', 'trust200902')
    set(doc, 'data.rfc._attr.submissionType', 'IETF')
    expect(validateIprAttribute(doc)).toHaveLength(0)
  })
  test('invalid noModificationTrust200902 ipr attribute', async () => {
    const doc = { ...baseXMLDoc }
    set(doc, 'data.rfc._attr.ipr', 'noModificationTrust200902')
    set(doc, 'data.rfc._attr.submissionType', 'IETF')
    expect(validateIprAttribute(doc)).toContainError('FORBIDDEN_IPR_VALUE_FOR_STREAM', ValidationError)
  })
  test('invalid noDerivativesTrust200902 ipr attribute', async () => {
    const doc = { ...baseXMLDoc }
    set(doc, 'data.rfc._attr.ipr', 'noDerivativesTrust200902')
    set(doc, 'data.rfc._attr.submissionType', 'IETF')
    expect(validateIprAttribute(doc)).toContainError('FORBIDDEN_IPR_VALUE_FOR_STREAM', ValidationError)
  })
})
