import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { parse } from '../lib/parsers/xml.mjs'
import { addXmlSourceLines, findXmlSourceOffset, getXmlLocationLabel, labelFindings, parsePath } from '../lib/helpers/location.mjs'
import { scanXmlSource } from '../lib/helpers/xml-source.mjs'
import { ValidationWarning } from '../lib/helpers/error.mjs'
import { checkNits } from '../lib/index.mjs'
import { clearRemoteCache } from '../lib/remote/common.mjs'

// -> checkNits looks up the RFCs SAMPLE_XML cites (offline skips only the document's own lookups).
//    Any other request fails the test that made it.
const server = setupServer(
  http.get('https://www.rfc-editor.org/rfc/rfc2119.json', () => HttpResponse.json({ status: 'BEST CURRENT PRACTICE' })),
  http.get('https://www.rfc-editor.org/rfc/rfc8174.json', () => HttpResponse.json({ status: 'BEST CURRENT PRACTICE' })),
  http.get('https://www.rfc-editor.org/rfc/rfc9999.json', () => new HttpResponse(null, { status: 404 }))
)
const unhandledRequests = []
beforeAll(() => server.listen({
  onUnhandledRequest: (request, print) => {
    unhandledRequests.push(`${request.method} ${request.url}`)
    print.error()
  }
}))
afterEach(() => {
  server.resetHandlers()
  clearRemoteCache()
  expect(unhandledRequests.splice(0), 'requests without a handler').toEqual([])
})
afterAll(() => server.close())

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-test-location-00" ipr="trust200902" category="std" submissionType="IETF">
  <front>
    <title>Location Test</title>
    <author fullname="Jane Doe" initials="J." surname="Doe"/>
    <author fullname="John Smith" initials="J." surname="Smith"/>
    <date year="2025" month="1" day="1"/>
    <abstract>
      <t>First abstract paragraph.</t>
      <t>Second abstract paragraph.</t>
    </abstract>
    <note><name>Discussion Venues</name><t>Somewhere.</t></note>
  </front>
  <middle>
    <section><name>Introduction</name>
      <t>Intro one.</t>
      <t>Intro two.</t>
      <section><name>Requirements <tt>Language</tt></name><t>Only one.</t></section>
    </section>
    <section numbered="false"><name>Unnumbered Interlude</name><t>No number here.</t></section>
    <section title="Protocol">
      <t>Overview.</t>
      <figure><artwork>art</artwork></figure>
      <section><name>Messages</name>
        <t>One.</t>
        <ul><li>Item one</li><li>Item two</li></ul>
      </section>
      <section><name>Security Considerations</name>
        <t>One.</t>
        <t>Two.</t>
        <table><tbody><tr><td>cell</td></tr></tbody></table>
      </section>
    </section>
  </middle>
  <back>
    <references>
      <name>References</name>
      <references>
        <name>Normative References</name>
        <reference anchor="RFC2119"><front><title>Key words</title></front></reference>
        <reference anchor="RFC8174"><front><title>Ambiguity</title></front></reference>
      </references>
      <references>
        <name>Informative References</name>
        <reference anchor="RFC9999"><front><title>Other</title></front></reference>
      </references>
    </references>
    <section numbered="false"><name>Acknowledgments</name><t>Thanks.</t></section>
    <section><name>Test Vectors</name>
      <t>Vectors.</t>
      <section><name>Vector One</name><t>One.</t></section>
    </section>
    <section><name>Implementation Status</name><t>None.</t></section>
  </back>
