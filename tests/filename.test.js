import { describe, expect, test } from '@jest/globals'
import { checkNits } from '../lib.mjs'

describe('filename base name contains valid characters', () => {
  test('valid characters', async () => {
    return expect(await checkNits())
  })
  test('invalid uppercase alpha', async () => {

  })
  test('invalid symbols', async () => {

  })
})

describe('filename extension matches a valid format type', () => {
  test('txt format', async () => {

  })
  test('xml format', async () => {

  })
  test('invalid extension', async () => {

  })
  test('missing extension', async () => {

  })
})

describe('filename base name matches the name declared in the document', () => {
  test('matching name', async () => {

  })
  test('non-matching name', async () => {

  })
})

describe('filename (including extension) is no more than 50 characters', () => {
  test('valid length', async () => {

  })
  test('exactly 50 characters in length', async () => {

  })
  test('filename too long', async () => {

  })
})
