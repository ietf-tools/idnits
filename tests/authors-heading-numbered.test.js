import { describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { getSection } from '../lib/model/sections.mjs'
import { validateAuthorSection } from '../lib/modules/sections.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
import { CANONICAL_TXT } from './generators/doc-txt.js'

/**
 * Parse a text document whose body, after the abstract, ends with the given authors heading and an address
 *
 * @param {string} heading The heading line, as is
 * @param {string} [before] The line before the heading, as is
 * @returns {Promise<Object>} Parsed document
 */
function docWithAuthorsHeading (heading, before = '') {
  return parseTXT(`${CANONICAL_TXT}
1.  Introduction

   Text.
${before}
${heading}

   Jane Doe
   Example Corp
   Email: author@example.com
`, '')
}

/**
 * Codes of the findings of validateAuthorSection in every mode
 *
 * @param {Object} doc Parsed document
 * @returns {Promise<Array<Array<string>>>} Codes per mode: normal, forgive-checklist, submission
 */
async function codesPerMode (doc) {
  const modes = [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]
  const results = await Promise.all(modes.map(mode => validateAuthorSection(doc, { mode })))
  return results.map(findings => findings.map(finding => finding.name))
}

describe('numbered authors heading in text', () => {
  test.each([
    ['9.  Authors\' Addresses'],
    ['9. Author\'s Address'],
    ['9.  AUTHORS\' ADDRESSES'],
    ['9.  Editors\' Addresses'],
    ['9.  Editor\'s Address'],
    ['5 Authors\' addresses'],
    ['9  Authors\' Addresses'],
    ['8.0 Authors\' Addresses'],
    ['9.  Author’s Address'],
    ['   11. Authors\' Addresses']
  ])('"%s" starts the authors section', async (heading) => {
    const doc = await docWithAuthorsHeading(heading)
    const section = getSection(doc, 'authors')
    expect(section.present).toBe(true)
    expect(doc.data.content.authorAddress[0]).toBe(heading.trim())
    expect(doc.data.content.authorAddress).toContain('Email: author@example.com')
    await expect(codesPerMode(doc)).resolves.toEqual([[], [], []])
  })

  test('the section ends at the next numbered heading', async () => {
    const doc = await docWithAuthorsHeading('9.  Authors\' Addresses\n\n   Jane Doe\n\n10.  Index')
    expect(doc.data.content.authorAddress).toEqual(['9.  Authors\' Addresses', 'Jane Doe'])
  })

  test.each([
    ['indented', '   9 Authors\' Addresses', ''],
    ['continuing a paragraph', '9 Authors\' Addresses', '   the text before']
  ])('a number without its full stop, %s, is no heading', async (_, heading, before) => {
    const doc = await docWithAuthorsHeading(heading, before)
    expect(getSection(doc, 'authors').present).toBe(false)
    await expect(codesPerMode(doc)).resolves.toEqual([['MISSING_AUTHOR_SECTION'], ['MISSING_AUTHOR_SECTION'], []])
  })
})
