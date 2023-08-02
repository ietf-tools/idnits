import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { detectDeprecatedElements, validateCodeBlocks, validateIprAttribute } from '../lib/modules/xml.mjs'
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

describe('XML document should not contain <CODE BEGINS> tags', () => {
  test('valid sourcecode value', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.sourcecode', 'test')
    await expect(validateCodeBlocks(doc)).resolves.toHaveLength(0)
  })
  test('sourcecode with a <CODE BEGINS>', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.sourcecode', '<CODE BEGINS>test')
    await expect(validateCodeBlocks(doc)).resolves.toContainError('UNNECESSARY_CODE_BEGINS', ValidationWarning)
    await expect(validateCodeBlocks(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UNNECESSARY_CODE_BEGINS', ValidationWarning)
    await expect(validateCodeBlocks(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('<CODE BEGINS> without <sourcecode> tag', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.t', '<CODE BEGINS>test')
    await expect(validateCodeBlocks(doc)).resolves.toContainError('MISSING_SOURCECODE_TAG', ValidationWarning)
    await expect(validateCodeBlocks(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_SOURCECODE_TAG', ValidationWarning)
    await expect(validateCodeBlocks(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})
