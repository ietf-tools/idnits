import { describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationError, ValidationWarning, ValidationComment } from '../lib/helpers/error.mjs'
import {
  validateLineLength,
  validateCodeComments,
  validatePKorBM,
  validateCodeBlockLicenses,
  validateLineExtraSpacing,
  validateUpdatesAndObsoletesLines,
  validateReferenceStyle,
  validateLinksInText,
  validateAbstractSectionIsNumbered,
  validateStatusOfThisMemoSectionIsNumbered,
  validateCopyrightNoticeSectionIsNumbered,
  validatePageNumbering,
  validatePreviousCopyrightSection,
  validateTitleUnexpectedIndentation,
  validateSeparatedFormfeeds,
  validateFormFeedOnSeparateLine,
  validateSubmissionComplianceLine,
  validateSubmissionComplianceLinePage,
  validateMultipleAcceptableParagraphPointingListId,
  validateParagraphLinkingToIdsList,
  validateDocumentName,
  validateAcceptableParagraphCallingOutSixMonthValidity,
  validateSaysWorkingDocuments,
  validateExpiresLine,
  validateIDIndicator,
  validatePages,
  validateCopyrightDate,
  validateLicenseDeclarations,
  validateCopyrightSection,
  validateTableOfContentsAndDocumentPages
} from '../lib/modules/txt.mjs'
import { baseTXTDoc } from './fixtures/base-doc.mjs'
import { cloneDeep } from 'lodash-es'
import { DateTime } from 'luxon'
import { PAGE_THRESHOLD_REQUIRING_TOC } from '../lib/config/consts.mjs'

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

  test('ignores lines containing non-ASCII characters even if over 72 chars', async () => {
    const doc = { ...baseTXTDoc }
    // 80 ASCII chars plus one non-ASCII at the end
    doc.body = 'x'.repeat(80) + 'é\n'
    await expect(validateLineLength(doc)).resolves.toHaveLength(0)
  })

  test('measures trimmed length, not raw length', async () => {
    const doc = { ...baseTXTDoc }
    // raw length is 100 but trimmed length is only 10
    doc.body = ' '.repeat(90) + 'abcdefghij\n'
    await expect(validateLineLength(doc)).resolves.toHaveLength(0)
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

describe('Validate pages are not separated by formfeeds.', () => {
  test('pages are not separated by formfeeds.', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.pagesFound = 3
    doc.data.pageCount = 6

    await expect(validateSeparatedFormfeeds(doc, { mode: MODES.NORMAL })).resolves.toContainError('PAGES_NOT_SEPARATED_BY_FORMFEEDS', ValidationWarning)
    await expect(validateSeparatedFormfeeds(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('PAGES_NOT_SEPARATED_BY_FORMFEEDS', ValidationWarning)
    await expect(validateSeparatedFormfeeds(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('pages are contain separated by formfeeds.', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.pagesFound = 4
    doc.data.pageCount = 4

    await expect(validateSeparatedFormfeeds(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateSeparatedFormfeeds(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateSeparatedFormfeeds(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('FORMFEED and [Page occur on a line, possibly separated by spaces.', () => {
  test('Document don`t have formfeed and page occur on a line', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.pageLineWithFormFeed = []

    await expect(validateFormFeedOnSeparateLine(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateFormFeedOnSeparateLine(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateFormFeedOnSeparateLine(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })

  test('Document have formfeed and page occur on a line', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.pageLineWithFormFeed = [{ page: 1, line: 2 }]

    await expect(validateFormFeedOnSeparateLine(doc, { mode: MODES.NORMAL })).resolves.toContainError('DOCUMENT_CONTAINS_FORM_FEED_NOT_ON_SEPARATE_LINE', ValidationComment)
    await expect(validateFormFeedOnSeparateLine(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('DOCUMENT_CONTAINS_FORM_FEED_NOT_ON_SEPARATE_LINE', ValidationComment)
    await expect(validateFormFeedOnSeparateLine(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('DOCUMENT_CONTAINS_FORM_FEED_NOT_ON_SEPARATE_LINE', ValidationComment)
  })
})

describe('The Document have an acceptable paragraph pointing to the list of current ids.', () => {
  test('Document have acceptable paragraph pointing to the list of current ids', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.paragraphPointingToTheListOfCurrentId = ['The list of current Internet-Drafts is at https://datatracker.ietf.org/drafts/current/.']

    await expect(validateMultipleAcceptableParagraphPointingListId(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateMultipleAcceptableParagraphPointingListId(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateMultipleAcceptableParagraphPointingListId(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })

  test('Document don`t acceptable paragraph pointing to the list of current ids', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.paragraphPointingToTheListOfCurrentId = ['The list of current Internet-Drafts is at https://datatracker.ietf.org/drafts/current/.', 'The list of current Internet-Drafts is at https://datatracker.ietf.org/drafts/current/.']

    await expect(validateMultipleAcceptableParagraphPointingListId(doc, { mode: MODES.NORMAL })).resolves.toContainError('ACCEPTABLE_PARAGRAPH_POINTING_LIST_ID_REPEATED_IN_THE_TEXT', ValidationError)
    await expect(validateMultipleAcceptableParagraphPointingListId(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('ACCEPTABLE_PARAGRAPH_POINTING_LIST_ID_REPEATED_IN_THE_TEXT', ValidationError)
    await expect(validateMultipleAcceptableParagraphPointingListId(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('ACCEPTABLE_PARAGRAPH_POINTING_LIST_ID_REPEATED_IN_THE_TEXT', ValidationError)
  })
})

describe('The Document have an acceptable paragraph pointing to the list of current I-Ds.', () => {
  test('Document have acceptable paragraph pointing to the list of current I-Ds', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.paragraphPointingToTheListOfCurrentId = ['The list of current Internet-Drafts is at https://datatracker.ietf.org/drafts/current/.']

    await expect(validateParagraphLinkingToIdsList(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateParagraphLinkingToIdsList(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateParagraphLinkingToIdsList(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })

  test('Document don`t acceptable paragraph pointing to the list of current I-Ds', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.paragraphPointingToTheListOfCurrentId = []

    await expect(validateParagraphLinkingToIdsList(doc, { mode: MODES.NORMAL })).resolves.toContainError('ACCEPTABLE_PARAGRAPH_POINTING_LIST_ID_MISSING', ValidationError)
    await expect(validateParagraphLinkingToIdsList(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('ACCEPTABLE_PARAGRAPH_POINTING_LIST_ID_MISSING', ValidationError)
    await expect(validateParagraphLinkingToIdsList(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('ACCEPTABLE_PARAGRAPH_POINTING_LIST_ID_MISSING', ValidationError)
  })
})

describe('Validate document name on first page.', () => {
  test('Document name doesn`t on first page', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.slug = null

    await expect(validateDocumentName(doc, { mode: MODES.NORMAL })).resolves.toContainError('DOCUMENT_NAME_MISSING', ValidationError)
    await expect(validateDocumentName(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('DOCUMENT_NAME_MISSING', ValidationError)
    await expect(validateDocumentName(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('DOCUMENT_NAME_MISSING', ValidationError)
  })
  test('Document name is present', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.slug = 'draft-'

    await expect(validateDocumentName(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateDocumentName(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateDocumentName(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('The Document have acceptable paragraph calling out 6 month validity.', () => {
  test('Document have acceptable paragraph calling out 6 month validity', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.draftParagraphOutSixMonthValidity = true

    await expect(validateAcceptableParagraphCallingOutSixMonthValidity(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateAcceptableParagraphCallingOutSixMonthValidity(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateAcceptableParagraphCallingOutSixMonthValidity(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })

  test('Document don`t acceptable paragraph calling out 6 month validity', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.draftParagraphOutSixMonthValidity = false

    await expect(validateAcceptableParagraphCallingOutSixMonthValidity(doc, { mode: MODES.NORMAL })).resolves.toContainError('ACCEPTABLE_PARAGRAPH_PROVIDING_FOR_PERIOD_OF_VALIDITY_MISSING', ValidationError)
    await expect(validateAcceptableParagraphCallingOutSixMonthValidity(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('ACCEPTABLE_PARAGRAPH_PROVIDING_FOR_PERIOD_OF_VALIDITY_MISSING', ValidationError)
    await expect(validateAcceptableParagraphCallingOutSixMonthValidity(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('ACCEPTABLE_PARAGRAPH_PROVIDING_FOR_PERIOD_OF_VALIDITY_MISSING', ValidationError)
  })
})

describe('The Document have acceptable paragraph noting that IDs are working documents.', () => {
  test('Document have acceptable paragraph', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.acceptableParagraphNotingThatDraft = true

    await expect(validateSaysWorkingDocuments(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateSaysWorkingDocuments(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateSaysWorkingDocuments(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })

  test('Document don`t acceptable paragraph', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.acceptableParagraphNotingThatDraft = false

    await expect(validateSaysWorkingDocuments(doc, { mode: MODES.NORMAL })).resolves.toContainError('ACCEPTABLE_PARAGRAPH_NOTING_THAT_DRAFT_MISSING', ValidationError)
    await expect(validateSaysWorkingDocuments(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('ACCEPTABLE_PARAGRAPH_NOTING_THAT_DRAFT_MISSING', ValidationError)
    await expect(validateSaysWorkingDocuments(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('ACCEPTABLE_PARAGRAPH_NOTING_THAT_DRAFT_MISSING', ValidationError)
  })
})

describe('The copyright date is not valid.', () => {
  test('Copyright text date valid', async () => {
    const doc = cloneDeep(baseTXTDoc)

    const currentYear = new Date().getFullYear()
    doc.data.extractedElements.copyrightDates = [currentYear]

    await expect(validateCopyrightDate(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateCopyrightDate(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateCopyrightDate(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('Copyright console date valid', async () => {
    const doc = cloneDeep(baseTXTDoc)

    const currentYear = new Date().getFullYear()
    doc.data.extractedElements.copyrightDates = [currentYear]

    await expect(validateCopyrightDate(doc, { mode: MODES.NORMAL, year: 2025 })).resolves.toHaveLength(0)
    await expect(validateCopyrightDate(doc, { mode: MODES.FORGIVE_CHECKLIST, year: 2025 })).resolves.toHaveLength(0)
    await expect(validateCopyrightDate(doc, { mode: MODES.SUBMISSION, year: 2025 })).resolves.toHaveLength(0)
  })
  test('Copyright text date not valid', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.extractedElements.copyrightDates = [2023]

    await expect(validateCopyrightDate(doc, { mode: MODES.NORMAL })).resolves.toContainError('COPYRIGHT_YEAR_MISMATCH', ValidationWarning)
    await expect(validateCopyrightDate(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('COPYRIGHT_YEAR_MISMATCH', ValidationWarning)
    await expect(validateCopyrightDate(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('COPYRIGHT_YEAR_MISMATCH', ValidationWarning)
  })
  test('Copyright console date not valid', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.extractedElements.copyrightDates = [2034]

    await expect(validateCopyrightDate(doc, { mode: MODES.NORMAL, year: 2024 })).resolves.toContainError('COPYRIGHT_YEAR_MISMATCH', ValidationWarning)
    await expect(validateCopyrightDate(doc, { mode: MODES.FORGIVE_CHECKLIST, year: 2024 })).resolves.toContainError('COPYRIGHT_YEAR_MISMATCH', ValidationWarning)
    await expect(validateCopyrightDate(doc, { mode: MODES.SUBMISSION, year: 2024 })).resolves.toContainError('COPYRIGHT_YEAR_MISMATCH', ValidationWarning)
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

describe('Document have page numbering', () => {
  test('Document have page numbering', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.missingPageNumbering = []

    await expect(validatePageNumbering(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validatePageNumbering(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validatePageNumbering(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })

  test('Document don`t have page numbering', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.missingPageNumbering = [{ page: 1, line: 2 }]

    await expect(validatePageNumbering(doc, { mode: MODES.NORMAL })).resolves.toContainError('DOCUMENT_NOT_CONTAINS_PAGE_NUMBERING', ValidationComment)
    await expect(validatePageNumbering(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('DOCUMENT_NOT_CONTAINS_PAGE_NUMBERING', ValidationComment)
    await expect(validatePageNumbering(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('DOCUMENT_NOT_CONTAINS_PAGE_NUMBERING', ValidationComment)
  })
})

describe('Previous TLP 6.b.i copyright versions', () => {
  test('Has previous TLP 6.b.i copyright versions', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.previous6_b_i_copyright = true

    await expect(validatePreviousCopyrightSection(doc, { mode: MODES.NORMAL })).resolves.toContainError('OBSELETE_COPYRIGHT_LINE', ValidationError)
    await expect(validatePreviousCopyrightSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSELETE_COPYRIGHT_LINE', ValidationError)
    await expect(validatePreviousCopyrightSection(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('OBSELETE_COPYRIGHT_LINE', ValidationError)
  })

  test('Does not have previous TLP 6.b.i copyright versions', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.previous6_b_i_copyright = false

    await expect(validatePreviousCopyrightSection(doc, {
      mode: MODES.NORMAL
    })).resolves.toHaveLength(0)
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

    doc.data.possibleIssues.unexpectedIndentation = [{ line: 1, pos: 12, name: 'Introduction' }]

    await expect(validateTitleUnexpectedIndentation(doc, { mode: MODES.NORMAL })).resolves.toContainError('SECTION_TITLE_HAS_UNEXPECTED_INDENTATION', ValidationWarning)
    await expect(validateTitleUnexpectedIndentation(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SECTION_TITLE_HAS_UNEXPECTED_INDENTATION', ValidationWarning)
    await expect(validateTitleUnexpectedIndentation(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('The submission compliance line validate.', () => {
  test('submission compliance line missing', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.submissionCompliance = false

    await expect(validateSubmissionComplianceLine(doc, { mode: MODES.NORMAL })).resolves.toContainError('SUBMISSION_COMPLIANCE_LINE_MISSING', ValidationError)
    await expect(validateSubmissionComplianceLine(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_COMPLIANCE_LINE_MISSING', ValidationError)
    await expect(validateSubmissionComplianceLine(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_COMPLIANCE_LINE_MISSING', ValidationError)
  })
  test('submission compliance line present', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.contains.submissionCompliance = true

    await expect(validateSubmissionComplianceLine(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateSubmissionComplianceLine(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateSubmissionComplianceLine(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('The submission compliance page validate.', () => {
  test('submission compliance page missing', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.submissionCompliancePage = null

    await expect(validateSubmissionComplianceLinePage(doc, { mode: MODES.NORMAL })).resolves.toContainError('SUBMISSION_COMPLIANCE_LINE_NOT_EARLY_IN_DOC', ValidationError)
    await expect(validateSubmissionComplianceLinePage(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_COMPLIANCE_LINE_NOT_EARLY_IN_DOC', ValidationError)
    await expect(validateSubmissionComplianceLinePage(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_COMPLIANCE_LINE_NOT_EARLY_IN_DOC', ValidationError)
  })
  test('submission compliance line on first page ', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.submissionCompliancePage = 1

    await expect(validateSubmissionComplianceLinePage(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateSubmissionComplianceLinePage(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateSubmissionComplianceLinePage(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })

  test('submission compliance line on fourth page ', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.submissionCompliancePage = 4

    await expect(validateSubmissionComplianceLinePage(doc, { mode: MODES.NORMAL })).resolves.toContainError('SUBMISSION_COMPLIANCE_LINE_NOT_EARLY_IN_DOC', ValidationError)
    await expect(validateSubmissionComplianceLinePage(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_COMPLIANCE_LINE_NOT_EARLY_IN_DOC', ValidationError)
    await expect(validateSubmissionComplianceLinePage(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_COMPLIANCE_LINE_NOT_EARLY_IN_DOC', ValidationError)
  })
})

describe(`The document has more than ${PAGE_THRESHOLD_REQUIRING_TOC} pages and not Table of Contents.`, () => {
  test('Table of Contents exists and pages less than current treshold', async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.isTableOfContentsExists = true
    doc.data.pageCount = 14

    await expect(validateTableOfContentsAndDocumentPages(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateTableOfContentsAndDocumentPages(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateTableOfContentsAndDocumentPages(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('Table of Contents missing and pages are current threshold', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.possibleIssues.isTableOfContentsExists = false
    doc.data.pageCount = PAGE_THRESHOLD_REQUIRING_TOC

    await expect(validateTableOfContentsAndDocumentPages(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    await expect(validateTableOfContentsAndDocumentPages(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateTableOfContentsAndDocumentPages(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test(`Table of Contents missing and pages more than current threshold (${PAGE_THRESHOLD_REQUIRING_TOC})`, async () => {
    const doc = cloneDeep(baseTXTDoc)

    doc.data.possibleIssues.isTableOfContentsExists = false
    doc.data.pageCount = 17

    await expect(validateTableOfContentsAndDocumentPages(doc, { mode: MODES.NORMAL })).resolves.toContainError(`DOCUMENT_HAVE_MORE_${PAGE_THRESHOLD_REQUIRING_TOC}_PAGES_OR_MISS_TABLE_OF_CONTENTS`, ValidationError)
    await expect(validateTableOfContentsAndDocumentPages(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError(`DOCUMENT_HAVE_MORE_${PAGE_THRESHOLD_REQUIRING_TOC}_PAGES_OR_MISS_TABLE_OF_CONTENTS`, ValidationError)
    await expect(validateTableOfContentsAndDocumentPages(doc, { mode: MODES.SUBMISSION })).resolves.toContainError(`DOCUMENT_HAVE_MORE_${PAGE_THRESHOLD_REQUIRING_TOC}_PAGES_OR_MISS_TABLE_OF_CONTENTS`, ValidationWarning)
  })
})

describe('Validate Expires Line in the document', () => {
  test('should return an error if the Expires lines are missing', async () => {
    const doc = cloneDeep(baseTXTDoc)

    await expect(validateExpiresLine(doc, { mode: MODES.NORMAL })).resolves.toEqual([
      new ValidationError(
        'EXPIRES_LINE_MISSING',
        'Document does not have expiration date on first and last page or it is invalid.',
        {
          ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
        }
      )
    ])
  })

  test('should return no errors if the Expires lines are present and match', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.header.expires = DateTime.fromFormat('2023-09-08', 'yyyy-MM-dd')
    doc.data.extractedElements.lastPageExpiration = DateTime.fromFormat('2023-09-08', 'yyyy-MM-dd')

    await expect(validateExpiresLine(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
  })

  test('should return no errors if the Expires line is present in submission mode', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.header.expires = DateTime.fromFormat('2023-09-08', 'yyyy-MM-dd')
    doc.data.extractedElements.lastPageExpiration = DateTime.fromFormat('2023-09-08', 'yyyy-MM-dd')

    await expect(validateExpiresLine(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })

  test('should return an error if the Expires line is invalid date', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.header.expires = null

    await expect(validateExpiresLine(doc, { mode: MODES.SUBMISSION })).resolves.toEqual([
      new ValidationError(
        'EXPIRES_LINE_MISSING',
        'Document does not have expiration date on first and last page or it is invalid.',
        {
          ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
        }
      )
    ])
  })

  test('should return an error if the Expires line is different', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.header.expires = DateTime.fromFormat('2023-09-08', 'yyyy-MM-dd')
    doc.data.extractedElements.lastPageExpiration = DateTime.fromFormat('2023-09-09', 'yyyy-MM-dd')

    await expect(validateExpiresLine(doc, { mode: MODES.NORMAL })).resolves.toEqual([
      new ValidationError(
        'EXPIRES_LINE_MISMATCH',
        'Document has different expiration date on first and last page.',
        {
          ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist'
        }
      )
    ])
  })
})

describe('validatePages', () => {
  test('should return no warnings if mode is SUBMISSION', async () => {
    const doc = {
      data: {
        possibleIssues: {
          tooLongPages: []
        }
      }
    }

    const result = await validatePages(doc, { mode: MODES.SUBMISSION })

    expect(result).toHaveLength(0)
  })

  test('should return no warnings if there are no too long pages', async () => {
    const doc = {
      data: {
        possibleIssues: {
          tooLongPages: []
        }
      }
    }

    const result = await validatePages(doc, { mode: MODES.NORMAL })

    expect(result).toHaveLength(0)
  })

  test('should return a warning if there are pages that are too long', async () => {
    const doc = {
      data: {
        possibleIssues: {
          tooLongPages: [
            { page: 3, lines: 85 },
            { page: 5, lines: 90 }
          ]
        }
      }
    }

    const result = await validatePages(doc, { mode: MODES.NORMAL })

    expect(result).toEqual([
      new ValidationWarning(
        'PAGE_TOO_LONG',
        'Page 3 is too long (85 lines).',
        { ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist' }
      ),
      new ValidationWarning(
        'PAGE_TOO_LONG',
        'Page 5 is too long (90 lines).',
        { ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist' }
      )
    ])
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
      'TLP5_LICENSE_RESTRICTION_NOTICE_MISSING',
      'The document does not contain a required TLP-5 license notice (6.b.i or 6.b.ii).',
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
    expect(result).toContainEqual(
      new ValidationWarning(
        'TLP5_LICENSE_RESTRICTION_NOTICE',
        'The document has an IETF Trust Provisions of 28 Dec 2009, Section 6.c(i) Publication Limitation clause.',
        { ref: 'https://trustee.ietf.org/license-info' }
      )
    )
  })

  test('should return error for licence6_c_ii when slug starts with "draft-ietf-"', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.slug = 'draft-ietf-example'
    doc.data.contains.license6_c_ii = true
    const result = await validateLicenseDeclarations(doc)
    expect(result).toContainEqual(
      new ValidationError(
        'TLP5_LICENSE_RESTRICTION_NOTICE',
        'The document has an IETF Trust Provisions, 28 Dec 2009, Section 6.c(ii) Publication Limitation clause.',
        { ref: 'https://trustee.ietf.org/license-info' }
      )
    )
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

describe('Validate ID indicator', () => {
  test('Should return error if ID indicator is missing in SUBMISSION mode', async () => {
    const doc = cloneDeep(baseTXTDoc)
    const result = await validateIDIndicator(doc, { mode: MODES.SUBMISSION })
    expect(result).toEqual([
      new ValidationError(
        'ID_INDICATOR_MISSING',
        'Document does not contain an ID indication.',
        { ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist' }
      )
    ])
  })

  test('should return no warnings if document contains ID indication', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.contains.idIndication = true
    const result = await validateIDIndicator(doc, { mode: MODES.NORMAL })
    expect(result).toHaveLength(0)
  })

  test('should return a warning if document does not contain ID indication', async () => {
    const doc = cloneDeep(baseTXTDoc)
    doc.data.contains.idIndication = false
    const result = await validateIDIndicator(doc, { mode: MODES.NORMAL })
    expect(result).toEqual([
      new ValidationError(
        'ID_INDICATOR_MISSING',
        'Document does not contain an ID indication.',
        { ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist' }
      )
    ])
  })

  test('should handle missing idIndication property gracefully', async () => {
    const doc = cloneDeep(baseTXTDoc)
    delete doc.data.contains.idIndication
    const result = await validateIDIndicator(doc, { mode: MODES.NORMAL })
    expect(result).toEqual([
      new ValidationError(
        'ID_INDICATOR_MISSING',
        'Document does not contain an ID indication.',
        { ref: 'https://authors.ietf.org/en/drafting-in-plaintext#checklist' }
      )
    ])
  })
})
