import { beforeAll, afterEach, afterAll, describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationWarning, ValidationError, ValidationComment } from '../lib/helpers/error.mjs'
import { baseXMLDoc, baseTXTDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
import { CANONICAL_TXT } from './generators/doc-txt.js'
import { validateDownrefs, validateInformativeReferences, validateNormativeReferences, validateUnclassifiedReferences, validatePublishedDraftReferences, validateReferenceForStale } from '../lib/modules/downref.mjs'
import { getAllValidations } from '../lib/index.mjs'
import { setupServer } from 'msw/node'
import { http, HttpResponse, passthrough } from 'msw'

expect.extend({
  toContainError
})

export const mockRestHandlers = [
  http.get('https://www.rfc-editor.org/rfc/rfc1094.json', () => {
    return HttpResponse.json({ status: 'INFORMATIONAL' })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc1234.json', () => {
    return HttpResponse.json({ status: 'HISTORIC' })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc2119.json', () => {
    return HttpResponse.json({ status: 'BEST CURRENT PRACTICE' })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc3901.json', () => {
    return HttpResponse.json({ status: 'Best Current Practice', obsoleted_by: ['RFC10001'] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc4086.json', () => {
    return HttpResponse.json({})
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc4087.json', () => {
    return HttpResponse.json({ status: 'Proposed Standard', obsoleted_by: ['RFC9000'] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc4088.json', () => {
    return HttpResponse.json({ status: 'Proposed Standard', obsoleted_by: [] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc4090.json', () => {
    return HttpResponse.json({ status: 'Proposed Standard', obsoleted_by: [] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc4187.json', () => {
    return HttpResponse.json({ status: 'Informational', updated_by: ['RFC5448', 'RFC9048'] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc5086.json', () => {
    return HttpResponse.json({ status: 'Informational', obsoleted_by: [] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc5087.json', () => {
    return HttpResponse.json({ status: 'Informational', obsoleted_by: ['RFC9000', '9001'] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc5678.json', () => {
    return HttpResponse.json({ obsoleted_by: [] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc7655.json', () => {
    return HttpResponse.json({ status: 'Proposed Standard' })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc8141.json', () => {
    return HttpResponse.json({ status: 'Unknown Status', obsoleted_by: [] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc8142.json', () => {
    return HttpResponse.json({ status: 'Proposed Standard' })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc8174.json', () => {
    return HttpResponse.json({ status: 'Best Current Practice' })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc8888.json', () => {
    return HttpResponse.json({ status: 'Proposed Standard' })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc9000.json', () => {
    return HttpResponse.json({ status: 'Proposed Standard', obsoleted_by: [] })
  }),
  http.get('https://www.rfc-editor.org/rfc/rfc9114.json', () => {
    return HttpResponse.json({ status: 'Proposed Standard' })
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ietf-emu-aka-pfs/doc.json', () => {
    return HttpResponse.json({
      intended_std_level: 'Proposed Standard'
    })
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ietf-example/doc.json', () => {
    return HttpResponse.json({ state: 'Active' })
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ietf-example2/doc.json', () => {
    return HttpResponse.json({
      rev_history: [
        { rev: '01' },
        { rev: '02' },
        { rev: '03' }
      ]
    })
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ietf-undefined-state/doc.json', () => {
    return HttpResponse.json({})
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ietf-missing/doc.json', () => {
    return HttpResponse.json({})
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ietf-stale/doc.json', () => {
    return HttpResponse.json({
      rev_history: [
        { rev: '01', name: 'draft-ietf-stale', published: '2025-01-31T12:51:10.280331+00:00' },
        { rev: '02', name: 'draft-ietf-newer', published: '2025-02-31T12:51:10.280331+00:00' },
        { rev: '03', name: 'draft-ietf-newer', published: '2025-03-31T12:51:10.280331+00:00' }
      ]
    })
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ietf-bess-rfc7432bis/doc.json', () => {
    return HttpResponse.json({
      state: 'Active',
      rev_history: [
        { rev: '10', name: 'draft-ietf-bess-rfc7432bis', published: '2024-07-01T12:00:00+00:00' },
        { rev: '13', name: 'draft-ietf-bess-rfc7432bis', published: '2025-06-25T01:52:50+00:00' },
        { rev: '14', name: 'draft-ietf-bess-rfc7432bis', published: '2026-03-02T17:54:00+00:00' }
      ]
    })
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ldbc-cats-framework/doc.json', () => {
    return HttpResponse.json({
      state: 'Replaced',
      rev_history: [
        { rev: '06', name: 'draft-ldbc-cats-framework', published: '2024-01-01T12:00:00+00:00' },
        { rev: '00', name: 'draft-ldbc-cats-framework-merged', published: '2024-03-01T12:00:00+00:00' },
        { rev: '00', name: 'draft-ietf-cats-framework', published: '2024-06-01T12:00:00+00:00' },
        { rev: '10', name: 'draft-ietf-cats-framework', published: '2025-06-01T12:00:00+00:00' }
      ]
    })
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ldbc-cats-replaced-rfc/doc.json', () => {
    return HttpResponse.json({
      state: 'Replaced',
      rev_history: [
        { rev: '06', name: 'draft-ldbc-cats-replaced-rfc', published: '2024-01-01T12:00:00+00:00' },
        { rev: '24', name: 'draft-ietf-cats-replacement', published: '2026-04-02T14:05:54+00:00' },
        { rev: 'rfc10053', name: 'rfc10053', published: '2026-10-06T21:50:52+00:00' }
      ]
    })
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ietf-quic-transport/doc.json', () => {
    return HttpResponse.json({
      state: 'RFC',
      rev_history: [
        { rev: '34', name: 'draft-ietf-quic-transport', published: '2021-01-15T03:14:41+00:00' },
        { rev: 'rfc9000', name: 'rfc9000', published: '2021-05-27T21:39:03+00:00' }
      ]
    })
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ietf-rtgwg-segment-routing-ti-lfa/doc.json', () => {
    return HttpResponse.json({})
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ietf-published-as-rfc/doc.json', () => {
    return HttpResponse.json({ state: 'RFC' })
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ietf-info-intended/doc.json', () => {
    return HttpResponse.json({
      state: 'Active',
      intended_std_level: 'Informational',
      rev_history: [{ rev: '02', name: 'draft-ietf-info-intended', published: '2026-01-01T12:00:00+00:00' }]
    })
  }),
  http.get('https://datatracker.ietf.org/doc/draft-iana-ianabis-rfc8126bis/doc.json', () => {
    return HttpResponse.json({
      state: 'Replaced',
      intended_std_level: null,
      rev_history: [
        { rev: '00', name: 'draft-iana-ianabis-rfc8126bis', published: '2025-02-27T21:45:32+00:00' },
        { rev: '00', name: 'draft-ietf-ianabis-rfc8126bis', published: '2025-08-01T12:00:00+00:00' },
        { rev: '03', name: 'draft-ietf-ianabis-rfc8126bis', published: '2026-07-06T21:46:23+00:00' }
      ]
    })
  }),
  // -> draft-chain-a was replaced by draft-chain-b, itself replaced by draft-chain-c
  ...['draft-chain-a', 'draft-chain-b', 'draft-chain-c'].map((name, idx) => http.get(`https://datatracker.ietf.org/doc/${name}/doc.json`, () => {
    return HttpResponse.json({
      state: idx < 2 ? 'Replaced' : 'Active',
      intended_std_level: idx < 2 ? 'Proposed Standard' : 'Informational',
      rev_history: [
        { rev: '03', name: 'draft-chain-a', published: '2024-01-01T12:00:00+00:00' },
        { rev: '00', name: 'draft-chain-b', published: '2024-06-01T12:00:00+00:00' },
        { rev: '00', name: 'draft-chain-c', published: '2025-01-01T12:00:00+00:00' },
        { rev: '04', name: 'draft-chain-c', published: '2026-01-01T12:00:00+00:00' }
      ]
    })
  })),
  // -> draft-chain-hist was replaced by draft-chain-hist-wg, published as RFC 1234 (Historic)
  ...['draft-chain-hist', 'draft-chain-hist-wg'].map((name, idx) => http.get(`https://datatracker.ietf.org/doc/${name}/doc.json`, () => {
    return HttpResponse.json({
      state: idx === 0 ? 'Replaced' : 'RFC',
      intended_std_level: 'Historic',
      rev_history: [
        { rev: '02', name: 'draft-chain-hist', published: '2024-01-01T12:00:00+00:00' },
        { rev: '05', name: 'draft-chain-hist-wg', published: '2025-01-01T12:00:00+00:00' },
        { rev: 'rfc1234', name: 'rfc1234', published: '2026-01-01T12:00:00+00:00' }
      ]
    })
  })),
  // -> Published as RFC 4087, which is obsolete
  http.get('https://datatracker.ietf.org/doc/draft-ietf-obsolete-rfc/doc.json', () => {
    return HttpResponse.json({
      state: 'RFC',
      intended_std_level: 'Proposed Standard',
      std_level: 'Proposed Standard',
      rev_history: [
        { rev: '07', name: 'draft-ietf-obsolete-rfc', published: '2005-01-01T12:00:00+00:00' },
        { rev: 'rfc4087', name: 'rfc4087', published: '2005-06-01T12:00:00+00:00' }
      ]
    })
  }),
  // -> Each replaced by the other
  ...['draft-cycle-a', 'draft-cycle-b'].map((name, idx) => http.get(`https://datatracker.ietf.org/doc/${name}/doc.json`, () => {
    return HttpResponse.json({
      state: 'Replaced',
      intended_std_level: 'Informational',
      rev_history: idx === 0
        ? [{ rev: '00', name: 'draft-cycle-a' }, { rev: '00', name: 'draft-cycle-b' }]
        : [{ rev: '00', name: 'draft-cycle-b' }, { rev: '01', name: 'draft-cycle-a' }]
    })
  })),
  // -> draft-long-N replaced by draft-long-(N+1), endlessly
  http.get(/^https:\/\/datatracker\.ietf\.org\/doc\/draft-long-\d+\/doc\.json$/, ({ request }) => {
    const idx = Number(request.url.match(/draft-long-(\d+)/)[1])
    return HttpResponse.json({
      state: 'Replaced',
      intended_std_level: 'Informational',
      rev_history: [{ rev: '00', name: `draft-long-${idx}` }, { rev: '00', name: `draft-long-${idx + 1}` }]
    })
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ietf-bess-evpn-ipvpn-interworking/doc.json', () => {
    return HttpResponse.json({
      state: 'Active',
      intended_std_level: null,
      rev_history: [{ rev: '13', name: 'draft-ietf-bess-evpn-ipvpn-interworking', published: '2025-02-04T12:00:00+00:00' }]
    })
  }),
  http.get('https://datatracker.ietf.org/doc/draft-ietf-ianabis-rfc8126bis/doc.json', () => {
    return HttpResponse.json({
      state: 'Active',
      intended_std_level: 'Best Current Practice',
      rev_history: [
        { rev: '00', name: 'draft-iana-ianabis-rfc8126bis', published: '2025-02-27T21:45:32+00:00' },
        { rev: '00', name: 'draft-ietf-ianabis-rfc8126bis', published: '2025-08-01T12:00:00+00:00' },
        { rev: '03', name: 'draft-ietf-ianabis-rfc8126bis', published: '2026-07-06T21:46:23+00:00' }
      ]
    })
  }),
  http.get('https://datatracker.ietf.org/doc/downref/', () => {
    return passthrough()
  }),
  http.all('*', async ({ request }) => {
    return new HttpResponse(null, { status: 404 })
  })
]

const server = setupServer(...mockRestHandlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

/**
 * Parse an XML draft with the given <back> content
 *
 * @param {string} back Content of the <back> element
 * @returns {Promise<Object>} Parsed document
 */
async function parseXMLBack (back) {
  const { doc } = await parse(`<rfc version="3" category="std"><back>${back}</back></rfc>`, 'draft-test-references-00.xml')
  return doc
}

/**
 * Wrap <reference> entries in a single <references> section nested in a References wrapper
 *
 * @param {string} name Name of the inner <references> section
 * @param {string} entries <reference> entries
 * @returns {string} XML
 */
function nestedReferences (name, entries) {
  return `<references><name>References</name><references><name>${name}</name>${entries}</references></references>`
}

/**
 * Parse a v2 XML draft, as written by hand or by kramdown-rfc, with the given
 * DOCTYPE internal subset and <back> content
 *
 * @param {string} entities Entity declarations of the internal subset
 * @param {string} back Content of the <back> element
 * @returns {Promise<Object>} Parsed document
 */
async function parseV2XML (entities, back) {
  const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE rfc SYSTEM "rfc2629.dtd" [
${entities}
]>
<?rfc toc="yes"?>
<rfc category="std" docName="draft-test-references-00" ipr="trust200902">
  <front><title>Test</title></front>
  <middle><section title="Introduction"><t>Text.</t></section></middle>
  <back>
${back}
  </back>
</rfc>
`, 'draft-test-references-00.xml')
  return doc
}

/**
 * Parse a TXT draft whose introduction cites the given anchors and whose
 * references section has the given normative and informative entries
 *
 * @param {Object} opts
 * @param {string[]} [opts.cited] Anchors cited in the introduction, e.g. '[FOO]'
 * @param {string[]} [opts.normative] Anchors listed under Normative References
 * @param {string[]} [opts.informative] Anchors listed under Informative References
 * @returns {Promise<Object>} Parsed document
 */
async function parseTXTReferences ({ cited = [], normative = [], informative = [] }) {
  const entries = anchors => anchors.map(anchor => `   ${anchor.padEnd(10)} Example, "A reference that is not an RFC", 2025.`).join('\n\n')
  const txt = `${CANONICAL_TXT}
1.  Introduction

   This document uses ${cited.join(' and ') || 'nothing'}.

2.  References

2.1.  Normative References

${entries(normative)}

2.2.  Informative References

${entries(informative)}
`
  return parseTXT(txt, 'draft-ietf-beep-boop-01.txt')
}

/**
 * Parse a TXT document whose references sections list the given RFCs: an RFC
 * with the given number, or a draft when there is none
 *
 * @param {Object} opts
 * @param {string} [opts.rfcNumber] RFC number of the document, e.g. '10001'
 * @param {string[]} [opts.normative] RFC numbers listed under Normative References
 * @param {string[]} [opts.informative] RFC numbers listed under Informative References
 * @returns {Promise<Object>} Parsed document
 */
async function parseTXTRfcReferences ({ rfcNumber, normative = [], informative = [] }) {
  const header = rfcNumber
    ? `
Internet Engineering Task Force (IETF)                         A. Author
Request for Comments: ${rfcNumber}                                      Example
Obsoletes: 3901                                              August 2026
Category: Best Current Practice
ISSN: 2070-1721


              DNS IPv6 Transport Operational Guidelines

Abstract

   This document obsoletes RFC 3901.
`
    : CANONICAL_TXT
  const entries = rfcs => rfcs.map(rfc => `   [RFC${rfc}]  Example, A., "Example Protocol", RFC ${rfc},
              DOI 10.17487/RFC${rfc}, June 2005,
              <https://www.rfc-editor.org/info/rfc${rfc}>.`).join('\n\n')
  const txt = `${header}
1.  Introduction

   This document cites ${[...normative, ...informative].map(rfc => `[RFC${rfc}]`).join(' and ')}.

2.  References

2.1.  Normative References

${entries(normative)}

2.2.  Informative References

${entries(informative)}
`
  return parseTXT(txt, rfcNumber ? `rfc${rfcNumber}.txt` : 'draft-ietf-beep-boop-01.txt')
}

/**
 * Entry of the references section of a TXT draft for an Internet-Draft, as xml2rfc writes
 * it, with the URL wrapped after the path
 *
 * @param {string} name Draft name with its version, e.g. draft-ietf-foo-bar-03
 * @returns {string} References section entry
 */
function txtDraftEntry (name) {
  return `   [I-D.${name.replace(/^draft-/, '').replace(/-\d{2}$/, '')}]
              Example, A., "Example Protocol", Work in Progress,
              Internet-Draft, ${name}, 2 January 2025,
              <https://datatracker.ietf.org/doc/html/
              ${name}>.`
}

/**
 * Where texts are in a parsed TXT document, as findings give it: on each line containing the given
 * text, where each text starts
 *
 * @param {Object} doc Parsed TXT document
 * @param {string} lineText Text the lines contain
 * @param {...string} texts Texts to locate in each line; the line text when none is given
 * @returns {Array<{line: number, pos: number}>} Locations, both 1-based
 */
function locate (doc, lineText, ...texts) {
  return doc.body.split('\n').flatMap((line, idx) => line.includes(lineText)
    ? (texts.length > 0 ? texts : [lineText]).map(text => ({ line: idx + 1, pos: line.indexOf(text) + 1 }))
    : [])
}

/**
 * Where a TXT draft written by txtDraftEntry() links to drafts
 *
 * @param {Object} doc Parsed TXT document
 * @param {...string} names Drafts linked to, with their version
 * @returns {Array<{line: number, pos: number}>} Locations
 */
function draftLinks (doc, ...names) {
  return names.flatMap(name => locate(doc, `${name}>.`, name))
}

/**
 * Where a TXT document written by parseTXTRfcReferences() lists an RFC: its label and its series
 *
 * @param {Object} doc Parsed TXT document
 * @param {string} rfc RFC number
 * @returns {Array<{line: number, pos: number}>} Locations
 */
function rfcEntry (doc, rfc) {
  return locate(doc, `[RFC${rfc}]  Example`, `[RFC${rfc}]`, `RFC ${rfc},`)
}

/**
 * Parse a TXT draft with the given intended status whose references sections list the given drafts
 *
 * @param {Object} opts
 * @param {string} [opts.intendedStatus] Intended status of the draft
 * @param {string[]} [opts.normative] Drafts listed under Normative References, with their version
 * @param {string[]} [opts.informative] Drafts listed under Informative References, with their version
 * @returns {Promise<Object>} Parsed document
 */
async function parseTXTDraftReferences ({ intendedStatus = 'Standards Track', normative = [], informative = [] }) {
  const header = CANONICAL_TXT.replace('Intended status: Standards Track      ', `Intended status: ${intendedStatus.padEnd(21)}`)
  const txt = `${header}
1.  Introduction

   This document cites the drafts below.

2.  References

2.1.  Normative References

${normative.map(txtDraftEntry).join('\n\n')}

2.2.  Informative References

${informative.map(txtDraftEntry).join('\n\n')}
`
  return parseTXT(txt, 'draft-ietf-beep-boop-01.txt')
}

/**
 * Parse an XML draft of the given category whose references sections list the given drafts
 *
 * @param {Object} opts
 * @param {string} [opts.category] Category of the draft
 * @param {string[]} [opts.normative] Drafts listed under Normative References, with their version
 * @param {string[]} [opts.informative] Drafts listed under Informative References, with their version
 * @returns {Promise<Object>} Parsed document
 */
async function parseXMLDraftReferences ({ category = 'std', normative = [], informative = [] }) {
  const entries = names => names.map(name => `<reference anchor="I-D.${name.replace(/^draft-/, '')}"><front><title>T</title></front><seriesInfo name="Internet-Draft" value="${name}"/></reference>`).join('')
  const { doc } = await parse(`<rfc version="3" category="${category}" docName="draft-test-references-00"><back>
    <references><name>Normative References</name>${entries(normative)}</references>
    <references><name>Informative References</name>${entries(informative)}</references>
  </back></rfc>`, 'draft-test-references-00.xml')
  return doc
}

describe('validateDownrefs', () => {
  describe('TXT Document Type', () => {
    test('valid references with no downrefs', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [{ value: '4086' }, { value: '8141' }])
      set(doc, 'data.extractedElements.draftStatusReferences', [{ value: 'draft-ietf-quic-http-34' }])

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('invalid downref for an RFC', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [{ value: '1234', subsection: 'normative_references' }])
      set(doc, 'data.header.category', 'Internet Standard')

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toContainError('DOWNREF_TO_LOWER_STATUS', ValidationError)
    })

    test('FORGIVE_CHECKLIST mode returns zero warnings', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [{ value: '1094' }])
      set(doc, 'data.extractedElements.draftStatusReferences', [{ value: 'draft-ietf-quic-http-34' }])

      const result = await validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toHaveLength(0)
    })

    test('FORGIVE_CHECKLIST mode returns warning on non RFC non draft reference', async () => {
      const doc = await parseTXTReferences({ normative: ['[ISO10589]'] })

      const result = await validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toEqual([
        new ValidationWarning('POSSIBLE_DOWNREF', 'Reference to [ISO10589] is possible downref', { ref: 'https://www.rfc-editor.org/info/bcp97', lines: locate(doc, '[ISO10589]') })
      ])
    })

    test('unused informative reference is not a possible downref', async () => {
      const doc = await parseTXTReferences({ informative: ['[UNUSED]'] })

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('used informative reference is not a possible downref', async () => {
      const doc = await parseTXTReferences({ cited: ['[USED]'], informative: ['[USED]'] })

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('unused normative reference is still a possible downref', async () => {
      const doc = await parseTXTReferences({ normative: ['[NORM]'], informative: ['[UNUSED]'] })

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(1)
      expect(result).toContainError('POSSIBLE_DOWNREF', ValidationError)
      expect(result[0].message).toContain('[NORM]')
    })

    test('used normative reference is still not a possible downref', async () => {
      const doc = await parseTXTReferences({ cited: ['[NORM]'], normative: ['[NORM]'] })

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })
  })

  describe('XML Document Type', () => {
    test('valid XML references without downrefs', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            {
              _attr: { anchor: 'RFC8142' },
              seriesInfo: [
                { _attr: { name: 'RFC', value: '8142' } }
              ]
            },
            {
              _attr: { anchor: 'RFC9114' },
              seriesInfo: [
                { _attr: { name: 'RFC', value: '9114' } }
              ]
            }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('parsed single nested and flat references sections', async () => {
      const entry = '<reference anchor="RFC7322"><front/><seriesInfo name="RFC" value="7322"/></reference>'
      const expected = [
        new ValidationError(
          'POSSIBLE_DOWNREF',
          'RFC 7322 status can\'t be fetched. Reference is possible downref',
          { ref: 'https://www.rfc-editor.org/info/bcp97' }
        )
      ]
      await expect(validateDownrefs(await parseXMLBack(nestedReferences('Normative References', entry)), { mode: MODES.NORMAL })).resolves.toEqual(expected)
      await expect(validateDownrefs(await parseXMLBack(`<references><name>Normative References</name>${entry}</references>`), { mode: MODES.NORMAL })).resolves.toEqual(expected)
    })

    test('normative reference pulled in by an <?rfc include?> instruction in a v2 section', async () => {
      const doc = await parseV2XML('', `<references title="Normative References">
      <?rfc include="reference.RFC.7322"?>
    </references>`)

      await expect(validateDownrefs(doc, { mode: MODES.NORMAL })).resolves.toEqual([
        new ValidationError(
          'POSSIBLE_DOWNREF',
          'RFC 7322 status can\'t be fetched. Reference is possible downref',
          { ref: 'https://www.rfc-editor.org/info/bcp97' }
        )
      ])
    })

    test('XML ref to a draft of the same intended status is not a downref', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            {
              _attr: { anchor: 'draft-ietf-emu-aka-pfs-34' },
              seriesInfo: [
                { _attr: { name: 'Internet-Draft', value: 'draft-ietf-emu-aka-pfs-34' } }
              ]
            }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result.map(finding => finding.name)).toEqual(['NORMATIVE_REFERENCE_TO_DRAFT'])
    })

    test('FORGIVE_CHECKLIST mode returns warnings for XML', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            {
              _attr: { anchor: 'draft-ietf-quic-http-34' },
              seriesInfo: [
                { _attr: { name: 'Internet-Draft', value: 'draft-ietf-quic-http-34' } }
              ]
            },
            {
              _attr: { anchor: 'RFC7322' },
              seriesInfo: [
                { _attr: { name: 'RFC', value: '7322' } }
              ]
            }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toContainError('POSSIBLE_DOWNREF', ValidationWarning)
    })

    test('valid XML references without downrefs (multiple references in a section)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            {
              _attr: { anchor: 'RFC9114' },
              seriesInfo: [{ _attr: { name: 'RFC', value: '9114' } }]
            },
            {
              _attr: { anchor: 'RFC8888' },
              seriesInfo: [{ _attr: { name: 'RFC', value: '8888' } }]
            },
            {
              _attr: { anchor: 'RFC7655' },
              seriesInfo: [{ _attr: { name: 'RFC', value: '7655' } }]
            }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('invalid XML downref when multiple references exist in a section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            {
              _attr: { anchor: 'RFC2119' },
              seriesInfo: [{ _attr: { name: 'RFC', value: '2119' } }]
            },
            {
              _attr: { anchor: 'RFC8174' },
              seriesInfo: [{ _attr: { name: 'RFC', value: '8174' } }]
            },
            {
              _attr: { anchor: 'RFC4187' }, // This is a downref
              seriesInfo: [{ _attr: { name: 'RFC', value: '4187' } }]
            }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result).toContainError('DOWNREF_TO_LOWER_STATUS_IN_REGISTRY', ValidationWarning)
    })

    test('FORGIVE_CHECKLIST mode returns warnings when multiple references exist', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            {
              _attr: { anchor: 'RFC4187' },
              seriesInfo: [{ _attr: { name: 'RFC', value: '4187' } }]
            },
            {
              _attr: { anchor: 'draft-ietf-quic-http-34' },
              seriesInfo: [
                { _attr: { name: 'Internet-Draft', value: 'draft-ietf-quic-http-34' } }
              ]
            }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toContainError('DOWNREF_TO_LOWER_STATUS_IN_REGISTRY', ValidationWarning)
    })

    test('FORGIVE_CHECKLIST mode returns warnings when multiple references exist', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        {
          name: 'Normative References',
          reference: [
            {
              _attr: { anchor: 'RFC4187' },
              seriesInfo: [
                { _attr: { name: 'RFC', value: '4187' } }
              ]
            },
            {
              _attr: { anchor: 'draft-ietf-quic-http-34' },
              seriesInfo: [
                { _attr: { name: 'Internet-Draft', value: 'draft-ietf-quic-http-34' } }
              ]
            }
          ]
        }
      ])

      const result = await validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toContainError('DOWNREF_TO_LOWER_STATUS_IN_REGISTRY', ValidationWarning)
    })
  })
})

describe('Normative references to drafts', () => {
  const STATEMENT = 'https://datatracker.ietf.org/doc/statement-iesg-iesg-statement-normative-and-informative-references-20060419/'
  const BCP97 = 'https://www.rfc-editor.org/info/bcp97'
  const toDraft = (subject) => new ValidationWarning(
    'NORMATIVE_REFERENCE_TO_DRAFT',
    `Normative reference to ${subject}. A document is not published as an RFC before the drafts it references normatively.`,
    { ref: STATEMENT }
  )
  const toLowerStatusDraft = (subject, name, status) => new ValidationWarning(
    'NORMATIVE_REFERENCE_TO_LOWER_STATUS_DRAFT',
    `Normative reference to ${subject}: the intended status of ${name} (${status}) is lower than this draft's intended status, so the reference will be a downref if ${name} is published with that status.`,
    { ref: BCP97 }
  )

  // -> A finding of a text document says where the draft is linked to; an XML document gets lines centrally
  const atTXTDraftLinks = (finding, doc, ...names) => Object.assign(finding, { lines: draftLinks(doc, ...names) })
  const asXML = (finding) => finding

  describe.each([
    ['TXT', parseTXTDraftReferences, 'intendedStatus', 'Informational', atTXTDraftLinks],
    ['XML', parseXMLDraftReferences, 'category', 'info', asXML]
  ])('%s', (_type, parseDoc, statusKey, informational, at) => {
    test('drafts without an intended status are reported alike, and not as downrefs (#223)', async () => {
      const doc = await parseDoc({ normative: ['draft-ietf-bess-evpn-ipvpn-interworking-13', 'draft-ietf-bess-rfc7432bis-10'] })

      await expect(validateDownrefs(doc, { mode: MODES.NORMAL })).resolves.toEqual([
        at(toDraft('the Internet-Draft draft-ietf-bess-evpn-ipvpn-interworking-13'), doc, 'draft-ietf-bess-evpn-ipvpn-interworking-13'),
        at(toDraft('the Internet-Draft draft-ietf-bess-rfc7432bis-10'), doc, 'draft-ietf-bess-rfc7432bis-10')
      ])
    })

    test('a replaced draft names the end of the chain, and is not a possible downref (#220)', async () => {
      const doc = await parseDoc({ normative: ['draft-iana-ianabis-rfc8126bis-00'] })

      // -> The end of the chain is a BCP, as high as this draft
      await expect(validateDownrefs(doc, { mode: MODES.NORMAL })).resolves.toEqual([
        at(toDraft('the Internet-Draft draft-iana-ianabis-rfc8126bis-00, which was replaced by draft-ietf-ianabis-rfc8126bis'), doc, 'draft-iana-ianabis-rfc8126bis-00')
      ])
    })

    test('a draft whose intended status is lower is a downref in the making', async () => {
      const doc = await parseDoc({ normative: ['draft-ietf-info-intended-02'] })
      const expected = [
        at(toDraft('the Internet-Draft draft-ietf-info-intended-02'), doc, 'draft-ietf-info-intended-02'),
        at(toLowerStatusDraft('the Internet-Draft draft-ietf-info-intended-02', 'draft-ietf-info-intended', 'Informational'), doc, 'draft-ietf-info-intended-02')
      ]

      await expect(validateDownrefs(doc, { mode: MODES.NORMAL })).resolves.toEqual(expected)
      await expect(validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toEqual(expected)
      await expect(validateDownrefs(doc, { mode: MODES.SUBMISSION })).resolves.toEqual([])
    })

    test('the intended status that counts is that of the end of the chain', async () => {
      const doc = await parseDoc({ normative: ['draft-chain-a-03'] })
      const subject = 'the Internet-Draft draft-chain-a-03, which was replaced by draft-chain-c'

      await expect(validateDownrefs(doc, { mode: MODES.NORMAL })).resolves.toEqual([
        at(toDraft(subject), doc, 'draft-chain-a-03'),
        at(toLowerStatusDraft(subject, 'draft-chain-c', 'Informational'), doc, 'draft-chain-a-03')
      ])
    })

    test('no downref in the making for a document that is not Standards Track or BCP', async () => {
      const doc = await parseDoc({ [statusKey]: informational, normative: ['draft-ietf-info-intended-02'] })

      await expect(validateDownrefs(doc, { mode: MODES.NORMAL })).resolves.toEqual([
        at(toDraft('the Internet-Draft draft-ietf-info-intended-02'), doc, 'draft-ietf-info-intended-02')
      ])
    })

    test('a draft that cannot be fetched is still a normative reference to a draft', async () => {
      const doc = await parseDoc({ normative: ['draft-ietf-missing-01'] })

      await expect(validateDownrefs(doc, { mode: MODES.NORMAL })).resolves.toEqual([
        at(toDraft('the Internet-Draft draft-ietf-missing-01'), doc, 'draft-ietf-missing-01')
      ])
    })

    test('a draft published as an RFC is judged as that RFC', async () => {
      const doc = await parseDoc({ normative: ['draft-ietf-quic-transport-34', 'draft-chain-hist-02'] })

      // -> RFC 9000 is Proposed Standard; draft-chain-hist was replaced by a draft published as RFC 1234, Historic
      await expect(validateDownrefs(doc, { mode: MODES.NORMAL })).resolves.toEqual([
        at(new ValidationError(
          'DOWNREF_TO_LOWER_STATUS',
          'Reference to RFC 1234 (cited as draft-chain-hist-02), which has a lower status than this draft\'s intended status. This reference is not in the Downref Registry.',
          { ref: BCP97 }
        ), doc, 'draft-chain-hist-02')
      ])
      await expect(validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('DOWNREF_TO_LOWER_STATUS', ValidationWarning)
    })

    test('a draft published as an RFC that is obsolete is an obsolete reference', async () => {
      const doc = await parseDoc({ normative: ['draft-ietf-obsolete-rfc-07', 'draft-ietf-quic-transport-34'] })

      await expect(validateNormativeReferences(doc, { mode: MODES.NORMAL })).resolves.toEqual([
        at(new ValidationError(
          'OBSOLETE_REFERENCE',
          'RFC 4087 (cited as draft-ietf-obsolete-rfc-07) is obsolete and has been replaced by: RFC9000.',
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        ), doc, 'draft-ietf-obsolete-rfc-07')
      ])
      await expect(validateNormativeReferences(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('OBSOLETE_REFERENCE', ValidationWarning)
    })

    test('a chain that loops ends at the last draft reached', async () => {
      const doc = await parseDoc({ normative: ['draft-cycle-a-00'] })
      const subject = 'the Internet-Draft draft-cycle-a-00, which was replaced by draft-cycle-b'

      await expect(validateDownrefs(doc, { mode: MODES.NORMAL })).resolves.toEqual([
        at(toDraft(subject), doc, 'draft-cycle-a-00'),
        at(toLowerStatusDraft(subject, 'draft-cycle-b', 'Informational'), doc, 'draft-cycle-a-00')
      ])
    })

    test('a chain is followed for at most ten drafts', async () => {
      const doc = await parseDoc({ normative: ['draft-long-0-00'] })

      const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
      expect(result[0]).toEqual(at(toDraft('the Internet-Draft draft-long-0-00, which was replaced by draft-long-9'), doc, 'draft-long-0-00'))
    })

    test('informative references to drafts are not reported', async () => {
      const doc = await parseDoc({ informative: ['draft-ietf-info-intended-02', 'draft-chain-hist-02'] })

      await expect(validateDownrefs(doc, { mode: MODES.NORMAL })).resolves.toEqual([])
      await expect(validateNormativeReferences(doc, { mode: MODES.NORMAL })).resolves.toEqual([])
    })

    test('nothing in submission mode', async () => {
      const doc = await parseDoc({ normative: ['draft-ietf-info-intended-02', 'draft-chain-hist-02', 'draft-ietf-obsolete-rfc-07'] })

      await expect(validateDownrefs(doc, { mode: MODES.SUBMISSION })).resolves.toEqual([])
      await expect(validateNormativeReferences(doc, { mode: MODES.SUBMISSION })).resolves.toEqual([])
    })
  })

  test('each draft is reported once, whatever its versions (TXT)', async () => {
    const doc = await parseTXTDraftReferences({ normative: ['draft-ietf-info-intended-01', 'draft-ietf-info-intended-02'] })

    const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
    expect(result.map(finding => finding.name)).toEqual(['NORMATIVE_REFERENCE_TO_DRAFT', 'NORMATIVE_REFERENCE_TO_LOWER_STATUS_DRAFT'])
  })

  test('a downref in the making is reported once for drafts replaced by the same draft (XML)', async () => {
    const doc = await parseXMLDraftReferences({ normative: ['draft-chain-a-03', 'draft-chain-c-04'] })

    const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
    expect(result.map(finding => finding.name)).toEqual(['NORMATIVE_REFERENCE_TO_DRAFT', 'NORMATIVE_REFERENCE_TO_LOWER_STATUS_DRAFT', 'NORMATIVE_REFERENCE_TO_DRAFT'])
  })

  test('an RFC cited both directly and as a draft is judged once (XML)', async () => {
    const { doc } = await parse(`<rfc version="3" category="std" docName="draft-test-references-00"><back>
      <references><name>Normative References</name>
        <reference anchor="RFC1234"><front><title>T</title></front><seriesInfo name="RFC" value="1234"/></reference>
        <reference anchor="I-D.chain-hist"><front><title>T</title></front><seriesInfo name="Internet-Draft" value="draft-chain-hist-02"/></reference>
      </references>
    </back></rfc>`, 'draft-test-references-00.xml')

    const result = await validateDownrefs(doc, { mode: MODES.NORMAL })
    expect(result).toEqual([
      new ValidationError(
        'DOWNREF_TO_LOWER_STATUS',
        'Reference to RFC 1234, which has a lower status than this draft\'s intended status. This reference is not in the Downref Registry.',
        { ref: BCP97 }
      )
    ])
  })

  test('the draft checks of a published RFC are not run (TXT)', async () => {
    const doc = await parseTXT(`
Internet Engineering Task Force (IETF)                         A. Author
Request for Comments: 9999                                       Example
Category: Standards Track                                    August 2026
ISSN: 2070-1721


                          Example Protocol

Abstract

   This document describes an example.

1.  Normative References

${txtDraftEntry('draft-ietf-info-intended-02')}
`, 'rfc9999.txt')
    expect(doc.docKind).toBe('rfc')
    expect(doc.data.extractedElements.draftStatusReferences).toEqual([{ value: 'draft-ietf-info-intended-02', subsection: 'normative_references' }])

    await expect(validateDownrefs(doc, { mode: MODES.NORMAL })).resolves.toEqual([])
  })

  test('the stale reference checks still tell the author to update the reference', async () => {
    const doc = await parseTXTDraftReferences({ normative: ['draft-chain-hist-02'] })
    const tasks = getAllValidations(doc.type).flatMap(group => group.tasks).filter(task => ['draftrefs', 'referenceStale'].includes(task.key))

    const result = (await Promise.all(tasks.map(task => task.task({ doc, options: { mode: MODES.NORMAL } })))).flat()
    expect(result).toEqual([
      new ValidationWarning(
        'OUTDATED_DRAFT',
        'The draft reference draft-chain-hist-02 is stale. draft-chain-hist was replaced by draft-chain-hist-wg, which has been published as RFC 1234.',
        { ref: 'https://datatracker.ietf.org/doc/draft-chain-hist', lines: draftLinks(doc, 'draft-chain-hist-02') }
      )
    ])
  })
})

describe('validateNormativeReferences', () => {
  describe('TXT Document Type', () => {
    test('valid normative references', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '4090', subsection: 'normative_references' },
        { value: '8142', subsection: 'normative_references' }
      ])

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('normative reference with undefined status', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '4086', subsection: 'normative_references' }
      ])

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNDEFINED_STATUS',
          'RFC 4086 does not have a defined status or could not be fetched.',
          { ref: 'https://www.rfc-editor.org/info/rfc4086' }
        )
      ])
    })

    test('normative reference with unknown status', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '8141', subsection: 'normative_references' }
      ])

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNKNOWN_STATUS',
          'RFC 8141 has an unrecognized status: "Unknown Status".',
          { ref: 'https://www.rfc-editor.org/info/rfc8141' }
        )
      ])
    })

    test('normative reference to an obsolete RFC', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '4087', subsection: 'normative_references' }
      ])

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'OBSOLETE_REFERENCE',
          message: 'RFC 4087 is obsolete and has been replaced by: RFC9000.'
        })
      )
    })

    test('FORGIVE_CHECKLIST mode for an obsolete RFC', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '4087', subsection: 'normative_references' }
      ])

      const result = await validateNormativeReferences(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toContainEqual(
        expect.objectContaining({
          name: 'OBSOLETE_REFERENCE',
          message: 'RFC 4087 is obsolete and has been replaced by: RFC9000.'
        })
      )
    })
    test('an RFC citing the RFC it obsoletes is not told that RFC is obsolete', async () => {
      const doc = await parseTXTRfcReferences({ rfcNumber: '10001', normative: ['3901', '4087'], informative: ['5087'] })

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationError(
          'OBSOLETE_REFERENCE',
          'RFC 4087 is obsolete and has been replaced by: RFC9000.',
          { ref: 'https://authors.ietf.org/en/required-content#references', lines: rfcEntry(doc, '4087') }
        )
      ])
    })
  })

  describe('TXT Document Type: where the reference is', () => {
    test('an RFC listed in both references sections is located in the normative one', async () => {
      // -> Excerpt of draft-baur-pap-02, whose second Informative References section lists RFC 3339 again
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

   Timestamps are as defined in [RFC3339].

19.  References

19.1.  Normative References

   [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate
   Requirement Levels", BCP 14, RFC 2119, March 1997.

   [RFC3339] Klyne, G. and C.  Newman, "Date and Time on the Internet:
   Timestamps", RFC 3339, July 2002.

19.2.  Informative References

   [RFC6455] Fette, I. and A.  Melnikov, "The WebSocket Protocol", RFC
   6455, December 2011.

20.  Informative References

   [RFC3339]  Klyne, G. and C. Newman, "Date and Time on the Internet:
              Timestamps", RFC 3339, DOI 10.17487/RFC3339, July 2002,
              <https://www.rfc-editor.org/info/rfc3339>.
`, 'draft-baur-pap-02.txt')
      server.use(http.get('https://www.rfc-editor.org/rfc/rfc3339.json', () => HttpResponse.json({})))
      expect(doc.data.extractedElements.locations.referenceSectionRfc['3339']).toHaveLength(2)

      await expect(validateNormativeReferences(doc, { mode: MODES.NORMAL })).resolves.toEqual([
        new ValidationComment('UNDEFINED_STATUS', 'RFC 3339 does not have a defined status or could not be fetched.', {
          ref: 'https://www.rfc-editor.org/info/rfc3339',
          lines: locate(doc, '[RFC3339] Klyne', '[RFC3339]')
        })
      ])
    })

    test('a citation after the references section is not where the reference is', async () => {
      // -> Excerpt of draft-bormann-cbor-cddl-freezer-18, whose Acknowledgements follow the references
      const doc = await parseTXT(`${CANONICAL_TXT}
9.  Security considerations

   The security considerations of [RFC8610] apply.

10.  References

10.1.  Normative References

   [RFC8610]  Birkholz, H., Vigano, C., and C. Bormann, "Concise Data
              Definition Language (CDDL): A Notational Convention to
              Express Concise Binary Object Representation (CBOR) and
              JSON Data Structures", RFC 8610, DOI 10.17487/RFC8610,
              June 2019, <https://www.rfc-editor.org/rfc/rfc8610>.

10.2.  Informative References

   [cddlc]    "CDDL conversion utilities", n.d.,
              <https://github.com/cabo/cddlc>.

Acknowledgements

   Before [RFC8610] was finally published, many people have asked for
   CDDL to be completed, soon.
`, 'draft-bormann-cbor-cddl-freezer-18.txt')
      server.use(http.get('https://www.rfc-editor.org/rfc/rfc8610.json', () => HttpResponse.json({})))
      // -> The text parser takes the Acknowledgements for part of the references section
      expect(doc.data.extractedElements.locations.referenceSectionRfc['8610']).toHaveLength(2)

      await expect(validateNormativeReferences(doc, { mode: MODES.NORMAL })).resolves.toEqual([
        new ValidationComment('UNDEFINED_STATUS', 'RFC 8610 does not have a defined status or could not be fetched.', {
          ref: 'https://www.rfc-editor.org/info/rfc8610',
          lines: locate(doc, '[RFC8610]  Birkholz', '[RFC8610]')
        })
      ])
    })
  })

  describe('XML Document Type', () => {
    test('valid normative references', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { name: 'Normative references', reference: [{ _attr: { anchor: 'RFC4088' }, seriesInfo: [{ _attr: { name: 'RFC', value: '4088' } }] }] },
        { name: 'Informative references', reference: [{ _attr: { anchor: 'RFC8141' }, seriesInfo: [{ _attr: { name: 'RFC', value: '8141' } }] }] }
      ])

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('normative reference with undefined status', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { name: 'Normative references', reference: [{ _attr: { anchor: 'RFC4086' }, seriesInfo: [{ _attr: { name: 'RFC', value: '4086' } }] }] }
      ])

      // fetchMock.mockResponse(JSON.stringify({}))

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNDEFINED_STATUS',
          'RFC 4086 does not have a defined status or could not be fetched.',
          { ref: 'https://www.rfc-editor.org/info/rfc4086' }
        )
      ])
    })

    test('normative reference in a parsed single nested references section', async () => {
      const doc = await parseXMLBack(nestedReferences('Normative References', '<reference anchor="RFC4086"><front/><seriesInfo name="RFC" value="4086"/></reference>'))

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNDEFINED_STATUS',
          'RFC 4086 does not have a defined status or could not be fetched.',
          { ref: 'https://www.rfc-editor.org/info/rfc4086' }
        )
      ])
    })

    test('normative references pulled in by an external entity and by xi:include', async () => {
      const doc = await parseV2XML(
        '<!ENTITY RFC4086 SYSTEM "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.4086.xml">',
        `<references title="Normative References">
      &RFC4086;
      <xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.4087.xml"/>
    </references>
    <references title="Informative References">
      <xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.5087.xml"/>
    </references>`
      )

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationError(
          'OBSOLETE_REFERENCE',
          'RFC 4087 is obsolete and has been replaced by: RFC9000.',
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        ),
        new ValidationComment(
          'UNDEFINED_STATUS',
          'RFC 4086 does not have a defined status or could not be fetched.',
          { ref: 'https://www.rfc-editor.org/info/rfc4086' }
        )
      ])
    })

    test('an RFC citing the RFC it obsoletes is not told that RFC is obsolete', async () => {
      const { doc } = await parse(`<rfc version="3" category="bcp" number="10001" obsoletes="3901"><front><title>Test</title></front><back>
        <references><name>Normative References</name>
          <xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.3901.xml"/>
          <xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.4087.xml"/>
        </references>
      </back></rfc>`, 'rfc10001.xml')

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationError(
          'OBSOLETE_REFERENCE',
          'RFC 4087 is obsolete and has been replaced by: RFC9000.',
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        )
      ])
    })

    test('normative reference with unknown status', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { name: 'Normative references', reference: [{ _attr: { anchor: 'RFC8141' }, seriesInfo: [{ _attr: { name: 'RFC', value: '8141' } }] }] }
      ])

      const result = await validateNormativeReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNKNOWN_STATUS',
          'RFC 8141 has an unrecognized status: "Unknown Status".',
          { ref: 'https://www.rfc-editor.org/info/rfc8141' }
        )
      ])
    })
  })
})

describe('validateUnclassifiedReferences', () => {
  describe('TXT Document Type', () => {
    test('unclassified reference to an obsolete RFC', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '4087', subsection: 'unclassified_references' }
      ])

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.NORMAL })
      expect(result).toContainError('OBSOLETE_REFERENCE', ValidationError)
    })

    test('FORGIVE_CHECKLIST mode for an obsolete unclassified RFC', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [
        { value: '4087', subsection: 'unclassified_references' }
      ])

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toContainError('OBSOLETE_REFERENCE', ValidationWarning)
    })
  })

  describe('XML Document Type', () => {
    test('unclassified reference to an obsolete RFC', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { name: 'Other References', reference: [{ _attr: { anchor: 'RFC4087' } }] }
      ])

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.NORMAL })
      expect(result).toContainError('OBSOLETE_REFERENCE', ValidationError)
    })

    test('unclassified reference to an obsolete RFC in a parsed flat references section', async () => {
      const doc = await parseXMLBack('<references><name>References</name><reference anchor="RFC4087"><front/></reference></references>')

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.NORMAL })
      expect(result).toContainError('OBSOLETE_REFERENCE', ValidationError)
      await expect(validateUnclassifiedReferences(await parseXMLBack(nestedReferences('Normative References', '<reference anchor="RFC4087"><front/></reference>')), { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    })

    test('unclassified reference to an obsolete RFC pulled in by xi:include in a <referencegroup>', async () => {
      const doc = await parseXMLBack(`<references><name>References</name>
        <referencegroup anchor="STD99">
          <xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.4087.xml"/>
        </referencegroup>
      </references>`)

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.NORMAL })
      expect(result).toContainError('OBSOLETE_REFERENCE', ValidationError)
    })

    test('an RFC citing the RFC it obsoletes is not told that RFC is obsolete', async () => {
      const { doc } = await parse(`<rfc version="3" category="bcp" number="10001" obsoletes="3901"><front><title>Test</title></front><back>
        <references><name>References</name>
          <xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.3901.xml"/>
        </references>
      </back></rfc>`, 'rfc10001.xml')

      await expect(validateUnclassifiedReferences(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    })

    test('FORGIVE_CHECKLIST mode for an obsolete unclassified RFC', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { name: 'Other References', reference: [{ _attr: { anchor: 'RFC4087' } }] }
      ])

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toContainError('OBSOLETE_REFERENCE', ValidationWarning)
    })

    test('unclassified reference with undefined status', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { name: 'Other References', reference: [{ _attr: { anchor: 'RFC4086' } }] }
      ])

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNDEFINED_STATUS',
          'RFC 4086 does not have a defined status or could not be fetched',
          { ref: 'https://www.rfc-editor.org/info/rfc4086' }
        )
      ])
    })

    test('unclassified reference with unknown status', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { name: 'Other References', reference: [{ _attr: { anchor: 'RFC5678' } }] }
      ])

      const result = await validateUnclassifiedReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationComment(
          'UNDEFINED_STATUS',
          'RFC 5678 does not have a defined status or could not be fetched',
          { ref: 'https://www.rfc-editor.org/info/rfc5678' }
        )
      ])
    })
  })
})

describe('Validating published as a RFC draft references', () => {
  describe('TXT Document Type', () => {
    test('should return no warnings for valid drafts with defined states', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.draftStatusReferences', [
        { value: 'draft-ietf-example-01' },
        { value: 'draft-ietf-example-02' }
      ])

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('should return warning for drafts with undefined states', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.draftStatusReferences', [
        { value: 'draft-ietf-undefined-state' }
      ])

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'UNDEFINED_STATE',
          'The draft reference draft-ietf-undefined-state does not have a defined state or could not be fetched.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-undefined-state' }
        )
      ])
    })

    test('should strip leading I-D. prefix before validation (TXT)', async () => {
      const doc = cloneDeep(baseTXTDoc)
      // simulate a two-part reference with an I-D. prefix
      set(doc, 'data.extractedElements.draftStatusReferences', [
        { value: 'I-D.draft-ietf-rtgwg-segment-routing-ti-lfa' }
      ])

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'UNDEFINED_STATE',
          'The draft reference draft-ietf-rtgwg-segment-routing-ti-lfa does not have a defined state or could not be fetched.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-rtgwg-segment-routing-ti-lfa' }
        )
      ])
    })

    test('should return warning for drafts published as RFCs', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.draftStatusReferences', [
        { value: 'draft-ietf-published-as-rfc' }
      ])

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'INVALID_STATE_FOR_DRAFT',
          'The draft reference draft-ietf-published-as-rfc is already published as an RFC and should not be referenced as a draft.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-published-as-rfc' }
        )
      ])
    })

    test('should return no warnings in SUBMISSION mode', async () => {
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.draftStatusReferences', [
        { value: 'draft-ietf-example-01' }
      ])

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.SUBMISSION })
      expect(result).toHaveLength(0)
    })
  })

  describe('XML Document Type', () => {
    test('should return no warnings for valid draft references', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { reference: [{ _attr: { anchor: 'draft-ietf-example-01' } }] },
        { reference: [{ _attr: { anchor: 'draft-ietf-example-02' } }] }
      ])

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('should return warning for drafts with undefined states', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { reference: [{ _attr: { anchor: 'draft-ietf-undefined-state' } }] }
      ])

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'UNDEFINED_STATE',
          'The draft reference draft-ietf-undefined-state does not have a defined state or could not be fetched.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-undefined-state' }
        )
      ])
    })

    test('should strip leading I-D. prefix before validation (XML)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      // simulate a reference that starts with "I-D."
      set(doc, 'data.rfc.back.references.references', [
        { reference: [{ _attr: { anchor: 'I-D.draft-ietf-rtgwg-segment-routing-ti-lfa' } }] }
      ])

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'UNDEFINED_STATE',
          'The draft reference draft-ietf-rtgwg-segment-routing-ti-lfa does not have a defined state or could not be fetched.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-rtgwg-segment-routing-ti-lfa' }
        )
      ])
    })

    test('should return warning for drafts published as RFCs', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { reference: [{ _attr: { anchor: 'draft-ietf-published-as-rfc' } }] }
      ])

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'INVALID_STATE_FOR_DRAFT',
          'The draft reference draft-ietf-published-as-rfc is already published as an RFC and should not be referenced as a draft.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-published-as-rfc' }
        )
      ])
    })

    test('should return warning for drafts published as RFCs in a parsed single nested references section', async () => {
      const doc = await parseXMLBack(nestedReferences('Informative References', '<reference anchor="draft-ietf-published-as-rfc"><front/></reference>'))

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'INVALID_STATE_FOR_DRAFT',
          'The draft reference draft-ietf-published-as-rfc is already published as an RFC and should not be referenced as a draft.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-published-as-rfc' }
        )
      ])
    })

    test('should return warning for drafts published as RFCs pulled in by an external entity', async () => {
      const doc = await parseV2XML(
        '<!ENTITY I-D.ietf-published-as-rfc SYSTEM "https://bib.ietf.org/public/rfc/bibxml3/reference.I-D.ietf-published-as-rfc.xml">',
        '<references title="Informative References">&I-D.ietf-published-as-rfc;</references>'
      )

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'INVALID_STATE_FOR_DRAFT',
          'The draft reference draft-ietf-published-as-rfc is already published as an RFC and should not be referenced as a draft.',
          { ref: 'https://datatracker.ietf.org/doc/draft-ietf-published-as-rfc' }
        )
      ])
    })

    test('should return no warnings in SUBMISSION mode (XML)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.references', [
        { reference: [{ _attr: { anchor: 'draft-ietf-example-01' } }] }
      ])

      const result = await validatePublishedDraftReferences(doc, { mode: MODES.SUBMISSION })
      expect(result).toHaveLength(0)
    })
  })
})

describe('validateInformativeReferences', () => {
  test('valid informative references', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.referenceSectionRfc', [
      { value: '5086', subsection: 'informative_references' },
      { value: '8141', subsection: 'informative_references' }
    ])

    const result = await validateInformativeReferences(doc, { mode: MODES.NORMAL })
    expect(result).toHaveLength(0)
  })

  test('informative reference with undefined status', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.referenceSectionRfc', [
      { value: '4086', subsection: 'informative_references' }
    ])

    const result = await validateInformativeReferences(doc, { mode: MODES.NORMAL })
    expect(result).toEqual([
      new ValidationComment(
        'UNDEFINED_STATUS',
        'The informative reference RFC 4086 does not have a defined status or could not be fetched.',
        { ref: 'https://www.rfc-editor.org/info/rfc4086' }
      )
    ])
  })

  test('informative reference to an obsolete RFC', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.referenceSectionRfc', [
      { value: '5087', subsection: 'informative_references' }
    ])

    const result = await validateInformativeReferences(doc, { mode: MODES.NORMAL })
    expect(result).toContainEqual(
      expect.objectContaining({
        name: 'OBSOLETE_INFORMATIVE_REFERENCE',
        message: 'Obsolete informative reference: RFC 5087 has been replaced by RFC9000, RFC9001. Is this intentional?'
      })
    )
  })

  test('FORGIVE_CHECKLIST mode for an obsolete informative RFC', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.referenceSectionRfc', [
      { value: '5087', subsection: 'informative_references' }
    ])

    const result = await validateInformativeReferences(doc, { mode: MODES.FORGIVE_CHECKLIST })
    expect(result).toContainEqual(
      expect.objectContaining({
        name: 'OBSOLETE_INFORMATIVE_REFERENCE',
        message: 'Obsolete informative reference: RFC 5087 has been replaced by RFC9000, RFC9001. Is this intentional?'
      })
    )
  })

  test('informative reference to an obsolete RFC pulled in by an <?rfc include?> instruction (XML)', async () => {
    const doc = await parseV2XML('', `<references title="Normative References">
      <?rfc include='https://xml.resource.org/public/rfc/bibxml/reference.RFC.4087.xml'?>
    </references>
    <references title="Informative References">
      <reference anchor="IANA-IPFIX" target="https://www.iana.org/assignments/ipfix/ipfix.xhtml">
        <front><title>IANA IPFIX Entities Registry</title><author/><date/></front>
      </reference>
      <?rfc include='https://xml.resource.org/public/rfc/bibxml/reference.RFC.5086.xml'?>
      <?rfc include='https://xml.resource.org/public/rfc/bibxml/reference.RFC.5087.xml'?>
    </references>`)

    const result = await validateInformativeReferences(doc, { mode: MODES.NORMAL })
    expect(result).toEqual([
      new ValidationWarning(
        'OBSOLETE_INFORMATIVE_REFERENCE',
        'Obsolete informative reference: RFC 5087 has been replaced by RFC9000, RFC9001. Is this intentional?',
        { ref: 'https://authors.ietf.org/en/required-content#references' }
      )
    ])
  })

  test('informative reference to an obsolete RFC in a nested v3 section (XML)', async () => {
    const doc = await parseXMLBack(nestedReferences('Informative References', `
      <xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.5087.xml"/>`))

    const result = await validateInformativeReferences(doc, { mode: MODES.FORGIVE_CHECKLIST })
    expect(result).toEqual([
      new ValidationComment(
        'OBSOLETE_INFORMATIVE_REFERENCE',
        'Obsolete informative reference: RFC 5087 has been replaced by RFC9000, RFC9001. Is this intentional?',
        { ref: 'https://authors.ietf.org/en/required-content#references' }
      )
    ])
  })

  test('an obsolete informative RFC is a question in each mode, not an error', async () => {
    const doc = await parseTXTRfcReferences({ normative: ['4088'], informative: ['5087'] })
    const message = 'Obsolete informative reference: RFC 5087 has been replaced by RFC9000, RFC9001. Is this intentional?'
    const ref = { ref: 'https://authors.ietf.org/en/required-content#references', lines: rfcEntry(doc, '5087') }

    await expect(validateInformativeReferences(doc, { mode: MODES.NORMAL })).resolves.toEqual([
      new ValidationWarning('OBSOLETE_INFORMATIVE_REFERENCE', message, ref)
    ])
    await expect(validateInformativeReferences(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toEqual([
      new ValidationComment('OBSOLETE_INFORMATIVE_REFERENCE', message, ref)
    ])
    await expect(validateInformativeReferences(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })

  test('an RFC citing the RFC it obsoletes is not told that RFC is obsolete', async () => {
    const doc = await parseTXTRfcReferences({ rfcNumber: '10001', informative: ['3901', '5087'] })

    const result = await validateInformativeReferences(doc, { mode: MODES.NORMAL })
    expect(result).toEqual([
      new ValidationWarning(
        'OBSOLETE_INFORMATIVE_REFERENCE',
        'Obsolete informative reference: RFC 5087 has been replaced by RFC9000, RFC9001. Is this intentional?',
        { ref: 'https://authors.ietf.org/en/required-content#references', lines: rfcEntry(doc, '5087') }
      )
    ])
  })

  test('a draft citing an RFC obsoleted by another RFC is told it is obsolete', async () => {
    const doc = await parseTXTRfcReferences({ informative: ['3901'] })

    const result = await validateInformativeReferences(doc, { mode: MODES.NORMAL })
    expect(result).toEqual([
      new ValidationWarning(
        'OBSOLETE_INFORMATIVE_REFERENCE',
        'Obsolete informative reference: RFC 3901 has been replaced by RFC10001. Is this intentional?',
        { ref: 'https://authors.ietf.org/en/required-content#references', lines: rfcEntry(doc, '3901') }
      )
    ])
  })

  test('an RFC citing the RFC it obsoletes is not told that RFC is obsolete (XML)', async () => {
    const back = `<references><name>Informative References</name>
      <xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.3901.xml"/>
      <xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.5087.xml"/>
    </references>`
    const expected = [
      new ValidationWarning(
        'OBSOLETE_INFORMATIVE_REFERENCE',
        'Obsolete informative reference: RFC 5087 has been replaced by RFC9000, RFC9001. Is this intentional?',
        { ref: 'https://authors.ietf.org/en/required-content#references' }
      )
    ]

    // -> The number attribute of <rfc>
    const { doc: withNumber } = await parse(`<rfc version="3" category="bcp" number="10001" obsoletes="3901"><front><title>Test</title></front><back>${back}</back></rfc>`, 'rfc10001.xml')
    await expect(validateInformativeReferences(withNumber, { mode: MODES.NORMAL })).resolves.toEqual(expected)

    // -> Only an RFC <seriesInfo>, alongside a BCP one
    const { doc: withSeriesInfo } = await parse(`<rfc version="3" category="bcp" obsoletes="3901"><front><title>Test</title>
      <seriesInfo name="RFC" value="10001" stream="IETF"/>
      <seriesInfo name="BCP" value="91" stream="IETF"/>
    </front><back>${back}</back></rfc>`, 'rfc10001.xml')
    await expect(validateInformativeReferences(withSeriesInfo, { mode: MODES.NORMAL })).resolves.toEqual(expected)
  })

  test('commented-out includes are not informative references (XML)', async () => {
    const doc = await parseV2XML(
      '<!ENTITY RFC5087 SYSTEM "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.5087.xml">',
      `<references title="Informative References">
      <!-- <?rfc include="reference.RFC.5087"?> &RFC5087; -->
      <?rfc include="reference.RFC.5086"?>
    </references>`
    )

    await expect(validateInformativeReferences(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
  })
})

describe('validateReferenceForStale (TXT)', () => {
  test('a draft listed in both references sections is located in each, for each finding', async () => {
    const doc = await parseTXTDraftReferences({ normative: ['draft-chain-hist-02'], informative: ['draft-chain-hist-02'] })
    const [normative, informative] = draftLinks(doc, 'draft-chain-hist-02')

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res.map(finding => finding.name)).toEqual(['OUTDATED_DRAFT', 'OUTDATED_DRAFT'])
    expect(res.map(finding => finding.lines)).toEqual([[normative], [informative]])
  })

  test('at most 20 locations are given', async () => {
    const doc = await parseTXTDraftReferences({ informative: Array(25).fill('draft-ietf-missing-01') })

    const res = await validatePublishedDraftReferences(doc, { mode: MODES.NORMAL })
    expect(res).toHaveLength(1)
    expect(res[0].lines).toEqual(draftLinks(doc, 'draft-ietf-missing-01').slice(0, 20))
  })

  test('no warnings if draft version matches latest', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.draftStatusReferences', [
      { value: 'draft-ietf-example2-03', subsection: 'normative_references' }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res).toHaveLength(0)
  })

  test('nothing when no rev_history', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.draftStatusReferences', [
      { value: 'draft-ietf-missing-01', subsection: 'normative_references' }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    // -> Reported by validatePublishedDraftReferences only
    expect(res).toEqual([])
  })

  test('OUTDATED_DRAFT when there is a newer version', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.draftStatusReferences', [
      { value: 'draft-ietf-stale-01', subsection: 'normative_references' }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res).toEqual([
      new ValidationWarning(
        'OUTDATED_DRAFT',
        'The draft reference draft-ietf-stale-01 is stale. draft-ietf-stale was replaced by draft-ietf-newer, whose latest revision is -03.',
        { ref: 'https://datatracker.ietf.org/doc/draft-ietf-stale' }
      )
    ])
  })

  test('OUTDATED_DRAFT when there is a newer revision of the same draft', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.draftStatusReferences', [
      { value: 'draft-ietf-bess-rfc7432bis-10', subsection: 'normative_references' }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res).toEqual([
      new ValidationWarning(
        'OUTDATED_DRAFT',
        'The draft reference draft-ietf-bess-rfc7432bis-10 is stale. Its latest revision is -14.',
        { ref: 'https://datatracker.ietf.org/doc/draft-ietf-bess-rfc7432bis' }
      )
    ])
  })

  test('OUTDATED_DRAFT names the end of a chain of replacements', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.draftStatusReferences', [
      { value: 'draft-ldbc-cats-framework-06', subsection: 'normative_references' }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res).toEqual([
      new ValidationWarning(
        'OUTDATED_DRAFT',
        'The draft reference draft-ldbc-cats-framework-06 is stale. draft-ldbc-cats-framework was replaced by draft-ietf-cats-framework, whose latest revision is -10.',
        { ref: 'https://datatracker.ietf.org/doc/draft-ldbc-cats-framework' }
      )
    ])
  })

  test('OUTDATED_DRAFT names the RFC when the chain of replacements ends in an RFC', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.draftStatusReferences', [
      { value: 'draft-ldbc-cats-replaced-rfc-06', subsection: 'normative_references' }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res).toEqual([
      new ValidationWarning(
        'OUTDATED_DRAFT',
        'The draft reference draft-ldbc-cats-replaced-rfc-06 is stale. draft-ldbc-cats-replaced-rfc was replaced by draft-ietf-cats-replacement, which has been published as RFC 10053.',
        { ref: 'https://datatracker.ietf.org/doc/draft-ldbc-cats-replaced-rfc' }
      )
    ])
  })

  test('no OUTDATED_DRAFT for a draft that was itself published as an RFC', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.draftStatusReferences', [
      { value: 'draft-ietf-quic-transport-34', subsection: 'normative_references' }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res).toHaveLength(0)
  })

  test('no warnings for a versionless reference to a current draft', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.draftStatusReferences', [
      { value: 'draft-ietf-bess-rfc7432bis', subsection: 'normative_references' }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res).toHaveLength(0)
  })

  test('versionless reference to a replaced draft does not mention an empty version', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.draftStatusReferences', [
      { value: 'draft-ldbc-cats-framework', subsection: 'normative_references' }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res).toEqual([
      new ValidationWarning(
        'OUTDATED_DRAFT',
        'The draft reference draft-ldbc-cats-framework is stale. draft-ldbc-cats-framework was replaced by draft-ietf-cats-framework, whose latest revision is -10.',
        { ref: 'https://datatracker.ietf.org/doc/draft-ldbc-cats-framework' }
      )
    ])
  })

  test('empty result in SUBMISSION mode', async () => {
    const doc = cloneDeep(baseTXTDoc)
    set(doc, 'data.extractedElements.draftStatusReferences', [
      { value: 'draft-ietf-any-01', subsection: 'normative_references' }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.SUBMISSION })
    expect(res).toHaveLength(0)
  })
})

