import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateLineLength } from '../lib/modules/txt.mjs'
import { baseTXTDoc } from './fixtures/base-doc.mjs'
import { set } from 'lodash-es'

expect.extend({
  toContainError
})

describe('Text document should not contain over-long lines', () => {
  test('72 chars', async () => {
    const doc = { ...baseTXTDoc }
    for (const length of [72, 64, 42, 72]) {
      doc.body += 'x'.repeat(length) + '\n'
    }
    expect(validateLineLength(doc)).toHaveLength(0)
  })
  test('more than 72 chars', async () => {
    const doc = { ...baseTXTDoc }
    for (const length of [72, 64, 42, 76]) {
      doc.body += 'x'.repeat(length) + '\n'
    }
    expect(validateLineLength(doc)).toContainError('LINE_TOO_LONG', ValidationError)
    expect(validateLineLength(doc, { mode: MODES.FORGIVE_CHECKLIST })).toContainError('LINE_TOO_LONG', ValidationWarning)
    expect(validateLineLength(doc, { mode: MODES.SUBMISSION })).toContainError('LINE_TOO_LONG', ValidationWarning)
  })
})
