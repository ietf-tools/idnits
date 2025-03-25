import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationError, ValidationWarning, ValidationComment } from '../lib/helpers/error.mjs'
import {
  validateLineLength,
  validateCodeComments,
  validatePKorBM,
  validateCodeBlockLicenses,
  validateLineExtraSpacing,
  validateUpdatesAndObsoletesLines,
  validateHyphenatedLineBreaks,
  validateReferenceStyle,
  validateLinksInText,
  validateAbstractSectionIsNumbered,
  validateStatusOfThisMemoSectionIsNumbered,
  validateCopyrightNoticeSectionIsNumbered,
  validateTitleUnexpectedIndentation
} from '../lib/modules/txt.mjs'
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

    doc.data.possibleIssues.linesWithSpaces = [{ line: 10, pos: 5 }]

    await expect(validateLineExtraSpacing(doc)).resolves.toHaveLength(0)
  })
  test('more than 50 indents', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.linesWithSpaces = [...Array(51)].map((item, index) => ({
      line: index + 1,
      pos: (index % 10) + 1
    }))

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

describe('The status of this memo section should not be numbered.', () => {
  test('status of this memo section numbered', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.isStatusOfThisMemoNumbered = true

    await expect(validateStatusOfThisMemoSectionIsNumbered(doc, { mode: MODES.NORMAL })).resolves.toContainError('STATUS_OF_THIS_MEMO_SECTION_IS_NUMBERED', ValidationError)
    await expect(validateStatusOfThisMemoSectionIsNumbered(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('STATUS_OF_THIS_MEMO_SECTION_IS_NUMBERED', ValidationError)
    await expect(validateStatusOfThisMemoSectionIsNumbered(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('STATUS_OF_THIS_MEMO_SECTION_IS_NUMBERED', ValidationError)
  })
  test('status of this memo section not numbered', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.isStatusOfThisMemoNumbered = false

    await expect(validateStatusOfThisMemoSectionIsNumbered(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateStatusOfThisMemoSectionIsNumbered(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateStatusOfThisMemoSectionIsNumbered(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('The abstract section should not be numbered.', () => {
  test('Abstract section numbered', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.isAbstractNumbered = true

    await expect(validateAbstractSectionIsNumbered(doc, { mode: MODES.NORMAL })).resolves.toContainError('ABSTRACT_SECTION_IS_NUMBERED', ValidationError)
    await expect(validateAbstractSectionIsNumbered(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('ABSTRACT_SECTION_IS_NUMBERED', ValidationError)
    await expect(validateAbstractSectionIsNumbered(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('ABSTRACT_SECTION_IS_NUMBERED', ValidationError)
  })
  test('Abstract section not numbered', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.isAbstractNumbered = false

    await expect(validateAbstractSectionIsNumbered(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateAbstractSectionIsNumbered(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateAbstractSectionIsNumbered(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('Document has some links like a reference appears but does not occur in any reference section', () => {
  test('Text document should not contain some links live reference', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.extractedElements.bracketedRfcReferences = ['[RFC1234]']
    doc.data.extractedElements.referenceSectionRfc = [{ value: '4567' }]

    doc.data.extractedElements.bracketedRfcNonReferences = ['[RFC1234]', '[RFC4567]']

    await expect(validateLinksInText(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateLinksInText(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateLinksInText(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('Text document should contain some links live reference', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.extractedElements.bracketedRfcReferences = ['[RFC1234]']
    doc.data.extractedElements.referenceSectionRfc = [{ value: '4567' }]

    doc.data.extractedElements.bracketedRfcNonReferences = ['[RFC87411]', '[RFC1111]']

    await expect(validateLinksInText(doc, { mode: MODES.NORMAL })).resolves.toContainError('REFERENCE_MISSING_IN_REFERENCE_SECTION', ValidationWarning)
    await expect(validateLinksInText(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('REFERENCE_MISSING_IN_REFERENCE_SECTION', ValidationWarning)
    await expect(validateLinksInText(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('REFERENCE_MISSING_IN_REFERENCE_SECTION', ValidationWarning)
  })
})

describe('Validate document references style.', () => {
  test('Document use numeric style', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.extractedElements.referenceSectionRfc = [{ value: '[1]', subsection: null }, { value: '[2]', subsection: null }]
    doc.data.extractedElements.nonReferenceSectionDraftReferences = ['[ABC]']

    await expect(validateReferenceStyle(doc, { mode: MODES.NORMAL })).resolves.toContainError('DOCUMENT_USE_NUMERIC_REFERENCES', ValidationComment)
    await expect(validateReferenceStyle(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('DOCUMENT_USE_NUMERIC_REFERENCES', ValidationComment)
    await expect(validateReferenceStyle(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('Document use string style', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.extractedElements.referenceSectionRfc = [{ value: 1234, subsection: null }, { value: 2345, subsection: null }]
    doc.data.extractedElements.nonReferenceSectionDraftReferences = ['[1]']

    await expect(validateReferenceStyle(doc, { mode: MODES.NORMAL })).resolves.toContainError('DOCUMENT_USE_STRING_REFERENCES', ValidationComment)
    await expect(validateReferenceStyle(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('DOCUMENT_USE_STRING_REFERENCES', ValidationComment)
    await expect(validateReferenceStyle(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('The document Document starts with PK or BM.', () => {
  test('Document start with PK or BM', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.isPKorBM = true

    await expect(validatePKorBM(doc, { mode: MODES.NORMAL })).resolves.toContainError('FIRST_LINE_STARTS_WITH_PK_OR_BM', ValidationComment)
    await expect(validatePKorBM(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('FIRST_LINE_STARTS_WITH_PK_OR_BM', ValidationComment)
    await expect(validatePKorBM(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('Document does not start with PK or BM', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.isPKorBM = false

    await expect(validatePKorBM(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validatePKorBM(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validatePKorBM(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('Document hyphenated line-breaks', () => {
  test('Text document should not contain hyphenated line-breaks', async () => {
    const doc = { ...baseTXTDoc }

    await expect(validateHyphenatedLineBreaks(doc)).resolves.toHaveLength(0)
  })
  test('ext document contain hyphenated line-breaks', async () => {
    const doc = { ...baseTXTDoc }

    doc.data.possibleIssues.hyphenatedLines = [{ line: 1, pos: 20 }]
    await expect(validateHyphenatedLineBreaks(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    await expect(validateHyphenatedLineBreaks(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('HYPHENATED_LINE_BREAKS', ValidationWarning)
    await expect(validateHyphenatedLineBreaks(doc, { mode: MODES.NORMAL })).resolves.toContainError('HYPHENATED_LINE_BREAKS', ValidationWarning)
  })
})

describe('The document Updates or Obsoletes line on first page has more than just numbers of RFCs', () => {
  test('empty rfc with letter', async () => {
    const doc = cloneDeep(baseTXTDoc)

    await expect(validateUpdatesAndObsoletesLines(doc)).resolves.toHaveLength(0)
  })
  test('updates line with letters', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.updatesRfcWithLetter = ['RFC 1234', 'RFC 4532']
    doc.data.possibleIssues.obsoletesWithLetter = ['RFC 2434', 'RFC 4532']

    await expect(validateUpdatesAndObsoletesLines(doc, { mode: MODES.NORMAL })).resolves.toContainError('UPDATE_CONTAINS_INVALID_CHARACTERS', ValidationWarning)
    await expect(validateUpdatesAndObsoletesLines(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UPDATE_CONTAINS_INVALID_CHARACTERS', ValidationWarning)
    await expect(validateUpdatesAndObsoletesLines(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('obsoletes line with letters', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.obsoletesWithLetter = ['RFC 2434', 'RFC 4532']

    await expect(validateUpdatesAndObsoletesLines(doc, { mode: MODES.NORMAL })).resolves.toContainError('OBSOLETES_CONTAINS_INVALID_CHARACTERS', ValidationWarning)
    await expect(validateUpdatesAndObsoletesLines(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETES_CONTAINS_INVALID_CHARACTERS', ValidationWarning)
    await expect(validateUpdatesAndObsoletesLines(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('validateCodeBlockLicenses', () => {
  test('should return no warnings if there are no code blocks', async () => {
    const doc = {
      data: {
        contains: {
          codeBlocks: false,
          revisedBsdLicense: false
        }
      }
    }

    const result = await validateCodeBlockLicenses(doc, { mode: 0 })

    expect(result).toHaveLength(0)
  })

  test('should return no warnings if document has code blocks and license declaration', async () => {
    const doc = {
      data: {
        contains: {
          codeBlocks: true,
          revisedBsdLicense: true
        }
      }
    }

    const result = await validateCodeBlockLicenses(doc, { mode: 0 })

    expect(result).toHaveLength(0)
  })

  test('should return a warning if code blocks are detected but no license declaration exists', async () => {
    const doc = {
      data: {
        contains: {
          codeBlocks: true,
          revisedBsdLicense: false
        }
      }
    }

    const result = await validateCodeBlockLicenses(doc, { mode: 0 })

    expect(result).toEqual([
      new ValidationWarning(
        'CODE_BLOCK_MISSING_LICENSE',
        'A code-block is detected, but the document does not contain a license declaration.',
        {
          ref: 'https://trustee.ietf.org/license-info'
        }
      )
    ])
  })

  test('should return no warnings in submission mode even if license declaration is missing', async () => {
    const doc = {
      data: {
        contains: {
          codeBlocks: true,
          revisedBsdLicense: false
        }
      }
    }

    const result = await validateCodeBlockLicenses(doc, { mode: MODES.SUBMISSION })

    expect(result).toHaveLength(0)
  })

  test('should handle missing "revisedBsdLicense" gracefully', async () => {
    const doc = {
      data: {
        contains: {
          codeBlocks: true
        }
      }
    }

    const result = await validateCodeBlockLicenses(doc, { mode: 0 })

    expect(result).toEqual([
      new ValidationWarning(
        'CODE_BLOCK_MISSING_LICENSE',
        'A code-block is detected, but the document does not contain a license declaration.',
        {
          ref: 'https://trustee.ietf.org/license-info'
        }
      )
    ])
  })
})

describe('Validate section title', () => {
  test('Section title don`t have unexpected indentation', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.unexpectedIndentation = []

    await expect(validateTitleUnexpectedIndentation(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateTitleUnexpectedIndentation(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateTitleUnexpectedIndentation(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })

  test('Section title have unexpected indentation', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.unexpectedIndentation = [{ line: 1, pos: 12 }]

    await expect(validateTitleUnexpectedIndentation(doc, { mode: MODES.NORMAL })).resolves.toContainError('SECTION_TITLE_HAS_UNEXPECTED_INDENTATION', ValidationWarning)
    await expect(validateTitleUnexpectedIndentation(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SECTION_TITLE_HAS_UNEXPECTED_INDENTATION', ValidationWarning)
    await expect(validateTitleUnexpectedIndentation(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})
