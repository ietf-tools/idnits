import { describe, expect, test } from 'vitest'
import { CERTAINTY } from '../lib/model/indexes.mjs'
import {
  getDraftReferencesLines,
  getDraftRevisionMismatches,
  getReferenceLinks,
  getReferences,
  getReferencesLines,
  getUncitedReferences
} from '../lib/model/references.mjs'
import { getReferencesSubsections } from '../lib/model/sections.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
import { CANONICAL_TXT } from './generators/doc-txt.js'

// The canonical text draft, with references: normative ones on lines 30-38, an informative one on lines 42-45
const TXT_REFERENCES = `
1.  Introduction

   This document cites [RFC0791], [TLS], [FIPS203] and [I-D.ietf-foo-bar].

2.  References

2.1.  Normative References

   [RFC0791]  Postel, J., "Internet Protocol", STD 5, RFC 791,
              September 1981.

   [TLS]      Rescorla, E., "The Transport Layer Security (TLS)
              Protocol Version 1.3", RFC 8446, August 2018.

   [FIPS203]  National Institute of Standards and Technology,
              "Module-Lattice-Based Key-Encapsulation Mechanism
              Standard", FIPS 203, August 2024.

2.2.  Informative References

   [I-D.ietf-foo-bar]
              Doe, J., "Foo Bar", Work in Progress, Internet-Draft,
              draft-ietf-foo-bar-02, 1 January 2026,
              <https://datatracker.ietf.org/doc/html/draft-ietf-foo-bar-02>.

Author's Address

   Alice Example
`

const XML_REFERENCES = `
<references><name>Normative References</name>
  <reference anchor="RFC2119"><front><title>Key words</title></front><seriesInfo name="RFC" value="2119"/></reference>
  <reference anchor="XML"><front><title>XML</title></front><seriesInfo name="W3C" value="REC-xml-20081126"/></reference>
</references>
<references><name>Informative References</name>
  <reference anchor="I-D.ietf-foo-bar"><front><title>Foo Bar</title></front><seriesInfo name="Internet-Draft" value="draft-ietf-foo-bar-02"/></reference>
</references>`

/**
 * Parse an XML draft with the given <back>
 *
 * @param {string} back Children of <back>
 * @param {string} [text] Children of the introduction section
 * @returns {Promise<Object>} Parsed document
 */
async function parseXmlDraft (back, text = '<t>Text.</t>') {
  const { doc } = await parse(`<?xml version="1.0" encoding="utf-8"?>
<rfc version="3" docName="draft-test-00" xmlns:xi="http://www.w3.org/2001/XInclude">
  <front><title>Test</title></front>
  <middle><section><name>Introduction</name>${text}</section></middle>
  <back>${back}</back>
</rfc>`, 'draft-test-00.xml')
  return doc
}

describe('references of a text document are inferred, located by line', () => {
  test('RFCs on label lines, RFCs only entries cite, drafts and entries citing none of these', async () => {
    const doc = await parseTXT(CANONICAL_TXT + TXT_REFERENCES, 'draft-ietf-beep-boop-01.txt')
    const answer = { label: null, rfc: null, draft: null, external: false, certainty: CERTAINTY.INFERRED }
    expect(getReferences(doc)).toEqual([
      // -> The label and the series line of the same entry write RFC 791 two ways
      { ...answer, kind: 'normative', rfc: '791', rfcAsWritten: '0791', location: { lines: [{ line: 30, pos: 4 }] } },
      { ...answer, kind: 'normative', rfc: '791', rfcAsWritten: '791', location: { lines: [{ line: 30, pos: 55 }] } },
      // -> Cited under another label, located at the label
      { ...answer, kind: 'normative', rfc: '8446', rfcAsWritten: '8446', location: { lines: [{ line: 33, pos: 4 }] } },
      { ...answer, kind: 'informative', draft: 'draft-ietf-foo-bar-02', location: { lines: [{ line: 45, pos: 54 }] } },
      { ...answer, kind: 'normative', label: 'FIPS203', external: true, location: { lines: [{ line: 36, pos: 4 }] } }
    ])
  })

  test('are read once per document', async () => {
    const doc = await parseTXT(CANONICAL_TXT + TXT_REFERENCES, 'draft-ietf-beep-boop-01.txt')
    expect(getReferences(doc)).toBe(getReferences(doc))
  })

  test('the lines of several references are merged for one finding, in document order', async () => {
    const doc = await parseTXT(CANONICAL_TXT + TXT_REFERENCES, 'draft-ietf-beep-boop-01.txt')
    const references = getReferences(doc)
    expect(getReferencesLines([references[2], references[0], references[1], references[0]])).toEqual([
      { line: 30, pos: 4 },
      { line: 30, pos: 55 },
      { line: 33, pos: 4 }
    ])
    expect(getReferencesLines([])).toBeUndefined()
  })

  test('a draft is located wherever the references section links to it', async () => {
    const doc = await parseTXT(CANONICAL_TXT + TXT_REFERENCES, 'draft-ietf-beep-boop-01.txt')
    const drafts = getReferences(doc).filter((reference) => reference.draft)
    expect(getDraftReferencesLines(doc, drafts)).toEqual([{ line: 45, pos: 54 }])
  })
})

