import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { delay, http, HttpResponse, passthrough } from 'msw'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { checkNits } from '../lib/index.mjs'
import { ValidationComment } from '../lib/helpers/error.mjs'
import { MODES } from '../lib/config/modes.mjs'
import {
  DEFAULT_DATATRACKER_URL,
  DEFAULT_REMOTE_TIMEOUT,
  DEFAULT_RFCEDITOR_URL,
  MAX_REMOTE_TIMEOUT,
  getDatatrackerUrl,
  getRemoteTimeout,
  getRfcEditorUrl,
  normalizeBaseUrl,
  normalizeTimeout,
  setRemoteTimeout,
  setRemoteUrls
} from '../lib/config/remote.mjs'
import {
  cachedLookup,
  clearRemoteCache,
  DOC_INFO_CACHE_SIZE,
  DOC_INFO_CACHE_TTL,
  fetchRemoteDocInfo,
  fetchRemoteDocInfoJson,
  fetchRemoteRfcInfo,
  getUserAgent,
  remoteFetch
} from '../lib/remote/common.mjs'
import { checkReferencesInDownrefs } from '../lib/remote/downref.mjs'

const pkgInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const requests = []

const server = setupServer(
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-foo-bar/', () => {
    return HttpResponse.json({ name: 'draft-foo-bar', rev: '02' })
  }),
  http.get('http://datatracker.svc:8000/api/v1/doc/document/draft-foo-bar/', () => {
    return HttpResponse.json({ name: 'draft-foo-bar', rev: '03' })
  }),
  http.get('http://datatracker.svc:8000/doc/draft-foo-bar/doc.json', () => {
    return HttpResponse.json({ name: 'draft-foo-bar', state: 'Active' })
  }),
  http.get('http://datatracker.svc:8000/doc/downref/', () => {
    return HttpResponse.text('<a href="/doc/rfc1234/">RFC 1234</a>')
  }),
  http.get('http://rfc-editor.svc/rfc/rfc1234.json', () => {
    return HttpResponse.json({ status: 'INFORMATIONAL' })
  }),
  http.all('*', () => {
    return new HttpResponse(null, { status: 404 })
  })
)

server.events.on('request:start', ({ request }) => {
  requests.push({ url: request.url, userAgent: request.headers.get('User-Agent') })
})

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  requests.length = 0
  clearRemoteCache()
  setRemoteUrls()
  setRemoteTimeout()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
afterAll(() => server.close())

describe('normalizeBaseUrl', () => {
  test('removes trailing slashes', () => {
    expect(normalizeBaseUrl('https://datatracker.ietf.org/')).toBe('https://datatracker.ietf.org')
    expect(normalizeBaseUrl(' http://datatracker.svc:8000// ')).toBe('http://datatracker.svc:8000')
    expect(normalizeBaseUrl('http://proxy.example/datatracker/')).toBe('http://proxy.example/datatracker')
  })

  test('rejects values that are not http(s) URLs', () => {
    expect(() => normalizeBaseUrl('datatracker.ietf.org')).toThrow('must be an http(s) URL')
    expect(() => normalizeBaseUrl('ftp://datatracker.ietf.org')).toThrow('must be an http(s) URL')
    expect(() => normalizeBaseUrl('https://datatracker.ietf.org/?a=b')).toThrow('without query or fragment')
    expect(() => normalizeBaseUrl('')).toThrow('must be an http(s) URL')
    expect(() => normalizeBaseUrl('nope', '--datatracker-url')).toThrow('--datatracker-url must be')
  })
})

describe('Remote base URLs', () => {
  test('default to the public services', () => {
    expect(getDatatrackerUrl()).toBe(DEFAULT_DATATRACKER_URL)
    expect(getRfcEditorUrl()).toBe(DEFAULT_RFCEDITOR_URL)
  })

  test('are taken from the environment', () => {
    vi.stubEnv('IDNITS_DATATRACKER_URL', 'http://datatracker.svc:8000/')
    vi.stubEnv('IDNITS_RFCEDITOR_URL', 'http://rfc-editor.svc')
    expect(getDatatrackerUrl()).toBe('http://datatracker.svc:8000')
    expect(getRfcEditorUrl()).toBe('http://rfc-editor.svc')
  })

  test('ignore empty environment variables', () => {
    vi.stubEnv('IDNITS_DATATRACKER_URL', ' ')
    expect(getDatatrackerUrl()).toBe(DEFAULT_DATATRACKER_URL)
  })

  test('reject an invalid environment variable', () => {
    vi.stubEnv('IDNITS_DATATRACKER_URL', 'datatracker.svc')
    expect(() => getDatatrackerUrl()).toThrow('IDNITS_DATATRACKER_URL must be an http(s) URL')
  })

  test('set explicitly take precedence over the environment', () => {
    vi.stubEnv('IDNITS_DATATRACKER_URL', 'http://env.example')
    vi.stubEnv('IDNITS_RFCEDITOR_URL', 'http://env.example')
    setRemoteUrls({ datatracker: 'http://datatracker.svc:8000/', rfcEditor: 'http://rfc-editor.svc/' })
    expect(getDatatrackerUrl()).toBe('http://datatracker.svc:8000')
    expect(getRfcEditorUrl()).toBe('http://rfc-editor.svc')
    setRemoteUrls({ datatracker: null })
    expect(getDatatrackerUrl()).toBe('http://env.example')
  })

  test('set explicitly are validated', () => {
    expect(() => setRemoteUrls({ datatracker: 'ftp://datatracker.svc' })).toThrow('Datatracker URL must be')
    expect(() => setRemoteUrls({ rfcEditor: 'rfc-editor.svc' })).toThrow('RFC Editor URL must be')
  })
})