describe('validateReferenceForStale (XML)', () => {
  test('no warnings if draft version matches latest', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.back.references.references', [
      {
        name: 'Normative References',
        reference: [
          { _attr: { anchor: 'draft-ietf-example2-03' } }
        ]
      }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res).toHaveLength(0)
  })

  test('nothing when no rev_history in XML', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.back.references.references', [
      { name: 'Normative references', reference: [{ _attr: { anchor: 'draft-ietf-missing-01' }, seriesInfo: [{ _attr: { name: 'Internet-Draft', value: 'draft-ietf-missing-01' } }] }] }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    // -> Reported by validatePublishedDraftReferences only
    expect(res).toEqual([])
  })

  test('OUTDATED_DRAFT when XML draft is stale', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.back.references.references', [
      { name: 'Normative references', reference: [{ _attr: { anchor: 'draft-ietf-stale-01' }, seriesInfo: [{ _attr: { name: 'Internet-Draft', value: 'draft-ietf-stale-01' } }] }] }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res).toEqual([
      new ValidationWarning(
        'OUTDATED_DRAFT',
        'The draft reference draft-ietf-stale-01 is stale. draft-ietf-stale was replaced by draft-ietf-newer, whose latest revision is -03.',
        { ref: 'https://datatracker.ietf.org/doc/draft-ietf-stale' }
      )
    ])
  })

  test('OUTDATED_DRAFT in a parsed single nested references section', async () => {
    const doc = await parseXMLBack(nestedReferences('Informative References', '<reference anchor="I-D.ietf-stale"><front/><seriesInfo name="Internet-Draft" value="draft-ietf-stale-01"/></reference>'))

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res).toEqual([
      new ValidationWarning(
        'OUTDATED_DRAFT',
        'The draft reference draft-ietf-stale-01 is stale. draft-ietf-stale was replaced by draft-ietf-newer, whose latest revision is -03.',
        { ref: 'https://datatracker.ietf.org/doc/draft-ietf-stale' }
      )
    ])
  })

  test('OUTDATED_DRAFT when XML references an older revision of the same draft', async () => {
    const doc = await parseXMLBack(nestedReferences('Normative References', '<reference anchor="I-D.ietf-bess-rfc7432bis"><front/><seriesInfo name="Internet-Draft" value="draft-ietf-bess-rfc7432bis-10"/></reference>'))

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res).toEqual([
      new ValidationWarning(
        'OUTDATED_DRAFT',
        'The draft reference draft-ietf-bess-rfc7432bis-10 is stale. Its latest revision is -14.',
        { ref: 'https://datatracker.ietf.org/doc/draft-ietf-bess-rfc7432bis' }
      )
    ])
  })

  test('OUTDATED_DRAFT for a draft pulled in by xi:include', async () => {
    const doc = await parseXMLBack(nestedReferences('Informative References', `
      <xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://bib.ietf.org/public/rfc/bibxml3/reference.I-D.ietf-stale.xml"/>`))

    const res = await validateReferenceForStale(doc, { mode: MODES.NORMAL })
    expect(res).toEqual([
      new ValidationWarning(
        'OUTDATED_DRAFT',
        'The draft reference draft-ietf-stale is stale. draft-ietf-stale was replaced by draft-ietf-newer, whose latest revision is -03.',
        { ref: 'https://datatracker.ietf.org/doc/draft-ietf-stale' }
      )
    ])
  })

  test('empty result in SUBMISSION mode (XML)', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.back.references.references', [
      {
        name: 'Normative References',
        reference: [
          { _attr: { anchor: 'draft-ietf-any-01' } }
        ]
      }
    ])

    const res = await validateReferenceForStale(doc, { mode: MODES.SUBMISSION })
    expect(res).toHaveLength(0)
  })
})

