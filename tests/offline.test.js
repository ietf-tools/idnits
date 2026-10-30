import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { setupServer } from 'msw/node'
import { checkNits } from '../lib/index.mjs'
import { MODES } from '../lib/config/modes.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTxt } from '../lib/parsers/txt.mjs'
import { clearRemoteCache } from '../lib/remote/common.mjs'
import { clearDownrefRegistryCache } from '../lib/remote/downref.mjs'
import {
  validateDownrefs,
  validateInformativeReferences,
  validateNormativeReferences,
  validatePublishedDraftReferences,
  validateReferenceForStale,
  validateUnclassifiedReferences
} from '../lib/modules/downref.mjs'
import { validateLookupFailures } from '../lib/modules/lookups.mjs'

// -> --offline means no network access: no handler, so any request is an error, and fetch
//    itself is replaced by one that fails the test
const server = setupServer()
const requests = []
const onRequest = ({ request }) => { requests.push(request.url) }
let fetchSpy

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  server.events.on('request:start', onRequest)
})
beforeEach(() => {
  requests.length = 0
  clearRemoteCache()
  clearDownrefRegistryCache()
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    throw new Error(`Unexpected request with offline: ${url}`)
  })
})
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(requests).toEqual([])
  vi.restoreAllMocks()
})
afterAll(() => {
  server.events.removeListener('request:start', onRequest)
  server.close()
})

const FIXTURES = [
  'draft-beep-boop.txt',
  'draft-ietf-idr-rt-derived-community-00.txt',
  'draft-ietf-idr-rt-derived-community-00.xml',
  'draft-ietf-ippm-ioam-ipv6-options-10.xml',
  'draft-ietf-uuidrev-rfc4122bis-11.xml',
  'draft-template-standard.xml'
]
const MODE_NAMES = { normal: MODES.NORMAL, 'forgive-checklist': MODES.FORGIVE_CHECKLIST, submission: MODES.SUBMISSION }
const UNAVAILABLE = ['REFERENCE_STATUS_UNAVAILABLE', 'DOCUMENT_LOOKUP_UNAVAILABLE', 'DOWNREF_REGISTRY_UNAVAILABLE']

describe('checkNits with offline', () => {
  test.each(FIXTURES.flatMap(file => Object.keys(MODE_NAMES).map(mode => [file, mode])))('makes no request: %s, %s mode', async (file, mode) => {
    const raw = await readFile(new URL(`./fixtures/${file}`, import.meta.url))
    const result = await checkNits(raw, file, { mode: MODE_NAMES[mode], offline: true })
    // -> Skipped lookups aren't failures
    expect(result.filter(f => UNAVAILABLE.includes(f.name))).toEqual([])
  })
})

const XML_REFS = `<rfc version="3" category="std" docName="draft-test-offline-00" obsoletes="5246" updates="8446"><back>
  <references><name>Normative References</name>
    <reference anchor="RFC1234"><front/><seriesInfo name="RFC" value="1234"/></reference>
    <reference anchor="I-D.ietf-foo-bar"><front/><seriesInfo name="Internet-Draft" value="draft-ietf-foo-bar-02"/></reference>
    <reference anchor="FIPS203"><front><title>ML-KEM</title></front></reference>
  </references>
  <references><name>Informative References</name>
    <reference anchor="RFC2616"><front/><seriesInfo name="RFC" value="2616"/></reference>
    <reference anchor="I-D.ietf-foo-baz"><front/><seriesInfo name="Internet-Draft" value="draft-ietf-foo-baz-01"/></reference>
  </references>
</back></rfc>`

const TXT_REFS = `Internet-Draft                                              A. Author
Intended status: Standards Track                                 Example
Expires: April 1, 2027                                   October 1, 2026


                          Offline Test Document
                        draft-test-offline-00

1.  Normative References

   [RFC1234]  Author, A., "Title", RFC 1234, DOI 10.17487/RFC1234,
              May 1991, <https://www.rfc-editor.org/info/rfc1234>.

   [I-D.ietf-foo-bar]
              Author, A., "Foo", Work in Progress, Internet-Draft,
              draft-ietf-foo-bar-02, 1 January 2026,
              <https://datatracker.ietf.org/doc/html/draft-ietf-foo-bar-02>.

2.  Informative References

   [RFC2616]  Author, A., "Title", RFC 2616, DOI 10.17487/RFC2616,
              June 1999, <https://www.rfc-editor.org/info/rfc2616>.
`

const docs = {
  xml: async () => (await parse(XML_REFS, 'draft-test-offline-00.xml')).doc,
  txt: () => parseTxt(TXT_REFS, 'draft-test-offline-00.txt')
}