describe('Remote lookups', () => {
  test('go to the public services by default, with the idnits3 User-Agent', async () => {
    await expect(fetchRemoteDocInfo('draft-foo-bar-02')).resolves.toEqual({ name: 'draft-foo-bar', rev: '02' })
    await expect(getUserAgent()).resolves.toBe(`idnits3/${pkgInfo.version} (+https://github.com/ietf-tools/idnits)`)
    expect(requests).toEqual([{
      url: 'https://datatracker.ietf.org/api/v1/doc/document/draft-foo-bar/',
      userAgent: `idnits3/${pkgInfo.version} (+https://github.com/ietf-tools/idnits)`
    }])
  })

  test('all go to the configured services', async () => {
    vi.stubEnv('IDNITS_DATATRACKER_URL', 'http://datatracker.svc:8000/')
    setRemoteUrls({ rfcEditor: 'http://rfc-editor.svc' })
    await expect(fetchRemoteDocInfo('draft-foo-bar-03')).resolves.toEqual({ name: 'draft-foo-bar', rev: '03' })
    await expect(fetchRemoteDocInfoJson('draft-foo-bar')).resolves.toEqual({ name: 'draft-foo-bar', state: 'Active' })
    await expect(fetchRemoteRfcInfo(1234)).resolves.toEqual({ status: 'INFORMATIONAL' })
    await expect(checkReferencesInDownrefs(['RFC 1234', 'RFC 2345'])).resolves.toEqual(['RFC 1234'])
    expect(requests.map(r => r.url)).toEqual([
      'http://datatracker.svc:8000/api/v1/doc/document/draft-foo-bar/',
      'http://datatracker.svc:8000/doc/draft-foo-bar/doc.json',
      'http://rfc-editor.svc/rfc/rfc1234.json',
      'http://datatracker.svc:8000/doc/downref/'
    ])
    expect(requests.every(r => r.userAgent.startsWith('idnits3/'))).toBe(true)
  })

  test('of a document are fetched once, with or without its version', async () => {
    const results = await Promise.all([
      fetchRemoteDocInfo('draft-foo-bar'),
      fetchRemoteDocInfo('draft-foo-bar-02'),
      fetchRemoteDocInfo('draft-foo-bar-03')
    ])
    await fetchRemoteDocInfo('draft-foo-bar-02')
    expect(results).toEqual(Array(3).fill({ name: 'draft-foo-bar', rev: '02' }))
    expect(requests).toHaveLength(1)
  })

  test('that find nothing are shared too', async () => {
    await expect(fetchRemoteDocInfo('draft-foo-unknown-00')).resolves.toBeNull()
    await expect(fetchRemoteDocInfo('draft-foo-unknown-01')).resolves.toBeNull()
    expect(requests).toHaveLength(1)
  })

  test('are made again after the configured service changes', async () => {
    await fetchRemoteDocInfo('draft-foo-bar-02')
    setRemoteUrls({ datatracker: 'http://datatracker.svc:8000' })
    await expect(fetchRemoteDocInfo('draft-foo-bar-02')).resolves.toEqual({ name: 'draft-foo-bar', rev: '03' })
    expect(requests).toHaveLength(2)
  })

  test('are not made to an invalid service', async () => {
    vi.stubEnv('IDNITS_DATATRACKER_URL', 'datatracker.svc')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(fetchRemoteDocInfo('draft-foo-bar-02')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('IDNITS_DATATRACKER_URL must be'))
    expect(requests).toHaveLength(0)
  })
})