describe('Draft references are checked for both document types', () => {
  const findTask = (docType) => getAllValidations(docType).flatMap(group => group.tasks.map(task => ({ group: group.key, ...task }))).find(task => task.key === 'draftrefs')

  test('registered with the common validations', () => {
    expect(findTask('txt').group).toBe('common')
    expect(findTask('xml').group).toBe('common')
  })

  test('XML document', async () => {
    const { doc } = await parse(`<rfc version="3" docName="draft-test-draftrefs-00"><back><references><name>Informative References</name>
      <reference anchor="I-D.ietf-published-as-rfc"><front><title>Published</title></front><seriesInfo name="Internet-Draft" value="draft-ietf-published-as-rfc-01"/></reference>
    </references></back></rfc>`, 'draft-test-draftrefs-00.xml')
    const result = await findTask('xml').task({ doc, options: { mode: MODES.NORMAL } })
    expect(result).toEqual([
      new ValidationWarning(
        'INVALID_STATE_FOR_DRAFT',
        'The draft reference draft-ietf-published-as-rfc is already published as an RFC and should not be referenced as a draft.',
        { ref: 'https://datatracker.ietf.org/doc/draft-ietf-published-as-rfc' }
      )
    ])
  })
})

describe('Draft references of published RFCs and drafts that cannot be fetched', () => {
  const runTask = async (doc, key) => {
    const task = getAllValidations(doc.type).flatMap(group => group.tasks).find(task => task.key === key)
    return task.task({ doc, options: { mode: MODES.NORMAL } })
  }
  const runDraftChecks = async (doc) => [...await runTask(doc, 'draftrefs'), ...await runTask(doc, 'referenceStale')]

  const parseXMLDraftRefs = async (rfcAttrs) => {
    const reference = (name, anchor) => `<reference anchor="${anchor}"><front><title>T</title></front><seriesInfo name="Internet-Draft" value="${name}"/></reference>`
    const { doc } = await parse(`<rfc version="3" docName="draft-test-draftrefs-00"${rfcAttrs}><back>
      <references><name>Normative References</name>${reference('draft-ietf-published-as-rfc-01', 'A')}${reference('draft-ietf-missing-01', 'B')}</references>
      <references><name>Informative References</name>${reference('draft-ietf-missing-02', 'C')}</references>
    </back></rfc>`, 'draft-test-draftrefs-00.xml')
    return doc
  }

  const parseTXTDraftRefs = async (rfcNumber) => {
    const header = rfcNumber
      ? `
Internet Engineering Task Force (IETF)                         A. Author
Request for Comments: ${rfcNumber}                                      Example
Category: Standards Track                                    August 2026
ISSN: 2070-1721


                          Example Protocol

Abstract

   This document describes an example.
`
      : CANONICAL_TXT
    const entry = (name, anchor) => `   [${anchor}]  Example, A., "Example", Work in Progress, Internet-Draft,
              ${name}, 2 January 2025,
              <https://datatracker.ietf.org/doc/html/${name}>.`
    const txt = `${header}
1.  Introduction

   This document cites [A], [B] and [C].

2.  References

2.1.  Normative References

${entry('draft-ietf-published-as-rfc-01', 'A')}

${entry('draft-ietf-missing-01', 'B')}

2.2.  Informative References

${entry('draft-ietf-missing-01', 'C')}
`
    return parseTXT(txt, rfcNumber ? `rfc${rfcNumber}.txt` : 'draft-ietf-beep-boop-01.txt')
  }

  const expected = [
    new ValidationWarning(
      'INVALID_STATE_FOR_DRAFT',
      'The draft reference draft-ietf-published-as-rfc is already published as an RFC and should not be referenced as a draft.',
      { ref: 'https://datatracker.ietf.org/doc/draft-ietf-published-as-rfc' }
    ),
    new ValidationWarning(
      'UNDEFINED_STATE',
      'The draft reference draft-ietf-missing does not have a defined state or could not be fetched.',
      { ref: 'https://datatracker.ietf.org/doc/draft-ietf-missing' }
    )
  ]

  test('a draft that cannot be fetched is reported once (XML)', async () => {
    await expect(runDraftChecks(await parseXMLDraftRefs(''))).resolves.toEqual(expected)
  })

  test('a draft that cannot be fetched is reported once (TXT)', async () => {
    const doc = await parseTXTDraftRefs()
    expect(doc.data.extractedElements.draftStatusReferences).toHaveLength(3)
    // -> Where the draft is linked to, in each references subsection that links to it
    await expect(runDraftChecks(doc)).resolves.toEqual([
      new ValidationWarning(expected[0].name, expected[0].message, { ref: expected[0].refUrl, lines: locate(doc, 'html/draft-ietf-published-as-rfc-01>', 'draft-ietf-published-as-rfc-01') }),
      new ValidationWarning(expected[1].name, expected[1].message, { ref: expected[1].refUrl, lines: locate(doc, 'html/draft-ietf-missing-01>', 'draft-ietf-missing-01') })
    ])
    expect(locate(doc, 'html/draft-ietf-missing-01>')).toHaveLength(2)
  })

  test('not checked for a published RFC (XML)', async () => {
    const doc = await parseXMLDraftRefs(' number="9999" prepTime="2026-01-01T00:00:00"')
    await expect(runTask(doc, 'draftrefs')).resolves.toHaveLength(0)
  })

  test('checked for an RFC Editor working copy (XML)', async () => {
    const doc = await parseXMLDraftRefs(' number="9999"')
    await expect(runTask(doc, 'draftrefs')).resolves.toEqual(expected)
  })

  test('not checked for a published RFC (TXT)', async () => {
    const doc = await parseTXTDraftRefs('9999')
    expect(doc.docKind).toBe('rfc')
    expect(doc.data.extractedElements.draftStatusReferences).toHaveLength(3)
    await expect(runTask(doc, 'draftrefs')).resolves.toHaveLength(0)
  })
})

