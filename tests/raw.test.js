import { describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateContent, validateEncoding, decodeBufferToUTF8 } from '../lib/modules/raw.mjs'
import { Buffer } from 'node:buffer'
import { checkNits } from '../lib/index.mjs'
import { parse as parseXML } from '../lib/parsers/xml.mjs'

expect.extend({
  toContainError
})

describe('input does not include invalid control chars', () => {
  test('valid x0A line endings', async () => {
    await expect(validateContent('abc\ndef\ngeh')).resolves.toHaveLength(0)
  })
  test('valid x0C page breaks', async () => {
    await expect(validateContent('abc\fdef\fgeh')).resolves.toHaveLength(0)
  })
  test('valid x0D carriage returns', async () => {
    await expect(validateContent('abc\rdef\r\ngeh')).resolves.toHaveLength(0)
  })
  test('invalid x00-x09 chars', async () => {
    await expect(validateContent('abc\bdef\bgeh')).resolves.toContainError('INVALID_CTRL_CODES', ValidationError)
    await expect(validateContent('abc\bdef\bgeh', { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_CTRL_CODES', ValidationWarning)
    await expect(validateContent('abc\bdef\bgeh', { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    await expect(validateContent('abc\bdef\tgeh')).resolves.toHaveLength(2)
    await expect(validateContent('abc\bdef\tgeh', { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(2)
    await expect(validateContent('abc\bdef\tgeh', { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    await expect(validateContent('abc\tdef\tgeh')).resolves.toContainError('TABS_NOT_ALLOWED', ValidationError)
    await expect(validateContent('abc\tdef\tgeh', { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('TABS_NOT_ALLOWED', ValidationWarning)
    await expect(validateContent('abc\tdef\tgeh', { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('tabs are listed with their position', async () => {
    const [result] = await validateContent('abc\tdef\n\tgeh')
    expect(result.message).toBe('Document contains 2 tabs. Remove or replace them with spaces.')
    expect(result.lines).toEqual([{ line: 1, pos: 4 }, { line: 2, pos: 1 }])
    const [many] = await validateContent('\t'.repeat(25))
    expect(many.message).toContain('25 tabs')
    expect(many.lines).toHaveLength(20)
  })
  test('tabs in XML are left to validateTabs', async () => {
    for (const mode of [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]) {
      await expect(validateContent('<rfc>\t</rfc>', { mode, type: 'xml' })).resolves.toHaveLength(0)
    }
    await expect(validateContent('<rfc>\t\b</rfc>', { type: 'xml' })).resolves.toContainError('INVALID_CTRL_CODES', ValidationError)
    await expect(validateContent('<rfc>\t\b</rfc>', { type: 'xml' })).resolves.toHaveLength(1)
  })
  test('invalid 0B char', async () => {
    await expect(validateContent('abc\vdef')).resolves.toContainError('INVALID_CTRL_CODES', ValidationError)
    await expect(validateContent('abc\vdef', { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_CTRL_CODES', ValidationWarning)
    await expect(validateContent('abc\vdef', { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('invalid x0E-x1 chars', async () => {
    /* eslint-disable no-useless-escape */
    await expect(validateContent('abc\edef\x0Egeh')).resolves.toContainError('INVALID_CTRL_CODES', ValidationError)
    await expect(validateContent('abc\edef\x0Egeh', { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_CTRL_CODES', ValidationWarning)
    await expect(validateContent('abc\edef\x0Egeh', { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('non-ASCII characters should follow draft-rswg-rfc7997bis', () => {
  const ALL_MODES = [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]
  const decode = (text) => decodeBufferToUTF8(Buffer.from(text, 'utf8'))

  test('ASCII text', async () => {
    for (const mode of ALL_MODES) {
      await expect(validateContent(await decode('abc\ndef'), { mode })).resolves.toHaveLength(0)
    }
  })
  test('characters that do not display', async () => {
    const data = await decode('abc\nde\u200Bf\u200B\ngh\u202Ei \u2066x\u2069\u061C\u200E\u200F\u2060\ufeff')
    for (const mode of ALL_MODES) {
      const result = await validateContent(data, { mode })
      expect(result.filter(r => r.name === 'NON_DISPLAYABLE_CHARACTER')).toHaveLength(9)
      expect(result).toContainError('NON_DISPLAYABLE_CHARACTER', ValidationWarning)
      // -> They are not listed again as non-ASCII characters
      expect(result.find(r => r.name === 'NON_ASCII_CHARACTERS')).toBeUndefined()
    }
    const zwsp = (await validateContent(data)).find(r => r.message.includes('U+200B'))
    expect(zwsp.message).toContain('2 ZERO WIDTH SPACE (U+200B) characters')
    expect(zwsp.lines).toEqual([{ line: 2, pos: 3 }, { line: 2, pos: 5 }])
    expect(zwsp.refUrl).toBe('https://datatracker.ietf.org/doc/draft-rswg-rfc7997bis/#section-3')
    const rlo = (await validateContent(data)).find(r => r.message.includes('U+202E'))
    expect(rlo.message).toContain('a RIGHT-TO-LEFT OVERRIDE (U+202E) character')
    expect(rlo.lines).toEqual([{ line: 3, pos: 3 }])
  })
  test('zero width space and word joiner are line-break hints in XML', async () => {
    const xml = await decode('<?xml version="1.0" encoding="UTF-8"?>\n<rfc>\n<t>address\u2060/port long\u200Bidentifier</t>\n<t>\u202Eabc\u202C d\ufeffef</t>\n</rfc>')
    for (const mode of ALL_MODES) {
      const result = await validateContent(xml, { mode, type: 'xml' })
      expect(result.map(r => r.message).join(' ')).not.toMatch(/U\+200B|U\+2060/)
      // -> Bidi controls and a misplaced byte order mark are still reported
      expect(result.filter(r => r.name === 'NON_DISPLAYABLE_CHARACTER')).toHaveLength(3)
    }
    // -> The document type is given, not guessed from how the document starts
    for (const start of ['<rfc version="3">', '\ufeff<!-- comment -->\n<rfc>', 'Network Working Group']) {
      await expect(validateContent(await decode(`${start}\n<t>a\u200Bb\u2060c</t>`), { type: 'xml' })).resolves.toHaveLength(0)
    }
    // -> Text documents, including one starting with "<" or an XML declaration, still report them
    for (const start of ['Network Working Group', '<Network Working Group>', '<?xml version="1.0"?>']) {
      const result = await validateContent(await decode(`${start}\na\u200Bb\u2060c`), { type: 'txt' })
      expect(result.filter(r => r.name === 'NON_DISPLAYABLE_CHARACTER').map(r => r.lines)).toEqual([[{ line: 2, pos: 2 }], [{ line: 2, pos: 4 }]])
    }
  })
  test('joiners are allowed', async () => {
    const result = await validateContent(await decode('\u0915\u094D\u200D\u0937 \u0645\u200C\u06CC'))
    expect(result.find(r => r.name === 'NON_DISPLAYABLE_CHARACTER')).toBeUndefined()
  })
  test('byte order mark', async () => {
    // -> A BOM at the very start of the file is allowed
    const atStart = '\ufeffabc\ndef'
    await expect(validateContent(atStart)).resolves.toHaveLength(0)
    await expect(validateContent(await decode(atStart))).resolves.toHaveLength(0)
    const elsewhere = await validateContent(await decode('abc\nd\ufeffef'), { mode: MODES.SUBMISSION })
    expect(elsewhere).toHaveLength(1)
    expect(elsewhere).toContainError('NON_DISPLAYABLE_CHARACTER', ValidationWarning)
    expect(elsewhere[0].lines).toEqual([{ line: 2, pos: 2 }])
  })
  test('text not in NFC', async () => {
    const data = await decode('abc\nCafe\u0301 and Cafe\u0301\nZo\u0308e\nCaf\u00E9')
    for (const mode of ALL_MODES) {
      await expect(validateContent(data, { mode })).resolves.toContainError('NON_NFC_TEXT', ValidationComment)
    }
    const result = (await validateContent(data)).find(r => r.name === 'NON_NFC_TEXT')
    expect(result.message).toContain('Text on 2 lines')
    expect(result.message).toContain('first on line 2')
    expect(result.lines).toEqual([{ line: 2, pos: 4 }])
    const nfc = await validateContent(await decode('Caf\u00E9'))
    expect(nfc.find(r => r.name === 'NON_NFC_TEXT')).toBeUndefined()
  })
  test('other non-ASCII characters are listed with their names and counts', async () => {
    const data = await decode('Jürgen Müller\n\u00A0— ≤ 一 한 ก 😀\n')
    for (const mode of ALL_MODES) {
      const result = await validateContent(data, { mode })
      expect(result).toHaveLength(1)
      expect(result).toContainError('NON_ASCII_CHARACTERS', ValidationComment)
    }
    const [result] = await validateContent(data)
    expect(result.message).toContain('Document contains non-ASCII characters: (U+00A0, NO-BREAK SPACE) x1, ü (U+00FC, LATIN SMALL LETTER U WITH DIAERESIS) x2, ก (U+0E01, Thai letter) x1, — (U+2014, EM DASH) x1, ≤ (U+2264, LESS-THAN OR EQUAL TO) x1, 一 (U+4E00, CJK UNIFIED IDEOGRAPH-4E00) x1, 한 (U+D55C, HANGUL SYLLABLE HAN) x1, 😀 (U+1F600, symbol) x1.')
    expect(result.refUrl).toBe('https://datatracker.ietf.org/doc/draft-rswg-rfc7997bis/#section-3')
  })
})

describe('XML characters written as numeric character references', () => {
  const CHAR_CODES = ['NON_DISPLAYABLE_CHARACTER', 'NON_NFC_TEXT', 'NON_ASCII_CHARACTERS']
  // -> A whole draft: line 10 is the <t> holding the text given
  const draft = (text, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
${extra}<rfc version="3" docName="draft-test-charref-00" ipr="trust200902" category="info" submissionType="IETF">
  <front>
    <title>Character References</title>
    <author fullname="Jane Doe" initials="J." surname="Doe"/>
    <date year="2026" month="1" day="1"/>
    <abstract><t>An abstract.</t></abstract>
  </front>
  <middle><section><name>Text</name>
      <t>${text}</t>
  </section></middle>
</rfc>
`
  const findings = async (xml) => (await checkNits(Buffer.from(xml), 'draft-test-charref-00.xml', { offline: true }))
    .filter(r => CHAR_CODES.includes(r.name))

  test('a draft with references parses, and the parsed text keeps them as written', async () => {
    const { doc } = await parseXML(draft('a&#x202E;b'), 'draft-test-charref-00.xml')
    expect(doc.data.rfc.middle.section.t).toEqual('a&#x202E;b')
  })
  test('a bidi control written as a reference is reported at the reference', async () => {
    for (const ref of ['&#x202E;', '&#x202e;', '&#8238;', '&#x0202E;']) {
      const result = await findings(draft(`one ${ref} two`))
      expect(result).toHaveLength(1)
      expect(result).toContainError('NON_DISPLAYABLE_CHARACTER', ValidationWarning)
      expect(result[0].message).toContain('a RIGHT-TO-LEFT OVERRIDE (U+202E) character')
      expect(result[0].lines).toEqual([{ line: 10, pos: 14 }])
    }
  })
  test('references and literal characters are reported together, in order', async () => {
    const [result] = await findings(draft('\u202Ea&#x202E;b\u202E'))
    expect(result.message).toContain('3 RIGHT-TO-LEFT OVERRIDE (U+202E) characters')
    expect(result.lines).toEqual([{ line: 10, pos: 10 }, { line: 10, pos: 12 }, { line: 10, pos: 21 }])
  })
  test('zero width space and word joiner references are not reported, as the literal characters', async () => {
    await expect(findings(draft('a&#x200B;b&#8203;c&#x2060;d&#8288;e'))).resolves.toHaveLength(0)
  })
  test('a byte order mark written as a reference is reported', async () => {
    const result = await findings(draft('a&#xFEFF;b'))
    expect(result.map(r => r.lines)).toEqual([[{ line: 10, pos: 11 }]])
  })
  test('a decomposed sequence written with references is not in NFC, located at the reference', async () => {
    for (const text of ['Cafe&#x301;', 'Caf&#x65;&#x301;', 'Cafe\u0301']) {
      const result = await findings(draft(text))
      expect(result.find(r => r.name === 'NON_NFC_TEXT')?.lines).toEqual([{ line: 10, pos: 13 }])
    }
    // -> (where it first differs from NFC: the e, here written as a reference in the second)
    // -> The composed character is NFC
    expect((await findings(draft('Caf&#xE9;'))).find(r => r.name === 'NON_NFC_TEXT')).toBeUndefined()
  })
  test('references in attribute values are decoded', async () => {
    const xml = draft('a').replace('<t>a</t>', '<t anchor="x">a</t><artwork alt="&#x202E;">art</artwork>')
    const [result] = await findings(xml)
    expect(result.name).toBe('NON_DISPLAYABLE_CHARACTER')
    expect(result.lines).toEqual([{ line: 10, pos: 40 }])
  })
  test('references in comments, CDATA, processing instructions and the DOCTYPE are not decoded', async () => {
    const xml = draft('<!-- &#x202E; --><![CDATA[&#x202E;]]><?pi &#x202E;?>x', '<!DOCTYPE rfc [\n<!ENTITY rlo "&#x202E;">\n]>\n')
    await expect(findings(xml)).resolves.toHaveLength(0)
  })
  test('the non-ASCII characters listed are only those written literally', async () => {
    const [result] = (await findings(draft('&#xE9; \u00E9 &#x202E;'))).filter(f => f.name === 'NON_ASCII_CHARACTERS')
    expect(result.message).toContain('(U+00E9, LATIN SMALL LETTER E WITH ACUTE) x1.')
    await expect(findings(draft('&#xE9;'))).resolves.toHaveLength(0)
  })
  test('text documents are unchanged', async () => {
    await expect(validateContent('a &#x202E; b', { type: 'txt' })).resolves.toHaveLength(0)
  })
  test('references that are not characters are ignored', async () => {
    await expect(validateContent('<t>&#xD800; &#x110000; &#xZZ; &#;</t>', { type: 'xml' })).resolves.toHaveLength(0)
  })
})

describe('raw input should be in utf-8 encoding', () => {
  test('valid UTF8 buffer', async () => {
    const buf = Buffer.from('This is à tést!', 'utf8')
    // -> Non-ASCII characters are reported by validateContent
    await expect(validateEncoding(buf)).resolves.toHaveLength(0)
    await expect(validateEncoding(buf, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateEncoding(buf, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('valid ascii buffer', async () => {
    const buf = Buffer.from('abcdef', 'utf8')
    await expect(validateEncoding(buf)).resolves.toHaveLength(0)
  })
  test('invalid latin1 buffer', async () => {
    const buf = Buffer.from('This is à tést!', 'latin1')
    await expect(validateEncoding(buf)).resolves.toContainError('INVALID_ENCODING', ValidationError)
    await expect(validateEncoding(buf, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_ENCODING', ValidationWarning)
    await expect(validateEncoding(buf, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('decode buffer to UTF-8 should produce an UTF-8 string', () => {
  test('valid UTF8 buffer', async () => {
    const buf = Buffer.from('This is à tést!', 'utf8')
    await expect(decodeBufferToUTF8(buf)).resolves.toBe('This is à tést!')
  })
})
