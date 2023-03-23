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
    expect(validateContent('abc\ndef\ngeh')).toHaveLength(0)
  })
  test('valid x0C page breaks', async () => {
    expect(validateContent('abc\fdef\fgeh')).toHaveLength(0)
  })
  test('valid x0D carriage returns', async () => {
    expect(validateContent('abc\rdef\r\ngeh')).toHaveLength(0)
  })
  test('invalid x00-x09 chars', async () => {
    expect(validateContent('abc\bdef\tgeh')).toContainError('INVALID_CTRL_CODES', ValidationError)
    expect(validateContent('abc\bdef\tgeh', { mode: MODES.FORGIVE_CHECKLIST })).toContainError('INVALID_CTRL_CODES', ValidationWarning)
    expect(validateContent('abc\bdef\tgeh', { mode: MODES.SUBMISSION })).toHaveLength(0)
  })
  test('invalid 0B char', async () => {
    expect(validateContent('abc\vdef')).toContainError('INVALID_CTRL_CODES', ValidationError)
    expect(validateContent('abc\vdef', { mode: MODES.FORGIVE_CHECKLIST })).toContainError('INVALID_CTRL_CODES', ValidationWarning)
    expect(validateContent('abc\vdef', { mode: MODES.SUBMISSION })).toHaveLength(0)
  })
  test('invalid x0E-x1 chars', async () => {
    /* eslint-disable no-useless-escape */
    expect(validateContent('abc\edef\x0Egeh')).toContainError('INVALID_CTRL_CODES', ValidationError)
    expect(validateContent('abc\edef\x0Egeh', { mode: MODES.FORGIVE_CHECKLIST })).toContainError('INVALID_CTRL_CODES', ValidationWarning)
    expect(validateContent('abc\edef\x0Egeh', { mode: MODES.SUBMISSION })).toHaveLength(0)
  })
})

describe('raw input should be in utf-8 encoding', () => {
  test('valid UTF8 buffer', async () => {
    const buf = Buffer.from('This is à tést!', 'utf8')
    expect(validateEncoding(buf)).toHaveLength(1)
    expect(validateEncoding(buf)).toContainError('NON_ASCII_UTF8', ValidationComment)
    expect(validateEncoding(buf, { mode: MODES.FORGIVE_CHECKLIST })).toHaveLength(1)
    expect(validateEncoding(buf, { mode: MODES.FORGIVE_CHECKLIST })).toContainError('NON_ASCII_UTF8', ValidationComment)
    expect(validateEncoding(buf, { mode: MODES.SUBMISSION })).toHaveLength(0)
  })
  test('valid ascii buffer', async () => {
    const buf = Buffer.from('abcdef', 'utf8')
    expect(validateEncoding(buf)).toHaveLength(0)
  })
  test('invalid latin1 buffer', async () => {
    const buf = Buffer.from('This is à tést!', 'latin1')
    expect(validateEncoding(buf)).toContainError('INVALID_ENCODING', ValidationError)
    expect(validateEncoding(buf, { mode: MODES.FORGIVE_CHECKLIST })).toContainError('INVALID_ENCODING', ValidationWarning)
    expect(validateEncoding(buf, { mode: MODES.SUBMISSION })).toHaveLength(0)
  })
})

describe('decode buffer to UTF-8 should produce an UTF-8 string', () => {
  test('valid UTF8 buffer', async () => {
    const buf = Buffer.from('This is à tést!', 'utf8')
    expect(decodeBufferToUTF8(buf)).toBe('This is à tést!')
  })
})
