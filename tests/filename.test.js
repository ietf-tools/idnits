import { describe, expect, test } from '@jest/globals'
import { toContainError } from '../lib/helpers/error.mjs'
import { validateFilename, validateDocName } from '../lib/modules/filename.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'

expect.extend({
  toContainError
})

describe('filename base name contains valid characters', () => {
  test('valid characters', async () => {
    expect(validateFilename('draft-ietf-abcd-01.txt')).toHaveLength(0)
  })
  test('invalid uppercase alpha', async () => {
    expect(validateFilename('draft-IETF-abcd-01.txt')).toContainError('FILENAME_INVALID_CHARS')
  })
  test('invalid symbols', async () => {
    expect(validateFilename('draft_ietf abcd-01.txt')).toContainError('FILENAME_INVALID_CHARS')
  })
  test('too many dots', async () => {
    expect(validateFilename('draft-ietf-abcd.01.txt')).toContainError('FILENAME_TOO_MANY_DOTS')
  })
})

describe('filename extension matches a valid format type', () => {
  test('txt format', async () => {
    expect(validateFilename('draft-ietf-abcd-01.txt')).toHaveLength(0)
  })
  test('xml format', async () => {
    expect(validateFilename('draft-ietf-abcd-01.xml')).toHaveLength(0)
  })
  test('invalid extension', async () => {
    expect(validateFilename('draft-ietf-abcd-01.pdf')).toContainError('FILENAME_EXTENSION_INVALID')
  })
  test('missing extension', async () => {
    expect(validateFilename('draft-ietf-abcd-01')).toContainError('FILENAME_MISSING_EXTENSION')
  })
})

describe('filename base name matches the name declared in the document', () => {
  describe('XML Document Type', () => {
    test('matching name', async () => {
      const doc = { ...cloneDeep(baseXMLDoc), filename: 'draft-ietf-abcd-01.xml' }
      set(doc, 'data.rfc._attr.docName', 'draft-ietf-abcd-01')
      expect(validateDocName(doc)).toHaveLength(0)
    })
    test('non-matching name', async () => {
      const doc = { ...cloneDeep(baseXMLDoc), filename: 'draft-ietf-abcd-01.xml' }
      set(doc, 'data.rfc._attr.docName', 'draft-ietf-abcd-02')
      expect(validateDocName(doc)).toContainError('FILENAME_DOCNAME_MISMATCH')
    })
  })
  describe('Text Document Type', () => {
    test('matching name', async () => {
      // TODO: matching name
    })
    test('non-matching name', async () => {
      // TODO: non-matching name
    })
  })
})

describe('filename (including extension) is no more than 50 characters', () => {
  test('valid length', async () => {
    expect(validateFilename('draft-ietf-abcd-01.txt')).toHaveLength(0)
  })
  test('exactly 50 characters in length', async () => {
    expect(validateFilename('draft-ietf-1234567890-1234567890-1234567890-01.txt')).toHaveLength(0)
  })
  test('filename too long', async () => {
    expect(validateFilename('draft-ietf-1234567890-1234567890-1234567890-1234567890-01.txt')).toContainError('FILENAME_TOO_LONG')
  })
})

describe('filename must start with draft-', () => {
  test('starts with draft-', async () => {
    expect(validateFilename('draft-ietf-abcd-01.txt')).toHaveLength(0)
  })
  test('missing draft prefix', async () => {
    expect(validateFilename('ietf-abcd-01.txt')).toContainError('FILENAME_MISSING_DRAFT_PREFIX')
  })
  test('draft prefix without dash', async () => {
    expect(validateFilename('draftietf-abcd-01.txt')).toContainError('FILENAME_MISSING_DRAFT_PREFIX')
  })
})

describe('filename must end with a version', () => {
  test('valid version suffix', async () => {
    expect(validateFilename('draft-ietf-abcd-01.txt')).toHaveLength(0)
  })
  test('missing version suffix', async () => {
    expect(validateFilename('draft-ietf-abcd.txt')).toContainError('FILENAME_INVALID_VERSION_SUFFIX')
  })
  test('version suffix over 99', async () => {
    expect(validateFilename('draft-ietf-abcd-100.txt')).toContainError('FILENAME_INVALID_VERSION_SUFFIX')
  })
})

describe('filename must have at least 4 components', () => {
  test('valid 4 components', async () => {
    expect(validateFilename('draft-ietf-abcd-01.txt')).toHaveLength(0)
  })
  test('valid 5 components', async () => {
    expect(validateFilename('draft-ietf-abcd-efgh-01.txt')).toHaveLength(0)
  })
  test('invalid 3 components', async () => {
    expect(validateFilename('draft-ietf-01.txt')).toContainError('FILENAME_MISSING_COMPONENTS')
  })
})
