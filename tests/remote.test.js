import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { readFile } from 'node:fs/promises'
import {
  DEFAULT_DATATRACKER_URL,
  DEFAULT_RFCEDITOR_URL,
  getDatatrackerUrl,
  getRfcEditorUrl,
  normalizeBaseUrl,
  setRemoteUrls
} from '../lib/config/remote.mjs'
import {
  fetchRemoteDocInfo,
  fetchRemoteDocInfoJson,
  fetchRemoteRfcInfo,
  getUserAgent
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
  setRemoteUrls()
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
    await expect(fetchRemoteDocInfoJson('draft-foo-bar-03')).resolves.toEqual({ name: 'draft-foo-bar', state: 'Active' })
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

  test('are not made to an invalid service', async () => {
    vi.stubEnv('IDNITS_DATATRACKER_URL', 'datatracker.svc')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(fetchRemoteDocInfo('draft-foo-bar-02')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('IDNITS_DATATRACKER_URL must be'))
    expect(requests).toHaveLength(0)
  })
})
