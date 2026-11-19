import { describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { getReferences } from '../lib/model/references.mjs'
import { getReferencesSubsections } from '../lib/model/sections.mjs'
import { validateReferencesSection } from '../lib/modules/sections.mjs'
import { getLooseHeadingLevel, parse as parseTXT } from '../lib/parsers/txt.mjs'
import { CANONICAL_TXT } from './generators/doc-txt.js'

/**
 * Parse a text document whose body holds the given lines, after the abstract
 *
 * @param {string} body Lines after the abstract
 * @returns {Promise<Object>} Parsed document
 */
function docWithBody (body) {
  return parseTXT(`${CANONICAL_TXT}
${body}
Authors' Addresses
`, '')
}

const ENTRY = `   [RFC4360]  Sangli, S., "BGP Extended Communities Attribute",
              RFC 4360, February 2006.
`

const OTHER_ENTRY = `   [RFC4087]  Thaler, D., "IP Tunnel MIB", RFC 4087, June 2005.
`

/**
 * Body of a document with its sections numbered in the given way
 *
 * @param {function(number): string} number Number of the section, as written before its title
 * @returns {string} Lines of the body
 */
function numberedBody (number) {
  return `${number(1)}Introduction

   This document uses [RFC4360].

${number(2)}Security Considerations

   None.

${number(3)}IANA Considerations

   None.

${number(4)}References

${ENTRY}`
}

describe('getLooseHeadingLevel', () => {
  test.each([
    ['8 Security Considerations', 'section'],
    ['1   Introduction', 'section'],
    ['5.0 References', 'section'],
    ['7.1 Other References', 'subsection'],
    ['4.2\tEnterprises', 'subsection'],
    ['5.1 media-col (collection)', 'subsection']
  ])('"%s" is a %s heading', (line, level) => {
    expect(getLooseHeadingLevel(line, 0, '')).toBe(level)
  })

  test.each([
    ['8.  Security Considerations'],
    ['4      R -> I     ExecutionResult      result'],
    ['302 Redirect'],
    ['0 1 2 3 4 5 6 7 0 1 2 3 4 5 6 7'],
    ['24 octet NT-Response:'],
    ['6 September 2026'],
    ['1 Introduction . . . . . . . . . 3'],
    [`2 ${'A'.repeat(72)}`]
  ])('"%s" is not', (line) => {
    expect(getLooseHeadingLevel(line, 0, '')).toBeNull()
  })

  test('only at the margin and starting a paragraph', () => {
    expect(getLooseHeadingLevel('8 Security Considerations', 3, '')).toBeNull()
    expect(getLooseHeadingLevel('8 Security Considerations', 0, '   the text before')).toBeNull()
    expect(getLooseHeadingLevel('8 Security Considerations', 0, '\f')).toBe('section')
  })
})

describe('sections numbered without a full stop or "N.0"', () => {
  test.each([
    ['"8 Security Considerations"', (n) => `${n} `],
    ['"8.0 Security Considerations"', (n) => `${n}.0 `]
  ])('%s starts its section', async (_, number) => {
    const doc = await docWithBody(numberedBody(number))
    const { markers, content } = doc.data
    expect(markers.introduction.start).toBeTruthy()
    expect(content.securityConsiderations).toEqual([`${number(2)}Security Considerations`, 'None.'])
    expect(content.ianaConsiderations).toEqual([`${number(3)}IANA Considerations`, 'None.'])
    expect(markers.references.start).toBeTruthy()
  })

  test('an indented one, or one that does not start a paragraph, does not', async () => {
    const indented = await docWithBody('1.  Introduction\n\n   Some text.\n\n   2 Security Considerations\n\n   None.\n')
    expect(indented.data.markers.securityConsiderations.start).toBeFalsy()
    const wrapped = await docWithBody('1.  Introduction\n\n   Some text\n2 Security Considerations\n\n   None.\n')
    expect(wrapped.data.markers.securityConsiderations.start).toBeFalsy()
  })

  test('one ends the references section', async () => {
    const doc = await docWithBody(`1.  Introduction\n\n   This document uses [RFC4360].\n\n2 References\n\n${ENTRY}\n3 Acknowledgements\n\n   Thanks.\n`)
    expect(doc.data.content.references).not.toContain('Thanks.')
  })
})

describe('references subsections numbered without a full stop', () => {
  const body = `1.  Introduction

   This document uses [RFC4360] and [RFC4087].

2 References

2.1 Normative References

${ENTRY}
2.2 Other References

${OTHER_ENTRY}`

  test('"2.2 Other References" is an unclassified subsection', async () => {
    const doc = await docWithBody(body)
    expect(getReferencesSubsections(doc).map(({ title, classified }) => [title, classified])).toEqual([
      ['2.1 Normative References', true],
      ['2.2 Other References', false]
    ])
    expect(getReferences(doc).map(({ rfc, kind }) => [rfc, kind])).toEqual([
      ['4360', 'normative'],
      ['4087', 'unclassified']
    ])
  })

  test('it is reported as unclassified', async () => {
    const doc = await docWithBody(body)
    const findings = await validateReferencesSection(doc, { mode: MODES.NORMAL })
    expect(findings.map(({ name, message }) => [name, message])).toEqual([
      ['UNCLASSIFIED_REFERENCES_SUBSECTION', 'The subsection "2.2 Other References" is not classified as Normative or Informative.']
    ])
  })

  test('an indented one is not a subsection', async () => {
    const doc = await docWithBody(body.replace('2.2 Other References', '   2.2 Other References'))
    expect(getReferencesSubsections(doc).map(({ title }) => title)).toEqual(['2.1 Normative References'])
  })
})