describe('the reference checks of a text document are answered from its references section', () => {
  test('the entries the text doesn\'t cite, by label', async () => {
    const text = TXT_REFERENCES.replace('[RFC0791], [TLS], [FIPS203] and [I-D.ietf-foo-bar]', '[TLS] only')
    const doc = await parseTXT(CANONICAL_TXT + text, 'draft-ietf-beep-boop-01.txt')
    const answer = { citedAsText: false, certainty: CERTAINTY.INFERRED }
    expect(getUncitedReferences(doc)).toEqual([
      { ...answer, label: 'RFC0791', location: { lines: [{ line: 30, pos: 4 }] } },
      { ...answer, label: 'FIPS203', location: { lines: [{ line: 36, pos: 4 }] } },
      { ...answer, label: 'I-D.ietf-foo-bar', location: { lines: [{ line: 42, pos: 4 }] } }
    ])
    expect(getUncitedReferences(doc)).toBe(getUncitedReferences(doc))
  })

  test('the links, and the entries linking to another revision of a draft than they name', async () => {
    const text = TXT_REFERENCES.replace('html/draft-ietf-foo-bar-02>', 'html/draft-ietf-foo-bar-01>')
    const doc = await parseTXT(CANONICAL_TXT + text, 'draft-ietf-beep-boop-01.txt')
    expect(getReferenceLinks(doc)).toEqual([
      { url: 'https://datatracker.ietf.org/doc/html/draft-ietf-foo-bar-01', certainty: CERTAINTY.INFERRED, location: { lines: [{ line: 45, pos: 16 }] } }
    ])
    expect(getDraftRevisionMismatches(doc)).toEqual([{
      label: 'I-D.ietf-foo-bar',
      drafts: [{ linked: 'draft-ietf-foo-bar-01', named: ['draft-ietf-foo-bar-02'] }],
      certainty: CERTAINTY.INFERRED,
      location: { lines: [{ line: 42, pos: 4 }] }
    }])
  })

  test('the numbered subsections, classified or not', async () => {
    const text = TXT_REFERENCES.replace('2.2.  Informative References', '2.2.  Other References')
    const doc = await parseTXT(CANONICAL_TXT + text, 'draft-ietf-beep-boop-01.txt')
    expect(getReferencesSubsections(doc)).toEqual([
      { title: '2.1.  Normative References', classified: true, certainty: CERTAINTY.INFERRED, location: { lines: [{ line: 28, pos: 1 }] } },
      { title: '2.2.  Other References', classified: false, certainty: CERTAINTY.INFERRED, location: { lines: [{ line: 40, pos: 1 }] } }
    ])
  })
})

