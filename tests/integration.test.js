import { beforeAll, afterAll, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../lib/parsers/txt.mjs'
import {
  validateLineLength,
  validateCodeComments,
  validateLineExtraSpacing,
  validateAbstractSectionIsNumbered,
  validateStatusOfThisMemoSectionIsNumbered,
  validateCopyrightNoticeSectionIsNumbered,
  validateIDIndicator,
  validateDocumentName
} from '../lib/modules/txt.mjs'
import {
  validateAbstractSection,
  validateIntroductionSection,
  validateSecurityConsiderationsSection,
  validateAuthorSection
} from '../lib/modules/sections.mjs'
import { MODES } from '../lib/config/modes.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readFixture (name) {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8')
}

beforeAll(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('integration: real TXT draft through parser → validators', () => {
  let doc

  beforeAll(async () => {
    const raw = readFixture('draft-ietf-idr-rt-derived-community-00.txt')
    doc = await parse(raw, 'draft-ietf-idr-rt-derived-community-00.txt')
  })

  test('parser produces a well-formed doc object', () => {
    expect(doc.type).toBe('txt')
    expect(doc.docKind).toBe('draft')
    expect(typeof doc.body).toBe('string')
    expect(doc.data).toBeDefined()
    expect(doc.data.slug).toBe('draft-ietf-idr-rt-derived-community-00')
    expect(doc.data.header.authors.length).toBeGreaterThan(0)
    expect(doc.data.content.abstract.length).toBeGreaterThan(0)
  })

  const txtValidators = [
    ['validateLineLength', validateLineLength],
    ['validateCodeComments', validateCodeComments],
    ['validateLineExtraSpacing', validateLineExtraSpacing],
    ['validateAbstractSectionIsNumbered', validateAbstractSectionIsNumbered],
    ['validateStatusOfThisMemoSectionIsNumbered', validateStatusOfThisMemoSectionIsNumbered],
    ['validateCopyrightNoticeSectionIsNumbered', validateCopyrightNoticeSectionIsNumbered],
    ['validateIDIndicator', validateIDIndicator],
    ['validateDocumentName', validateDocumentName]
  ]

  const sectionValidators = [
    ['validateAbstractSection', validateAbstractSection],
    ['validateIntroductionSection', validateIntroductionSection],
    ['validateSecurityConsiderationsSection', validateSecurityConsiderationsSection],
    ['validateAuthorSection', validateAuthorSection]
  ]

  for (const [name, validator] of [...txtValidators, ...sectionValidators]) {
    test(`${name} returns an array when given parser output`, async () => {
      const result = await validator(doc, { mode: MODES.NORMAL })
      expect(Array.isArray(result)).toBe(true)
    })
  }

  test('abstract section has valid content', async () => {
    const result = await validateAbstractSection(doc, { mode: MODES.NORMAL })
    expect(result).not.toContainEqual(
      expect.objectContaining({ name: 'MISSING_ABSTRACT_SECTION' })
    )
  })

  test('document name is recognised', async () => {
    const result = await validateDocumentName(doc, { mode: MODES.NORMAL })
    expect(result).not.toContainEqual(
      expect.objectContaining({ name: 'FILENAME_NOT_FOUND_IN_DOC' })
    )
  })
})
