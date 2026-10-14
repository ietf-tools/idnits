import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import {
  fetchDatatrackerStream,
  parseDatatrackerStream,
  streamDisplayName,
  streamFromDraftName,
  submissionTypeToStream
} from '../lib/helpers/stream.mjs'

const server = setupServer(
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-foo-bar/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/ise/' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-foo-nostream/', () => {
    return HttpResponse.json({ stream: null })
  }),
  http.all('*', () => {
    return new HttpResponse(null, { status: 404 })
  })
)

describe('submissionTypeToStream', () => {
  test('maps rfcxml submissionType values to Datatracker slugs', () => {
    expect(submissionTypeToStream('IETF')).toEqual('ietf')
    expect(submissionTypeToStream('IAB')).toEqual('iab')
    expect(submissionTypeToStream('IRTF')).toEqual('irtf')
    expect(submissionTypeToStream('independent')).toEqual('ise')
    expect(submissionTypeToStream('editorial')).toEqual('editorial')
  })
  test('is case-insensitive', () => {
    expect(submissionTypeToStream('ietf')).toEqual('ietf')
    expect(submissionTypeToStream('Independent')).toEqual('ise')
  })
  test('returns null for invalid values', () => {
    expect(submissionTypeToStream('xyz')).toBeNull()
    expect(submissionTypeToStream('ise')).toBeNull()
    expect(submissionTypeToStream(undefined)).toBeNull()
  })
})

describe('streamDisplayName', () => {
  test('returns display names', () => {
    expect(streamDisplayName('ietf')).toEqual('IETF')
    expect(streamDisplayName('ise')).toEqual('Independent Submission')
    expect(streamDisplayName('editorial')).toEqual('Editorial')
    expect(streamDisplayName('unknown')).toEqual('unknown')
  })
})

describe('streamFromDraftName', () => {
  test('detects iab and irtf prefixes', () => {
    expect(streamFromDraftName('draft-iab-foo-bar-01')).toEqual('iab')
    expect(streamFromDraftName('draft-irtf-foo-bar')).toEqual('irtf')
  })
  test('returns null otherwise', () => {
    expect(streamFromDraftName('draft-ietf-foo-bar')).toBeNull()
    expect(streamFromDraftName('draft-smith-iab-bar')).toBeNull()
    expect(streamFromDraftName(undefined)).toBeNull()
  })
})

describe('parseDatatrackerStream', () => {
  test('extracts the slug from a stream URI', () => {
    expect(parseDatatrackerStream('/api/v1/name/streamname/ietf/')).toEqual('ietf')
    expect(parseDatatrackerStream('ise')).toEqual('ise')
  })
  test('returns null when there is no stream', () => {
    expect(parseDatatrackerStream(null)).toBeNull()
    expect(parseDatatrackerStream('')).toBeNull()
  })
})

describe('fetchDatatrackerStream', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())

  test('returns the stream of a known document', async () => {
    await expect(fetchDatatrackerStream('draft-foo-bar-03')).resolves.toEqual({ stream: 'ise' })
  })
  test('returns a null stream when Datatracker has none', async () => {
    await expect(fetchDatatrackerStream('draft-foo-nostream')).resolves.toEqual({ stream: null })
  })
  test('returns null for an unknown document', async () => {
    await expect(fetchDatatrackerStream('draft-foo-unknown')).resolves.toBeNull()
  })
})
