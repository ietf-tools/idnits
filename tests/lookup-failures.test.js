import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { delay, http, HttpResponse } from 'msw'
import { MODES } from '../lib/config/modes.mjs'
import { setRemoteTimeout } from '../lib/config/remote.mjs'
import { ValidationComment } from '../lib/helpers/error.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTxt } from '../lib/parsers/txt.mjs'
import { clearRemoteCache } from '../lib/remote/common.mjs'
import { validateDownrefs, validateInformativeReferences, validateNormativeReferences, validateUnclassifiedReferences } from '../lib/modules/downref.mjs'
import { validateObsoleteUpdateRef, validateVersion } from '../lib/modules/metadata.mjs'
import { validateIprAttribute, validateSubmissionType } from '../lib/modules/xml.mjs'
import { validateStream } from '../lib/modules/txt.mjs'
import { validateLookupFailures } from '../lib/modules/lookups.mjs'
import { txtStreamDraft } from './fixtures/stream-docs.mjs'

const down = () => new HttpResponse('down', { status: 503 })

const server = setupServer(
  http.get('https://www.rfc-editor.org/rfc/rfc2119.json', () => HttpResponse.json({ status: 'BEST CURRENT PRACTICE' })),
  http.get('https://www.rfc-editor.org/rfc/rfc7322.json', () => HttpResponse.json({ status: 'UNKNOWN' })),
  http.get('https://www.rfc-editor.org/rfc/rfc8174.json', down),
  http.get('https://www.rfc-editor.org/rfc/rfc8446.json', down),
  http.get('https://www.rfc-editor.org/rfc/rfc5246.json', down),
  http.get('https://www.rfc-editor.org/rfc/rfc6066.json', () => HttpResponse.error()),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-ietf-foo-failing/', down),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-ietf-foo-known/', () => HttpResponse.json({ name: 'draft-ietf-foo-known', rev: '04', stream: '/api/v1/name/streamname/ietf/' })),
  http.all('*', () => new HttpResponse(null, { status: 404 }))
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  clearRemoteCache()
  setRemoteTimeout(null)
  vi.restoreAllMocks()
})
afterAll(() => server.close())

const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {})
const names = result => result.map(f => f.name)
const messages = result => result.map(f => f.message)
const withCode = (result, code) => result.filter(f => f.name === code)

// -> One check, then the report of failed lookups
const checkAndReport = async (validate, doc, opts) => {
  const findings = await validate(doc, opts)
  const failures = await validateLookupFailures(doc, opts)
  return [...findings, ...failures]
}

const parseRefs = async ({ category = 'std', normative = [], informative = [], attrs = '' } = {}) => {
  const entry = n => `<reference anchor="RFC${n}"><front/><seriesInfo name="RFC" value="${n}"/></reference>`
  const normativeEntries = normative.map(entry).join('')
  const informativeEntries = informative.map(entry).join('')
  const xml = `<rfc version="3" category="${category}" docName="draft-test-references-00"${attrs}><back>
    <references><name>Normative References</name>${normativeEntries}</references>
    <references><name>Informative References</name>${informativeEntries}</references>
  </back></rfc>`
  const { doc } = await parse(xml, 'draft-test-references-00.xml')
  return doc
}

// -> The reference checks, run concurrently as checkNits does, then the report of failed lookups
const checkReferences = async (doc, opts) => {
  const results = await Promise.all([
    validateDownrefs(doc, opts),
    validateNormativeReferences(doc, opts),
    validateInformativeReferences(doc, opts),
    validateUnclassifiedReferences(doc, opts),
    validateObsoleteUpdateRef(doc, opts)
  ])
  const failures = await validateLookupFailures(doc, opts)
  return [...results.flat(), ...failures]
}

