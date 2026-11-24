import { describe, expect, test } from 'vitest'
import { CERTAINTY } from '../lib/model/indexes.mjs'
import { getMissingXrefTargets } from '../lib/model/references.mjs'
import { parse } from '../lib/parsers/xml.mjs'

/**
 * Parse an XML document with the given DTD internal subset, <middle> content and <back> content
 *
 * @param {Object} parts Parts of the document
 * @param {string} [parts.dtd] Internal subset of the document type declaration, without brackets
 * @param {string} parts.middle Content of <middle>
 * @param {string} [parts.back] Content of <back>
 * @returns {Promise<Object>} Parsed document
 */
async function xmlDoc ({ dtd, middle, back = '' }) {
  const doctype = dtd ? `<!DOCTYPE rfc [${dtd}]>\n` : ''
  const { doc } = await parse(`<?xml version="1.0"?>
${doctype}<rfc xmlns:xi="http://www.w3.org/2001/XInclude" version="3" docName="draft-test-xref-00">
<front><title>T</title></front>
<middle>${middle}</middle>
<back>${back}</back>
</rfc>`, 'draft-test-xref-00.xml')
  return doc
}

/**
 * The targets getMissingXrefTargets() answers for a document
 *
 * @param {Object} doc Parsed XML document
 * @returns {string[]} Targets
 */
function missingTargets (doc) {
  return getMissingXrefTargets(doc).map(answer => answer.target)
}

const BIBXML = 'https://bib.ietf.org/public/rfc'

describe('getMissingXrefTargets', () => {
  test('a target naming no anchor is answered at the first <xref> citing it, declared', async () => {
    const doc = await xmlDoc({
      middle: '<section anchor="intro"><name>I</name><t>See <xref target="intro"/>, <xref target="TLS"/> and <xref target="TLS"/>.</t></section>'
    })
    expect(getMissingXrefTargets(doc)).toEqual([{
      element: 'xref',
      target: 'TLS',
      certainty: CERTAINTY.DECLARED,
      location: { path: 'rfc.middle.section.t.xref[1]' }
    }])
  })

  test('any element with an anchor is a target, and so is a pn or slugifiedName', async () => {
    const doc = await xmlDoc({
      middle: `<section anchor="s1" pn="section-1"><name slugifiedName="name-one">One</name>
        <t anchor="p1">x</t><ol><li anchor="li1">y</li></ol><figure anchor="f1"><artwork>z</artwork></figure>
        <table anchor="t1"><tr><td>a</td></tr></table><t>c<cref anchor="c1">n</cref></t>
        <t>See <xref target="s1"/> <xref target="section-1"/> <xref target="name-one"/> <xref target="p1"/>
        <xref target="li1"/> <xref target="f1"/> <xref target="t1"/> <xref target="c1"/> <xref target="REF"/>
        <xref target="GROUP"/> <xref target="member"/>.</t></section>`,
      back: `<references><name>Normative References</name>
        <reference anchor="REF"><front><title>R</title></front></reference>
        <referencegroup anchor="GROUP"><reference anchor="member"><front><title>M</title></front></reference></referencegroup>
        </references>`
    })
    expect(missingTargets(doc)).toEqual([])
  })

  test('a <relref> is answered as a <relref>', async () => {
    const doc = await xmlDoc({ middle: '<t><relref target="NOPE" section="1"/></t>' })
    expect(getMissingXrefTargets(doc)).toEqual([expect.objectContaining({ element: 'relref', target: 'NOPE', location: { path: 'rfc.middle.t.relref' } })])
  })

  test('a v2 document: anchors on <texttable> and list items are targets', async () => {
    const { doc } = await parse(`<rfc docName="draft-test-xref-00"><front><title>T</title></front><middle>
      <section title="One" anchor="s1"><t><list style="numbers"><t anchor="l1">a</t></list></t>
      <texttable anchor="tt"><ttcol>a</ttcol><c>b</c></texttable>
      <t><xref target="s1"/> <xref target="l1"/> <xref target="tt"/> <xref target="gone"/></t></section>
      </middle></rfc>`, 'draft-test-xref-00.xml')
    expect(missingTargets(doc)).toEqual(['gone'])
  })

  test('a target is matched as xml2rfc makes IDs valid, and in the same case', async () => {
    const doc = await xmlDoc({
      middle: `<section anchor="Two_Words"><name>I</name></section><section anchor="3GPP-TS.23.501"><name>J</name></section>
        <t><xref target="Two Words"/> <xref target="_GPP-TS.23.501"/> <xref target="two_words"/></t>`
    })
    expect(missingTargets(doc)).toEqual(['two_words'])
  })

  test('an included RFC or draft entry gives its own anchor only', async () => {
    const doc = await xmlDoc({
      middle: '<t><xref target="RFC8446"/> <xref target="I-D.ietf-foo-bar"/> <xref target="RFC2119"/> <xref target="I-D.ietf-baz"/></t>',
      back: `<references><name>Normative References</name>
        <xi:include href="${BIBXML}/bibxml/reference.RFC.8446.xml"/>
        <xi:include href="${BIBXML}/bibxml3/reference.I-D.ietf-foo-bar.xml"/>
        </references>`
    })
    expect(missingTargets(doc)).toEqual(['RFC2119', 'I-D.ietf-baz'])
  })

  test('an included BCP, STD or FYI entry may give any RFC anchor, and its own', async () => {
    const doc = await xmlDoc({
      middle: '<t><xref target="BCP14"/> <xref target="RFC2119"/> <xref target="RFC8174"/> <xref target="TLS"/></t>',
      back: `<references><name>Normative References</name>
        <xi:include href="${BIBXML}/bibxml-rfcsubseries/reference.BCP.0014.xml"/>
        </references>`
    })
    expect(missingTargets(doc)).toEqual(['TLS'])
  })

  test('an included entry of another series gives an anchor its name ends with', async () => {
    const doc = await xmlDoc({
      middle: '<t><xref target="IEEE_754_2019"/> <xref target="IEEE_802.1Q_2022"/></t>',
      back: `<references><name>Normative References</name>
        <xi:include href="${BIBXML}/bibxml6/reference.R.IEEE.754-2019.xml"/>
        </references>`
    })
    expect(missingTargets(doc)).toEqual(['IEEE_802.1Q_2022'])
  })

  test('external entities and <?rfc include?> count when referenced, not when only declared', async () => {
    const doc = await xmlDoc({
      dtd: `<!ENTITY RFC8446 SYSTEM "${BIBXML}/bibxml/reference.RFC.8446.xml">
        <!ENTITY RFC9000 SYSTEM "${BIBXML}/bibxml/reference.RFC.9000.xml">`,
      middle: '<t><xref target="RFC8446"/> <xref target="RFC9000"/> <xref target="RFC2119"/></t>',
      back: `<references><name>Normative References</name>
        &RFC8446;
        <?rfc include="reference.RFC.2119.xml"?>
        </references>`
    })
    expect(missingTargets(doc)).toEqual(['RFC9000'])
  })

  test('an include instruction of another target counts, as xml2rfc reads it', async () => {
    const doc = await xmlDoc({
      middle: '<t><xref target="I-D.ietf-foo-bar"/></t>',
      back: `<references><name>Informative References</name>
        <?ref include="reference.I-D.ietf-foo-bar"?>
        </references>`
    })
    expect(missingTargets(doc)).toEqual([])
  })

  test('another included file may give any anchor', async () => {
    const doc = await xmlDoc({
      middle: '<t><xref target="anything"/></t><xi:include href="sections/appendix.xml"/>'
    })
    expect(missingTargets(doc)).toEqual([])
  })
})
