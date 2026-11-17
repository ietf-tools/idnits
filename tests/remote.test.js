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
  normalizeRemoteOptions,
  normalizeTimeout,
  setRemoteTimeout,
  setRemoteUrls
} from '../lib/config/remote.mjs'
import {
  fetchRemoteDocInfo,
  fetchRemoteDocInfoJson,
  fetchRemoteRfcInfo,
  getUserAgent,
  isLookupName,
  lookupRemoteDocInfoJson,
  ownDocLookupName,
  remoteFetch
} from '../lib/remote/common.mjs'
import { checkReferencesInDownrefs } from '../lib/remote/downref.mjs'
import { getDocInfo } from '../lib/remote/lookups.mjs'

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
    await expect(checkReferencesInDownrefs({}, ['RFC 1234', 'RFC 2345'])).resolves.toEqual(['RFC 1234'])
    expect(requests.map(r => r.url)).toEqual([
      'http://datatracker.svc:8000/api/v1/doc/document/draft-foo-bar/',
      'http://datatracker.svc:8000/doc/draft-foo-bar/doc.json',
      'http://rfc-editor.svc/rfc/rfc1234.json',
      'http://datatracker.svc:8000/doc/downref/'
    ])
    expect(requests.every(r => r.userAgent.startsWith('idnits3/'))).toBe(true)
  })

  test('of a document are fetched once for the document being checked, with or without its version', async () => {
    const doc = {}
    const results = await Promise.all([
      getDocInfo(doc, 'draft-foo-bar', 'revision'),
      getDocInfo(doc, 'draft-foo-bar-02', 'revision'),
      getDocInfo(doc, 'draft-foo-bar-03', 'stream')
    ])
    await getDocInfo(doc, 'draft-foo-bar-02', 'revision')
    expect(results).toEqual(Array(3).fill({ name: 'draft-foo-bar', rev: '02' }))
    expect(requests).toHaveLength(1)

    // -> Fetched again for another document
    await getDocInfo({}, 'draft-foo-bar-02', 'revision')
    expect(requests).toHaveLength(2)
  })

  test('that find nothing are shared too', async () => {
    const doc = {}
    await expect(getDocInfo(doc, 'draft-foo-unknown-00', 'revision')).resolves.toBeNull()
    await expect(getDocInfo(doc, 'draft-foo-unknown-01', 'revision')).resolves.toBeNull()
    expect(requests).toHaveLength(1)
  })

  test('go to the services given for the run before the configured ones', async () => {
    setRemoteUrls({ datatracker: 'http://datatracker.example', rfcEditor: 'http://rfc-editor.example' })
    const options = normalizeRemoteOptions({ datatrackerUrl: 'http://datatracker.svc:8000/', rfcEditorUrl: 'http://rfc-editor.svc' })
    await expect(fetchRemoteDocInfo('draft-foo-bar-02', options)).resolves.toEqual({ name: 'draft-foo-bar', rev: '03' })
    await expect(fetchRemoteDocInfoJson('draft-foo-bar', options)).resolves.toEqual({ name: 'draft-foo-bar', state: 'Active' })
    await expect(fetchRemoteRfcInfo(1234, options)).resolves.toEqual({ status: 'INFORMATIONAL' })
    expect(requests.map(r => r.url)).toEqual([
      'http://datatracker.svc:8000/api/v1/doc/document/draft-foo-bar/',
      'http://datatracker.svc:8000/doc/draft-foo-bar/doc.json',
      'http://rfc-editor.svc/rfc/rfc1234.json'
    ])
  })

  test('are not made to an invalid service', async () => {
    vi.stubEnv('IDNITS_DATATRACKER_URL', 'datatracker.svc')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(fetchRemoteDocInfo('draft-foo-bar-02')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('IDNITS_DATATRACKER_URL must be'))
    expect(requests).toHaveLength(0)
  })
})

