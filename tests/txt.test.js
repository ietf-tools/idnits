import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateLineLength, validateCodeComments, validateCopyrightDate, validateLicenseDeclarations, validateCopyrightSection } from '../lib/modules/txt.mjs'
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

describe('The copyright date is not valid.', () => {
  test('Copyright text date valid', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.extractedElements.copyrightDates = [2025]

    await expect(validateCopyrightDate(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateCopyrightDate(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateCopyrightDate(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('Copyright console date valid', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.extractedElements.copyrightDates = [2025]

    await expect(validateCopyrightDate(doc, { mode: MODES.NORMAL, year: 2025 })).resolves.toHaveLength(0)
    await expect(validateCopyrightDate(doc, { mode: MODES.FORGIVE_CHECKLIST, year: 2025 })).resolves.toHaveLength(0)
    await expect(validateCopyrightDate(doc, { mode: MODES.SUBMISSION, year: 2025 })).resolves.toHaveLength(0)
  })
  test('Copyright text date not valid', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.extractedElements.copyrightDates = [2023]

    await expect(validateCopyrightDate(doc, { mode: MODES.NORMAL })).resolves.toContainError('COPYRIGHT_DATE_NOT_VALID', ValidationWarning)
    await expect(validateCopyrightDate(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('COPYRIGHT_DATE_NOT_VALID', ValidationWarning)
    await expect(validateCopyrightDate(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('COPYRIGHT_DATE_NOT_VALID', ValidationWarning)
  })
  test('Copyright console date not valid', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.extractedElements.copyrightDates = [2034]

    await expect(validateCopyrightDate(doc, { mode: MODES.NORMAL, year: 2024 })).resolves.toContainError('COPYRIGHT_DATE_NOT_VALID', ValidationWarning)
    await expect(validateCopyrightDate(doc, { mode: MODES.FORGIVE_CHECKLIST, year: 2024 })).resolves.toContainError('COPYRIGHT_DATE_NOT_VALID', ValidationWarning)
    await expect(validateCopyrightDate(doc, { mode: MODES.SUBMISSION, year: 2024 })).resolves.toContainError('COPYRIGHT_DATE_NOT_VALID', ValidationWarning)
  })
})

describe('validateLicenseDeclarations', () => {
  test('should return error when both licence6_b_ii is empty and revisedBsdLicense6_i is false', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.extractedElements.licence6_b_ii = []
    doc.data.contains.revisedBsdLicense6_i = false
    doc.data.slug = 'draft-ietf-example'

    const result = await validateLicenseDeclarations(doc)
    expect(result).toContainEqual(new ValidationError(
      'TLP4_LICENSE_NOTICE_MISSING',
      'The document does not contain a required TLP-4 license notice (6.b.i or 6.b.ii).',
      { ref: 'https://trustee.ietf.org/license-info' }
    ))
  })

  test('should not return error for missing licence6_b_ii if revisedBsdLicense6_i is present', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.extractedElements.license6_b_ii = []
    doc.data.contains.revisedBsdLicense6_i = true
    doc.data.slug = 'draft-ietf-example'

    const result = await validateLicenseDeclarations(doc)
    expect(result).toHaveLength(0)
  })

  test('should return warning for licence6_c_i when slug starts with "draft-ietf-"', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.slug = 'draft-ietf-example'
    doc.data.contains.license6_c_i = true
    const result = await validateLicenseDeclarations(doc)
    expect(result).toContainEqual(new ValidationWarning(
      'TLP4_LICENSE_NOTICE',
      'The document has an IETF Trust Provisions of 28 Dec 2009, Section 6.c(i) Publication Limitation clause.',
      { ref: 'https://trustee.ietf.org/license-info' }
    ))
  })

  test('should return error for licence6_c_ii when slug starts with "draft-ietf-"', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.slug = 'draft-ietf-example'
    doc.data.contains.license6_c_ii = true
    const result = await validateLicenseDeclarations(doc)
    expect(result).toContainEqual(new ValidationError(
      'TLP4_LICENSE_NOTICE',
      'The document has an IETF Trust Provisions, 28 Dec 2009, Section 6.c(ii) Publication Limitation clause.',
      { ref: 'https://trustee.ietf.org/license-info' }
    ))
  })

  test('should not check for licence6_c if slug does not start with "draft-ietf-"', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.slug = 'other-document'
    doc.data.contains.license6_c_i = true
    doc.data.contains.license6_c_ii = true
    doc.data.contains.revisedBsdLicense6_i = true

    const result = await validateLicenseDeclarations(doc)
    expect(result).toHaveLength(0)
  })
})

describe('The copyright line is not present.', () => {
  test('Copyright line is not present', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.copyrightSection6_b_i = false
    doc.data.possibleIssues.copyrightLines6_i = []

    await expect(validateCopyrightSection(doc, { mode: MODES.NORMAL })).resolves.toContainError('COPYRIGHT_LINE_MISSING', ValidationError)
    await expect(validateCopyrightSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('COPYRIGHT_LINE_MISSING', ValidationError)
    await expect(validateCopyrightSection(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('COPYRIGHT_LINE_MISSING', ValidationError)
  })
  test('Copyright line is present', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.copyrightSection6_b_i = true
    doc.data.possibleIssues.copyrightLines6_i = []

    await expect(validateCopyrightSection(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateCopyrightSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateCopyrightSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('Document contains more than one copyright notice.', () => {
  test('Document contains one copyright notice', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.copyrightSection6_b_i = true
    doc.data.possibleIssues.copyrightLines6_i = ['COPYRIGHT']

    await expect(validateCopyrightSection(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateCopyrightSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateCopyrightSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })

  test('Document contains more than one copyright notice', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.copyrightSection6_b_i = true
    doc.data.possibleIssues.copyrightLines6_i = [
      'COPYRIGHT',
      'COPYRIGHT'
    ]

    await expect(validateCopyrightSection(doc, { mode: MODES.NORMAL })).resolves.toContainError('COPYRIGHT_LINE_MORE_THAN_ONE', ValidationWarning)
    await expect(validateCopyrightSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('COPYRIGHT_LINE_MORE_THAN_ONE', ValidationWarning)
    await expect(validateCopyrightSection(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('COPYRIGHT_LINE_MORE_THAN_ONE', ValidationWarning)
  })
})
