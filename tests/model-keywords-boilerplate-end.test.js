import { describe, expect, test } from 'vitest'
import { validate2119Keywords } from '../lib/modules/keywords.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { getKeywords } from '../lib/model/keywords.mjs'

// An untagged BCP 14 boilerplate whose sentence goes on after "in this document"
const longSentence = `<t>The key words "MUST" and "MAY" in this document are to be interpreted, when written in
  capitals as MUST is here, as described in RFC 2119 [RFC2119].</t>`

const parseXML = async (boilerplate) => {
  const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-test-bcp14-sentence-00" category="std">
  <front><title>Test</title><abstract><t>An abstract.</t></abstract></front>
  <middle>
    <section><name>Terminology</name>${boilerplate}</section>
    <section><name>Protocol</name><t>Nothing required.</t></section>
  </middle>
  <back><references><name>Normative References</name>
    <reference anchor="RFC2119"><front><title>Key words for use in RFCs to Indicate Requirement Levels</title></front><seriesInfo name="RFC" value="2119"/></reference>
    <reference anchor="RFC8174"><front><title>Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words</title></front><seriesInfo name="RFC" value="8174"/></reference>
  </references></back>
</rfc>`, 'draft-test-bcp14-sentence-00.xml')
  return doc
}

const names = async (doc) => {
  const results = await validate2119Keywords(doc)
  return results.map(r => r.name).filter(n => n !== 'MISSING_BCP14_TAGS')
}

describe('an untagged XML boilerplate ends at the end of its sentence', () => {
  test('a keyword later in its sentence is the boilerplate\'s, not used', async () => {
    const doc = await parseXML(longSentence)
    expect(getKeywords(doc)).toEqual({ used: false, keywords: [] })
    expect(await names(doc)).toEqual(['MISSING_REQLEVEL_KEYWORDS'])
  })
  test('a keyword after its full stop is used', async () => {
    const doc = await parseXML(longSentence.replace('.</t>', '. Clients MAY retry.</t>'))
    expect(getKeywords(doc).keywords.map(kw => [kw.keyword, kw.inBoilerplate])).toEqual([['MAY', false]])
    expect(await names(doc)).toEqual([])
  })
})