describe('REFERENCE_STATUS_UNAVAILABLE', () => {
  const unavailable = message => new ValidationComment('REFERENCE_STATUS_UNAVAILABLE', message)

  test.each(['info', 'std'])('replaces POSSIBLE_DOWNREF and UNDEFINED_STATUS for a %s document citing an RFC whose lookup fails', async (category) => {
    quiet()
    const doc = await parseRefs({ category, normative: ['2119', '8174'] })
    await expect(checkReferences(doc, { mode: MODES.NORMAL })).resolves.toEqual([
      unavailable("The status of RFC 8174 couldn't be fetched from rfc-editor.org (Request to www.rfc-editor.org failed: HTTP 503), so the reference to it wasn't checked for downrefs or obsolete RFCs.")
    ])
  })

  test('is given once, listing the RFCs cited normatively and informatively', async () => {
    quiet()
    const doc = await parseRefs({ normative: ['8446'], informative: ['8174', '2119'] })
    const result = await checkReferences(doc, { mode: MODES.FORGIVE_CHECKLIST })
    expect(result).toEqual([
      unavailable("The status of RFC 8174 and RFC 8446 couldn't be fetched from rfc-editor.org (Request to www.rfc-editor.org failed: HTTP 503), so the references to them weren't checked for downrefs or obsolete RFCs.")
    ])
  })

  test('names each reason when the lookups failed differently', async () => {
    quiet()
    const doc = await parseRefs({ normative: ['8446', '6066'] })
    const result = await checkReferences(doc, { mode: MODES.NORMAL })
    expect(result).toHaveLength(1)
    expect(result[0].message).toBe("The status of RFC 6066 (Request to www.rfc-editor.org failed: Failed to fetch) and RFC 8446 (Request to www.rfc-editor.org failed: HTTP 503) couldn't be fetched from rfc-editor.org, so the references to them weren't checked for downrefs or obsolete RFCs.")
  })

  test('names a timeout', async () => {
    quiet()
    server.use(http.get('https://www.rfc-editor.org/rfc/rfc9999.json', async () => {
      await delay(1000)
      return HttpResponse.json({ status: 'PROPOSED STANDARD' })
    }))
    setRemoteTimeout(0.05)
    const doc = await parseRefs({ normative: ['9999'] })
    const result = await checkReferences(doc, { mode: MODES.NORMAL })
    expect(messages(result)).toEqual([
      "The status of RFC 9999 couldn't be fetched from rfc-editor.org (Request to www.rfc-editor.org timed out after 0.05 s), so the reference to it wasn't checked for downrefs or obsolete RFCs."
    ])
  })

  test('lists the RFCs of the Obsoletes and Updates metadata, without *_RFC_NOT_FOUND', async () => {
    quiet()
    const doc = await parseRefs({ normative: ['8446'], attrs: ' obsoletes="5246" updates="5246, 8174"' })
    const all = await checkReferences(doc, { mode: MODES.NORMAL })
    const result = all.filter(f => f.name.endsWith('_RFC_NOT_FOUND') || f.name === 'REFERENCE_STATUS_UNAVAILABLE')
    expect(result).toEqual([
      unavailable("The status of RFC 5246 (in Obsoletes and Updates), RFC 8174 (in Updates) and RFC 8446 couldn't be fetched from rfc-editor.org (Request to www.rfc-editor.org failed: HTTP 503), so the reference to it wasn't checked for downrefs or obsolete RFCs, and the RFCs this document obsoletes or updates weren't checked against rfc-editor.org.")
    ])
  })

  test('names an Obsoletes or Updates value that is not an RFC number as written', async () => {
    quiet()
    server.use(http.get(/^https:\/\/www\.rfc-editor\.org\/rfc\/rfc(draft|2026-)/, down))
    const doc = await parseRefs({ attrs: ' obsoletes="draft-foo-bar-00" updates="2026-5-29"' })
    const result = await checkReferences(doc, { mode: MODES.NORMAL })
    expect(messages(withCode(result, 'REFERENCE_STATUS_UNAVAILABLE'))).toEqual([
      "The status of \"2026-5-29\" (in Updates) and \"draft-foo-bar-00\" (in Obsoletes) couldn't be fetched from rfc-editor.org (Request to www.rfc-editor.org failed: HTTP 503), so the RFCs this document obsoletes or updates weren't checked against rfc-editor.org."
    ])
  })

  test('is not given for an RFC rfc-editor.org has no record of (404), which UNDEFINED_STATUS reports', async () => {
    const doc = await parseRefs({ normative: ['9999'] })
    const result = await checkReferences(doc, { mode: MODES.NORMAL })
    expect(result).toEqual([
      new ValidationComment('UNDEFINED_STATUS', "RFC 9999 wasn't found on rfc-editor.org.", { ref: 'https://www.rfc-editor.org/info/rfc9999' })
    ])
  })

  test('leaves an RFC of status UNKNOWN to POSSIBLE_DOWNREF', async () => {
    const doc = await parseRefs({ normative: ['7322'] })
    const result = await checkReferences(doc, { mode: MODES.NORMAL })
    expect(names(result).sort()).toEqual(['POSSIBLE_DOWNREF', 'UNKNOWN_STATUS'])
  })

  test('is not given in submission mode', async () => {
    quiet()
    const doc = await parseRefs({ normative: ['8446'], attrs: ' obsoletes="5246"' })
    const result = await checkReferences(doc, { mode: MODES.SUBMISSION })
    expect(result).toEqual([])
  })
})

