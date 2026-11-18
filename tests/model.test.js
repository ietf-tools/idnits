import { describe, expect, test } from 'vitest'
import { cloneDeep } from 'lodash-es'
import { CERTAINTY, getIndex } from '../lib/model/indexes.mjs'
import { getReferencesHeadings, getSection } from '../lib/model/sections.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
import { CANONICAL_TXT } from './generators/doc-txt.js'

// The canonical text draft (abstract on line 18), with sections from line 22 on
const TXT_SECTIONS = `
1.  Introduction

   This document introduces nothing.

2.  Security Considerations

3.  References

3.1.  Normative References

   [RFC2119]  Bradner, S., "Key words", BCP 14, RFC 2119.

3.2.  Informational References

   [RFC7322]  Flanagan, H., "RFC Style Guide", RFC 7322.

Author's Address

   Alice Example
`

/**
 * Parse an XML draft with the given <front> and <back> children and <middle> sections
 *
 * @param {Object} parts Markup of the parts
 * @param {string} [parts.front=''] Children of <front> besides its <title>
 * @param {string} [parts.middle=''] Children of <middle>
 * @param {string} [parts.back=''] Children of <back>
 * @returns {Promise<Object>} Parsed document
 */
async function parseXmlDraft ({ front = '', middle = '', back = '' }) {
  const { doc } = await parse(`<?xml version="1.0" encoding="utf-8"?>
<rfc version="3" docName="draft-test-00">
  <front><title>Test</title>${front}</front>
  <middle>${middle}</middle>
  <back>${back}</back>
</rfc>`, 'draft-test-00.xml')
  return doc
}

describe('indexes on a document', () => {
  test('are computed on first use and kept for the document', () => {
    const doc = {}
    let computed = 0
    const compute = () => {
      computed++
      return { computed }
    }
    const first = getIndex(doc, 'count', compute)
    expect(getIndex(doc, 'count', compute)).toBe(first)
    expect(computed).toBe(1)
  })

  test('are not shared between documents', () => {
    const compute = (doc) => doc.name
    expect(getIndex({ name: 'a' }, 'name', compute)).toBe('a')
    expect(getIndex({ name: 'b' }, 'name', compute)).toBe('b')
  })
})

describe('sections of a text document are inferred, located by line', () => {
  test('a section that is there, with its heading line', async () => {
    const doc = await parseTXT(CANONICAL_TXT + TXT_SECTIONS, 'draft-ietf-beep-boop-01.txt')
    expect(getSection(doc, 'abstract')).toEqual({
      kind: 'abstract',
      certainty: CERTAINTY.INFERRED,
      present: true,
      empty: false,
      location: { lines: [{ line: 18, pos: 1 }] }
    })
    expect(getSection(doc, 'introduction')).toMatchObject({ certainty: CERTAINTY.INFERRED, present: true, empty: false, location: { lines: [{ line: 22, pos: 1 }] } })
    expect(getSection(doc, 'authors')).toMatchObject({ present: true, location: { lines: [{ line: 38, pos: 1 }] } })
  })

  test('a heading with nothing under it is an empty section', async () => {
    const doc = await parseTXT(CANONICAL_TXT + TXT_SECTIONS, 'draft-ietf-beep-boop-01.txt')
    expect(getSection(doc, 'securityConsiderations')).toMatchObject({ present: true, empty: true, location: { lines: [{ line: 26, pos: 1 }] } })
  })

  test('a missing section is located nowhere', async () => {
    const doc = await parseTXT(CANONICAL_TXT + TXT_SECTIONS, 'draft-ietf-beep-boop-01.txt')
    expect(getSection(doc, 'ianaConsiderations')).toEqual({
      kind: 'ianaConsiderations',
      certainty: CERTAINTY.INFERRED,
      present: false,
      empty: false,
      location: {}
    })
  })

  test('the IANA considerations section is empty with no line but its heading that isn\'t blank', () => {
    const doc = {
      type: 'txt',
      body: 'x\n   5.  IANA Considerations',
      data: { markers: { ianaConsiderations: { start: 2 } }, content: { ianaConsiderations: ['5.  IANA Considerations', ''] } }
    }
    expect(getSection(doc, 'ianaConsiderations')).toMatchObject({ present: true, empty: true, location: { lines: [{ line: 2, pos: 4 }] } })
  })

  test('the answer is read once per document', async () => {
    const doc = await parseTXT(CANONICAL_TXT + TXT_SECTIONS, 'draft-ietf-beep-boop-01.txt')
    const other = cloneDeep(doc)
    other.data.markers.introduction.start = 0
    expect(getSection(doc, 'introduction')).toBe(getSection(doc, 'introduction'))
    expect(getSection(other, 'introduction').present).toBe(false)
  })

  test('the headings of the references sections, with their lines', async () => {
    const doc = await parseTXT(CANONICAL_TXT + TXT_SECTIONS, 'draft-ietf-beep-boop-01.txt')
    expect(getReferencesHeadings(doc)).toEqual([
      { title: '3.  References', certainty: CERTAINTY.INFERRED, location: { lines: [{ line: 28, pos: 1 }] } },
      { title: '3.1.  Normative References', certainty: CERTAINTY.INFERRED, location: { lines: [{ line: 30, pos: 1 }] } },
      { title: '3.2.  Informational References', certainty: CERTAINTY.INFERRED, location: { lines: [{ line: 34, pos: 1 }] } }
    ])
  })

  test('no references section, no headings', async () => {
    const doc = await parseTXT(CANONICAL_TXT, 'draft-ietf-beep-boop-01.txt')
    expect(getReferencesHeadings(doc)).toEqual([])
  })
})

