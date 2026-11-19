import { describe, expect, test } from 'vitest'
import { validate2119Keywords } from '../lib/modules/keywords.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { getBcp14Boilerplate, getKeywords } from '../lib/model/keywords.mjs'

// The BCP 14 boilerplate as a YANG module's description repeats it
const yangBoilerplate = `The key words 'MUST', 'MUST NOT', 'REQUIRED', 'SHALL', 'SHALL NOT', 'SHOULD',
     'SHOULD NOT', 'RECOMMENDED', 'NOT RECOMMENDED', 'MAY', and 'OPTIONAL' in this document
     are to be interpreted as described in BCP 14 (RFC 2119) (RFC 8174) when, and only when,
     they appear in all capitals, as shown here.`

// A YANG module repeating the boilerplate, whose description uses a keyword
const yangModule = `module example {
  description
    "${yangBoilerplate}";
  leaf a { description "A server MUST reject it."; }
}`

// The document's own boilerplate, tagged
const docBoilerplate = `<t>The key words "<bcp14>MUST</bcp14>", "<bcp14>MUST NOT</bcp14>", "<bcp14>REQUIRED</bcp14>",
  "<bcp14>SHALL</bcp14>", "<bcp14>SHALL NOT</bcp14>", "<bcp14>SHOULD</bcp14>", "<bcp14>SHOULD NOT</bcp14>",
  "<bcp14>RECOMMENDED</bcp14>", "<bcp14>NOT RECOMMENDED</bcp14>", "<bcp14>MAY</bcp14>", and
  "<bcp14>OPTIONAL</bcp14>" in this document are to be interpreted as described in BCP 14
  <xref target="RFC2119"/> <xref target="RFC8174"/> when, and only when, they appear in all capitals,
  as shown here.</t>`

const parseXML = async ({ boilerplate = docBoilerplate, body }) => {
  const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-test-bcp14-verbatim-00" category="std">
  <front><title>Test</title><abstract><t>An abstract.</t></abstract></front>
  <middle>
    <section><name>Terminology</name>${boilerplate}</section>
    <section><name>Protocol</name>${body}</section>
  </middle>
  <back><references><name>Normative References</name>
    <reference anchor="RFC2119"><front><title>Key words for use in RFCs to Indicate Requirement Levels</title></front><seriesInfo name="RFC" value="2119"/></reference>
    <reference anchor="RFC8174"><front><title>Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words</title></front><seriesInfo name="RFC" value="8174"/></reference>
  </references></back>
</rfc>`, 'draft-test-bcp14-verbatim-00.xml')
  return doc
}

const findings = async (doc) => {
  return (await validate2119Keywords(doc)).map(r => [r.name, r.message, r.path])
}

const used = (doc) => {
  return getKeywords(doc).keywords.filter(kw => !kw.inBoilerplate).map(kw => [kw.keyword, kw.location.path])
}

const noKeywords = ['MISSING_REQLEVEL_KEYWORDS', 'A BCP14 boilerplate is present but no keywords are used in the document.', 'rfc.middle.section[0].t']

describe('BCP 14 keywords in <sourcecode> and <artwork>', () => {
  describe('without a boilerplate of their own: not read, with attributes or without', () => {
    const blocks = {
      'bare <sourcecode>': '<sourcecode>if (ready) { /* MUST not run */ }</sourcecode>',
      '<sourcecode type="c">': '<sourcecode type="c">if (ready) { /* MUST not run */ }</sourcecode>',
      'bare <artwork>': '<artwork>+--+ MUST not run +--+</artwork>',
      '<artwork type="ascii-art">': '<artwork type="ascii-art">+--+ MUST not run +--+</artwork>'
    }
    for (const [name, block] of Object.entries(blocks)) {
      test(name, async () => {
        const doc = await parseXML({ body: block })
        expect(used(doc)).toEqual([])
        expect(await findings(doc)).toEqual([noKeywords])
      })
    }
    test('ASN.1 OPTIONAL in a document without a boilerplate', async () => {
      const asn1 = '<sourcecode type="asn.1">Foo ::= SEQUENCE { bar INTEGER OPTIONAL }</sourcecode>'
      const doc = await parseXML({ boilerplate: '<t>No requirements.</t>', body: asn1 })
      expect(getKeywords(doc)).toEqual({ used: false, keywords: [] })
      expect(await findings(doc)).toEqual([])
    })
    test('an SVG drawing in <artwork>', async () => {
      const svg = '<artwork type="svg"><svg xmlns="http://www.w3.org/2000/svg"><text x="1">MUST</text></svg></artwork>'
      expect(used(await parseXML({ body: svg }))).toEqual([])
    })
  })

  describe('with a boilerplate of their own, as a YANG module: read, with attributes or without', () => {
    const blocks = {
      'bare <sourcecode>': `<sourcecode><![CDATA[${yangModule}]]></sourcecode>`,
      '<sourcecode type="yang">': `<sourcecode type="yang" markers="true"><![CDATA[${yangModule}]]></sourcecode>`,
      'bare <artwork> (v2)': `<figure><artwork><![CDATA[${yangModule}]]></artwork></figure>`
    }
    for (const [name, block] of Object.entries(blocks)) {
      test(name, async () => {
        const doc = await parseXML({ body: block })
        expect(used(doc).map(([keyword]) => keyword)).toEqual(['MUST'])
        expect(await findings(doc)).toEqual([])
      })
    }
    test('invalid keywords are flagged, untagged ones aren\'t', async () => {
      const doc = await parseXML({ body: `<artwork><![CDATA[${yangModule.replace('MUST reject', 'MUST\n    not reject')}]]></artwork>` })
      expect(await findings(doc)).toEqual([
        ['INVALID_REQLEVEL_KEYWORD', 'MUST not is not a valid BCP14 Requirement Level keyword.', 'rfc.middle.section[1].artwork']
      ])
    })
    test('the document\'s only boilerplate', async () => {
      const doc = await parseXML({ boilerplate: '<t>No requirements.</t>', body: `<artwork><![CDATA[${yangModule}]]></artwork>` })
      expect(getBcp14Boilerplate(doc)).toMatchObject({ present: true, location: { path: 'rfc.middle.section[1].artwork' } })
      expect(used(doc)).toEqual([['MUST', 'rfc.middle.section[1].artwork']])
    })
  })
})