describe('Remote lookups are shared by the checks of a run', () => {
  const runAll = async (doc) => {
    const tasks = getAllValidations(doc.type).flatMap(group => group.tasks).filter(task => ['downrefs', 'normrefs', 'draftrefs', 'referenceStale'].includes(task.key))
    return Promise.all(tasks.map(task => task.task({ doc, options: { mode: MODES.NORMAL } })))
  }
  const countRequests = () => {
    const counts = {}
    server.use(http.get(/^https:\/\/(datatracker\.ietf\.org|www\.rfc-editor\.org)\//, ({ request }) => {
      const path = new URL(request.url).pathname
      counts[path] = (counts[path] ?? 0) + 1
      return path === '/doc/draft-ietf-counted/doc.json'
        ? HttpResponse.json({ state: 'Active', rev_history: [{ rev: '01', name: 'draft-ietf-counted' }] })
        : HttpResponse.json({ status: 'Proposed Standard' })
    }))
    return counts
  }

  test('each draft and RFC is fetched once per document (TXT)', async () => {
    const counts = countRequests()
    const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

   This document cites [RFC8888] and [I-D.ietf-counted].

2.  Normative References

   [RFC8888]  Example, A., "Example", RFC 8888, DOI 10.17487/RFC8888,
              January 2020, <https://www.rfc-editor.org/info/rfc8888>.

   [I-D.ietf-counted]
              Example, A., "Example", Work in Progress, Internet-Draft,
              draft-ietf-counted-01, 2 January 2025,
              <https://datatracker.ietf.org/doc/html/draft-ietf-counted-01>.
`, 'draft-ietf-beep-boop-01.txt')
    await runAll(doc)
    expect(counts['/doc/draft-ietf-counted/doc.json']).toBe(1)
    expect(counts['/rfc/rfc8888.json']).toBe(1)

    // -> A new run fetches fresh data
    await runAll(cloneDeep(doc))
    expect(counts['/doc/draft-ietf-counted/doc.json']).toBe(2)
  })

  test('each draft and RFC is fetched once per document (XML)', async () => {
    const counts = countRequests()
    const doc = await parseXMLBack(`<references><name>Normative References</name>
      <reference anchor="RFC8888"><front><title>T</title></front><seriesInfo name="RFC" value="8888"/></reference>
      <reference anchor="I-D.ietf-counted"><front><title>T</title></front><seriesInfo name="Internet-Draft" value="draft-ietf-counted-01"/></reference>
    </references>`)
    await runAll(doc)
    expect(counts['/doc/draft-ietf-counted/doc.json']).toBe(1)
    expect(counts['/rfc/rfc8888.json']).toBe(1)
  })
})
