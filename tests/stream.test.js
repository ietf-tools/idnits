import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import {
  checkDatatrackerStream,
  fetchDatatrackerStream,
  parseDatatrackerStream,
  streamDisplayName,
  streamFromDraftName,
  streamFromHeaderSource,
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

expect.extend({
  toContainError
})

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

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
  test('detects the ietf prefix only when asked', () => {
    expect(streamFromDraftName('draft-ietf-foo-bar-01', { ietf: true })).toEqual('ietf')
    expect(streamFromDraftName('draft-irtf-foo-bar-01', { ietf: true })).toEqual('irtf')
    expect(streamFromDraftName('draft-smith-foo-bar-01', { ietf: true })).toBeNull()
  })
  test('returns null otherwise', () => {
    expect(streamFromDraftName('draft-ietf-foo-bar')).toBeNull()
    expect(streamFromDraftName('draft-smith-iab-bar')).toBeNull()
    expect(streamFromDraftName(undefined)).toBeNull()
  })
})

describe('streamFromHeaderSource', () => {
  test('maps RFC header first lines to Datatracker slugs', () => {
    expect(streamFromHeaderSource('Internet Engineering Task Force (IETF)')).toEqual('ietf')
    expect(streamFromHeaderSource('Internet Architecture Board (IAB)')).toEqual('iab')
    expect(streamFromHeaderSource('Internet Research Task Force (IRTF)')).toEqual('irtf')
    expect(streamFromHeaderSource('Independent Submission')).toEqual('ise')
    expect(streamFromHeaderSource('Editorial Stream')).toEqual('editorial')
  })
  test('ignores case, extra whitespace and a missing abbreviation', () => {
    expect(streamFromHeaderSource('  Internet  Engineering Task Force   ')).toEqual('ietf')
    expect(streamFromHeaderSource('INTERNET RESEARCH TASK FORCE (IRTF)')).toEqual('irtf')
  })
  test('returns null for lines naming no stream', () => {
    expect(streamFromHeaderSource('Network Working Group')).toBeNull()
    expect(streamFromHeaderSource('Internet Engineering Task Force (IAB)')).toBeNull()
    expect(streamFromHeaderSource(null)).toBeNull()
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

describe('checkDatatrackerStream', () => {
  const opts = { declared: 'The document declares the IETF stream', findingOpts: { ref: 'https://www.rfc-editor.org/rfc/rfc7841.html' } }

  test('accepts a matching stream', async () => {
    await expect(checkDatatrackerStream('draft-foo-bar', 'ise', opts)).resolves.toHaveLength(0)
  })
  test('accepts an unknown document', async () => {
    await expect(checkDatatrackerStream('draft-foo-unknown', 'ietf', opts)).resolves.toHaveLength(0)
  })
  test('reports a different stream by mode', async () => {
    await expect(checkDatatrackerStream('draft-foo-bar', 'ietf', opts)).resolves.toEqual([
      new ValidationError('SUBMISSION_TYPE_UNEXPECTED', 'The document declares the IETF stream, but Datatracker has this draft in the Independent Submission stream.', opts.findingOpts)
    ])
    await expect(checkDatatrackerStream('draft-foo-bar', 'ietf', { ...opts, mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationWarning)
    await expect(checkDatatrackerStream('draft-foo-bar', 'ietf', { ...opts, mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
  })
  test('reports a document with no stream yet by mode', async () => {
    await expect(checkDatatrackerStream('draft-foo-nostream', 'ietf', { ...opts, docType: 'RFC' })).resolves.toEqual([
      new ValidationError('SUBMISSION_TYPE_UNEXPECTED', 'The document declares the IETF stream, but Datatracker has no stream for this RFC yet.', opts.findingOpts)
    ])
    await expect(checkDatatrackerStream('draft-foo-nostream', 'ietf', { ...opts, mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationWarning)
    await expect(checkDatatrackerStream('draft-foo-nostream', 'ietf', { ...opts, mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationComment)
  })
})