</rfc>
`

async function getDoc () {
  const { doc } = await parse(SAMPLE_XML, 'draft-test-location-00.xml')
  return doc
}

describe('location', () => {
  describe('parsePath()', () => {
    test('should split indexes and name selectors', () => {
      expect(parsePath('rfc.middle.section[1].section[name=Security Considerations].t[0].#text')).toEqual([
        { key: 'rfc' },
        { key: 'middle' },
        { key: 'section', index: 1 },
        { key: 'section', name: 'Security Considerations' },
        { key: 't', index: 0 },
        { key: '#text' }
      ])
    })
    test('should not split on dots inside brackets', () => {
      expect(parsePath('rfc.middle.section[name=Section 1.2]')).toEqual([
        { key: 'rfc' },
        { key: 'middle' },
        { key: 'section', name: 'Section 1.2' }
      ])
    })
  })

  describe('getXmlLocationLabel()', () => {
    test.each([
      // Numbered and nested sections, with paragraphs
      ['rfc.middle.section[0]', 'Section 1 (Introduction)'],
      ['rfc.middle.section[0].t[1]', 'Section 1 (Introduction), paragraph 2'],
      ['rfc.middle.section[0].t[1].#text', 'Section 1 (Introduction), paragraph 2'],
      // (inline markup in titles is dropped, as the parser doesn't keep its position)
      ['rfc.middle.section[0].section.t', 'Section 1.1 (Requirements), paragraph 1'],
      // Unnumbered sections don't consume a number
      ['rfc.middle.section[1].t', 'Unnumbered Interlude, paragraph 1'],
      ['rfc.middle.section[2]', 'Section 2 (Protocol)'],
      ['rfc.middle.section[2].figure.artwork', 'Section 2 (Protocol), figure 1, artwork'],
      ['rfc.middle.section[2].section[0].ul.li[1]', 'Section 2.1 (Messages), list item 2'],
      ['rfc.middle.section[2].section[1].t[1].bcp14', 'Section 2.2 (Security Considerations), paragraph 2'],
      ['rfc.middle.section[2].section[1].table.tbody.tr.td', 'Section 2.2 (Security Considerations), table 1'],
      // Selectors by name
      ['rfc.middle.section[name=Introduction]', 'Section 1 (Introduction)'],
      ['rfc.middle.section[2].section[name=Security Considerations].t[0]', 'Section 2.2 (Security Considerations), paragraph 1'],
      ['rfc.middle.section[name=Nonexistent].t[0]', null],
      // Appendices
      ['rfc.back.section[0].t', 'Acknowledgments, paragraph 1'],
      ['rfc.back.section[1]', 'Appendix A (Test Vectors)'],
      ['rfc.back.section[1].section.t', 'Appendix A.1 (Vector One), paragraph 1'],
      ['rfc.back.section[2].t', 'Appendix B (Implementation Status), paragraph 1'],
      // References
      ['rfc.back.references.name', 'References'],
      ['rfc.back.references.references[0].name', 'Normative References'],
      ['rfc.back.references.references[0].reference[1]', 'Normative References, reference [RFC8174]'],
      ['rfc.back.references.references[1].reference.front.title', 'Informative References, reference [RFC9999]'],
      // Front matter
      ['rfc.front.title', 'Title'],
      ['rfc.front.date', 'Date'],
      ['rfc.front.abstract', 'Abstract'],
      ['rfc.front.abstract.t[1]', 'Abstract, paragraph 2'],
      ['rfc.front.note.t', 'Discussion Venues, paragraph 1'],
      ['rfc.front.author[1].address', 'Author 2 (John Smith)'],
      ['rfc.front.author', 'Authors'],
      ['rfc.front', 'Front matter'],
      // Repeated root element
      ['rfc.rfc.middle.section[0].t[0].', 'Section 1 (Introduction), paragraph 1'],
      // Unresolvable or non-located paths
      ['rfc.middle.section', null],
      ['rfc.middle.section[7].t[0]', null],
      ['rfc.middle.section[0].t[9]', 'Section 1 (Introduction)'],
      ['rfc.middle.section[0].foo.bar', 'Section 1 (Introduction)'],
      ['rfc.docName', null],
      ['rfc._attr.ipr', null],
      ['data.content.abstract', null]
    ])('%s → %s', async (path, expected) => {
      const doc = await getDoc()
      expect(getXmlLocationLabel(doc.data, path)).toEqual(expected)
    })
  })

  describe('labelFindings()', () => {
    test('should label XML findings with a path and leave others untouched', async () => {
      const doc = await getDoc()
      const findings = [
        new ValidationWarning('A', 'a', { path: 'rfc.middle.section[2].t' }),
        new ValidationWarning('B', 'b'),
        new ValidationWarning('C', 'c', { path: 'rfc.docName' })
      ]
      labelFindings(findings, doc)
      expect(findings[0].label).toEqual('Section 2 (Protocol), paragraph 1')
      expect(findings[1].label).toBeUndefined()
      expect(findings[2].label).toBeUndefined()
    })
    test('should not label findings of text documents', () => {
      const findings = [new ValidationWarning('A', 'a', { path: 'rfc.front.date' })]
      labelFindings(findings, { type: 'txt', data: {} })
      expect(findings[0].label).toBeUndefined()
    })
  })

  describe('findXmlSourceOffset()', () => {
    test.each([
      // Elements, with [0] on an only child as some checks give it
      ['rfc.middle.section[0].t[1]', { line: 17, pos: 7 }, true],
      ['rfc.middle.section[0].t[1].#text', { line: 17, pos: 7 }, true],
      ['rfc.middle.section[2].section[1]', { line: 28, pos: 7 }, true],
      ['rfc.back.references.references[0].reference[1]', { line: 41, pos: 9 }, true],
      ['rfc.front.abstract', { line: 8, pos: 5 }, true],
      ['rfc.front.abstract[0]', { line: 8, pos: 5 }, true],
      ['rfc.rfc.middle.section[0].t[0].', { line: 16, pos: 7 }, true],
      // Attributes, under _attr or by their bare name
      ['rfc._attr.ipr', { line: 2, pos: 51 }, true],
      ['rfc.docName', { line: 2, pos: 18 }, true],
      ['rfc.front.author[1].fullname', { line: 6, pos: 13 }, true],
      ['rfc.front.author[1]._attr.fullname', { line: 6, pos: 13 }, true],
      // Not in the source: nearest ancestor
      ['rfc.front.author[1].organization', { line: 6, pos: 5 }, false],
      ['rfc.front.author[1]._attr.asciiFullname', { line: 6, pos: 5 }, false],
      ['rfc.number', { line: 2, pos: 1 }, false],
      ['rfc.middle.section', { line: 14, pos: 3 }, false],
      ['rfc.middle.section[7].t[0]', { line: 14, pos: 3 }, false],
      ['rfc.middle.section[0].t[9]', { line: 15, pos: 5 }, false],
      ['rfc.middle.section[name=Introduction]', { line: 14, pos: 3 }, false]
    ])('%s → %o', async (path, expected, exact) => {
      const doc = await getDoc()
      const source = scanXmlSource(doc.body)
      const found = findXmlSourceOffset(source, doc.body, path)
      expect(source.position(found.offset)).toEqual(expected)
      expect(found.exact).toBe(exact)
    })
    test('should not locate paths outside the root element', async () => {
      const doc = await getDoc()
      expect(findXmlSourceOffset(scanXmlSource(doc.body), doc.body, 'data.content.abstract')).toBeNull()
      expect(findXmlSourceOffset(scanXmlSource(''), '', 'rfc.front')).toBeNull()
    })
    test('should not be misled by attribute names in quoted values', () => {
      const xml = '<rfc title="a docName=b" docName="c"/>'
      const found = findXmlSourceOffset(scanXmlSource(xml), xml, 'rfc.docName')
      expect(xml.slice(found.offset)).toEqual('docName="c"/>')
    })
  })

  describe('addXmlSourceLines()', () => {
    test('should add the source line of XML findings with a path and leave others untouched', async () => {
      const doc = await getDoc()
      const findings = [
        new ValidationWarning('A', 'a', { path: 'rfc.middle.section[2].section[1]' }),
        new ValidationWarning('B', 'b'),
        new ValidationWarning('C', 'c', { path: 'rfc.middle.section[0].t[0]', lines: [{ line: 99, pos: 1 }] })
      ]
      addXmlSourceLines(findings, doc)
      expect(findings[0].lines).toEqual([{ line: 28, pos: 7 }])
      expect(findings[1].lines).toBeUndefined()
      expect(findings[2].lines).toEqual([{ line: 99, pos: 1 }])
    })
    test('should not add lines to findings of text documents', () => {
      const findings = [new ValidationWarning('A', 'a', { path: 'rfc.front.date' })]
      addXmlSourceLines(findings, { type: 'txt', body: '<rfc><front><date/></front></rfc>', data: {} })
      expect(findings[0].lines).toBeUndefined()
    })
  })

  describe('checkNits()', () => {
    test('should add a label to XML findings that have a path', async () => {
      const xml = SAMPLE_XML.replace('<t>Intro two.</t>', '<t>Implementations MUST do this.</t>')
      const result = await checkNits(Buffer.from(xml), 'draft-test-location-00.xml', { offline: true })
      const finding = result.find(r => r.name === 'MISSING_BCP14_TAGS')
      expect(finding).toBeDefined()
      expect(finding.path).toEqual('rfc.middle.section[0].t[1]')
      expect(finding.label).toEqual('Section 1 (Introduction), paragraph 2')
    })
    test('should add the source line to XML findings that have a path', async () => {
      const xml = SAMPLE_XML.replace('<t>Intro two.</t>', '<t>Implementations MUST do this.</t>')
      const result = await checkNits(Buffer.from(xml), 'draft-test-location-00.xml', { offline: true })
      const finding = result.find(r => r.name === 'MISSING_BCP14_TAGS')
      expect(finding.lines).toEqual([{ line: 17, pos: 7 }])
    })
    test('should keep the lines a check gives', async () => {
      const xml = SAMPLE_XML.replace('<figure><artwork>art</artwork></figure>', '<sourcecode>a\tb</sourcecode>')
      const result = await checkNits(Buffer.from(xml), 'draft-test-location-00.xml', { offline: true })
      const finding = result.find(r => r.name === 'TABS_IN_CODE')
      expect(finding.path).toEqual('rfc.middle.section[2].sourcecode')
      // (the tab, not the start of the element)
      expect(finding.lines).toEqual([{ line: 23, pos: 20 }])
    })
  })
})
