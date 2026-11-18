import { describe, expect, test } from 'vitest'
import { CERTAINTY } from '../lib/model/indexes.mjs'
import { getCategory, getDate, getDocName, getRelationMentions, getRelations } from '../lib/model/metadata.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
import { CANONICAL_TXT } from './generators/doc-txt.js'

/**
 * Parse an XML draft with the given <rfc> attributes and children of <front>
 *
 * @param {Object} parts Markup of the parts
 * @param {string} [parts.attrs=''] Attributes of <rfc> besides docName
 * @param {string} [parts.front=''] Children of <front> after <title>
 * @returns {Promise<Object>} Parsed document
 */
async function parseXmlDraft ({ attrs = '', front = '' }) {
  const { doc } = await parse(`<?xml version="1.0" encoding="utf-8"?>
<rfc version="3" docName="draft-test-03" ${attrs}>
  <front><title>Test</title>${front}</front>
  <middle><section><name>Introduction</name><t>Text.</t></section></middle>
</rfc>`, 'draft-test-03.xml')
  return doc
}

describe('metadata of a text document is inferred', () => {
  test('category, date and name, read once per document and located at their lines', async () => {
    const doc = await parseTXT(CANONICAL_TXT, '')
    const category = getCategory(doc)
    expect(category).toMatchObject({ certainty: CERTAINTY.INFERRED, value: 'Standards Track', known: true, location: { lines: [{ line: 8, pos: 1 }] } })
    expect(getCategory(doc)).toBe(category)
    const date = getDate(doc)
    expect(date).toMatchObject({ certainty: CERTAINTY.INFERRED, present: true, location: { lines: [{ line: 11, pos: 49 }] } })
    expect(date.date.toISODate()).toBe('2025-01-01')
    expect(getDocName(doc)).toEqual({ certainty: CERTAINTY.INFERRED, name: 'draft-ietf-beep-boop-01', location: { lines: [{ line: 16, pos: 15 }] } })
  })

  test('a status given on the other kind of document\'s line is located there', async () => {
    const doc = await parseTXT(CANONICAL_TXT.replace('Intended status: Standards Track', '  Category: Informational'), '')
    expect(getCategory(doc)).toMatchObject({ value: undefined, misplacedValue: 'Informational', location: { lines: [{ line: 8, pos: 3 }] } })
  })

  test('a draft giving its status on a Category: line, and a date that is not one', () => {
    const doc = {
      type: 'txt',
      docKind: 'draft',
      data: { header: { category: 'Informational', date: { year: 2026, month: 'Augst', day: 1 } } }
    }
    expect(getCategory(doc)).toMatchObject({ value: undefined, misplacedValue: 'Informational', known: false, location: {} })
    expect(getDate(doc)).toMatchObject({ present: true, date: null, location: {} })
  })

  test('RFCs listed on the header lines and mentioned in the abstract', async () => {
    const doc = await parseTXT(CANONICAL_TXT, '')
    expect(getRelations(doc, 'obsoletes')).toEqual({
      kind: 'obsoletes',
      certainty: CERTAINTY.INFERRED,
      rfcs: [{ rfc: '5678', location: { lines: [{ line: 10, pos: 12 }] } }],
      others: [],
      location: { lines: [{ line: 10, pos: 1 }] }
    })
    expect(getRelations(doc, 'updates').rfcs).toEqual([{ rfc: '1234', location: { lines: [{ line: 12, pos: 10 }] } }])
    expect(await getRelationMentions(doc, 'obsoletes')).toEqual({
      kind: 'obsoletes', certainty: CERTAINTY.INFERRED, mentioned: ['5678'], stated: ['5678'], location: { lines: [{ line: 18, pos: 1 }] }
    })
    expect(await getRelationMentions(doc, 'updates')).toMatchObject({ mentioned: [], stated: [] })
  })
})

describe('metadata of an XML document is declared, located by path', () => {
  test('category, date and name', async () => {
    const doc = await parseXmlDraft({ attrs: 'category="standard"', front: '<date year="2025" month="Feb" day="18"/>' })
    expect(getCategory(doc)).toMatchObject({ certainty: CERTAINTY.DECLARED, value: 'standard', known: false, location: { path: 'rfc.category' } })
    const date = getDate(doc)
    expect(date).toMatchObject({ certainty: CERTAINTY.DECLARED, present: true, location: { path: 'rfc.front.date' } })
    expect(date.date.toISODate()).toBe('2025-02-18')
    expect(getDocName(doc)).toEqual({ certainty: CERTAINTY.DECLARED, name: 'draft-test-03', location: { path: 'rfc.docName' } })
  })

  test('a missing <date>, an empty one (today) and an impossible one', async () => {
    expect(getDate(await parseXmlDraft({}))).toMatchObject({ present: false, date: null })
    expect(getDate(await parseXmlDraft({ front: '<date/>' })).date).not.toBeNull()
    expect(getDate(await parseXmlDraft({ front: '<date year="2026" month="2" day="31"/>' }))).toMatchObject({ present: true, date: null })
  })

  test('RFCs listed in the attributes, however written, and mentioned in the abstract through an <xref>', async () => {
    const doc = await parseXmlDraft({
      attrs: 'obsoletes="RFC8474, draft-foo-bar, [5652]" updates="7854"',
      front: '<abstract><t>This document updates <xref target="RFC7854"/> and obsoletes RFC 5652.</t></abstract>'
    })
    const location = { path: 'rfc.obsoletes' }
    expect(getRelations(doc, 'obsoletes')).toEqual({
      kind: 'obsoletes',
      certainty: CERTAINTY.DECLARED,
      rfcs: [{ rfc: '8474', location }, { rfc: '5652', location }],
      others: [{ value: '[5652]', rfcs: ['5652'] }],
      location
    })
    expect(await getRelationMentions(doc, 'updates')).toEqual({
      kind: 'updates', certainty: CERTAINTY.INFERRED, mentioned: ['7854'], stated: ['7854'], location: { path: 'rfc.front.abstract' }
    })
    expect(await getRelationMentions(doc, 'obsoletes')).toMatchObject({ mentioned: ['5652'], stated: ['5652'] })
  })
})
