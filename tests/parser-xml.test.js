import { describe, expect, test } from 'vitest'
import { toContainError, ValidationWarning } from '../lib/helpers/error.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { validate2119Keywords } from '../lib/modules/keywords.mjs'

expect.extend({
  toContainError
})

/**
 * Parse an XML body wrapped in a minimal but valid draft skeleton.
 *
 * @param {string} body Markup to place inside <middle>
 * @returns {Promise<Object>} Parsed document object
 */
async function parseDraft (body) {
  const { doc } = await parse(
    `<?xml version="1.0" encoding="utf-8"?>
<rfc version="3" docName="draft-test-00">
  <front>
    <seriesInfo name="Internet-Draft" value="draft-test-00"/>
  </front>
  <middle>${body}</middle>
</rfc>`,
    'draft-test-00.xml'
  )
  return doc
}

describe('XML parser', () => {
  describe('mixed content', () => {
    // An inline tag splits a paragraph into separate text runs. The parser
    // concatenates those runs, so the whitespace around the tag is the only
    // thing keeping the adjoining words apart.
    test('should keep a word separator across an inline element', async () => {
      const doc = await parseDraft('<section><t>The server <xref target="x"/> MUST retry.</t></section>')
      expect(doc.data.rfc.middle.section.t['#text']).toMatch(/\bserver\b/)
      expect(doc.data.rfc.middle.section.t['#text']).toMatch(/\bMUST\b/)
      expect(doc.data.rfc.middle.section.t['#text']).not.toContain('serverMUST')
    })

    test('should keep a word separator across several inline elements', async () => {
      const doc = await parseDraft('<section><t>See <xref target="a"/> and <xref target="b"/> below.</t></section>')
      expect(doc.data.rfc.middle.section.t['#text']).not.toMatch(/[a-z]and[a-z]/)
      expect(doc.data.rfc.middle.section.t['#text']).toMatch(/\band\b/)
    })

    test('should not leave leading or trailing whitespace on the joined text', async () => {
      const doc = await parseDraft('<section><t>Before <xref target="x"/> after.</t></section>')
      const text = doc.data.rfc.middle.section.t['#text']
      expect(text).toBe(text.trim())
    })
  })

  describe('value normalization', () => {
    test('should trim text laid out across several lines', async () => {
      const doc = await parseDraft('<section>\n    <t>\n      Indented paragraph.\n    </t>\n  </section>')
      expect(doc.data.rfc.middle.section.t).toBe('Indented paragraph.')
    })

    test('should not turn indentation between tags into text nodes', async () => {
      const doc = await parseDraft('<section>\n    <t>One.</t>\n    <t>Two.</t>\n  </section>')
      expect(doc.data.rfc.middle.section).not.toHaveProperty('#text')
      expect(doc.data.rfc.middle.section.t).toEqual(['One.', 'Two.'])
    })

    test('should trim attribute values', async () => {
      const doc = await parseDraft('<section anchor="  spaced  "><t>Body.</t></section>')
      expect(doc.data.rfc.middle.section._attr.anchor).toBe('spaced')
    })

    test('should preserve an empty element as an empty string', async () => {
      const doc = await parseDraft('<section><t/></section>')
      expect(doc.data.rfc.middle.section.t).toBe('')
    })
  })

  describe('downstream effect', () => {
    // The fused text hid the keyword from the BCP14 check entirely.
    test('should let a keyword next to an inline element be found', async () => {
      const doc = await parseDraft('<section><t>The server <xref target="x"/> MUST retry.</t></section>')
      doc.externalEntities = [{ name: 'BCP14' }]
      const result = await validate2119Keywords(doc)
      expect(result.map(r => r.name)).toContain('MISSING_BCP14_TAGS')
    })
  })
})

const body = `<rfc version="3" docName="draft-ietf-beep-boop-00">
  <front><title>Test</title><seriesInfo name="Internet-Draft" value="draft-ietf-beep-boop-00"/></front>
  <middle><section><name>Intro</name><t>Text&nbsp;here.</t></section></middle>
  <back><references><name>Normative References</name>&RFC2119;&RFC8174;</references></back>
</rfc>`

