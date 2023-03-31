import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateContent, validateEncoding, decodeBufferToUTF8 } from '../lib/modules/raw.mjs'
import { Buffer } from 'node:buffer'

expect.extend({
  toContainError
})

describe('input does not include invalid control chars', () => {
  test('valid x0A line endings', async () => {
    await expect(validateContent('abc\ndef\ngeh')).resolves.toHaveLength(0)
  })
  test('valid x0C page breaks', async () => {
    await expect(validateContent('abc\fdef\fgeh')).resolves.toHaveLength(0)
  })
  test('valid x0D carriage returns', async () => {
    await expect(validateContent('abc\rdef\r\ngeh')).resolves.toHaveLength(0)
  })
  test('invalid x00-x09 chars', async () => {
    await expect(validateContent('abc\bdef\tgeh')).resolves.toContainError('INVALID_CTRL_CODES', ValidationError)
    await expect(validateContent('abc\bdef\tgeh', { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_CTRL_CODES', ValidationWarning)
    await expect(validateContent('abc\bdef\tgeh', { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('invalid 0B char', async () => {
    await expect(validateContent('abc\vdef')).resolves.toContainError('INVALID_CTRL_CODES', ValidationError)
    await expect(validateContent('abc\vdef', { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_CTRL_CODES', ValidationWarning)
    await expect(validateContent('abc\vdef', { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('invalid x0E-x1 chars', async () => {
    /* eslint-disable no-useless-escape */
    await expect(validateContent('abc\edef\x0Egeh')).resolves.toContainError('INVALID_CTRL_CODES', ValidationError)
    await expect(validateContent('abc\edef\x0Egeh', { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_CTRL_CODES', ValidationWarning)
    await expect(validateContent('abc\edef\x0Egeh', { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('raw input should be in utf-8 encoding', () => {
  test('valid UTF8 buffer', async () => {
    const buf = Buffer.from('This is à tést!', 'utf8')
    await expect(validateEncoding(buf)).resolves.toHaveLength(1)
    await expect(validateEncoding(buf)).resolves.toContainError('NON_ASCII_UTF8', ValidationComment)
    await expect(validateEncoding(buf, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(1)
    await expect(validateEncoding(buf, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('NON_ASCII_UTF8', ValidationComment)
    await expect(validateEncoding(buf, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('valid ascii buffer', async () => {
    const buf = Buffer.from('abcdef', 'utf8')
    await expect(validateEncoding(buf)).resolves.toHaveLength(0)
  })
  test('invalid latin1 buffer', async () => {
    const buf = Buffer.from('This is à tést!', 'latin1')
    await expect(validateEncoding(buf)).resolves.toContainError('INVALID_ENCODING', ValidationError)
    await expect(validateEncoding(buf, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_ENCODING', ValidationWarning)
    await expect(validateEncoding(buf, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('decode buffer to UTF-8 should produce an UTF-8 string', () => {
  test('valid UTF8 buffer', async () => {
    const buf = Buffer.from('This is à tést!', 'utf8')
    await expect(decodeBufferToUTF8(buf)).resolves.toBe('This is à tést!')
  })
})
