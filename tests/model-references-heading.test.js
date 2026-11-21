import { describe, expect, test } from 'vitest'
import { CERTAINTY } from '../lib/model/indexes.mjs'
import { getReferencesSubsections, getUnrecognisedReferencesHeading } from '../lib/model/sections.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
import { CANONICAL_TXT } from './generators/doc-txt.js'

// Line of the heading that follows the introduction in docWithBack
const BACK_LINE = 26

/**
 * Parse a text document whose back holds the given lines, after an introduction citing [RFC4360]
 *
 * @param {string} back Lines after the introduction
 * @returns {Promise<Object>} Parsed document
 */
function docWithBack (back) {
  return parseTXT(`${CANONICAL_TXT}
1.  Introduction

   This document uses [RFC4360].

${back}
Authors' Addresses
`, '')
}

const ENTRY = `   [RFC4360]  Sangli, S., "BGP Extended Communities Attribute",
              RFC 4360, February 2006.
`

describe('getUnrecognisedReferencesHeading', () => {
  test.each([
    ['Appendix A.  References'],
    ['11.  11.  References'],
    ['39.  20.  Normative References'],
    ['21.  Normative and Informative References'],
    ['8.  References>'],
    ['Appendix B.  Bibliography.'],
    ['Appendix B - Bibliography'],
    ['14.  Normative']
  ])('finds "%s" at its line', async (heading) => {
    const doc = await docWithBack(`${heading}\n\n${ENTRY}`)
    expect(doc.data.markers.references.start).toBeFalsy()
    expect(getUnrecognisedReferencesHeading(doc)).toEqual({
      title: heading,
      certainty: CERTAINTY.INFERRED,
      location: { lines: [{ line: BACK_LINE, pos: 1 }] }
    })
  })

  test('the first such heading is the one found', async () => {
    const doc = await docWithBack(`Appendix A.  References\n\nA.1.  Normative References\n\n${ENTRY}`)
    expect(getUnrecognisedReferencesHeading(doc).title).toBe('Appendix A.  References')
  })

  test.each([
    ['Appendix A.  Reference Implementation'],
    ['6.  Reference Deployment Model'],
    ['14.  Appendix B: Capability Gating Reference'],
    ['10.  Relying Party Profile (Normative)'],
    ['Normative']
  ])('"%s" is no references heading', async (heading) => {
    const doc = await docWithBack(`${heading}\n\n   Some text.\n`)
    expect(getUnrecognisedReferencesHeading(doc)).toBeNull()
  })

  test('only at the margin and starting a paragraph', async () => {
    const indented = await docWithBack('   Appendix A.  References\n\n   Some text.\n')
    expect(getUnrecognisedReferencesHeading(indented)).toBeNull()
    const wrapped = await docWithBack('2.  Terms\n\n   Some text\nAppendix A.  References\n')
    expect(getUnrecognisedReferencesHeading(wrapped)).toBeNull()
  })

  test('not an entry of the table of contents', async () => {
    const doc = await docWithBack('Appendix A.  References . . . . . . . 7\n\n   Some text.\n')
    expect(getUnrecognisedReferencesHeading(doc)).toBeNull()
  })

  test('none in a document without one', async () => {
    const doc = await docWithBack('2.  Security Considerations\n\n   None.\n')
    expect(getUnrecognisedReferencesHeading(doc)).toBeNull()
  })
})

describe('references headings numbered without a full stop', () => {
  test('"7 References" starts the references section, and "7.1 Normative References" is a subsection', async () => {
    const doc = await docWithBack(`2 References\n\n2.1 Normative References\n\n${ENTRY}\n2.2 Informative References\n\n${ENTRY}`)
    expect(doc.data.markers.references.start).toBe(BACK_LINE)
    expect(getReferencesSubsections(doc).map(({ title, classified }) => [title, classified])).toEqual([
      ['2.1 Normative References', true],
      ['2.2 Informative References', true]
    ])
  })

  test('"7.1 Other References" is an unclassified subsection', async () => {
    const doc = await docWithBack(`2 References\n\n2.1 Other References\n\n${ENTRY}`)
    expect(getReferencesSubsections(doc).map(({ title, classified }) => [title, classified])).toEqual([
      ['2.1 Other References', false]
    ])
  })
})