describe('the reference checks of an XML document are answered from its elements', () => {
  const back = `<references><name>Normative References</name>
  <reference anchor="RFC2119"><front><title>Key words</title></front><seriesInfo name="RFC" value="2119"/></reference>
  <reference anchor="XML" target="https://www.w3.org/TR/xml/"><front><title>XML</title></front></reference>
  <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8446.xml"/>
</references>
<references>
  <reference anchor="I-D.ietf-foo-bar" target="https://datatracker.ietf.org/doc/html/draft-ietf-foo-bar-01"><front><title>Foo Bar</title></front><seriesInfo name="Internet-Draft" value="draft-ietf-foo-bar-02"/></reference>
</references>
<references><name>Other References</name>
  <reference anchor="OTHER"><front><title>Other</title></front></reference>
</references>`

  test('the references the text doesn\'t cite with an <xref>, and those it mentions as typed text', async () => {
    const doc = await parseXmlDraft(back, '<t>See RFC 2119, <xref target="I-D.ietf-foo-bar"/> and <xref target="OTHER"/>.</t>')
    const answer = { citedAsText: false, certainty: CERTAINTY.DECLARED }
    expect(getUncitedReferences(doc)).toEqual([
      { ...answer, label: 'RFC2119', citedAsText: true, source: 'reference', location: { path: 'rfc.back.references[0].reference[0]' } },
      { ...answer, label: 'XML', source: 'reference', location: { path: 'rfc.back.references[0].reference[1]' } },
      { ...answer, label: 'RFC8446', source: 'xi:include', location: { path: 'rfc.back.references[0].xi:include[0]' } }
    ])
  })

  test('the targets, and the references linking to another revision of a draft than they name', async () => {
    const doc = await parseXmlDraft(back)
    expect(getReferenceLinks(doc)).toEqual([
      { url: 'https://www.w3.org/TR/xml/', certainty: CERTAINTY.DECLARED, location: { path: 'rfc.back.references[0].reference[1]._attr.target' } },
      { url: 'https://datatracker.ietf.org/doc/html/draft-ietf-foo-bar-01', certainty: CERTAINTY.DECLARED, location: { path: 'rfc.back.references[1].reference[0]._attr.target' } }
    ])
    expect(getDraftRevisionMismatches(doc)).toEqual([{
      label: 'I-D.ietf-foo-bar',
      drafts: [{ linked: 'draft-ietf-foo-bar-01', named: ['draft-ietf-foo-bar-02'] }],
      certainty: CERTAINTY.DECLARED,
      location: { path: 'rfc.back.references[1].reference[0]' }
    }])
  })

  test('the <references> elements, with their names, classified or not', async () => {
    const doc = await parseXmlDraft(back)
    expect(getReferencesSubsections(doc)).toEqual([
      { title: 'Normative References', classified: true, certainty: CERTAINTY.DECLARED, location: { path: 'rfc.back.references[0].name' } },
      // -> Without a name, located where it would be declared
      { title: null, classified: false, certainty: CERTAINTY.DECLARED, location: { path: 'rfc.back.references[1].name' } },
      { title: 'Other References', classified: false, certainty: CERTAINTY.DECLARED, location: { path: 'rfc.back.references[2].name' } }
    ])
  })
})

describe('references of an XML document are declared, located by path', () => {
  test('each <reference>, with its anchor and what it cites', async () => {
    const doc = await parseXmlDraft(XML_REFERENCES)
    const answer = { rfc: null, draft: null, external: false, source: 'reference', certainty: CERTAINTY.DECLARED }
    expect(getReferences(doc)).toEqual([
      { ...answer, kind: 'normative', label: 'RFC2119', rfc: '2119', location: { path: 'rfc.back.references[0].reference[0]' } },
      { ...answer, kind: 'normative', label: 'XML', external: true, location: { path: 'rfc.back.references[0].reference[1]' } },
      { ...answer, kind: 'informative', label: 'I-D.ietf-foo-bar', draft: 'draft-ietf-foo-bar-02', location: { path: 'rfc.back.references[1].reference[0]' } }
    ])
  })

  test('give no lines', async () => {
    const doc = await parseXmlDraft(XML_REFERENCES)
    const references = getReferences(doc)
    expect(getReferencesLines(references)).toBeUndefined()
    expect(getDraftReferencesLines(doc, references.filter((reference) => reference.draft))).toBeUndefined()
  })
})
