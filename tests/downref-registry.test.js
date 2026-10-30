import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { delay, http, HttpResponse } from 'msw'
import { MODES } from '../lib/config/modes.mjs'
import { setRemoteTimeout } from '../lib/config/remote.mjs'
import { ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateDownrefs } from '../lib/modules/downref.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { checkNits } from '../lib/index.mjs'
import { clearDownrefRegistryCache, DOWNREF_REGISTRY_FAILURE_TTL } from '../lib/remote/downref.mjs'

const REGISTRY_URL = 'https://datatracker.ietf.org/doc/downref/'
const BCP97_REF = 'https://www.rfc-editor.org/info/bcp97'

const REGISTRY_HTML = `<html><body><table>
<tr><td><a href="/doc/draft-ietf-foo-bar/">draft-ietf-foo-bar</a></td><td><a href="/doc/rfc1094/">RFC 1094</a></td></tr>
</table></body></html>`

let registryRequests = 0
let registryResponse = () => HttpResponse.text(REGISTRY_HTML)

const server = setupServer(
  http.get(REGISTRY_URL, () => {
    registryRequests++
    return registryResponse()
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc1094.json', () => HttpResponse.json({ status: 'INFORMATIONAL' })),
  http.get('https://www.rfc-editor.org/rfc/rfc1234.json', () => HttpResponse.json({ status: 'HISTORIC' })),
  http.get('https://www.rfc-editor.org/rfc/rfc5678.json', () => HttpResponse.json({ status: 'EXPERIMENTAL' })),
  http.all('*', () => new HttpResponse(null, { status: 404 }))
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => {
  clearDownrefRegistryCache()
  registryRequests = 0
  registryResponse = () => HttpResponse.text(REGISTRY_HTML)
})
afterEach(() => {
  server.resetHandlers()
  setRemoteTimeout(null)
  vi.restoreAllMocks()
})
afterAll(() => {
  server.close()
  clearDownrefRegistryCache()
})

const references = (...rfcs) => rfcs.map(rfc => `<reference anchor="RFC${rfc}"><front><title>T</title></front><seriesInfo name="RFC" value="${rfc}"/></reference>`).join('')

/**
 * Proposed Standard XML draft citing the given RFCs normatively
 *
 * @param {...string} rfcs RFC numbers
 * @returns {Promise<Object>} Parsed document
 */
async function parseDraft (...rfcs) {
  const { doc } = await parse(`<rfc version="3" category="std"><back><references><name>Normative References</name>${references(...rfcs)}</references></back></rfc>`, 'draft-test-registry-00.xml')
  return doc
}

const inRegistry = (rfc) => new ValidationWarning('DOWNREF_TO_LOWER_STATUS_IN_REGISTRY', `Reference to RFC ${rfc}, which has a lower status than this draft's intended status and is listed in the Downref Registry.`, { ref: BCP97_REF })
const notInRegistry = (rfc, Severity = ValidationError) => new Severity('DOWNREF_TO_LOWER_STATUS', `Reference to RFC ${rfc}, which has a lower status than this draft's intended status. This reference is not in the Downref Registry.`, { ref: BCP97_REF })
const unchecked = (rfc, Severity = ValidationWarning) => new Severity('DOWNREF_TO_LOWER_STATUS', `Reference to RFC ${rfc}, which has a lower status than this draft's intended status. The Downref Registry couldn't be checked for it.`, { ref: BCP97_REF })
const unavailable = (reason) => new ValidationComment('DOWNREF_REGISTRY_UNAVAILABLE', `The Downref Registry couldn't be checked (${reason}), so downrefs are reported without telling whether they are listed in it.`, { ref: REGISTRY_URL })

describe('Downref Registry', () => {
  test('tells the downrefs listed in it from the others', async () => {
    const doc = await parseDraft('1094', '1234')
    await expect(validateDownrefs(doc, { mode: MODES.NORMAL })).resolves.toEqual([inRegistry('1094'), notInRegistry('1234')])
    await expect(validateDownrefs(await parseDraft('5678'), { mode: MODES.FORGIVE_CHECKLIST })).resolves.toEqual([notInRegistry('5678', ValidationWarning)])
    expect(registryRequests).toBe(1)
  })

  describe.each([
    ['an HTTP error', () => new HttpResponse('Server Error', { status: 500 }), 'Request to datatracker.ietf.org failed: HTTP 500'],
    ['a network error', () => HttpResponse.error(), /^Request to datatracker\.ietf\.org failed: .+/],
    ['a page listing nothing', () => HttpResponse.text('<html><body>Maintenance</body></html>'), 'no documents found in the registry page'],
    ['a timeout', async () => {
      await delay(1000)
      return HttpResponse.text(REGISTRY_HTML)
    }, 'Request to datatracker.ietf.org timed out after 0.05 s']
  ])('that cannot be fetched because of %s', (_, response, reason) => {
    beforeEach(() => {
      registryResponse = response
      if (reason.toString().includes('timed out')) {
        setRemoteTimeout(0.05)
      }
    })

    /**
     * Check the findings of a document, whose registry comment names the reason
     *
     * @param {Array} result Findings
     * @param {Array} expected Findings expected before the comment
     */
    const expectFindings = (result, expected) => {
      expect(result.slice(0, -1)).toEqual(expected)
      const comment = result.at(-1)
      expect(comment).toBeInstanceOf(ValidationComment)
      expect(comment.name).toBe('DOWNREF_REGISTRY_UNAVAILABLE')
      if (typeof reason === 'string') {
        expect(comment).toEqual(unavailable(reason))
      } else {
        expect(comment.message).toMatch(/^The Downref Registry couldn't be checked \(Request to datatracker\.ietf\.org failed: .+\), so downrefs are reported without telling whether they are listed in it\.$/)
      }
    }

    test('reports downrefs without the registry and comments once, in normal and forgive-checklist modes', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const doc = await parseDraft('1094', '1234')
      // -> A Warning in both modes: the downref may be registered
      expectFindings(await validateDownrefs(doc, { mode: MODES.NORMAL }), [unchecked('1094'), unchecked('1234')])
      expectFindings(await validateDownrefs(await parseDraft('5678'), { mode: MODES.FORGIVE_CHECKLIST }), [unchecked('5678')])

      // -> The failure is remembered: fetched, and warned about, once for both documents
      expect(registryRequests).toBe(1)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toMatch(/^Failed to fetch Downref Registry: /)
    })

    test('is not needed without a downref', async () => {
      await expect(validateDownrefs(await parseDraft(), { mode: MODES.NORMAL })).resolves.toEqual([])
      expect(registryRequests).toBe(0)
    })

    test('lets the run complete', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const raw = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<rfc xmlns:xi="http://www.w3.org/2001/XInclude" version="3" category="std" docName="draft-test-registry-00" ipr="trust200902" submissionType="IETF">
  <front><title>Test</title><author fullname="A. Author"/><date year="2026" month="October" day="20"/><abstract><t>Abstract.</t></abstract></front>
  <middle><section><name>Introduction</name><t>See <xref target="RFC1234"/> and <xref target="RFC1094"/>.</t></section></middle>
  <back><references><name>Normative References</name>${references('1094', '1234')}</references></back>
</rfc>`)
      const result = await checkNits(raw, 'draft-test-registry-00.xml', { mode: MODES.NORMAL })
      expect(result.filter(r => r.name === 'DOWNREF_REGISTRY_UNAVAILABLE')).toHaveLength(1)
      expect(result.filter(r => r.name === 'DOWNREF_TO_LOWER_STATUS').map(r => r.message)).toEqual([
        "Reference to RFC 1094, which has a lower status than this draft's intended status. The Downref Registry couldn't be checked for it.",
        "Reference to RFC 1234, which has a lower status than this draft's intended status. The Downref Registry couldn't be checked for it."
      ])
      const downrefs = result.filter(r => r.name === 'DOWNREF_TO_LOWER_STATUS')
      expect(downrefs.every(r => r instanceof ValidationWarning)).toBe(true)
      expect(result.some(r => r.name === 'DOWNREF_TO_LOWER_STATUS_IN_REGISTRY')).toBe(false)
    })
  })

  test('is fetched again once a failure is old enough, and kept once fetched', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    registryResponse = () => new HttpResponse(null, { status: 503 })
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    await validateDownrefs(await parseDraft('1094'), { mode: MODES.NORMAL })
    clock.mockReturnValue(now + DOWNREF_REGISTRY_FAILURE_TTL - 1)
    await validateDownrefs(await parseDraft('1094'), { mode: MODES.NORMAL })
    expect(registryRequests).toBe(1)

    registryResponse = () => HttpResponse.text(REGISTRY_HTML)
    clock.mockReturnValue(now + DOWNREF_REGISTRY_FAILURE_TTL)
    await expect(validateDownrefs(await parseDraft('1094'), { mode: MODES.NORMAL })).resolves.toEqual([inRegistry('1094')])
    expect(registryRequests).toBe(2)

    registryResponse = () => new HttpResponse(null, { status: 503 })
    clock.mockReturnValue(now + 10 * DOWNREF_REGISTRY_FAILURE_TTL)
    await expect(validateDownrefs(await parseDraft('1094'), { mode: MODES.NORMAL })).resolves.toEqual([inRegistry('1094')])
    expect(registryRequests).toBe(2)
  })

  test('checks running at once share one request', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    registryResponse = async () => {
      await delay(20)
      return new HttpResponse(null, { status: 500 })
    }
    const results = await Promise.all([parseDraft('1094'), parseDraft('1234')].map(async doc => validateDownrefs(await doc, { mode: MODES.NORMAL })))
    expect(results.map(r => r.map(f => f.name))).toEqual([
      ['DOWNREF_TO_LOWER_STATUS', 'DOWNREF_REGISTRY_UNAVAILABLE'],
      ['DOWNREF_TO_LOWER_STATUS', 'DOWNREF_REGISTRY_UNAVAILABLE']
    ])
    expect(registryRequests).toBe(1)
  })
})