describe('DOCUMENT_LOOKUP_UNAVAILABLE', () => {
  const parseDraft = async (docName, attrs = '') => {
    const xml = `<rfc version="3" category="std" docName="${docName}"${attrs}><front><title>T</title></front></rfc>`
    const { doc } = await parse(xml, `${docName}.xml`)
    return doc
  }
  const runDatatrackerChecks = async (doc, opts) => {
    const results = await Promise.all([
      validateVersion(doc, opts),
      validateSubmissionType(doc, opts),
      validateIprAttribute(doc, opts)
    ])
    const failures = await validateLookupFailures(doc, opts)
    return [...results.flat(), ...failures]
  }

  test('replaces "should be version 00" in submission mode, naming the reason and the check', async () => {
    quiet()
    const doc = await parseDraft('draft-ietf-foo-failing-05')
    const result = await checkAndReport(validateVersion, doc, { mode: MODES.SUBMISSION })
    expect(result).toEqual([
      new ValidationComment('DOCUMENT_LOOKUP_UNAVAILABLE', "Datatracker couldn't be asked about draft-ietf-foo-failing (Request to datatracker.ietf.org failed: HTTP 503), so this check didn't run: revision.")
    ])
  })

  test('is not given when Datatracker answers that the draft does not exist', async () => {
    const doc = await parseDraft('draft-ietf-foo-missing-05')
    const result = await checkAndReport(validateVersion, doc, { mode: MODES.SUBMISSION })
    expect(names(result)).toEqual(['UNEXPECTED_DOC_VERSION'])
  })

  test('is given once, naming every check that did not run', async () => {
    const warn = quiet()
    const doc = await parseDraft('draft-ietf-foo-failing-05', ' ipr="noModificationTrust200902"')
    const all = await runDatatrackerChecks(doc, { mode: MODES.SUBMISSION })
    expect(withCode(all, 'DOCUMENT_LOOKUP_UNAVAILABLE')).toEqual([
      new ValidationComment('DOCUMENT_LOOKUP_UNAVAILABLE', "Datatracker couldn't be asked about draft-ietf-foo-failing (Request to datatracker.ietf.org failed: HTTP 503), so these checks didn't run: revision, submission type, ipr.")
    ])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('is given in normal mode for the text stream check', async () => {
    quiet()
    const text = txtStreamDraft('draft-ietf-foo-failing-05')
    const doc = await parseTxt(text, 'draft-ietf-foo-failing-05.txt')
    const result = await checkAndReport(validateStream, doc, { mode: MODES.NORMAL })
    expect(messages(result)).toEqual([
      "Datatracker couldn't be asked about draft-ietf-foo-failing (Request to datatracker.ietf.org failed: HTTP 503), so this check didn't run: stream."
    ])
  })

  test('names a cross-stream lookup of an obsoleted RFC that failed', async () => {
    quiet()
    server.use(http.get('https://datatracker.ietf.org/api/v1/doc/document/rfc5246/', down))
    const doc = await parseDraft('draft-ietf-foo-known-05', ' obsoletes="5246"')
    const result = await checkAndReport(validateObsoleteUpdateRef, doc, { mode: MODES.SUBMISSION })
    expect(messages(result)).toEqual([
      "Datatracker couldn't be asked about rfc5246 (Request to datatracker.ietf.org failed: HTTP 503), so this check didn't run: cross-stream."
    ])
  })

  test('is not given when the lookups succeed', async () => {
    const doc = await parseDraft('draft-ietf-foo-known-05', ' ipr="noModificationTrust200902"')
    const result = await runDatatrackerChecks(doc, { mode: MODES.SUBMISSION })
    expect(names(result)).not.toContain('DOCUMENT_LOOKUP_UNAVAILABLE')
  })
})

describe('With --offline', () => {
  test('no DOCUMENT_LOOKUP_UNAVAILABLE, as the document lookups are not attempted', async () => {
    const requests = []
    const listener = ({ request }) => {
      requests.push(request.url)
    }
    server.events.on('request:start', listener)
    const xml = `<rfc version="3" category="std" docName="draft-ietf-foo-failing-05" ipr="noModificationTrust200902" obsoletes="5246"><front><title>T</title></front><back>
      <references><name>Normative References</name></references></back></rfc>`
    const { doc } = await parse(xml, 'draft-ietf-foo-failing-05.xml')
    for (const mode of [MODES.NORMAL, MODES.SUBMISSION]) {
      const opts = { mode, offline: true }
      await Promise.all([
        validateVersion(doc, opts),
        validateSubmissionType(doc, opts),
        validateIprAttribute(doc, opts),
        validateObsoleteUpdateRef(doc, opts)
      ])
      await expect(validateLookupFailures(doc, opts)).resolves.toEqual([])
    }
    expect(requests).toEqual([])
    server.events.removeListener('request:start', listener)
  })

  test('REFERENCE_STATUS_UNAVAILABLE still, as the cited RFCs are still looked up', async () => {
    quiet()
    const doc = await parseRefs({ normative: ['8446'], attrs: ' obsoletes="5246"' })
    const result = await checkReferences(doc, { mode: MODES.NORMAL, offline: true })
    expect(messages(withCode(result, 'REFERENCE_STATUS_UNAVAILABLE'))).toEqual([
      "The status of RFC 8446 couldn't be fetched from rfc-editor.org (Request to www.rfc-editor.org failed: HTTP 503), so the reference to it wasn't checked for downrefs or obsolete RFCs."
    ])
  })
})