describe('cachedLookup', () => {
  test('shares a lookup until it expires', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const fetcher = vi.fn(async () => 'value')
    await expect(cachedLookup('key', fetcher)).resolves.toBe('value')
    now.mockReturnValue(1000 + DOC_INFO_CACHE_TTL - 1)
    await cachedLookup('key', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    now.mockReturnValue(1000 + DOC_INFO_CACHE_TTL)
    await cachedLookup('key', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  test('keeps a bounded number of lookups, dropping the oldest', async () => {
    const fetcher = vi.fn(async () => 'value')
    for (let i = 0; i <= DOC_INFO_CACHE_SIZE; i++) {
      cachedLookup(`key${i}`, fetcher)
    }
    expect(fetcher).toHaveBeenCalledTimes(DOC_INFO_CACHE_SIZE + 1)
    cachedLookup(`key${DOC_INFO_CACHE_SIZE}`, fetcher)
    cachedLookup('key1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(DOC_INFO_CACHE_SIZE + 1)
    cachedLookup('key0', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(DOC_INFO_CACHE_SIZE + 2)
  })

  test('forgets all lookups when cleared', async () => {
    const fetcher = vi.fn(async () => 'value')
    await cachedLookup('key', fetcher)
    clearRemoteCache()
    await cachedLookup('key', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('normalizeTimeout', () => {
  test('accepts a positive number of seconds', () => {
    expect(normalizeTimeout('10')).toBe(10)
    expect(normalizeTimeout(' 2.5 ')).toBe(2.5)
    expect(normalizeTimeout(0.05)).toBe(0.05)
    expect(normalizeTimeout(MAX_REMOTE_TIMEOUT)).toBe(MAX_REMOTE_TIMEOUT)
  })

  test('rejects other values', () => {
    for (const value of ['0', '-1', 'abc', '', '10s', 'Infinity', 0, NaN, null]) {
      expect(() => normalizeTimeout(value)).toThrow('must be a positive number of seconds')
    }
    expect(() => normalizeTimeout(MAX_REMOTE_TIMEOUT + 1, '--remote-timeout')).toThrow(`--remote-timeout must be at most ${MAX_REMOTE_TIMEOUT} seconds`)
  })
})

describe('Remote timeout', () => {
  test('defaults to 10 seconds', () => {
    expect(getRemoteTimeout()).toBe(DEFAULT_REMOTE_TIMEOUT)
    expect(DEFAULT_REMOTE_TIMEOUT).toBe(10)
  })

  test('is taken from the environment', () => {
    vi.stubEnv('IDNITS_REMOTE_TIMEOUT', '2.5')
    expect(getRemoteTimeout()).toBe(2.5)
    vi.stubEnv('IDNITS_REMOTE_TIMEOUT', ' ')
    expect(getRemoteTimeout()).toBe(DEFAULT_REMOTE_TIMEOUT)
  })

  test('rejects an invalid environment variable', () => {
    vi.stubEnv('IDNITS_REMOTE_TIMEOUT', '0')
    expect(() => getRemoteTimeout()).toThrow('IDNITS_REMOTE_TIMEOUT must be a positive number of seconds')
  })

  test('set explicitly takes precedence over the environment, and is validated', () => {
    vi.stubEnv('IDNITS_REMOTE_TIMEOUT', '30')
    setRemoteTimeout('5')
    expect(getRemoteTimeout()).toBe(5)
    setRemoteTimeout(null)
    expect(getRemoteTimeout()).toBe(30)
    expect(() => setRemoteTimeout(-1)).toThrow('Remote timeout must be a positive number of seconds')
  })
})

describe('Remote lookups that time out', () => {
  const stall = () => server.use(http.get(/^https:\/\/(datatracker\.ietf\.org|www\.rfc-editor\.org)\//, async () => {
    await delay(1000)
    return HttpResponse.json({ name: 'late', rev: '99', stream: '/api/v1/name/streamname/ietf/' })
  }))

  test('fail, are shared and warned about once, naming the host', async () => {
    stall()
    setRemoteTimeout(0.05)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const start = Date.now()
    const results = await Promise.all([
      fetchRemoteDocInfo('draft-foo-bar-02'),
      fetchRemoteDocInfo('draft-foo-bar-03')
    ])
    await expect(fetchRemoteDocInfo('draft-foo-bar')).resolves.toBeUndefined()
    expect(Date.now() - start).toBeLessThan(900)
    expect(results).toEqual([undefined, undefined])
    expect(requests).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('Request to datatracker.ietf.org timed out after 0.05 s')
  })

  test('fail for doc.json and RFC Editor lookups too', async () => {
    stall()
    vi.stubEnv('IDNITS_REMOTE_TIMEOUT', '0.05')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(fetchRemoteDocInfoJson('draft-foo-bar')).resolves.toBeUndefined()
    await expect(fetchRemoteRfcInfo(1234)).resolves.toBeUndefined()
    expect(warn.mock.calls).toEqual([
      ['Request to datatracker.ietf.org timed out after 0.05 s'],
      ['Request to www.rfc-editor.org timed out after 0.05 s']
    ])
  })

  test('include reading the response body', async () => {
    // -> A real server sending headers and part of the body, as msw doesn't abort a mocked body
    const stalling = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.write('<html>')
    })
    await new Promise(resolve => stalling.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${stalling.address().port}/doc/downref/`
    server.use(http.get(url, () => passthrough()))
    setRemoteTimeout(0.2)
    try {
      await expect(remoteFetch(url, { type: 'text' })).rejects.toThrow(`Request to 127.0.0.1:${stalling.address().port} timed out after 0.2 s`)
    } finally {
      stalling.closeAllConnections()
      await new Promise(resolve => stalling.close(resolve))
    }
  })

  test('let a submission check complete as when Datatracker does not know the document, saying which checks did not run', async () => {
    const raw = await readFile(new URL('./fixtures/draft-ietf-ippm-ioam-ipv6-options-10.xml', import.meta.url))
    const run = () => checkNits(raw, 'draft-ietf-ippm-ioam-ipv6-options-10.xml', { mode: MODES.SUBMISSION })
    const unknown = await run()
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every(r => r.url.startsWith('https://datatracker.ietf.org/api/v1/doc/document/'))).toBe(true)
    const shouldBe00 = unknown.filter(f => f.name === 'UNEXPECTED_DOC_VERSION' && f.message.includes('should be version 00'))
    expect(shouldBe00).toHaveLength(1)

    clearRemoteCache()
    stall()
    setRemoteTimeout(0.05)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const timedOut = await run()
    const unavailable = timedOut.filter(f => f.name === 'DOCUMENT_LOOKUP_UNAVAILABLE')
    expect(unavailable).toEqual([
      new ValidationComment('DOCUMENT_LOOKUP_UNAVAILABLE', "Datatracker couldn't be asked about draft-ietf-ippm-ioam-ipv6-options (Request to datatracker.ietf.org timed out after 0.05 s), so these checks didn't run: revision, submission type.")
    ])
    expect(timedOut.filter(f => !unavailable.includes(f))).toEqual(unknown.filter(f => !shouldBe00.includes(f)))
    expect(new Set(warn.mock.calls.map(c => c[0]))).toEqual(new Set(['Request to datatracker.ietf.org timed out after 0.05 s']))
    expect(warn.mock.calls.length).toBe(new Set(requests.slice(requests.length / 2).map(r => r.url)).size)
  })
})

describe('Remote lookups answered with an HTTP error', () => {
  test('give null for 404 and 410: the document does not exist', async () => {
    server.use(http.get('https://www.rfc-editor.org/rfc/rfc9999.json', () => new HttpResponse(null, { status: 410 })))
    await expect(remoteFetch('https://www.rfc-editor.org/rfc/rfc8888.json')).resolves.toBeNull()
    await expect(remoteFetch('https://www.rfc-editor.org/rfc/rfc9999.json')).resolves.toBeNull()
    await expect(fetchRemoteRfcInfo(8888)).resolves.toBeNull()
  })

  test('throw for any other status, naming the host and the status once', async () => {
    server.use(http.get('https://www.rfc-editor.org/rfc/rfc8888.json', () => new HttpResponse('down', { status: 503 })))
    await expect(remoteFetch('https://www.rfc-editor.org/rfc/rfc8888.json')).rejects.toThrow(/^Request to www\.rfc-editor\.org failed: HTTP 503$/)
  })

  test('fail the lookup, warning about it, instead of finding nothing', async () => {
    server.use(
      http.get('https://www.rfc-editor.org/rfc/rfc8888.json', () => new HttpResponse('down', { status: 500 })),
      http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-foo-baz/', () => new HttpResponse('down', { status: 502 })),
      http.get('https://datatracker.ietf.org/doc/draft-foo-baz/doc.json', () => new HttpResponse('down', { status: 503 }))
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(fetchRemoteRfcInfo(8888)).resolves.toBeUndefined()
    await expect(fetchRemoteDocInfo('draft-foo-baz-01')).resolves.toBeUndefined()
    await expect(fetchRemoteDocInfoJson('draft-foo-baz')).resolves.toBeUndefined()
    expect(warn.mock.calls).toEqual([
      ['Request to www.rfc-editor.org failed: HTTP 500'],
      ['Request to datatracker.ietf.org failed: HTTP 502'],
      ['Request to datatracker.ietf.org failed: HTTP 503']
    ])
  })
})
