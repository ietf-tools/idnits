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
      const doc = cloneDeep(baseTXTDoc)
      set(doc, 'data.extractedElements.referenceSectionRfc', [{ value: '1094', subsection: 'normative_references' }])
      set(doc, 'data.extractedElements.draftStatusReferences', [{ value: 'ISO10589', subsection: 'normative_references' }])
      set(doc, 'data.header.intendedStatus', null)

      const result = await validateDownrefs(doc, { mode: MODES.FORGIVE_CHECKLIST })
      expect(result).toHaveLength(1)
      expect(result).toContainError('POSSIBLE_DOWNREF', ValidationWarning)
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

    test('invalid XML ref for a draft', async () => {
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
      expect(result).toHaveLength(0)
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
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        )
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
    const ref = { ref: 'https://authors.ietf.org/en/required-content#references' }

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
        { ref: 'https://authors.ietf.org/en/required-content#references' }
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
        { ref: 'https://authors.ietf.org/en/required-content#references' }
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
    await expect(runDraftChecks(doc)).resolves.toEqual(expected)
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
