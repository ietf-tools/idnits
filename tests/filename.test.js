import { describe, expect, test } from 'vitest'
import { toContainError, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateFilename, validateDocName } from '../lib/modules/filename.mjs'
import { baseTXTDoc, baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set, repeat } from 'lodash-es'
import { CANONICAL_TXT } from './generators/doc-txt.js'
import { parse } from '../lib/parsers/txt.mjs'

expect.extend({
  toContainError
})

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