describe.each(['xml', 'txt'])('Reference checks with offline (%s)', (type) => {
  test.each([
    ['validateNormativeReferences', validateNormativeReferences],
    ['validateInformativeReferences', validateInformativeReferences],
    ['validateUnclassifiedReferences', validateUnclassifiedReferences],
    ['validatePublishedDraftReferences', validatePublishedDraftReferences],
    ['validateReferenceForStale', validateReferenceForStale]
  ])('%s looks nothing up and reports nothing', async (name, validate) => {
    await expect(validate(await docs[type](), { mode: MODES.NORMAL, offline: true })).resolves.toEqual([])
  })

  test('validateDownrefs only reports what needs no lookup', async () => {
    const result = await validateDownrefs(await docs[type](), { mode: MODES.NORMAL, offline: true })
    expect(result.map(f => f.name).sort()).toEqual(type === 'xml'
      ? ['NORMATIVE_REFERENCE_EXTERNAL', 'NORMATIVE_REFERENCE_TO_DRAFT']
      : ['NORMATIVE_REFERENCE_TO_DRAFT'])
    expect(result.find(f => f.name === 'NORMATIVE_REFERENCE_TO_DRAFT').message).toBe('Normative reference to the Internet-Draft draft-ietf-foo-bar-02. A document is not published as an RFC before the drafts it references normatively.')
  })
})

describe('LOOKUPS_SKIPPED_OFFLINE', () => {
  const skipped = result => result.filter(f => f.name === 'LOOKUPS_SKIPPED_OFFLINE')
  const message = checks => `With --offline, nothing was looked up on Datatracker or the RFC Editor site, so ${checks.length > 1 ? 'these checks' : 'this check'} didn't run: ${checks.join('; ')}.`
  const REFS = 'status and obsolescence of the cited RFCs'
  const DOWNREFS = 'downrefs (including the Downref Registry)'
  const DRAFTS = 'states of the cited drafts (newer revisions, replacement, publication as an RFC)'
  const LISTED = 'status of the RFCs this document obsoletes or updates'
  const CROSS = 'streams of the RFCs this document obsoletes or updates'
  const REVISION = "this document's revision on Datatracker"
  const STREAM = "this document's stream on Datatracker"
  const SUBMISSION_TYPE = "this document's stream on Datatracker, against its submissionType"
  const IPR = "this document's stream on Datatracker, for its ipr value"

  test.each([
    ['normal', [REFS, DOWNREFS, DRAFTS, LISTED, CROSS, SUBMISSION_TYPE]],
    ['forgive-checklist', [REFS, DOWNREFS, DRAFTS, LISTED, CROSS, SUBMISSION_TYPE]],
    ['submission', [CROSS, REVISION, SUBMISSION_TYPE]]
  ])('is given once, naming the checks of %s mode that would have looked something up (XML)', async (mode, checks) => {
    const result = await checkNits(Buffer.from(XML_REFS), 'draft-test-offline-00.xml', { mode: MODE_NAMES[mode], offline: true })
    expect(skipped(result).map(f => f.message)).toEqual([message(checks)])
    expect(result.filter(f => UNAVAILABLE.includes(f.name))).toEqual([])
  })

  test('names the stream and ipr lookups when they apply', async () => {
    const xml = '<rfc version="3" category="info" docName="draft-ietf-foo-bar-03" ipr="noDerivativesTrust200902" submissionType="IETF"><front><title>T</title></front></rfc>'
    const result = await checkNits(Buffer.from(xml), 'draft-ietf-foo-bar-03.xml', { mode: MODES.SUBMISSION, offline: true })
    expect(skipped(result).map(f => f.message)).toEqual([message([REVISION, SUBMISSION_TYPE, IPR])])
  })

  test.each(['normal', 'submission'])('names the stream lookup of a text draft named draft-ietf-... (%s)', async (mode) => {
    const raw = await readFile(new URL('./fixtures/draft-ietf-idr-rt-derived-community-00.txt', import.meta.url))
    const [finding] = skipped(await checkNits(raw, 'draft-ietf-idr-rt-derived-community-00.txt', { mode: MODE_NAMES[mode], offline: true }))
    expect(finding.message).toContain(STREAM)
    expect(finding.message.includes(REVISION)).toBe(mode === 'submission')
    expect(finding.message.includes(REFS)).toBe(mode === 'normal')
  })

  test.each(Object.keys(MODE_NAMES))('is not given for a document that cites nothing and whose own lookups don\'t apply (%s)', async (mode) => {
    const xml = '<rfc version="3" category="info" submissionType="independent"><front><title>T</title></front><middle><section><name>Intro</name><t>Text.</t></section></middle></rfc>'
    await expect(checkNits(Buffer.from(xml), 'draft-test-nothing.xml', { mode: MODE_NAMES[mode], offline: true }).then(skipped)).resolves.toEqual([])
  })

  test('is not given without offline', async () => {
    const doc = await docs.xml()
    await validateDownrefs(doc, { mode: MODES.NORMAL, offline: true })
    await expect(validateLookupFailures(doc, { mode: MODES.NORMAL })).resolves.toEqual([])
    await expect(validateLookupFailures(doc, { mode: MODES.NORMAL, offline: true }).then(r => r.map(f => f.name))).resolves.toEqual(['LOOKUPS_SKIPPED_OFFLINE'])
  })
})
