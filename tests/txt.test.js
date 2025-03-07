import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateLineLength, validateCodeComments, validateCopyrightNoticeSectionIsNumbered } from '../lib/modules/txt.mjs'
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

describe('The Copyright Notice section should not be numbered.', () => {
  test('Copyright Notice section numbered', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.isCopyrightNoticeNumbered = true

    await expect(validateCopyrightNoticeSectionIsNumbered(doc, { mode: MODES.NORMAL })).resolves.toContainError('COPYRIGHT_NOTICE_SECTION_IS_NUMBERED', ValidationError)
    await expect(validateCopyrightNoticeSectionIsNumbered(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('COPYRIGHT_NOTICE_SECTION_IS_NUMBERED', ValidationError)
    await expect(validateCopyrightNoticeSectionIsNumbered(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('COPYRIGHT_NOTICE_SECTION_IS_NUMBERED', ValidationError)
  })
  test('Copyright Notice section not numbered', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.isCopyrightNoticeNumbered = false

    await expect(validateCopyrightNoticeSectionIsNumbered(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateCopyrightNoticeSectionIsNumbered(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateCopyrightNoticeSectionIsNumbered(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})
