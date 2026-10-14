import { describe, expect, test } from 'vitest'
import { parse } from '../lib/parsers/xml.mjs'
import { validate2119Keywords } from '../lib/modules/keywords.mjs'

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
