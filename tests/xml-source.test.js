import { describe, expect, test } from 'vitest'
import { get } from 'lodash-es'
import { readFile } from 'node:fs/promises'
import { scanXmlSource } from '../lib/helpers/xml-source.mjs'
import { parse } from '../lib/parsers/xml.mjs'

describe('scanXmlSource', () => {
  test('paths match those of the parsed tree', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE rfc [
  <!ENTITY nbsp "&#160;">
  <!-- a comment with a ] and a > -->
]>
<?rfc toc="yes"?>
<rfc version="3" docName="draft-test-00">
  <front><title abbrev="a > b">Test</title></front>
  <middle>
    <section anchor="one"><name>One</name>
      <t>First <xref target="x"/> and <xref target="y"/>.</t>
      <!-- <section anchor="commented-out"> -->
      <t>Second</t>
      <sourcecode><![CDATA[if (a < b) { </section> }]]></sourcecode>
    </section>
    <section anchor="two"><name>Two</name>
      <artwork type="ascii-art"/>
      <t>Only</t>
    </section>
  </middle>
</rfc>`
    const { doc } = await parse(xml, 'draft-test-00.xml')
    const source = scanXmlSource(xml)
    expect(source.root.name).toBe('rfc')
    expect(source.root.attributes).toEqual({ version: '3', docName: 'draft-test-00' })
    expect(source.elements.map(el => el.path)).toEqual([
      'rfc',
      'rfc.front',
      'rfc.front.title',
      'rfc.middle',
      'rfc.middle.section[0]',
      'rfc.middle.section[0].name',
      'rfc.middle.section[0].t[0]',
      'rfc.middle.section[0].t[0].xref[0]',
      'rfc.middle.section[0].t[0].xref[1]',
      'rfc.middle.section[0].t[1]',
      'rfc.middle.section[0].sourcecode',
      'rfc.middle.section[1]',
      'rfc.middle.section[1].name',
      'rfc.middle.section[1].artwork',
      'rfc.middle.section[1].t'
    ])
    for (const el of source.elements) {
      expect(get(doc.data, el.path)).toBeDefined()
    }
    for (const el of source.elements.filter(el => el.attributes.anchor)) {
      expect(get(doc.data, el.path)._attr.anchor).toBe(el.attributes.anchor)
    }
    expect(source.markup.map(m => m.kind)).toEqual(expect.arrayContaining(['pi', 'doctype', 'comment', 'cdata', 'tag']))
  })

  test('paths match those of the parsed tree for real documents', async () => {
    for (const name of ['draft-ietf-ippm-ioam-ipv6-options-10.xml', 'draft-ietf-uuidrev-rfc4122bis-11.xml']) {
      const xml = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
      const { doc } = await parse(xml, name)
      const source = scanXmlSource(xml)
      expect(source.elements.length).toBeGreaterThan(100)
      for (const el of source.elements) {
        expect(get(doc.data, el.path), el.path).toBeDefined()
      }
    }
  })

  test('offsets, lines and columns', () => {
    const xml = '<rfc>\n  <t a=\'x\ty\'\t>a\tb</t>\n<!--\t-->\n</rfc>\n'
    const source = scanXmlSource(xml)
    const t = source.elements[1]
    expect(xml.slice(t.start, t.contentStart)).toBe('<t a=\'x\ty\'\t>')
    expect(xml.slice(t.contentStart, t.contentEnd)).toBe('a\tb')
    expect(xml.slice(t.contentEnd, t.end)).toBe('</t>')
    expect(t.attributes).toEqual({ a: 'x\ty' })

    const tabs = [...xml.matchAll(/\t/g)].map(match => match.index)
    expect(tabs.map(offset => source.position(offset))).toEqual([
      { line: 2, pos: 10 },
      { line: 2, pos: 13 },
      { line: 2, pos: 16 },
      { line: 3, pos: 5 }
    ])
    const located = tabs.map(offset => source.locate(offset)).map(({ element, markup }) => [element.name, markup?.kind ?? 'text'])
    expect(located).toEqual([['t', 'tag'], ['t', 'tag'], ['t', 'text'], ['rfc', 'comment']])
    expect(source.locate(0).element.name).toBe('rfc')
    expect(source.locate(xml.length - 1)).toEqual({ element: null, markup: null })
    expect(source.position(0)).toEqual({ line: 1, pos: 1 })
  })

  test('malformed documents', () => {
    // -> An unclosed element ends where its parent does, an unmatched end tag is ignored
    const xml = '<rfc><section><t>a</section></x>< b<t>c'
    const source = scanXmlSource(xml)
    expect(source.elements.map(el => [el.path, el.end])).toEqual([
      ['rfc', xml.length],
      ['rfc.section', xml.indexOf('</x>')],
      ['rfc.section.t', xml.indexOf('</section>')],
      ['rfc.t', xml.length]
    ])
    expect(scanXmlSource('no markup').root).toBeNull()
    // -> Quoted values in the DOCTYPE may contain > and ]
    expect(scanXmlSource('<!DOCTYPE rfc [<!ENTITY a \'>]\'>]><rfc/>').root.path).toBe('rfc')
    expect(scanXmlSource('<rfc><!-- unclosed').markup.at(-1)).toEqual({ kind: 'comment', start: 5, end: 18 })
  })
})
