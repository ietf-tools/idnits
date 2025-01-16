import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateLineLength, validateCodeComments, validateLineExtraSpacing } from '../lib/modules/txt.mjs'
import { baseTXTDoc } from './fixtures/base-doc.mjs'
import { cloneDeep } from 'lodash-es'

expect.extend({
  toContainError
})

describe('Text document should not contain over-long lines', () => {
  test('72 chars', async () => {
    const doc = { ...baseTXTDoc }
    for (const length of [72, 64, 42, 72]) {
      doc.body += 'x'.repeat(length) + '\n'
    }
    await expect(validateLineLength(doc)).resolves.toHaveLength(0)
  })
  test('more than 72 chars', async () => {
    const doc = { ...baseTXTDoc }
    for (const length of [72, 64, 42, 76]) {
      doc.body += 'x'.repeat(length) + '\n'
    }
    await expect(validateLineLength(doc)).resolves.toContainError('LINE_TOO_LONG', ValidationError)
    await expect(validateLineLength(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('LINE_TOO_LONG', ValidationWarning)
    await expect(validateLineLength(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('LINE_TOO_LONG', ValidationWarning)
  })
})

describe('The document should not contain more than 50 lines with intra-line extra spacing.', () => {
  test('less than 50 indents', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.body = `The translation of the IRTs is necessary in order to refrain from`

    await expect(validateLineExtraSpacing(doc)).resolves.toHaveLength(0)
  })
  test('more than 50 indents', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.body = `The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
                The      translation      of      the     Test
    `
    await expect(validateLineExtraSpacing(doc, { mode: MODES.NORMAL })).resolves.toContainError('RAGGED_RIGHT', ValidationError)
    await expect(validateLineExtraSpacing(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('RAGGED_RIGHT', ValidationWarning)
    await expect(validateLineExtraSpacing(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('validateCodeComments', () => {
  test('should return no warnings for documents without comments outside code blocks', async () => {
    const doc = {
      data: {
        possibleIssues: {
          inlineCode: []
        }
      }
    }

    const result = await validateCodeComments(doc, { mode: 0 })

    expect(result).toHaveLength(0)
  })

  test('should return a warning for a single comment outside code blocks', async () => {
    const doc = {
      data: {
        possibleIssues: {
          inlineCode: [
            { line: 10, pos: 5 }
          ]
        }
      }
    }

    const result = await validateCodeComments(doc, { mode: 0 })

    expect(result).toEqual([
      new ValidationWarning('COMMENT_OUT_OF_CODE_BLOCK', 'Found something which looks like a code comment -- if you have code sections in the document, please surround them with \'<CODE BEGINS>\' and \'<CODE ENDS>\' lines.', {
        lines: [{ line: 10, pos: 5 }],
        ref: 'https://datatracker.ietf.org/doc/rfc8879'
      })
    ])
  })

  test('should return a warning for multiple comments outside code blocks', async () => {
    const doc = {
      data: {
        possibleIssues: {
          inlineCode: [
            { line: 10, pos: 5 },
            { line: 15, pos: 20 }
          ]
        }
      }
    }

    const result = await validateCodeComments(doc, { mode: 0 })

    expect(result).toEqual([
      new ValidationWarning('COMMENT_OUT_OF_CODE_BLOCK', 'Found something which looks like a code comment -- if you have code sections in the document, please surround them with \'<CODE BEGINS>\' and \'<CODE ENDS>\' lines.', {
        lines: [
          { line: 10, pos: 5 },
          { line: 15, pos: 20 }
        ],
        ref: 'https://datatracker.ietf.org/doc/rfc8879'
      })
    ])
  })
})