describe('Lookups of names taken from a document', () => {
  // -> Values a document could hold where a draft name or RFC number is expected
  const HOSTILE = [
    '../../api/v1/person/person/',
    'draft-foo-bar/../../api/v1/person/person',
    'draft-foo-bar/..',
    'x?y',
    'draft-foo-bar?format=xml',
    'draft-foo-bar#frag',
    'a%zz',
    'draft-foo-bar%2F..%2F..',
    'draft-foo-bar%00',
    'draft-foo-bar (work in progress)',
    'draft-foo-bar\n',
    ''
  ]

  test('tell draft and RFC names from anything else', () => {
    for (const name of ['draft-foo-bar', 'draft-ietf-oauth-v2-1', 'draft-3gpp-collaboration', 'draft-odell-8+8', 'draft-ietf-pilc-2.5g3g', 'draft-ietf-oncrpc-rpcsec_gss', 'draft-a..b-c', 'rfc1', 'rfc9000', 'rfc99999']) {
      expect(isLookupName(name), name).toBe(true)
    }
    for (const name of [...HOSTILE, 'draft', 'draft-numbers', 'draft-foo--bar', 'draft-foo-bar-', '-draft-foo-bar', 'draft-Foo-bar', 'draft-.-bar', 'draft-..-bar', 'draft-foo-.bar', 'draft-foo-+bar', 'draft-foo-_bar', '.', '..', 'rfc0', 'rfc0791', 'rfc123456', 'RFC9000', 'rfc', null, undefined, 9000]) {
      expect(isLookupName(name), String(name)).toBe(false)
    }
  })

  test('take the name of the document being checked without extension or revision', () => {
    expect(ownDocLookupName('draft-foo-bar-02')).toBe('draft-foo-bar')
    expect(ownDocLookupName('draft-foo-bar-02.txt')).toBe('draft-foo-bar')
    expect(ownDocLookupName('draft-foo-bar-02.xml')).toBe('draft-foo-bar')
    expect(ownDocLookupName('draft-foo-bar')).toBe('draft-foo-bar')
    expect(ownDocLookupName('rfc9000')).toBe('rfc9000')
  })

  test('are not made for a value that is not a draft or RFC name', async () => {
    setRemoteUrls({ datatracker: 'http://datatracker.svc:8000', rfcEditor: 'http://rfc-editor.svc' })
    for (const value of [...HOSTILE, 'draft-numbers', 'draft-Foo-bar-02']) {
      await expect(fetchRemoteDocInfo(value), value).resolves.toBeNull()
      await expect(fetchRemoteDocInfo(`${value}-02`), value).resolves.toBeNull()
      await expect(fetchRemoteDocInfoJson(value), value).resolves.toBeNull()
      await expect(fetchRemoteRfcInfo(value), value).resolves.toBeNull()
    }
    for (const value of ['0', '0791', '123456', '1234/../../x', '1234?x', '1234#x', '1234%2F', ' 1234', 'RFC1234', '1e3', -1]) {
      await expect(fetchRemoteRfcInfo(value), String(value)).resolves.toBeNull()
      await expect(fetchRemoteDocInfo(`rfc${value}`), String(value)).resolves.toBeNull()
    }
    expect(requests).toEqual([])
  })

  test('request exactly the document named', async () => {
    setRemoteUrls({ datatracker: 'http://datatracker.svc:8000', rfcEditor: 'http://rfc-editor.svc' })
    await fetchRemoteDocInfo('draft-foo-bar-02.txt')
    await fetchRemoteDocInfo('draft-foo-baz-02.xml')
    await fetchRemoteDocInfo('rfc9000')
    await fetchRemoteDocInfoJson('draft-foo-bar')
    await lookupRemoteDocInfoJson('draft-singh-apex-psi-04')
    await fetchRemoteRfcInfo(1234)
    await fetchRemoteRfcInfo('9000')
    expect(requests.map(r => r.url)).toEqual([
      'http://datatracker.svc:8000/api/v1/doc/document/draft-foo-bar/',
      'http://datatracker.svc:8000/api/v1/doc/document/draft-foo-baz/',
      'http://datatracker.svc:8000/api/v1/doc/document/rfc9000/',
      'http://datatracker.svc:8000/doc/draft-foo-bar/doc.json',
      'http://datatracker.svc:8000/doc/draft-singh-apex-psi-04/doc.json',
      'http://rfc-editor.svc/rfc/rfc1234.json',
      'http://rfc-editor.svc/rfc/rfc9000.json'
    ])
  })

  test('encode the name, so "+" is sent as itself and dots stay inside the name', async () => {
    setRemoteUrls({ datatracker: 'http://datatracker.svc:8000' })
    await fetchRemoteDocInfoJson('draft-odell-8+8')
    await fetchRemoteDocInfoJson('draft-ietf-pilc-2.5g3g')
    await fetchRemoteDocInfoJson('draft-a..b-c')
    await fetchRemoteDocInfo('draft-a..b-c-02')
    // -> A bare "." or ".." path segment would leave the path (encodeURIComponent keeps dots), but
    //    a name always starts with draft- or rfc, so no segment is ever one
    await fetchRemoteDocInfoJson('..')
    await fetchRemoteDocInfo('..')
    expect(requests.map(r => r.url)).toEqual([
      'http://datatracker.svc:8000/doc/draft-odell-8%2B8/doc.json',
      'http://datatracker.svc:8000/doc/draft-ietf-pilc-2.5g3g/doc.json',
      'http://datatracker.svc:8000/doc/draft-a..b-c/doc.json',
      'http://datatracker.svc:8000/api/v1/doc/document/draft-a..b-c/'
    ])
  })
})

