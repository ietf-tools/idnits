import { describe, expect, test } from 'vitest'
import { CERTAINTY } from '../lib/model/indexes.mjs'
import { getDraftReferencesLines, getReferences, getReferencesLines } from '../lib/model/references.mjs'
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
 * @returns {Promise<Object>} Parsed document
 */
async function parseXmlDraft (back) {
  const { doc } = await parse(`<?xml version="1.0" encoding="utf-8"?>
<rfc version="3" docName="draft-test-00">
  <front><title>Test</title></front>
  <middle><section><name>Introduction</name><t>Text.</t></section></middle>
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

describe('references of an XML document are declared, located by path', () => {
  test('each <reference>, with its anchor and what it cites', async () => {
    const doc = await parseXmlDraft(XML_REFERENCES)
    const answer = { rfc: null, draft: null, external: false, certainty: CERTAINTY.DECLARED }
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
