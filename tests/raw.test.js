import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateRawContent } from '../lib/modules/raw.mjs'

expect.extend({
  toContainError
})

describe('raw data does not include invalid control chars', () => {
  test('valid x0A line endings', async () => {
    expect(validateRawContent('abc\ndef\ngeh')).toHaveLength(0)
  })
  test('valid x0C page breaks', async () => {
    expect(validateRawContent('abc\fdef\fgeh')).toHaveLength(0)
  })
  test('valid x0D carriage returns', async () => {
    expect(validateRawContent('abc\rdef\r\ngeh')).toHaveLength(0)
  })
  test('invalid x00-x09 chars', async () => {
    expect(validateRawContent('abc\bdef\tgeh')).toContainError('INVALID_CTRL_CODES', ValidationError)
    expect(validateRawContent('abc\bdef\tgeh', { mode: MODES.FORGIVE_CHECKLIST })).toContainError('INVALID_CTRL_CODES', ValidationWarning)
    expect(validateRawContent('abc\bdef\tgeh', { mode: MODES.SUBMISSION })).toHaveLength(0)
  })
  test('invalid 0B char', async () => {
    expect(validateRawContent('abc\vdef')).toContainError('INVALID_CTRL_CODES', ValidationError)
    expect(validateRawContent('abc\vdef', { mode: MODES.FORGIVE_CHECKLIST })).toContainError('INVALID_CTRL_CODES', ValidationWarning)
    expect(validateRawContent('abc\vdef', { mode: MODES.SUBMISSION })).toHaveLength(0)
  })
  test('invalid x0E-x1 chars', async () => {
    /* eslint-disable no-useless-escape */
    expect(validateRawContent('abc\edef\x0Egeh')).toContainError('INVALID_CTRL_CODES', ValidationError)
    expect(validateRawContent('abc\edef\x0Egeh', { mode: MODES.FORGIVE_CHECKLIST })).toContainError('INVALID_CTRL_CODES', ValidationWarning)
    expect(validateRawContent('abc\edef\x0Egeh', { mode: MODES.SUBMISSION })).toHaveLength(0)
  })
})
