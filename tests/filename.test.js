import { describe, expect, test } from 'vitest'
import { toContainError, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { splitFilename, validateFilename, validateDocName } from '../lib/modules/filename.mjs'
import { MODES } from '../lib/config/modes.mjs'
import { CANONICAL_TXT } from './generators/doc-txt.js'
import { parse } from '../lib/parsers/txt.mjs'
import { parse as parseXML } from '../lib/parsers/xml.mjs'
import { getDocType } from '../lib/index.mjs'

expect.extend({
  toContainError
})

const ALL_MODES = [['normal', MODES.NORMAL], ['forgive-checklist', MODES.FORGIVE_CHECKLIST], ['submission', MODES.SUBMISSION]]
// Datatracker rejects these in a submission: an Error there, a Warning otherwise
const submissionSeverity = mode => mode === MODES.SUBMISSION ? ValidationError : ValidationWarning
const severityName = cls => cls === ValidationError ? 'error' : 'warning'

/**
 * Parse an XML draft declaring the given name
 *
 * @param {string|null} docName docName attribute, or null for none
 * @param {string} filename Filename of the document
 * @returns {Promise<Object>} Parsed document object
 */
async function parseXMLDraft (docName, filename) {
  const { doc } = await parseXML(`<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3"${docName === null ? '' : ` docName="${docName}"`}>
  <front><title>Test</title><seriesInfo name="Internet-Draft" value="${docName ?? ''}"/></front>
</rfc>`, filename)
  return doc
}

/**
 * Parse an XML RFC
 *
 * @param {string} number RFC number
 * @param {string} filename Filename of the document
 * @returns {Promise<Object>} Parsed document object
 */
async function parseXMLRFC (number, filename) {
  const { doc } = await parseXML(`<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" number="${number}" docName="draft-ietf-beep-boop-07">
  <front><title>Test</title><seriesInfo name="RFC" value="${number}"/></front>
</rfc>`, filename)
  return doc
}

/**
 * Parse a text draft declaring the given name on its first page
 *
 * @param {string} name Name on the first page
 * @param {string} filename Filename of the document
 * @returns {Promise<Object>} Parsed document object
 */
async function parseTXTDraft (name, filename) {
  return parse(CANONICAL_TXT.replace('draft-ietf-beep-boop-01', name), filename)
}

describe('filename is split into base name and extension', () => {
  test('extension after the last dot, lowercased', () => {
    expect(splitFilename('draft-ietf-abcd-01.XML')).toEqual({ base: 'draft-ietf-abcd-01', ext: 'xml' })
    expect(splitFilename('draft-foo.bar-00.txt')).toEqual({ base: 'draft-foo.bar-00', ext: 'txt' })
  })
  test('no extension', () => {
    expect(splitFilename('draft-ietf-abcd-01')).toEqual({ base: 'draft-ietf-abcd-01', ext: null })
  })
  test('xml2rfc --v2v3 output', () => {
    expect(splitFilename('draft-ietf-abcd-01.v2v3.xml')).toEqual({ base: 'draft-ietf-abcd-01', ext: 'xml' })
    expect(splitFilename('draft-ietf-abcd-01.v2v3.txt')).toEqual({ base: 'draft-ietf-abcd-01.v2v3', ext: 'txt' })
  })
})

describe('document type follows the filename extension, in either case', () => {
  test.each([
    ['draft-ietf-abcd-01.xml', 'xml'],
    ['draft-ietf-abcd-01.XML', 'xml'],
    ['draft-ietf-abcd-01.v2v3.xml', 'xml'],
    ['draft-ietf-abcd-01.txt', 'txt'],
    ['draft-ietf-abcd-01.TXT', 'txt'],
    ['draft-ietf-abcd-01', 'txt']
  ])('%s', (filename, type) => {
    expect(getDocType(filename)).toBe(type)
  })
})

describe('filename extension matches a valid format type', () => {
  test.each(['draft-ietf-abcd-01.txt', 'draft-ietf-abcd-01.xml', 'draft-ietf-abcd-01.XML', 'draft-ietf-abcd-01.Txt'])('%s', async (filename) => {
    await expect(validateFilename(filename)).resolves.toHaveLength(0)
  })
  describe.each(ALL_MODES)('in %s mode', (_, mode) => {
    const Severity = submissionSeverity(mode)
    test(`invalid extension (${severityName(Severity)})`, async () => {
      await expect(validateFilename('draft-ietf-abcd-01.pdf', { mode })).resolves.toContainError('FILENAME_EXTENSION_INVALID', Severity)
    })
    test(`missing extension (${severityName(Severity)})`, async () => {
      const result = await validateFilename('draft-ietf-abcd-01', { mode })
      expect(result).toContainError('FILENAME_MISSING_EXTENSION', Severity)
      expect(result.map(r => r.name)).not.toContain('FILENAME_EXTENSION_INVALID')
    })
  })
})

describe('filename base name contains valid characters', () => {
  test('valid characters', async () => {
    await expect(validateFilename('draft-ietf-abcd-01.txt')).resolves.toHaveLength(0)
  })
  test('xml2rfc --v2v3 output', async () => {
    await expect(validateFilename('draft-ietf-abcd-01.v2v3.xml')).resolves.toHaveLength(0)
  })
  test('dot in the base name, the extension still found', async () => {
    const result = await validateFilename('draft-foo.bar-00.txt')
    expect(result).toContainError('FILENAME_TOO_MANY_DOTS', ValidationWarning)
    expect(result.map(r => r.name)).toEqual(['FILENAME_TOO_MANY_DOTS'])
  })
  describe.each(ALL_MODES)('in %s mode', (_, mode) => {
    const Severity = submissionSeverity(mode)
    test.each(['draft-ietf abcd-01.txt', 'draft-ietf-abcd-01\t.txt', 'draft-ietf-$abcd-01.txt', 'draft-ietf-&abcd-01.txt', 'draft-ietf-;abcd-01.txt', 'draft-ietf-*abcd-01.txt', 'draft-ietf-\\abcd-01.txt'])(`characters Datatracker refuses in an upload: %s (${severityName(Severity)})`, async (filename) => {
      await expect(validateFilename(filename, { mode })).resolves.toContainError('FILENAME_INVALID_CHARS', Severity)
    })
  })
  // How the name is built is checked against the declared name (see validateDocName)
  test.each(['draft-IETF-abcd-01.txt', 'draft_ietf_abcd-01.txt'])('characters Datatracker accepts in an upload: %s', async (filename) => {
    await expect(validateFilename(filename)).resolves.toHaveLength(0)
  })
  describe.each(ALL_MODES)('in %s mode', (_, mode) => {
    const Severity = submissionSeverity(mode)
    test(`too many dots (${severityName(Severity)})`, async () => {
      await expect(validateFilename('draft-ietf-abcd.01.txt', { mode })).resolves.toContainError('FILENAME_TOO_MANY_DOTS', Severity)
    })
  })
})

describe('name declared in the document follows the Datatracker naming rules', () => {
  test('valid name', async () => {
    const doc = await parseXMLDraft('draft-ietf-beep-boop-01', 'draft-ietf-beep-boop-01.xml')
    await expect(validateDocName(doc)).resolves.toHaveLength(0)
  })
  test('three components', async () => {
    const doc = await parseXMLDraft('draft-rswg-rfc7997bis-02', 'draft-rswg-rfc7997bis-02.xml')
    await expect(validateDocName(doc)).resolves.toHaveLength(0)
  })
  test('50 characters without the revision', async () => {
    const name = `draft-ietf-${'a'.repeat(39)}`
    const doc = await parseXMLDraft(`${name}-00`, `${name}-00.xml`)
    await expect(validateDocName(doc)).resolves.toHaveLength(0)
  })
  describe.each(ALL_MODES)('in %s mode', (_, mode) => {
    const Severity = submissionSeverity(mode)
    // The text parser only reads names it recognizes on the first page, so the
    // last few can only be declared in XML
    test.each([
      ['DOCNAME_MISSING_COMPONENTS', 'draft-ietf-01', true],
      ['DOCNAME_EMPTY_COMPONENT', 'draft-ietf--abcd-01', true],
      ['DOCNAME_EMPTY_COMPONENT', 'draft-ietf-abcd--01', true],
      ['DOCNAME_TOO_LONG', `draft-ietf-${'a'.repeat(40)}-00`, true],
      ['DOCNAME_INVALID_CHARS', 'draft-ietf-Abcd-01', true],
      ['DOCNAME_INVALID_CHARS', 'draft-1etf-abcd-01', true],
      ['DOCNAME_INVALID_VERSION_SUFFIX', 'draft-ietf-abcd-1', true],
      ['DOCNAME_INVALID_CHARS', 'draft-ietf-abcd-01.xml', false],
      ['DOCNAME_MISSING_DRAFT_PREFIX', 'ietf-abcd-efgh-01', false],
      ['DOCNAME_INVALID_VERSION_SUFFIX', 'draft-ietf-abcd-100', false]
    ])(`%s: %s (${severityName(Severity)})`, async (code, name, inText) => {
      const xmlDoc = await parseXMLDraft(name, `${name.replace(/\.xml$/, '')}.xml`)
      const xmlResult = await validateDocName(xmlDoc, { mode })
      expect(xmlResult).toContainError(code, Severity)
      expect(xmlResult.find(r => r.name === code).path).toBe('rfc.docName')
      expect(xmlResult.map(r => r.name)).not.toContain('FILENAME_DOCNAME_MISMATCH')

      if (inText) {
        const txtDoc = await parseTXTDraft(name, `${name}.txt`)
        expect(txtDoc.data.slug).toBe(name)
        const txtResult = await validateDocName(txtDoc, { mode })
        expect(txtResult).toContainError(code, Severity)
        expect(txtResult.map(r => r.name)).not.toContain('FILENAME_DOCNAME_MISMATCH')
      }
    })
    test(`name without its revision (${severityName(Severity)})`, async () => {
      const doc = await parseXMLDraft('draft-ietf-abcd', 'draft-ietf-abcd-00.xml')
      const result = await validateDocName(doc, { mode })
      expect(result).toContainError('DOCNAME_INVALID_VERSION_SUFFIX', Severity)
      expect(result.map(r => r.name)).toEqual(['DOCNAME_INVALID_VERSION_SUFFIX'])
    })
    test(`name with a file name extension (${severityName(Severity)})`, async () => {
      const doc = await parseXMLDraft('draft-ietf-abcd-01.txt', 'draft-ietf-abcd-01.xml')
      const result = await validateDocName(doc, { mode })
      expect(result).toContainError('DOCNAME_INVALID_CHARS', Severity)
      expect(result.map(r => r.name)).toEqual(['DOCNAME_INVALID_CHARS'])
    })
    test(`no name in an XML document (${severityName(Severity)})`, async () => {
      const doc = await parseXMLDraft(null, 'draft-ietf-abcd-00.xml')
      await expect(validateDocName(doc, { mode })).resolves.toContainError('DOCNAME_MISSING', Severity)
    })
  })
  test('no name in an XML document: the filename is checked instead', async () => {
    const doc = await parseXMLDraft(null, 'draft-ietf-00.xml')
    const result = await validateDocName(doc, { mode: MODES.SUBMISSION })
    expect(result.map(r => r.name)).toEqual(['DOCNAME_MISSING', 'FILENAME_MISSING_COMPONENTS'])
    expect(result).toContainError('FILENAME_MISSING_COMPONENTS', ValidationError)
  })
  test('no name in a text document: the filename is checked instead', async () => {
    const doc = await parse(CANONICAL_TXT.replace('draft-ietf-beep-boop-01', ''), 'Draft-ietf-beep-boop.txt')
    const result = await validateDocName(doc)
    expect(result.map(r => r.name)).toEqual(['FILENAME_MISSING_DRAFT_PREFIX', 'FILENAME_INVALID_VERSION_SUFFIX'])
    expect(result).toContainError('FILENAME_INVALID_VERSION_SUFFIX', ValidationWarning)
  })
  test('the name of an RFC is not checked', async () => {
    const doc = await parseXMLRFC('9999', 'rfc9999.xml')
    doc.data.rfc._attr.docName = 'not a draft name'
    await expect(validateDocName(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('filename base name matches the name declared in the document', () => {
  describe('Text Document Type', () => {
    test('matching name', async () => {
      const doc = await parse(CANONICAL_TXT, 'draft-ietf-beep-boop-01.txt')
      await expect(validateDocName(doc)).resolves.toHaveLength(0)
    })
    test('matching name with an uppercase extension', async () => {
      const doc = await parse(CANONICAL_TXT, 'draft-ietf-beep-boop-01.TXT')
      await expect(validateDocName(doc)).resolves.toHaveLength(0)
    })
    test('matching name written with its .txt extension', async () => {
      const filename = 'draft-ietf-beep-boop-01.txt'
      const doc = await parse(CANONICAL_TXT.replace('draft-ietf-beep-boop-01', 'draft-ietf-beep-boop-01.txt'), filename)
      await expect(validateDocName(doc)).resolves.toHaveLength(0)
    })
    test('matching name followed by an author name on the same line', async () => {
      const filename = 'draft-ietf-beep-boop-01.txt'
      const doc = await parse(CANONICAL_TXT.replace('draft-ietf-beep-boop-01', 'draft-ietf-beep-boop-01          A. Author'), filename)
      await expect(validateDocName(doc)).resolves.toHaveLength(0)
    })
    test('non-matching name in the document', async () => {
      const filename = 'draft-ietf-beep-boop-02.txt'
      const doc = await parse(CANONICAL_TXT, filename)
      await expect(validateDocName(doc)).resolves.toContainError('FILENAME_DOCNAME_MISMATCH', ValidationError)
    })
    test('filename without the revision', async () => {
      const doc = await parse(CANONICAL_TXT, 'draft-ietf-beep-boop.txt')
      const result = await validateDocName(doc)
      expect(result.map(r => r.name)).toEqual(['FILENAME_INVALID_VERSION_SUFFIX'])
    })
    test('no name in the document', async () => {
      const filename = 'draft-ietf-beep-boop-01.txt'
      const doc = await parse(CANONICAL_TXT.replace('draft-ietf-beep-boop-01', ''), filename)
      await expect(validateDocName(doc)).resolves.toHaveLength(0)
    })
  })
  describe('XML Document Type', () => {
    test('matching name', async () => {
      const doc = await parseXMLDraft('draft-ietf-abcd-01', 'draft-ietf-abcd-01.xml')
      await expect(validateDocName(doc)).resolves.toHaveLength(0)
    })
    test('matching name with an uppercase extension', async () => {
      const doc = await parseXMLDraft('draft-ietf-abcd-01', 'draft-ietf-abcd-01.XML')
      await expect(validateDocName(doc)).resolves.toHaveLength(0)
    })
    test('xml2rfc --v2v3 output', async () => {
      const doc = await parseXMLDraft('draft-ietf-abcd-01', 'draft-ietf-abcd-01.v2v3.xml')
      await expect(validateDocName(doc)).resolves.toHaveLength(0)
    })
    describe.each(ALL_MODES)('in %s mode', (_, mode) => {
      // An Error where the document is about to become an RFC, a Warning otherwise
      const MismatchSeverity = mode === MODES.NORMAL ? ValidationError : ValidationWarning
      test(`non-matching name (${severityName(MismatchSeverity)})`, async () => {
        const doc = await parseXMLDraft('draft-ietf-abcd-02', 'draft-ietf-abcd-01.xml')
        await expect(validateDocName(doc, { mode })).resolves.toContainError('FILENAME_DOCNAME_MISMATCH', MismatchSeverity)
      })
      test(`filename without the revision (${severityName(submissionSeverity(mode))})`, async () => {
        const doc = await parseXMLDraft('draft-rswg-rfc7997bis-02', 'draft-rswg-rfc7997bis.xml')
        const result = await validateDocName(doc, { mode })
        expect(result).toContainError('FILENAME_INVALID_VERSION_SUFFIX', submissionSeverity(mode))
        expect(result.map(r => r.name)).toEqual(['FILENAME_INVALID_VERSION_SUFFIX'])
      })
    })
  })
  describe('RFC', () => {
    test.each(['rfc9999.xml', 'rfc09999.xml'])('matching number: %s', async (filename) => {
      const doc = await parseXMLRFC('9999', filename)
      await expect(validateDocName(doc)).resolves.toHaveLength(0)
    })
    test.each(['rfc9998.xml', 'draft-ietf-beep-boop-07.xml'])('non-matching number: %s', async (filename) => {
      const doc = await parseXMLRFC('9999', filename)
      await expect(validateDocName(doc)).resolves.toContainError('FILENAME_DOCNAME_MISMATCH', ValidationError)
      await expect(validateDocName(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('FILENAME_DOCNAME_MISMATCH', ValidationWarning)
    })
    test('text RFC', async () => {
      const rfc = CANONICAL_TXT.replace('Internet-Draft', 'Request for Comments: 9999').replace(/Intended status:/, 'Category:')
      const doc = await parse(rfc, 'rfc9999.txt')
      expect(doc.docKind).toBe('rfc')
      await expect(validateDocName(doc)).resolves.toHaveLength(0)
      const renamed = await parse(rfc, 'draft-ietf-beep-boop-01.txt')
      await expect(validateDocName(renamed)).resolves.toContainError('FILENAME_DOCNAME_MISMATCH', ValidationError)
    })
    test('text draft named as an RFC', async () => {
      const doc = await parse(CANONICAL_TXT, 'rfc9999.txt')
      await expect(validateDocName(doc)).resolves.toContainError('FILENAME_DOCNAME_MISMATCH', ValidationError)
    })
  })
})
