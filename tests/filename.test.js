import { describe, expect, test } from '@jest/globals'
import { toThrowWithErrorName } from '../lib/helpers/error.mjs'
import { validateFilename } from '../lib/modules/filename.mjs'

expect.extend({
  toThrowWithErrorName
})

describe('filename base name contains valid characters', () => {
  test('valid characters', async () => {
    expect(validateFilename('draft-ietf-abcd-1234.txt')).toBe(true)
  })
  test('invalid uppercase alpha', async () => {
    expect(() => {
      validateFilename('draft-IETF-abcd-1234.txt')
    }).toThrowWithErrorName('FILENAME_INVALID_CHARS')
  })
  test('invalid symbols', async () => {
    expect(() => {
      validateFilename('draft_ietf abcd-1234.txt')
    }).toThrowWithErrorName('FILENAME_INVALID_CHARS')
  })
  test('too many dots', async () => {
    expect(() => {
      validateFilename('draft-ietf-abcd.1234.txt')
    }).toThrowWithErrorName('FILENAME_TOO_MANY_DOTS')
  })
})

describe('filename extension matches a valid format type', () => {
  test('txt format', async () => {
    expect(validateFilename('draft-ietf-abcd-1234.txt')).toBe(true)
  })
  test('xml format', async () => {
    expect(validateFilename('draft-ietf-abcd-1234.xml')).toBe(true)
  })
  test('invalid extension', async () => {
    expect(() => {
      validateFilename('draft-ietf-abcd-1234.pdf')
    }).toThrowWithErrorName('FILENAME_EXTENSION_INVALID')
  })
  test('missing extension', async () => {
    expect(() => {
      validateFilename('draft-ietf-abcd-1234')
    }).toThrowWithErrorName('FILENAME_MISSING_EXTENSION')
  })
})

describe('filename base name matches the name declared in the document', () => {
  test('matching name', async () => {
    // TODO: Missing test
  })
  test('non-matching name', async () => {
    // TODO: Missing test
  })
})

describe('filename (including extension) is no more than 50 characters', () => {
  test('valid length', async () => {
    expect(validateFilename('draft-ietf-abcd-1234.txt')).toBe(true)
  })
  test('exactly 50 characters in length', async () => {
    expect(validateFilename('1234567890-1234567890-1234567890-1234567890-12.txt')).toBe(true)
  })
  test('filename too long', async () => {
    expect(() => {
      validateFilename('1234567890-1234567890-1234567890-1234567890-123.txt')
    }).toThrowWithErrorName('FILENAME_TOO_LONG')
  })
})