describe('sections of an XML document are declared, located by path', () => {
  test('a section that is there, with its path and element', async () => {
    const doc = await parseXmlDraft({
      front: '<abstract><t>Text.</t></abstract>',
      middle: '<section><name>Terminology</name><t>Words.</t></section><section><name>Introduction</name><t>Text.</t></section>'
    })
    expect(getSection(doc, 'abstract')).toMatchObject({
      kind: 'abstract',
      certainty: CERTAINTY.DECLARED,
      present: true,
      empty: false,
      location: { path: 'rfc.front.abstract' }
    })
    const introduction = getSection(doc, 'introduction')
    expect(introduction).toMatchObject({ certainty: CERTAINTY.DECLARED, present: true, empty: false, location: { path: 'rfc.middle.section[1]' } })
    expect(introduction.node.name).toBe('Introduction')
  })

  test('a section without child elements is empty', async () => {
    const doc = await parseXmlDraft({
      front: '<abstract/>',
      middle: '<section><name>Security Considerations</name></section>'
    })
    expect(getSection(doc, 'abstract')).toMatchObject({ present: true, empty: true })
    expect(getSection(doc, 'securityConsiderations')).toMatchObject({ present: true, empty: true, location: { path: 'rfc.middle.section[0]' } })
  })

  test('a missing section is located where it would be declared', async () => {
    const doc = await parseXmlDraft({ middle: '<section><name>Terminology</name><t>Words.</t></section>' })
    expect(getSection(doc, 'abstract')).toMatchObject({ certainty: CERTAINTY.DECLARED, present: false, location: { path: 'rfc.front.abstract' } })
    expect(getSection(doc, 'ianaConsiderations')).toEqual({
      kind: 'ianaConsiderations',
      certainty: CERTAINTY.DECLARED,
      present: false,
      empty: false,
      location: { path: 'rfc.middle' }
    })
  })

  test('the authors are the <author> elements, a single one too', async () => {
    const one = await parseXmlDraft({ front: '<author fullname="Alice Example"/>' })
    expect(getSection(one, 'authors')).toMatchObject({ certainty: CERTAINTY.DECLARED, present: true, location: { path: 'rfc.front.author' } })
    expect(getSection(one, 'authors').node).toHaveLength(1)
    const none = await parseXmlDraft({})
    expect(getSection(none, 'authors').present).toBe(false)
  })

  test('the headings of the references sections, with the path of their names', async () => {
    const doc = await parseXmlDraft({
      back: `<references><name>References</name>
        <references><name>Normative References</name><reference anchor="A"><front><title>A</title></front></reference></references>
        <references><name> Informational References </name><reference anchor="B"><front><title>B</title></front></reference></references>
      </references>`
    })
    expect(getReferencesHeadings(doc)).toEqual([
      { title: 'Normative References', certainty: CERTAINTY.DECLARED, location: { path: 'rfc.back.references[0].references[0].name' } },
      { title: 'Informational References', certainty: CERTAINTY.DECLARED, location: { path: 'rfc.back.references[0].references[1].name' } }
    ])
  })
})
