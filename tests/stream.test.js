import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import {
  checkDatatrackerStream,
  fetchDatatrackerStream,
  getDocumentStream,
  parseDatatrackerStream,
  streamDisplayName,
  streamFromDraftName,
  streamFromHeaderSource,
  submissionTypeToStream
} from '../lib/helpers/stream.mjs'
import { parse as parseTxt } from '../lib/parsers/txt.mjs'
import { parse as parseXml } from '../lib/parsers/xml.mjs'
import { txtStreamDraft, txtStreamRfc, xmlStreamDoc } from './fixtures/stream-docs.mjs'

const requests = []

const server = setupServer(
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-foo-bar/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/ise/' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-foo-nostream/', () => {
    return HttpResponse.json({ stream: null })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-smith-foo-bar/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/ise/' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-iab-foo-nostream/', () => {
    return HttpResponse.json({ stream: null })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/rfc9990/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/irtf/' })
  }),
  http.all('*', () => {
    return new HttpResponse(null, { status: 404 })
  })
)

expect.extend({
  toContainError
})

server.events.on('request:start', ({ request }) => { requests.push(request.url) })

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  requests.length = 0
})
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

describe('getDocumentStream', () => {
  const xml = async (opts, filename = 'draft-smith-foo-bar-02.xml') => (await parseXml(xmlStreamDoc(opts), filename)).doc

  test('takes a non-IETF submissionType of an XML draft as is', async () => {
    const doc = await xml({ docName: 'draft-ietf-foo-bar-02', submissionType: 'independent' })
    await expect(getDocumentStream(doc)).resolves.toEqual('ise')
    expect(requests).toHaveLength(0)
  })
  test('asks Datatracker about an XML draft declaring or defaulting to IETF', async () => {
    await expect(getDocumentStream(await xml())).resolves.toEqual('ise')
    await expect(getDocumentStream(await xml({ submissionType: 'IETF' }))).resolves.toEqual('ise')
    expect(requests).toContain('https://datatracker.ietf.org/api/v1/doc/document/draft-smith-foo-bar/')
  })
  test('falls back to the name prefix of an XML draft', async () => {
    await expect(getDocumentStream(await xml({ docName: 'draft-ietf-foo-bar-02', submissionType: 'IETF' }))).resolves.toEqual('ietf')
    await expect(getDocumentStream(await xml({ docName: 'draft-iab-foo-nostream-00' }))).resolves.toEqual('iab')
    await expect(getDocumentStream(await xml({ docName: 'draft-smith-foo-unknown-00' }))).resolves.toBeNull()
  })
  test('only uses the name prefix when offline', async () => {
    await expect(getDocumentStream(await xml(), { offline: true })).resolves.toBeNull()
    await expect(getDocumentStream(await xml({ docName: 'draft-ietf-foo-bar-02' }), { offline: true })).resolves.toEqual('ietf')
    expect(requests).toHaveLength(0)
  })
  test('takes any submissionType of an XML RFC, or asks Datatracker by number', async () => {
    await expect(getDocumentStream(await xml({ number: '9991', submissionType: 'IETF' }, 'rfc9991.xml'))).resolves.toEqual('ietf')
    await expect(getDocumentStream(await xml({ number: '9990' }, 'rfc9990.xml'))).resolves.toEqual('irtf')
    await expect(getDocumentStream(await xml({ number: '9991' }, 'rfc9991.xml'))).resolves.toBeNull()
  })
  test('asks Datatracker about a text draft, then uses its name prefix', async () => {
    const draft = name => parseTxt(txtStreamDraft(name), `${name}.txt`)
    await expect(getDocumentStream(await draft('draft-smith-foo-bar-02'))).resolves.toEqual('ise')
    await expect(getDocumentStream(await draft('draft-iab-foo-nostream-00'))).resolves.toEqual('iab')
    await expect(getDocumentStream(await draft('draft-ietf-foo-bar-02'))).resolves.toEqual('ietf')
    await expect(getDocumentStream(await draft('draft-smith-foo-unknown-00'))).resolves.toBeNull()
  })
  test('takes the header stream of a text RFC, or asks Datatracker by number', async () => {
    const rfc = (source, number) => parseTxt(txtStreamRfc(source, number), `rfc${number}.txt`)
    await expect(getDocumentStream(await rfc('Independent Submission', '9991'))).resolves.toEqual('ise')
    expect(requests).toHaveLength(0)
    await expect(getDocumentStream(await rfc('Network Working Group', '9990'))).resolves.toEqual('irtf')
    await expect(getDocumentStream(await rfc('Network Working Group', '9991'))).resolves.toBeNull()
    await expect(getDocumentStream(await rfc('Network Working Group', '9990'), { offline: true })).resolves.toBeNull()
  })
})
