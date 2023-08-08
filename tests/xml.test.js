import { beforeEach, describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { detectDeprecatedElements, validateCodeBlocks, validateTextLikeRefs, validateIprAttribute, validateSubmissionType } from '../lib/modules/xml.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'
import fetchMock from 'jest-fetch-mock'

fetchMock.enableMocks()

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

describe('XML document should not contain text document refs', () => {
  test('valid <eref> ref', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.t', 'test <eref> test')
    await expect(validateTextLikeRefs(doc)).resolves.toHaveLength(0)
  })
  test('invalid ref in [1] format', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.t', 'test [1] test')
    await expect(validateTextLikeRefs(doc)).resolves.toContainError('TEXT_DOC_REF', ValidationWarning)
    await expect(validateTextLikeRefs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('TEXT_DOC_REF', ValidationWarning)
    await expect(validateTextLikeRefs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('invalid ref in [RFC1234] format', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.t', 'test [RFC1234] test')
    await expect(validateTextLikeRefs(doc)).resolves.toContainError('TEXT_DOC_REF', ValidationWarning)
    await expect(validateTextLikeRefs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('TEXT_DOC_REF', ValidationWarning)
    await expect(validateTextLikeRefs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('XML document should have a valid submission type', () => {
  beforeEach(() => {
    fetch.resetMocks()
  })

  test('valid submissionType', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.submissionType', 'ietf')
    set(doc, 'filename', 'draft-ietf-beep-boop.xml')
    await expect(validateSubmissionType(doc, { offline: true })).resolves.toHaveLength(0)
  })
  test('invalid stream', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.submissionType', 'xyz')
    set(doc, 'filename', 'draft-xyz-beep-boop.xml')
    await expect(validateSubmissionType(doc, { offline: true })).resolves.toContainError('SUBMISSION_TYPE_INVALID', ValidationError)
    await expect(validateSubmissionType(doc, { offline: true, mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_TYPE_INVALID', ValidationError)
    await expect(validateSubmissionType(doc, { offline: true, mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_TYPE_INVALID', ValidationError)
  })
  test('filename stream mismatch', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.submissionType', 'ietf')
    set(doc, 'filename', 'draft-iab-beep-boop.xml')
    await expect(validateSubmissionType(doc, { offline: true })).resolves.toContainError('SUBMISSION_TYPE_MISMATCH', ValidationError)
    await expect(validateSubmissionType(doc, { offline: true, mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_TYPE_MISMATCH', ValidationError)
    await expect(validateSubmissionType(doc, { offline: true, mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_TYPE_MISMATCH', ValidationError)
  })
  test('valid submissionType with matching online stream', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.submissionType', 'ietf')
    set(doc, 'data.rfc._attr.docName', 'draft-ietf-beep-boop')
    set(doc, 'filename', 'draft-ietf-beep-boop.xml')
    fetch.mockResponse(JSON.stringify({ stream: '/api/v1/name/streamname/ietf/' }))
    await expect(validateSubmissionType(doc)).resolves.toHaveLength(0)
  })
  test('valid submissionType with non-existent online doc', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.submissionType', 'ietf')
    set(doc, 'data.rfc._attr.docName', 'draft-ietf-beep-boop')
    set(doc, 'filename', 'draft-ietf-beep-boop.xml')
    fetch.mockResponse('Not Found', { status: 404 })
    await expect(validateSubmissionType(doc)).resolves.toHaveLength(0)
  })
  test('stream mismatch with existing online doc', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.submissionType', 'ietf')
    set(doc, 'data.rfc._attr.docName', 'draft-ietf-beep-boop')
    set(doc, 'filename', 'draft-ietf-beep-boop.xml')
    fetch.mockResponse(JSON.stringify({ stream: '/api/v1/name/streamname/iab/' }))
    await expect(validateSubmissionType(doc)).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
    await expect(validateSubmissionType(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
    await expect(validateSubmissionType(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
  })
  test('stream set while existing online doc is not set', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.submissionType', 'ietf')
    set(doc, 'data.rfc._attr.docName', 'draft-ietf-beep-boop')
    set(doc, 'filename', 'draft-ietf-beep-boop.xml')
    fetch.mockResponse(JSON.stringify({ stream: null }))
    await expect(validateSubmissionType(doc)).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
    await expect(validateSubmissionType(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
    await expect(validateSubmissionType(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
  })
})
