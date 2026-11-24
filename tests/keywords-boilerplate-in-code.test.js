import { describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { validate2119Keywords } from '../lib/modules/keywords.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { getBcp14Boilerplate, getKeywords } from '../lib/model/keywords.mjs'

// The BCP 14 boilerplate as a YANG module's description repeats it, listing NOT RECOMMENDED
const yangBoilerplate = `The key words 'MUST', 'MUST NOT', 'REQUIRED', 'SHALL', 'SHALL NOT', 'SHOULD',
     'SHOULD NOT', 'RECOMMENDED', 'NOT RECOMMENDED', 'MAY', and 'OPTIONAL' in this document
     are to be interpreted as described in BCP 14 (RFC 2119) (RFC 8174) when, and only when,
     they appear in all capitals, as shown here.`

// A YANG module repeating the boilerplate, in a v2-style bare <artwork>, whose description uses a keyword
// or none
const yangModule = (leaf = 'A server MUST reject it.') => {
  return `<artwork><![CDATA[module example {
  description
    "${yangBoilerplate}";
  leaf a { description "${leaf}"; }
}]]></artwork>`
}

// A document boilerplate of RFC 2119, which doesn't list NOT RECOMMENDED
const docBoilerplate = `<t>The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
  "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in
  <xref target="RFC2119"/>.</t>`

const references = `<back><references><name>Normative References</name>
    <reference anchor="RFC2119"><front><title>Key words for use in RFCs to Indicate Requirement Levels</title></front><seriesInfo name="RFC" value="2119"/></reference>
    <reference anchor="RFC8174"><front><title>Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words</title></front><seriesInfo name="RFC" value="8174"/></reference>
  </references></back>`

const parseXML = async ({ sections, back = references }) => {
  const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-test-bcp14-in-code-00" category="std">
  <front><title>Test</title><abstract><t>An abstract.</t></abstract></front>
  <middle>${sections.map(s => `<section><name>S</name>${s}</section>`).join('')}</middle>
  ${back}
</rfc>`, 'draft-test-bcp14-in-code-00.xml')
  return doc
}

const findings = async (doc, mode = MODES.NORMAL) => {
  return (await validate2119Keywords(doc, { mode })).map(r => [r.constructor.name, r.name, r.path])
}

describe('a BCP 14 boilerplate inside code', () => {
  test('doesn\'t stand in for the document\'s, but still has the keywords of its code read', async () => {
    const doc = await parseXML({ sections: ['<t>No terminology.</t>', yangModule()] })
    expect(getBcp14Boilerplate(doc)).toEqual({ certainty: 'inferred', present: false, notRecommended: false, location: {} })
    expect(getKeywords(doc).keywords).toMatchObject([{ keyword: 'MUST', inBoilerplate: false, location: { path: 'rfc.middle.section[1].artwork' } }])
    expect(await findings(doc)).toEqual([
      ['ValidationWarning', 'MISSING_REQLEVEL_BOILERPLATE_REFERENCED', 'rfc.middle.section[1].artwork']
    ])
  })

  test('keywords in prose, without a reference: the boilerplate is missing, not the reference', async () => {
    const doc = await parseXML({ sections: ['<t>A client <bcp14>SHOULD</bcp14> retry.</t>', yangModule()], back: '' })
    expect(await findings(doc)).toEqual([
      ['ValidationError', 'MISSING_REQLEVEL_BOILERPLATE', 'rfc.middle.section[0].t.bcp14']
    ])
    expect(await findings(doc, MODES.FORGIVE_CHECKLIST)).toEqual([
      ['ValidationWarning', 'MISSING_REQLEVEL_BOILERPLATE', 'rfc.middle.section[0].t.bcp14']
    ])
  })

  test('no keywords used anywhere: no finding', async () => {
    const doc = await parseXML({ sections: ['<t>No terminology.</t>', yangModule('A leaf.')], back: '' })
    expect(await findings(doc)).toEqual([])
  })

  test('before the document\'s boilerplate: the document\'s is the one located', async () => {
    const doc = await parseXML({ sections: [yangModule('A leaf.'), docBoilerplate] })
    expect(getBcp14Boilerplate(doc)).toMatchObject({ present: true, location: { path: 'rfc.middle.section[1].t' } })
    expect(await findings(doc)).toEqual([
      ['ValidationWarning', 'MISSING_REQLEVEL_KEYWORDS', 'rfc.middle.section[1].t']
    ])
  })

  test('listing NOT RECOMMENDED doesn\'t make the document\'s list it', async () => {
    const doc = await parseXML({ sections: [docBoilerplate, '<t>Reuse is <bcp14>NOT RECOMMENDED</bcp14>.</t>', yangModule()] })
    expect(getBcp14Boilerplate(doc)).toMatchObject({ present: true, notRecommended: false })
    expect(await findings(doc)).toEqual([
      ['ValidationWarning', 'MISSING_NOTRECOMMENDED_IN_BOILERPLATE', 'rfc.middle.section[1].t.bcp14']
    ])
  })
})