describe('XML parser should handle external entities', () => {
  test('SYSTEM entities and their references', async () => {
    const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE rfc [
<!ENTITY nbsp "&#160;">
<!ENTITY RFC2119 SYSTEM "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml">
<!ENTITY RFC8174 SYSTEM 'https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8174.xml'>
]>
${body}`, 'draft-ietf-beep-boop-00.xml')
    expect(doc.externalEntities).toMatchObject([
      { name: 'RFC2119', type: 'SYSTEM', url: 'https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml' },
      { name: 'RFC8174', type: 'SYSTEM', url: 'https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8174.xml' }
    ])
    expect(doc.data.rfc.middle.section.t).toBe('Text&nbsp;here.')
  })
  test('PUBLIC entities with a public identifier', async () => {
    const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE rfc [
<!ENTITY nbsp "&#160;">
<!ENTITY RFC2119 PUBLIC '' 'https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml'>
<!ENTITY RFC8174 PUBLIC "-//IETF//RFC 8174//EN"
  "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8174.xml">
]>
${body}`, 'draft-ietf-beep-boop-00.xml')
    expect(doc.externalEntities).toMatchObject([
      { name: 'RFC2119', type: 'PUBLIC', url: 'https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml' },
      { name: 'RFC8174', type: 'PUBLIC', url: 'https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8174.xml' }
    ])
  })
  test('entities commented out in the DTD are ignored', async () => {
    const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE rfc [
<!-- e.g. &lt;!ENTITY RFC8174 SYSTEM
     "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8174.xml"> -->
<!-- <!ENTITY RFC1234 SYSTEM "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.1234.xml"> -->
<!ENTITY nbsp "&#160;">
<!ENTITY RFC2119 SYSTEM "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml">
<!ENTITY RFC8174 SYSTEM "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8174.xml">
]>
${body}`, 'draft-ietf-beep-boop-00.xml')
    expect(doc.externalEntities.map(e => e.name)).toEqual(['RFC2119', 'RFC8174'])
  })
})

describe('XML parser should handle processing instructions', () => {
  test('unbalanced quotes in processing instructions', async () => {
    const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type='text/xsl' href='rfc2629.xslt' ?>
<?rfc toc="yes"?>
<rfc docName="draft-ietf-beep-boop-00">
  <front><title>Test</title></front>
  <back><references title="Normative References">
    <?rfc include="reference.RFC.2119'?>
  </references></back>
</rfc>`, 'draft-ietf-beep-boop-00.xml')
    expect(doc.data.rfc.front.title).toBe('Test')
  })
  test('processing instructions and entity references inside CDATA are kept', async () => {
    const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE rfc [
<!ENTITY RFC2119 SYSTEM "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml">
]>
<rfc docName="draft-ietf-beep-boop-00">
  <front><title>Test</title></front>
  <middle><section><name>Code</name><sourcecode><![CDATA[<?php echo "&RFC2119;"; ?>]]></sourcecode></section></middle>
</rfc>`, 'draft-ietf-beep-boop-00.xml')
    expect(doc.data.rfc.middle.section.sourcecode).toBe('<?php echo "&RFC2119;"; ?>')
  })
})

describe('XML parser should keep the raw text', () => {
  test('body is the text as given, before clean-up', async () => {
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE rfc [
<!ENTITY RFC2119 SYSTEM "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml">
]>
<?rfc toc="yes"?>
<rfc docName="draft-ietf-beep-boop-00">
  <front><title>Test</title></front>
  <middle><?line 12?><section><name>Intro</name><t>Text</t></section></middle>
  <back><references title="Normative References">&RFC2119;</references></back>
</rfc>`
    const { doc, nits } = await parse(text, 'draft-ietf-beep-boop-00.xml')
    expect(doc.body).toBe(text)
    // -> <?line?> instructions are stripped, and left to validateLinePI to report
    expect(doc.data.rfc.middle.section.name).toBe('Intro')
    expect(nits.map(n => n.name)).not.toContain('LINE_PI')
  })
})

describe('XML parser should determine the document kind', () => {
  test('unexpected seriesInfo name', async () => {
    const { doc, nits } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-ietf-beep-boop-00">
  <front><title>Test</title><seriesInfo name="Draft" value="draft-ietf-beep-boop-00"/></front>
</rfc>`, 'draft-ietf-beep-boop-00.xml')
    expect(doc.docKind).toBe('draft')
    expect(doc.docKindCertainty).toBe('guess')
    expect(nits).toContainError('XML_UNEXPECTED_SERIESINFO_NAME', ValidationWarning)
  })

  // Without a <seriesInfo> (e.g. v2 documents), the document kind follows
  // what the document declares, not what the file happens to be called
  test.each([
    ['docName, filename without draft- prefix', '<rfc docName="draft-ietf-beep-boop-00">', 'paper.xml', 'draft'],
    ['docName, filename of an RFC', '<rfc docName="draft-ietf-beep-boop-00">', 'rfc9999.xml', 'draft'],
    ['empty number and docName', '<rfc number="" docName="draft-ietf-beep-boop-00">', 'paper.xml', 'draft'],
    ['number, filename of a draft', '<rfc number="9999" docName="draft-ietf-beep-boop-00">', 'draft-ietf-beep-boop-00.xml', 'rfc'],
    ['neither, filename of a draft', '<rfc>', 'draft-ietf-beep-boop-00.xml', 'draft'],
    ['neither, filename of an RFC', '<rfc>', 'rfc9999.xml', 'rfc']
  ])('no seriesInfo: %s', async (_, rfcTag, filename, docKind) => {
    const { doc, nits } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
${rfcTag}
  <front><title>Test</title></front>
</rfc>`, filename)
    expect(doc.docKind).toBe(docKind)
    expect(doc.docKindCertainty).toBe('guess')
    expect(nits).toHaveLength(0)
  })

  test('no seriesInfo, docName or number, and a filename that says nothing', async () => {
    await expect(parse(`<?xml version="1.0" encoding="UTF-8"?>
<rfc>
  <front><title>Test</title></front>
</rfc>`, 'paper.xml')).rejects.toThrow(expect.objectContaining({ name: 'XML_UNRECOGNIZED_DOC_KIND' }))
  })

  test.each([
    ['RFC', 'BCP', 'rfc'],
    ['BCP', 'RFC', 'rfc'],
    ['RFC', 'Internet-Draft', 'draft']
  ])('several seriesInfo: %s and %s', async (first, second, docKind) => {
    const { doc, nits } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" number="9999" docName="draft-ietf-beep-boop-00">
  <front><title>Test</title><seriesInfo name="${first}" value="1"/><seriesInfo name="${second}" value="2"/></front>
</rfc>`, 'paper.xml')
    expect(doc.docKind).toBe(docKind)
    expect(doc.docKindCertainty).toBe('strict')
    expect(nits).toHaveLength(0)
  })
})
