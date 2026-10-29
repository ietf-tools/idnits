import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { delay, http, HttpResponse } from 'msw'
import { MODES } from '../lib/config/modes.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTxt } from '../lib/parsers/txt.mjs'
import { clearRemoteCache } from '../lib/remote/common.mjs'
import { MAX_CONCURRENT_LOOKUPS_PER_DOC, MAX_LOOKUPS_PER_DOC } from '../lib/remote/lookups.mjs'
import { validateDownrefs, validateInformativeReferences, validateNormativeReferences, validatePublishedDraftReferences, validateReferenceForStale, validateUnclassifiedReferences } from '../lib/modules/downref.mjs'
import { validateObsoleteUpdateRef, validateVersion } from '../lib/modules/metadata.mjs'
import { validateLookupFailures } from '../lib/modules/lookups.mjs'
import { checkNits } from '../lib/index.mjs'

// -> RFCs below 9000 exist (Proposed Standard), drafts are active; failing ones answer 503
const FAILING_RFCS = new Set(['8001', '8002'])
const requests = []
let inFlight = 0
let maxInFlight = 0
let answerDelay = 0

const answer = async (request, body) => {
  requests.push(new URL(request.url).pathname)
  inFlight++
  maxInFlight = Math.max(maxInFlight, inFlight)
  try {
    if (answerDelay > 0) {
      await delay(answerDelay)
    }
    return body()
  } finally {
    inFlight--
  }
}

const server = setupServer(
  http.get('https://www.rfc-editor.org/rfc/:name', ({ request, params }) => answer(request, () => {
    const number = params.name.replace(/^rfc|\.json$/g, '')
    if (FAILING_RFCS.has(number)) {
      return new HttpResponse('down', { status: 503 })
    }
    return HttpResponse.json({ status: 'PROPOSED STANDARD', obsoleted_by: [], updated_by: [] })
  })),
  http.get('https://datatracker.ietf.org/doc/:name/doc.json', ({ request, params }) => answer(request, () => HttpResponse.json({ name: params.name, state: 'Active', rev_history: [{ name: params.name, rev: '00' }] }))),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/:name/', ({ request }) => answer(request, () => new HttpResponse(null, { status: 404 }))),
  http.get('https://datatracker.ietf.org/doc/downref/', ({ request }) => answer(request, () => HttpResponse.text('<html></html>'))),
  http.all('*', () => new HttpResponse(null, { status: 404 }))
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  clearRemoteCache()
  vi.restoreAllMocks()
  requests.length = 0
  maxInFlight = 0
  answerDelay = 0
})
afterAll(() => server.close())

const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {})
const range = (from, count) => Array.from({ length: count }, (_, idx) => String(from + idx))

const parseRefs = async ({ normative = [], informative = [], drafts = [], attrs = '' } = {}) => {
  const entry = n => `<reference anchor="RFC${n}"><front><title>T</title></front><seriesInfo name="RFC" value="${n}"/></reference>`
  const draftEntry = name => `<reference anchor="I-D.${name}"><front><title>T</title></front><seriesInfo name="Internet-Draft" value="${name}-00"/></reference>`
  const { doc } = await parse(`<rfc version="3" category="std" docName="draft-test-limits-00"${attrs}><front><title>T</title></front><back>
    <references><name>Normative References</name>${normative.map(entry).join('')}</references>
    <references><name>Informative References</name>${informative.map(entry).join('')}${drafts.map(draftEntry).join('')}</references>
  </back></rfc>`, 'draft-test-limits-00.xml')
  return doc
}

// -> The checks that look references up, run concurrently as checkNits does, then the report of failed lookups
const checkReferences = async (doc, opts) => {
  const results = await Promise.all([
    validateDownrefs(doc, opts),
    validateNormativeReferences(doc, opts),
    validateInformativeReferences(doc, opts),
    validateUnclassifiedReferences(doc, opts),
    validatePublishedDraftReferences(doc, opts),
    validateReferenceForStale(doc, opts),
    validateObsoleteUpdateRef(doc, opts),
    validateVersion(doc, opts)
  ])
  return [...results.flat(), ...await validateLookupFailures(doc, opts)]
}