describe('normalizeRemoteOptions', () => {
  test('checks the options given for a run, leaving out those not given', () => {
    expect(normalizeRemoteOptions()).toEqual({ datatrackerUrl: null, rfcEditorUrl: null, remoteTimeout: null })
    expect(normalizeRemoteOptions({ datatrackerUrl: 'http://datatracker.svc:8000/', rfcEditorUrl: 'http://rfc-editor.svc//', remoteTimeout: '2.5' })).toEqual({
      datatrackerUrl: 'http://datatracker.svc:8000',
      rfcEditorUrl: 'http://rfc-editor.svc',
      remoteTimeout: 2.5
    })
    expect(() => normalizeRemoteOptions({ datatrackerUrl: 'datatracker.svc' })).toThrow('Datatracker URL must be an http(s) URL')
    expect(() => normalizeRemoteOptions({ rfcEditorUrl: 'ftp://rfc-editor.svc' })).toThrow('RFC Editor URL must be an http(s) URL')
    expect(() => normalizeRemoteOptions({ remoteTimeout: 0 })).toThrow('Remote timeout must be a positive number of seconds')
  })

  test('take precedence over the process-wide settings', () => {
    vi.stubEnv('IDNITS_REMOTE_TIMEOUT', '30')
    setRemoteUrls({ datatracker: 'http://datatracker.example', rfcEditor: 'http://rfc-editor.example' })
    setRemoteTimeout(5)
    const options = normalizeRemoteOptions({ datatrackerUrl: 'http://datatracker.svc:8000', rfcEditorUrl: 'http://rfc-editor.svc', remoteTimeout: 1 })
    expect(getDatatrackerUrl(options)).toBe('http://datatracker.svc:8000')
    expect(getRfcEditorUrl(options)).toBe('http://rfc-editor.svc')
    expect(getRemoteTimeout(options)).toBe(1)
    const none = normalizeRemoteOptions()
    expect(getDatatrackerUrl(none)).toBe('http://datatracker.example')
    expect(getRfcEditorUrl(none)).toBe('http://rfc-editor.example')
    expect(getRemoteTimeout(none)).toBe(5)
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
    const doc = {}
    const results = await Promise.all([
      getDocInfo(doc, 'draft-foo-bar-02', 'revision'),
      getDocInfo(doc, 'draft-foo-bar-03', 'stream')
    ])
    await expect(getDocInfo(doc, 'draft-foo-bar', 'revision')).resolves.toBeUndefined()
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

describe('Runs in the same process', () => {
  const draft = (name) => Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<rfc version="3" category="std" docName="${name}" ipr="trust200902" submissionType="IETF">
  <front><title>Test</title><author fullname="A. Author"/><date year="2026" month="October" day="20"/><abstract><t>Abstract.</t></abstract></front>
  <middle><section><name>Introduction</name><t>See <xref target="RFC1234"/>.</t></section></middle>
  <back><references><name>Normative References</name><reference anchor="RFC1234"><front><title>T</title></front><seriesInfo name="RFC" value="1234"/></reference></references></back>
</rfc>`)

  test('do not reuse a lookup that failed in an earlier run', async () => {
    const raw = await readFile(new URL('./fixtures/draft-ietf-ippm-ioam-ipv6-options-10.xml', import.meta.url))
    const run = () => checkNits(raw, 'draft-ietf-ippm-ioam-ipv6-options-10.xml', { mode: MODES.SUBMISSION })
    const ownLookup = 'https://datatracker.ietf.org/api/v1/doc/document/draft-ietf-ippm-ioam-ipv6-options/'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    server.use(http.get(ownLookup, () => new HttpResponse('down', { status: 503 })))
    const failed = await run()
    expect(failed.filter(f => f.name === 'DOCUMENT_LOOKUP_UNAVAILABLE')).toHaveLength(1)

    server.resetHandlers()
    const answered = await run()
    expect(answered.filter(f => f.name === 'DOCUMENT_LOOKUP_UNAVAILABLE')).toEqual([])
    expect(requests.filter(r => r.url === ownLookup)).toHaveLength(2)
  })

  test('running at once each use their own services, timeout and lookups', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const slowRegistry = async () => {
      await delay(100)
      return HttpResponse.text('<a href="/doc/rfc1234/">RFC 1234</a>')
    }
    server.use(
      http.get('http://rfc-editor-a.example/rfc/rfc1234.json', () => HttpResponse.json({ status: 'INFORMATIONAL' })),
      http.get('http://rfc-editor-b.example/rfc/rfc1234.json', () => HttpResponse.json({ status: 'INFORMATIONAL' })),
      http.get('http://datatracker-a.example/doc/downref/', slowRegistry),
      http.get('http://datatracker-b.example/doc/downref/', slowRegistry)
    )
    const [a, b] = await Promise.all([
      checkNits(draft('draft-test-run-a-00'), 'draft-test-run-a-00.xml', {
        datatrackerUrl: 'http://datatracker-a.example',
        rfcEditorUrl: 'http://rfc-editor-a.example'
      }),
      checkNits(draft('draft-test-run-b-00'), 'draft-test-run-b-00.xml', {
        datatrackerUrl: 'http://datatracker-b.example/',
        rfcEditorUrl: 'http://rfc-editor-b.example',
        remoteTimeout: 0.05
      })
    ])
    const downrefs = (result) => result.filter(f => f.name.startsWith('DOWNREF_')).map(f => f.name)
    expect(downrefs(a)).toEqual(['DOWNREF_TO_LOWER_STATUS_IN_REGISTRY'])
    expect(downrefs(b)).toEqual(['DOWNREF_TO_LOWER_STATUS_UNCHECKED', 'DOWNREF_REGISTRY_UNAVAILABLE'])
    expect(b.find(f => f.name === 'DOWNREF_REGISTRY_UNAVAILABLE').message).toContain('Request to datatracker-b.example timed out after 0.05 s')

    const hosts = (run) => new Set(requests.filter(r => r.url.includes(`-${run}.example/`)).map(r => new URL(r.url).host))
    expect(hosts('a')).toEqual(new Set(['datatracker-a.example', 'rfc-editor-a.example']))
    expect(hosts('b')).toEqual(new Set(['datatracker-b.example', 'rfc-editor-b.example']))
    expect(requests.every(r => /-[ab]\.example\//.test(r.url))).toBe(true)
    expect(requests.filter(r => r.url.endsWith('/rfc/rfc1234.json'))).toHaveLength(2)
    expect(requests.filter(r => r.url.endsWith('/doc/downref/'))).toHaveLength(2)
  })

  test('reject an invalid option before checking anything', async () => {
    const onProgress = vi.fn()
    await expect(checkNits(draft('draft-test-run-a-00'), 'draft-test-run-a-00.xml', { datatrackerUrl: 'datatracker.example', onProgress })).rejects.toThrow('Datatracker URL must be an http(s) URL')
    await expect(checkNits(draft('draft-test-run-a-00'), 'draft-test-run-a-00.xml', { remoteTimeout: -1, onProgress })).rejects.toThrow('Remote timeout must be a positive number of seconds')
    expect(onProgress).not.toHaveBeenCalled()
    expect(requests).toEqual([])
  })
})
