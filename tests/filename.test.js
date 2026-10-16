import { describe, expect, test } from 'vitest'
import { toContainError, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateFilename, validateDocName } from '../lib/modules/filename.mjs'
import { MODES } from '../lib/config/modes.mjs'
import { baseTXTDoc, baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set, repeat } from 'lodash-es'
import { CANONICAL_TXT } from './generators/doc-txt.js'
import { parse } from '../lib/parsers/txt.mjs'
import { parse as parseXML } from '../lib/parsers/xml.mjs'

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

describe('filename base name contains valid characters', () => {
  test('valid characters', async () => {
    await expect(validateFilename('draft-ietf-abcd-01.txt')).resolves.toHaveLength(0)
  })
  test('invalid uppercase alpha', async () => {
    await expect(validateFilename('draft-IETF-abcd-01.txt')).resolves.toContainError('FILENAME_INVALID_CHARS')
  })
  test('invalid symbols', async () => {
    await expect(validateFilename('draft_ietf abcd-01.txt')).resolves.toContainError('FILENAME_INVALID_CHARS')
  })
  test('too many dots', async () => {
    await expect(validateFilename('draft-ietf-abcd.01.txt')).resolves.toContainError('FILENAME_TOO_MANY_DOTS')
  })
})

describe('filename extension matches a valid format type', () => {
  test('txt format', async () => {
    await expect(validateFilename('draft-ietf-abcd-01.txt')).resolves.toHaveLength(0)
  })
  test('xml format', async () => {
    await expect(validateFilename('draft-ietf-abcd-01.xml')).resolves.toHaveLength(0)
  })
  test('invalid extension', async () => {
    await expect(validateFilename('draft-ietf-abcd-01.pdf')).resolves.toContainError('FILENAME_EXTENSION_INVALID')
  })
  test('missing extension', async () => {
    await expect(validateFilename('draft-ietf-abcd-01')).resolves.toContainError('FILENAME_MISSING_EXTENSION')
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

      if (inText) {
        const txtDoc = await parseTXTDraft(name, `${name}.txt`)
        expect(txtDoc.data.slug).toBe(name)
        const txtResult = await validateDocName(txtDoc, { mode })
        expect(txtResult).toContainError(code, Severity)
      }
    })
    test(`name without its revision (${severityName(Severity)})`, async () => {
      const doc = await parseXMLDraft('draft-ietf-abcd', 'draft-ietf-abcd-00.xml')
      const result = await validateDocName(doc, { mode })
      expect(result).toContainError('DOCNAME_INVALID_VERSION_SUFFIX', Severity)
    })
    test(`no name in an XML document (${severityName(Severity)})`, async () => {
      const doc = await parseXMLDraft(null, 'draft-ietf-abcd-00.xml')
      await expect(validateDocName(doc, { mode })).resolves.toContainError('DOCNAME_MISSING', Severity)
    })
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
      const doc = { ...cloneDeep(baseTXTDoc), filename: 'draft-ietf-abcd-01.txt' }
      set(doc, 'data.slug', 'draft-ietf-abcd-01')
      await expect(validateDocName(doc)).resolves.toHaveLength(0)
    })
    test('non-matching name', async () => {
      const doc = { ...cloneDeep(baseTXTDoc), filename: 'draft-ietf-abcd-01.txt' }
      set(doc, 'data.slug', 'draft-ietf-abcd-02')
      await expect(validateDocName(doc)).resolves.toContainError('FILENAME_DOCNAME_MISMATCH')
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
      await expect(validateDocName(doc)).resolves.toContainError('FILENAME_DOCNAME_MISMATCH')
    })
    test('no name in the document', async () => {
      const filename = 'draft-ietf-beep-boop-01.txt'
      const doc = await parse(CANONICAL_TXT.replace('draft-ietf-beep-boop-01', ''), filename)
      await expect(validateDocName(doc)).resolves.toHaveLength(0)
    })
  })
  describe('XML Document Type', () => {
    test('matching name', async () => {
      const doc = { ...cloneDeep(baseXMLDoc), filename: 'draft-ietf-abcd-01.xml' }
      set(doc, 'data.rfc._attr.docName', 'draft-ietf-abcd-01')
      await expect(validateDocName(doc)).resolves.toHaveLength(0)
    })
    test('non-matching name', async () => {
      const doc = { ...cloneDeep(baseXMLDoc), filename: 'draft-ietf-abcd-01.xml' }
      set(doc, 'data.rfc._attr.docName', 'draft-ietf-abcd-02')
      await expect(validateDocName(doc)).resolves.toContainError('FILENAME_DOCNAME_MISMATCH')
    })
  })
})

describe('filename (including extension) is no more than 72 characters', () => {
  test('valid length', async () => {
    await expect(validateFilename('draft-ietf-abcd-01.txt')).resolves.toHaveLength(0)
  })
  test('exactly 72 characters in length', async () => {
    await expect(validateFilename('draft-ietf-1234567890-1234567890-1234567890-1234567890-1234567890-12.txt')).resolves.toHaveLength(0)
  })
  test('filename too long >72 <=255', async () => {
    await expect(validateFilename('draft-ietf-1234567890-1234567890-1234567890-1234567890-1234567890-123.txt')).resolves.toContainError('FILENAME_TOO_LONG', ValidationWarning)
  })
  test('filename too long >255', async () => {
    await expect(validateFilename(`draft-ietf${repeat('-123456789', 24)}-1.txt`)).resolves.toContainError('FILENAME_TOO_LONG', ValidationError)
  })
})

describe('filename must start with draft-', () => {
  test('starts with draft-', async () => {
    await expect(validateFilename('draft-ietf-abcd-01.txt')).resolves.toHaveLength(0)
  })
  test('missing draft prefix', async () => {
    await expect(validateFilename('ietf-abcd-01.txt')).resolves.toContainError('FILENAME_MISSING_DRAFT_PREFIX')
  })
  test('draft prefix without dash', async () => {
    await expect(validateFilename('draftietf-abcd-01.txt')).resolves.toContainError('FILENAME_MISSING_DRAFT_PREFIX')
  })
})

describe('filename must end with a version', () => {
  test('valid version suffix', async () => {
    await expect(validateFilename('draft-ietf-abcd-01.txt')).resolves.toHaveLength(0)
  })
  test('missing version suffix', async () => {
    await expect(validateFilename('draft-ietf-abcd.txt')).resolves.toContainError('FILENAME_INVALID_VERSION_SUFFIX')
  })
  test('version suffix over 99', async () => {
    await expect(validateFilename('draft-ietf-abcd-100.txt')).resolves.toContainError('FILENAME_INVALID_VERSION_SUFFIX')
  })
})

describe('filename must have at least 4 components', () => {
  test('valid 4 components', async () => {
    await expect(validateFilename('draft-ietf-abcd-01.txt')).resolves.toHaveLength(0)
  })
  test('valid 5 components', async () => {
    await expect(validateFilename('draft-ietf-abcd-efgh-01.txt')).resolves.toHaveLength(0)
  })
  test('invalid 3 components', async () => {
    await expect(validateFilename('draft-ietf-01.txt')).resolves.toContainError('FILENAME_MISSING_COMPONENTS')
  })
})