describe('Remote lookups of a document', () => {
  test('are made once per name, at most a few at a time', async () => {
    answerDelay = 20
    const doc = await parseRefs({ normative: range(100, 8), informative: [...range(104, 4), ...range(200, 8)], drafts: ['draft-foo-bar', 'draft-foo-baz'], attrs: ' obsoletes="100, 200" updates="201"' })
    const result = await checkReferences(doc, { mode: MODES.NORMAL })
    const rfcRequests = requests.filter(path => path.startsWith('/rfc/'))
    expect(rfcRequests).toHaveLength(16)
    expect(new Set(rfcRequests).size).toBe(16)
    expect(requests.filter(path => path.endsWith('/doc.json')).sort()).toEqual(['/doc/draft-foo-bar/doc.json', '/doc/draft-foo-baz/doc.json'])
    expect(maxInFlight).toBe(MAX_CONCURRENT_LOOKUPS_PER_DOC)
    expect(result.map(f => f.name)).not.toContain('LOOKUP_LIMIT_REACHED')
  })

  test('that fail are reported once, whatever the order they end in', async () => {
    quiet()
    answerDelay = 10
    const doc = await parseRefs({ normative: ['8001', ...range(100, 5)], informative: ['8002', ...range(200, 5)] })
    const result = await checkReferences(doc, { mode: MODES.NORMAL })
    expect(result.filter(f => f.name === 'REFERENCE_STATUS_UNAVAILABLE').map(f => f.message)).toEqual([
      "The status of RFC 8001 and RFC 8002 couldn't be fetched from rfc-editor.org (Request to www.rfc-editor.org failed: HTTP 503), so the references to them weren't checked for downrefs or obsolete RFCs."
    ])
    expect(requests.filter(path => path === '/rfc/rfc8001.json')).toHaveLength(1)
  })

  test(`stop at ${MAX_LOOKUPS_PER_DOC} for a document, which gets one LOOKUP_LIMIT_REACHED`, async () => {
    const doc = await parseRefs({ normative: range(1, MAX_LOOKUPS_PER_DOC - 2), informative: range(MAX_LOOKUPS_PER_DOC - 1, 25), drafts: ['draft-foo-bar'], attrs: ' obsoletes="1, 5000"' })
    const result = await checkReferences(doc, { mode: MODES.NORMAL })
    expect(requests).toHaveLength(MAX_LOOKUPS_PER_DOC)
    // -> The document's own lookups aren't counted
    await validateVersion(doc, { mode: MODES.SUBMISSION })
    expect(requests.at(-1)).toBe('/api/v1/doc/document/draft-test-limits/')
    const limit = result.filter(f => f.name === 'LOOKUP_LIMIT_REACHED')
    expect(limit).toHaveLength(1)
    expect(limit[0].constructor.name).toBe('ValidationComment')
    expect(limit[0].message).toMatch(new RegExp(`^This document needs more than ${MAX_LOOKUPS_PER_DOC} lookups on Datatracker and the RFC Editor site, so only the first ${MAX_LOOKUPS_PER_DOC} were made\\. 27 weren't, `))
    expect(limit[0].message).toMatch(/: RFC \d+(, (RFC \d+|draft-foo-bar)){19} and 7 more\.$/)
    // -> What wasn't looked up gets nothing else: neither a status, nor "not found", nor a failed lookup
    expect(result.map(f => f.name)).not.toContain('REFERENCE_STATUS_UNAVAILABLE')
    expect(result.map(f => f.name)).not.toContain('OBSOLETES_RFC_NOT_FOUND')
    expect(result.map(f => f.name)).not.toContain('UNDEFINED_STATE')
  })

  test('count only names that are looked up', async () => {
    quiet()
    // -> "_x" can't start a component of a draft name: answered as no such draft, without a request
    const unnamed = range(1, 30).map(n => `draft-foo-_x${n}`)
    const doc = await parseRefs({ normative: range(1, MAX_LOOKUPS_PER_DOC - 1), drafts: [...unnamed, 'draft-foo-bar'] })
    const result = await checkReferences(doc, { mode: MODES.NORMAL })
    expect(requests.filter(path => !path.startsWith('/doc/downref'))).toHaveLength(MAX_LOOKUPS_PER_DOC)
    expect(requests).toContain('/doc/draft-foo-bar/doc.json')
    expect(result.map(f => f.name)).not.toContain('LOOKUP_LIMIT_REACHED')
  })

  test('of an RFC in the Obsoletes header line are the lookups of the RFC number', async () => {
    const doc = await parseTxt(`Network Working Group                                           J. Doe
Internet-Draft                                                   Example
Obsoletes: 0821, 0822 (if approved)                         October 2026
Intended status: Standards Track
Expires: 2 April 2027


                                 Title
                          draft-test-limits-00

Abstract

   This document obsoletes RFC 821 and RFC 822.

1.  Normative References

   [RFC821]  Doe, J., "Title", RFC 821, DOI 10.17487/RFC0821, 1982.
`, 'draft-test-limits-00.txt')
    const result = await checkReferences(doc, { mode: MODES.NORMAL })
    expect(requests.filter(path => path.startsWith('/rfc/')).sort()).toEqual(['/rfc/rfc821.json', '/rfc/rfc822.json'])
    expect(result.map(f => f.name)).not.toContain('OBSOLETES_RFC_NOT_FOUND')
  })

  test('of a text document are limited too', async () => {
    const entries = range(1, MAX_LOOKUPS_PER_DOC + 3).map(n => `   [RFC${n}]  Doe, J., "Title", RFC ${n}, DOI 10.17487/RFC${n}, 2000.\n`).join('\n')
    const doc = await parseTxt(`Network Working Group                                           J. Doe
Internet-Draft                                                   Example
Intended status: Standards Track                            October 2026
Expires: 2 April 2027


                                 Title
                          draft-test-limits-00

Abstract

   Abstract.

1.  Normative References

${entries}`, 'draft-test-limits-00.txt')
    const result = await checkReferences(doc, { mode: MODES.NORMAL })
    expect(requests.filter(path => path.startsWith('/rfc/'))).toHaveLength(MAX_LOOKUPS_PER_DOC)
    expect(result.filter(f => f.name === 'LOOKUP_LIMIT_REACHED')).toHaveLength(1)
  })

  test('are limited in a whole run, in every mode', async () => {
    const doc = (n) => `<rfc version="3" category="std" docName="draft-test-limits-00" ipr="trust200902" obsoletes="${range(1, n).join(', ')}"><front><title>T</title><seriesInfo name="Internet-Draft" value="draft-test-limits-00"/></front></rfc>`
    for (const mode of [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]) {
      requests.length = 0
      clearRemoteCache()
      const result = await checkNits(Buffer.from(doc(MAX_LOOKUPS_PER_DOC + 1)), 'draft-test-limits-00.xml', { mode })
      expect(requests.length).toBeLessThanOrEqual(MAX_LOOKUPS_PER_DOC + 2)
      expect(result.filter(f => f.name === 'LOOKUP_LIMIT_REACHED')).toHaveLength(1)
    }
  })
})
