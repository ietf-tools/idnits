import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationError, ValidationWarning, ValidationComment } from '../lib/helpers/error.mjs'
import { addXmlSourceLines, labelFindings } from '../lib/helpers/location.mjs'
import { detectDeprecatedElements, detectDeprecatedAttributes, validateCodeBlocks, validateTextLikeRefs, validateIprAttribute, validatePreptimeAttribute, detectPrepToolOutput, validateSubmissionType, validateTabs, validateLinePI, validateXMLBoilerplate, validateArtworkSize } from '../lib/modules/xml.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

expect.extend({
  toContainError
})

export const mockRestHandlers = [
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-ietf-beep-boop/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/ietf/' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-ietf-beep-boop2/', () => {
    return new HttpResponse(null, { status: 404 })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-ietf-beep-boop3/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/iab/' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-ietf-beep-boop4/', () => {
    return HttpResponse.json({ stream: null })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-beep-boop5/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/ise/' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-beep-boop6/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/editorial/' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-beep-boop7/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/ietf/' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-beep-boop8/', () => {
    return HttpResponse.json({ stream: null })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/rfc9999/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/ietf/' })
  }),
  http.get('https://datatracker.ietf.org/api/v1/doc/document/draft-iab-beep-boop/', () => {
    return HttpResponse.json({ stream: '/api/v1/name/streamname/ietf/' })
  }),
  http.all('*', () => {
    return new HttpResponse(null, { status: 404 })
  })
]

const server = setupServer(...mockRestHandlers)

describe('XML document should not use deprecated elements', () => {
  test('valid ipr value', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.t', 'test')
    await expect(detectDeprecatedElements(doc)).resolves.toHaveLength(0)
  })
  test('deprecated element at first level', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.c', 'test')
    await expect(detectDeprecatedElements(doc)).resolves.toContainError('DEPRECATED_ELEMENT', ValidationWarning)
  })
  test('deprecated element nested deep', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.front.title', 'test')
    set(doc, 'data.rfc.front.author.address.spanx', 'test')
    await expect(detectDeprecatedElements(doc)).resolves.toContainError('DEPRECATED_ELEMENT', ValidationWarning)
  })
  test('attribute named like a deprecated element', async () => {
    const { doc } = await parse(`<rfc version="3"><middle><section><name>Introduction</name>
      <t>See <xref target="RFC9000" format="counter"/> and <u format="num">ü</u>.</t>
    </section></middle></rfc>`, 'draft-test.xml')
    await expect(detectDeprecatedElements(doc)).resolves.toHaveLength(0)
  })
  test('deprecated element alongside attribute named like it', async () => {
    const { doc } = await parse(`<rfc version="3"><back><references><name>Normative References</name>
      <reference anchor="RFC9000"><front><title>QUIC</title></front><format type="TXT" target="https://example.com"/></reference>
    </references></back></rfc>`, 'draft-test.xml')
    const result = await detectDeprecatedElements(doc)
    expect(result).toHaveLength(1)
    expect(result).toContainError('DEPRECATED_ELEMENT', ValidationWarning)
    expect(result[0].path).toBe('rfc.back.references.reference.format')
  })
  test('deprecated relref element', async () => {
    const { doc } = await parse(`<rfc version="3"><middle><section><name>Introduction</name>
      <t>See <relref target="RFC9000" section="2"/> and <xref target="RFC9000" section="3" relative="#section-3"/>.</t>
    </section></middle></rfc>`, 'draft-test.xml')
    const result = await detectDeprecatedElements(doc)
    expect(result).toHaveLength(1)
    expect(result).toContainError('DEPRECATED_ELEMENT', ValidationWarning)
    expect(result[0].path).toBe('rfc.middle.section.t.relref')
    expect(result[0].message).toContain('The <relref> element is deprecated. Instead, use <xref>')
  })
  describe('deprecated attributes', () => {
    const parseDoc = async (body, rfcAttrs = '') => {
      const { doc } = await parse(`<rfc version="3"${rfcAttrs}>${body}</rfc>`, 'draft-test-attributes-00.xml')
      return doc
    }
    const inSection = (xml) => `<middle><section><name>Introduction</name>${xml}</section></middle>`

    test.each([
      ['artwork', 'height', inSection('<artwork height="10">x</artwork>'), 'rfc.middle.section.artwork._attr.height'],
      ['artwork', 'width', inSection('<artwork width="10">x</artwork>'), 'rfc.middle.section.artwork._attr.width'],
      ['artwork', 'xml:space', inSection('<artwork xml:space="preserve">x</artwork>'), 'rfc.middle.section.artwork._attr.xml:space'],
      ['figure', 'align', inSection('<figure align="center"><artwork>x</artwork></figure>'), 'rfc.middle.section.figure._attr.align'],
      ['figure', 'alt', inSection('<figure alt="Text"><artwork>x</artwork></figure>'), 'rfc.middle.section.figure._attr.alt'],
      ['figure', 'height', inSection('<figure height="10"><artwork>x</artwork></figure>'), 'rfc.middle.section.figure._attr.height'],
      ['figure', 'src', inSection('<figure src="a.svg"><artwork>x</artwork></figure>'), 'rfc.middle.section.figure._attr.src'],
      ['figure', 'suppress-title', inSection('<figure suppress-title="true"><artwork>x</artwork></figure>'), 'rfc.middle.section.figure._attr.suppress-title'],
      ['figure', 'title', inSection('<figure title="Diagram"><artwork>x</artwork></figure>'), 'rfc.middle.section.figure._attr.title'],
      ['figure', 'width', inSection('<figure width="10"><artwork>x</artwork></figure>'), 'rfc.middle.section.figure._attr.width'],
      ['note', 'title', '<front><note title="Note"><t>x</t></note></front>', 'rfc.front.note._attr.title'],
      ['references', 'title', '<back><references title="Normative References"><reference anchor="RFC2119"/></references></back>', 'rfc.back.references._attr.title'],
      ['section', 'title', '<middle><section title="Introduction"><t>x</t></section></middle>', 'rfc.middle.section._attr.title'],
      ['seriesInfo', 'status', '<front><seriesInfo name="Internet-Draft" value="draft-test-attributes-00" status="standard"/></front>', 'rfc.front.seriesInfo._attr.status'],
      ['seriesInfo', 'stream', '<front><seriesInfo name="Internet-Draft" value="draft-test-attributes-00" stream="IETF"/></front>', 'rfc.front.seriesInfo._attr.stream'],
      ['t', 'hangText', inSection('<t><list style="hanging"><t hangText="Term">x</t></list></t>'), 'rfc.middle.section.t.list.t._attr.hangText'],
      ['texttable', 'title', inSection('<texttable title="Table"><ttcol>A</ttcol><c>1</c></texttable>'), 'rfc.middle.section.texttable._attr.title'],
      ['xref', 'pageno', inSection('<t>See <xref target="RFC2119" pageno="false"/>.</t>'), 'rfc.middle.section.t.xref._attr.pageno']
    ])('<%s %s>', async (element, attribute, body, path) => {
      const doc = await parseDoc(body)
      for (const mode of [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]) {
        const result = await detectDeprecatedAttributes(doc, { mode })
        expect(result).toHaveLength(1)
        expect(result).toContainError('DEPRECATED_ATTRIBUTE', ValidationWarning)
        expect(result[0].path).toBe(path)
        expect(result[0].message).toContain(`The ${attribute} attribute of <${element}> is deprecated`)
      }
    })
    test('reports each attribute once, with a count and the first use', async () => {
      const doc = await parseDoc(`<middle>
        <section title="Introduction"><t>x</t>
          <section title="Background"><t>x</t></section>
        </section>
        <section title="Security Considerations"><t>x</t></section>
      </middle>`)
      const result = await detectDeprecatedAttributes(doc)
      expect(result.map(r => r.path)).toEqual(['rfc.middle.section[0]._attr.title'])
      expect(result[0].message).toBe('The title attribute of <section> is deprecated and is used 3 times (first: title="Introduction"). Instead, use a <name> child element.')
    })
    test('references title in nested and flat layouts', async () => {
      const nested = await parseDoc(`<back><references title="References">
        <references title="Normative References"><reference anchor="RFC2119"/></references>
        <references><name>Informative References</name><reference anchor="RFC8174"/></references>
      </references></back>`)
      const nestedResult = await detectDeprecatedAttributes(nested)
      expect(nestedResult.map(r => r.path)).toEqual(['rfc.back.references._attr.title'])
      expect(nestedResult[0].message).toContain('is used 2 times')
      const flat = await parseDoc(`<back>
        <references title="Normative References"><reference anchor="RFC2119"/></references>
        <references title="Informative References"><reference anchor="RFC8174"/></references>
      </back>`)
      const flatResult = await detectDeprecatedAttributes(flat)
      expect(flatResult.map(r => r.path)).toEqual(['rfc.back.references[0]._attr.title'])
      expect(flatResult[0].message).toContain('is used 2 times')
    })
    test('attributes that are not deprecated', async () => {
      const doc = await parseDoc(`<front><title>Test</title></front>${inSection(`
        <t>See <xref target="RFC2119" format="counter"/> and <xref target="RFC8174" format="none"/>.</t>
        <figure><name>Diagram</name><artwork align="center" alt="Text" src="a.svg">x</artwork></figure>`)}
        <back><references><name>Normative References</name>
          <reference anchor="RFC2119" quote-title="false"><front><title>Key words</title></front></reference>
        </references></back>`, ' consensus="yes"')
      await expect(detectDeprecatedAttributes(doc)).resolves.toHaveLength(0)
    })
    test('attribute named like a deprecated attribute on another element', async () => {
      const doc = await parseDoc(inSection('<table title="Table"><tr><td>1</td></tr></table><t pageno="false">x</t><artwork name="a.txt" src="a.svg">x</artwork>'))
      await expect(detectDeprecatedAttributes(doc)).resolves.toHaveLength(0)
    })
    test('deprecated elements ignore deprecated attributes', async () => {
      const doc = await parseDoc('<middle><section title="Introduction"><t><xref target="RFC2119" pageno="false"/></t></section></middle>')
      await expect(detectDeprecatedElements(doc)).resolves.toHaveLength(0)
    })
    test('attributes added by the prep tool are not reported in prepped XML', async () => {
      const body = `<front><seriesInfo name="RFC" value="9999" stream="IETF" status="standard"/></front>${inSection('<figure align="left" suppress-title="false"><artwork>x</artwork></figure>')}`
      const prepped = await parseDoc(body, ' prepTime="2026-01-01T00:00:00"')
      await expect(detectDeprecatedAttributes(prepped)).resolves.toHaveLength(0)
      const unprepped = await parseDoc(body)
      const result = await detectDeprecatedAttributes(unprepped)
      expect(result.map(r => r.path).sort()).toEqual([
        'rfc.front.seriesInfo._attr.status',
        'rfc.front.seriesInfo._attr.stream',
        'rfc.middle.section.figure._attr.align',
        'rfc.middle.section.figure._attr.suppress-title'
      ])
    })
    test('other deprecated attributes are still reported in prepped XML', async () => {
      const doc = await parseDoc(inSection('<figure title="Figure"><artwork height="10">x</artwork></figure>'), ' prepTime="2026-01-01T00:00:00"')
      await expect(detectDeprecatedAttributes(doc)).resolves.toHaveLength(2)
    })
  })
})

describe('XML document should have a valid ipr attribute', () => {
  const parseDoc = async (rfcAttrs) => {
    const { doc } = await parse(`<rfc version="3" docName="draft-test-ipr-00"${rfcAttrs}><front><title>Test</title></front></rfc>`, 'draft-test-ipr-00.xml')
    return doc
  }

  test('valid ipr value', async () => {
    for (const ipr of ['trust200902', 'pre5378Trust200902']) {
      await expect(validateIprAttribute(await parseDoc(` ipr="${ipr}"`), { offline: true })).resolves.toHaveLength(0)
    }
  })
  test('missing ipr attribute', async () => {
    const result = await validateIprAttribute(await parseDoc(''), { offline: true })
    expect(result).toHaveLength(1)
    expect(result).toContainError('MISSING_IPR_ATTRIBUTE', ValidationError)
    expect(result[0].path).toBe('rfc._attr.ipr')
  })
  test('invalid ipr attribute', async () => {
    for (const ipr of ['', 'test', 'trust200811']) {
      const result = await validateIprAttribute(await parseDoc(` ipr="${ipr}"`), { offline: true })
      expect(result).toHaveLength(1)
      expect(result).toContainError('INVALID_IPR_VALUE', ValidationWarning)
      expect(result[0].message).toContain(`"${ipr}" is not a valid value`)
    }
  })
})

describe('XML document should only use a restricted ipr value outside the IETF stream', () => {
  const ALL_MODES = [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]
  const RESTRICTED = ['noModificationTrust200902', 'noDerivativesTrust200902']
  const parseDoc = async (ipr, docName, submissionType) => {
    const typeAttr = submissionType ? ` submissionType="${submissionType}"` : ''
    const { doc } = await parse(`<rfc version="3" ipr="${ipr}" docName="${docName}"${typeAttr}><front><title>Test</title></front></rfc>`, `${docName}.xml`)
    return doc
  }
  const findings = async (ipr, docName, submissionType, opts) => validateIprAttribute(await parseDoc(ipr, docName, submissionType), opts)

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())

  test('trust200902 in the IETF stream', async () => {
    for (const mode of ALL_MODES) {
      await expect(findings('trust200902', 'draft-ietf-beep-boop-01', 'IETF', { mode })).resolves.toHaveLength(0)
    }
  })
  test('IETF stream on Datatracker', async () => {
    for (const ipr of RESTRICTED) {
      for (const submissionType of ['IETF', null]) {
        // -> draft-beep-boop7 is in the IETF stream on Datatracker, though not named draft-ietf-
        await expect(findings(ipr, 'draft-beep-boop7-00', submissionType)).resolves.toContainError('FORBIDDEN_IPR_VALUE_FOR_STREAM', ValidationError)
        await expect(findings(ipr, 'draft-beep-boop7-00', submissionType, { mode: MODES.SUBMISSION })).resolves.toContainError('FORBIDDEN_IPR_VALUE_FOR_STREAM', ValidationError)
        await expect(findings(ipr, 'draft-beep-boop7-00', submissionType, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('FORBIDDEN_IPR_VALUE_FOR_STREAM', ValidationWarning)
      }
    }
    const [entry] = await findings('noDerivativesTrust200902', 'draft-beep-boop7-00', 'IETF')
    expect(entry.message).toBe('The ipr attribute "noDerivativesTrust200902" gives the Trust Legal Provisions notice (Section 6.c) that withholds the right to produce derivative works, and an IETF working group can only work on a document that grants that right (RFC 5378, Section 3.3). Datatracker has this draft in the IETF stream, so the notice can\'t be used. Use ipr="trust200902" (or "pre5378Trust200902").')
    expect(entry.refUrl).toBe('https://www.rfc-editor.org/rfc/rfc5378.html#section-3.3')
    expect(entry.path).toBe('rfc._attr.ipr')
  })
  test('Datatracker IETF stream over a declared stream', async () => {
    // -> Datatracker decides the stream; the disagreement is SUBMISSION_TYPE_UNEXPECTED
    await expect(findings('noModificationTrust200902', 'draft-beep-boop7-00', 'independent')).resolves.toContainError('FORBIDDEN_IPR_VALUE_FOR_STREAM', ValidationError)
  })
  test('draft-ietf- name', async () => {
    for (const ipr of RESTRICTED) {
      // -> Online: Datatracker doesn't have the draft or has no stream for it; offline
      for (const [docName, opts] of [['draft-ietf-beep-boop2-00', {}], ['draft-ietf-beep-boop4-00', {}], ['draft-ietf-beep-boop3-00', { offline: true }]]) {
        await expect(findings(ipr, docName, null, { ...opts })).resolves.toContainError('FORBIDDEN_IPR_VALUE_FOR_STREAM', ValidationError)
        await expect(findings(ipr, docName, 'IETF', { ...opts, mode: MODES.SUBMISSION })).resolves.toContainError('FORBIDDEN_IPR_VALUE_FOR_STREAM', ValidationError)
        await expect(findings(ipr, docName, 'independent', { ...opts, mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('FORBIDDEN_IPR_VALUE_FOR_STREAM', ValidationWarning)
      }
    }
    const [entry] = await findings('noModificationTrust200902', 'draft-ietf-beep-boop2-00', 'IETF')
    expect(entry.message).toContain('Datatracker puts a draft named draft-ietf-... in the IETF stream, so the notice can\'t be used.')
  })
  test('IETF declared or defaulted, stream otherwise unknown', async () => {
    for (const ipr of RESTRICTED) {
      for (const submissionType of ['IETF', null]) {
        for (const mode of ALL_MODES) {
          // -> No stream on Datatracker, not on Datatracker, offline
          for (const [docName, opts] of [['draft-beep-boop8-00', {}], ['draft-beep-boop9-00', {}], ['draft-beep-boop7-00', { offline: true }]]) {
            const result = await findings(ipr, docName, submissionType, { ...opts, mode })
            expect(result).toHaveLength(1)
            expect(result).toContainError('FORBIDDEN_IPR_VALUE_FOR_STREAM', ValidationWarning)
          }
        }
      }
    }
    const message = async (submissionType, docName, opts) => (await findings('noDerivativesTrust200902', docName, submissionType, opts))[0].message
    await expect(message('IETF', 'draft-beep-boop8-00')).resolves.toContain('(RFC 5378, Section 3.3). The rfc tag declares submissionType="IETF", and Datatracker has no stream for this draft yet. If the draft is meant for the IETF stream, use ipr="trust200902" (or "pre5378Trust200902"); if not, declare its stream with the submissionType attribute.')
    await expect(message(null, 'draft-beep-boop9-00')).resolves.toContain('The rfc tag has no submissionType attribute, so the draft is treated as submissionType="IETF", and Datatracker doesn\'t have this draft yet.')
    await expect(message('IETF', 'draft-beep-boop7-00', { offline: true })).resolves.toContain('and its stream was not looked up on Datatracker (offline).')
  })
  test('other streams', async () => {
    for (const ipr of RESTRICTED) {
      for (const mode of ALL_MODES) {
        // -> Declared, Datatracker having no stream, not having the draft, or offline
        for (const submissionType of ['independent', 'IAB', 'IRTF', 'editorial']) {
          await expect(findings(ipr, 'draft-beep-boop8-00', submissionType, { mode })).resolves.toHaveLength(0)
          await expect(findings(ipr, 'draft-beep-boop9-00', submissionType, { mode })).resolves.toHaveLength(0)
          await expect(findings(ipr, 'draft-beep-boop7-00', submissionType, { mode, offline: true })).resolves.toHaveLength(0)
        }
        // -> Datatracker stream, whatever the declared stream
        await expect(findings(ipr, 'draft-beep-boop5-00', 'independent', { mode })).resolves.toHaveLength(0)
        await expect(findings(ipr, 'draft-beep-boop5-00', null, { mode })).resolves.toHaveLength(0)
        await expect(findings(ipr, 'draft-beep-boop6-00', 'IETF', { mode })).resolves.toHaveLength(0)
        await expect(findings(ipr, 'draft-ietf-beep-boop3-00', 'IETF', { mode })).resolves.toHaveLength(0)
        // -> Name of the draft
        await expect(findings(ipr, 'draft-irtf-beep-boop-00', null, { mode, offline: true })).resolves.toHaveLength(0)
        await expect(findings(ipr, 'draft-iab-beep-boop-00', 'IAB', { mode, offline: true })).resolves.toHaveLength(0)
      }
    }
  })
  test('RFC', async () => {
    const parseRfc = async (submissionType) => {
      const typeAttr = submissionType ? ` submissionType="${submissionType}"` : ''
      const { doc } = await parse(`<rfc version="3" ipr="noModificationTrust200902" number="9999"${typeAttr}><front><title>Test</title><seriesInfo name="RFC" value="9999"/></front></rfc>`, 'rfc9999.xml')
      expect(doc.docKind).toBe('rfc')
      return doc
    }
    // -> Datatracker has rfc9999 in the IETF stream
    await expect(validateIprAttribute(await parseRfc('independent'))).resolves.toContainError('FORBIDDEN_IPR_VALUE_FOR_STREAM', ValidationError)
    const [entry] = await validateIprAttribute(await parseRfc(null), { offline: true })
    expect(entry).toBeInstanceOf(ValidationWarning)
    expect(entry.message).toContain('so the RFC is treated as submissionType="IETF", and its stream was not looked up on Datatracker (offline). If the RFC is meant')
    await expect(validateIprAttribute(await parseRfc('independent'), { offline: true })).resolves.toHaveLength(0)
  })
})

describe('XML document should not have a prepTime attribute', () => {
  const parseDoc = async (body, rfcAttrs = '') => {
    const { doc } = await parse(`<rfc version="3" ipr="trust200902" docName="draft-test-prep-00"${rfcAttrs}>${body}</rfc>`, 'draft-test-prep-00.xml')
    return doc
  }
  const front = (xml = '') => `<front><title>Test</title>${xml}</front>`
  const inSection = (xml) => `${front()}<middle><section><name>Introduction</name>${xml}</section></middle>`
  const PREPTIME = ' prepTime="2026-01-01T00:00:00"'

  test('non-existing prepTime attribute', async () => {
    const doc = cloneDeep(baseXMLDoc)
    await expect(validatePreptimeAttribute(doc)).resolves.toHaveLength(0)
  })
  test('present prepTime attribute', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.prepTime', '2020-01-02T22:11:00')
    await expect(validatePreptimeAttribute(doc)).resolves.toContainError('RFC_PREPTIME_ATTRIBUTE', ValidationComment)
    await expect(validatePreptimeAttribute(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('RFC_PREPTIME_ATTRIBUTE', ValidationComment)
    await expect(validatePreptimeAttribute(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('RFC_PREPTIME_ATTRIBUTE', ValidationError)
  })
  test('present prepTime attribute is stated neutrally outside of submission', async () => {
    const doc = await parseDoc(front(), PREPTIME)
    for (const mode of [MODES.NORMAL, MODES.FORGIVE_CHECKLIST]) {
      const result = await validatePreptimeAttribute(doc, { mode })
      expect(result).toHaveLength(1)
      expect(result[0].message).toBe('This document has been prepped by xml2rfc (prepTime="2026-01-01T00:00:00").')
    }
    const result = await validatePreptimeAttribute(doc, { mode: MODES.SUBMISSION })
    expect(result[0].message).toBe('The prepTime attribute should not be present on the <rfc> element.')
  })

  describe('prep tool output', () => {
    test.each([
      ['expiresDate attribute on <rfc>', front(), ' expiresDate="2026-07-01"', 1, 'rfc._attr.expiresDate'],
      ['scripts attribute on <rfc>', front(), ' scripts="Common,Latin"', 1, 'rfc._attr.scripts'],
      ['<link rel="alternate"> element', `<link href="https://dx.doi.org/10.17487/rfc9999" rel="alternate"/><link href="urn:issn:2070-1721" rel="alternate"/>${front()}`, '', 2, 'rfc.link[0]'],
      ['<boilerplate> element', front('<boilerplate><section anchor="copyright"><t>Copyright</t></section></boilerplate>'), '', 1, 'rfc.front.boilerplate'],
      ['<toc> element', front('<toc><section anchor="toc"><t>Contents</t></section></toc>'), '', 1, 'rfc.front.toc'],
      ['pn attribute', inSection('<t pn="section-1-1">x</t><t pn="section-1-2">y</t>'), '', 2, 'rfc.middle.section.t[0]._attr.pn'],
      ['slugifiedName attribute on <name>', `${front()}<middle><section><name slugifiedName="name-introduction">Introduction</name><t>x</t></section></middle>`, '', 1, 'rfc.middle.section.name._attr.slugifiedName'],
      ['derivedCounter attribute on <li>', inSection('<ol><li derivedCounter="1.">x</li><li derivedCounter="2.">y</li><li derivedCounter="3.">z</li></ol>'), '', 3, 'rfc.middle.section.ol.li[0]._attr.derivedCounter'],
      ['derivedContent attribute on <xref>', inSection('<t>See <xref target="RFC2119" derivedContent="RFC2119"/>.</t>'), '', 1, 'rfc.middle.section.t.xref._attr.derivedContent'],
      ['derivedLink attribute on <xref>', inSection('<t>See <xref target="RFC2119" derivedLink="https://rfc-editor.org/rfc/rfc2119"/>.</t>'), '', 1, 'rfc.middle.section.t.xref._attr.derivedLink'],
      ['generated Authors\' Addresses section', `${front()}<back><section anchor="authors-addresses"><name>Author's Address</name></section></back>`, '', 1, 'rfc.back.section'],
      ['generated index section', `${front()}<back><section anchor="rfc.index.index"><name>Index</name></section></back>`, '', 1, 'rfc.back.section']
    ])('%s', async (kind, body, rfcAttrs, count, path) => {
      const doc = await parseDoc(body, rfcAttrs)
      const result = await detectPrepToolOutput(doc)
      expect(result).toHaveLength(1)
      expect(result).toContainError('PREP_TOOL_OUTPUT_PRESENT', ValidationComment)
      expect(result[0].message).toContain(`contains output of the xml2rfc prep tool: ${kind} (${count}).`)
      expect(result[0].path).toBe(path)
    })
    test('reports several kinds in a single finding', async () => {
      const doc = await parseDoc(`<front><title>Test</title><boilerplate><section><name slugifiedName="name-copyright-notice">Copyright Notice</name><t>x</t></section></boilerplate></front>
        <middle><section pn="section-1"><name slugifiedName="name-introduction">Introduction</name><t pn="section-1-1">See <xref target="RFC2119" derivedContent="RFC2119"/>.</t></section></middle>`, ' scripts="Common,Latin"')
      const result = await detectPrepToolOutput(doc)
      expect(result).toHaveLength(1)
      expect(result[0].message).toContain('scripts attribute on <rfc> (1), <boilerplate> element (1), pn attribute (2), slugifiedName attribute on <name> (2), derivedContent attribute on <xref> (1).')
      expect(result[0].path).toBe('rfc._attr.scripts')
    })
    test('severity depends on the mode', async () => {
      const doc = await parseDoc(inSection('<t pn="section-1-1">x</t>'))
      await expect(detectPrepToolOutput(doc, { mode: MODES.NORMAL })).resolves.toContainError('PREP_TOOL_OUTPUT_PRESENT', ValidationComment)
      await expect(detectPrepToolOutput(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('PREP_TOOL_OUTPUT_PRESENT', ValidationComment)
      await expect(detectPrepToolOutput(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('PREP_TOOL_OUTPUT_PRESENT', ValidationWarning)
    })
    test('is not reported for a prepped document', async () => {
      const doc = await parseDoc(`<link href="https://dx.doi.org/10.17487/rfc9999" rel="alternate"/><front><title>Test</title><boilerplate><section><t>x</t></section></boilerplate><toc><section><t>x</t></section></toc></front>
        <middle><section pn="section-1"><name slugifiedName="name-introduction">Introduction</name><t pn="section-1-1">x</t></section></middle>
        <back><section anchor="authors-addresses"><name>Author's Address</name></section></back>`, `${PREPTIME} scripts="Common,Latin"`)
      for (const mode of [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]) {
        await expect(detectPrepToolOutput(doc, { mode })).resolves.toHaveLength(0)
      }
    })
    test('does not report attributes with default values or originalSrc', async () => {
      const doc = await parseDoc(`<front><title>Test</title></front>
        <middle><section numbered="true" toc="default"><name>Introduction</name><t indent="0">x</t><ol indent="adaptive" spacing="normal" type="1"><li>x</li></ol><figure><artwork align="left" originalSrc="a.txt">x</artwork></figure></section></middle>
        <back><references><name>References</name><reference anchor="RFC2119" quoteTitle="true"><front><title>Key words</title></front></reference></references><section anchor="acknowledgments"><name>Acknowledgments</name><t>x</t></section></back>`, ' indent="3" sortRefs="true" symRefs="true" tocDepth="3" tocInclude="true" consensus="true"')
      await expect(detectPrepToolOutput(doc)).resolves.toHaveLength(0)
    })
    test('does not report reference entries copied from a published RFC', async () => {
      const doc = await parseDoc(`<front><title>Test</title></front>
        <middle><section><name>Introduction</name><t>See <xref target="RFC8537"/>.</t></section></middle>
        <back><references><name>References</name><reference anchor="RFC8537" target="https://www.rfc-editor.org/info/rfc8537" quoteTitle="true" derivedAnchor="RFC8537"><front><title>Updates to the Fast Reroute Procedures</title><author initials="R." surname="Gandhi" fullname="R. Gandhi" role="editor"/><date year="2019" month="February"/></front><seriesInfo name="RFC" value="8537"/></reference></references></back>`)
      await expect(detectPrepToolOutput(doc)).resolves.toHaveLength(0)
    })
    test('plain draft', async () => {
      const doc = await parseDoc(inSection('<t>See <xref target="RFC2119"/>.</t><ol><li>x</li></ol>'))
      for (const mode of [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]) {
        await expect(detectPrepToolOutput(doc, { mode })).resolves.toHaveLength(0)
      }
    })
  })
})

describe('XML document should not contain <?line?> processing instructions', () => {
  const parseDoc = async (body) => {
    const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-test-line-pi-00">
  <front><title>Test</title></front>
  <middle>${body}<section><name>Introduction</name><t>Text</t></section></middle>
</rfc>`, 'draft-test-line-pi-00.xml')
    return doc
  }

  test('line processing instructions', async () => {
    const doc = await parseDoc('<?line 12?>')
    await expect(validateLinePI(doc)).resolves.toContainError('LINE_PI', ValidationComment)
    await expect(validateLinePI(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('LINE_PI', ValidationComment)
    await expect(validateLinePI(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('no line processing instructions', async () => {
    const doc = await parseDoc('<?rfc toc="yes"?>')
    await expect(validateLinePI(doc)).resolves.toHaveLength(0)
    await expect(validateLinePI(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    await expect(validateLinePI(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
})

describe('XML document should not contain <CODE BEGINS> tags', () => {
  test('valid sourcecode value', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.sourcecode', 'test')
    await expect(validateCodeBlocks(doc)).resolves.toHaveLength(0)
  })
  test('sourcecode with a <CODE BEGINS>', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.sourcecode', '<CODE BEGINS>test')
    await expect(validateCodeBlocks(doc)).resolves.toContainError('UNNECESSARY_CODE_BEGINS', ValidationWarning)
    await expect(validateCodeBlocks(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('UNNECESSARY_CODE_BEGINS', ValidationWarning)
    await expect(validateCodeBlocks(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('<CODE BEGINS> without <sourcecode> tag', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.t', '<CODE BEGINS>test')
    await expect(validateCodeBlocks(doc)).resolves.toContainError('MISSING_SOURCECODE_TAG', ValidationWarning)
    await expect(validateCodeBlocks(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_SOURCECODE_TAG', ValidationWarning)
    await expect(validateCodeBlocks(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('paths of <CODE BEGINS> findings', async () => {
    const { doc } = await parse(`<rfc version="3"><middle><section><name>Code</name>
      <t>Intro</t>
      <sourcecode>&lt;CODE BEGINS&gt; file "a.yang"</sourcecode>
    </section><section><name>More</name>
      <t>First</t>
      <t>&lt;CODE BEGINS&gt;</t>
    </section></middle></rfc>`, 'draft-test.xml')
    const result = await validateCodeBlocks(doc)
    expect(result.map(r => [r.name, r.path])).toEqual([
      ['UNNECESSARY_CODE_BEGINS', 'rfc.middle.section[0].sourcecode'],
      ['MISSING_SOURCECODE_TAG', 'rfc.middle.section[1].t[1]']
    ])
  })
})

describe('Tabs in XML documents', () => {
  const ALL_MODES = [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]
  const parseDoc = async (body, version = '3') => {
    const { doc } = await parse(`<rfc${version ? ` version="${version}"` : ''}>\n<middle>\n<section><name>Introduction</name>\n${body}\n</section>\n</middle>\n</rfc>`, 'draft-test-tabs-00.xml')
    return doc
  }

  test('no tabs', async () => {
    const doc = await parseDoc('<sourcecode>a  b</sourcecode>')
    await expect(validateTabs(doc)).resolves.toHaveLength(0)
  })

  test('tabs in <sourcecode> and <artwork type="ascii-art">, once per element', async () => {
    const doc = await parseDoc([
      '<sourcecode type="c">int\tx;\n\tx++;</sourcecode>',
      '<t>Text</t>',
      '<figure><artwork type="ascii-art"><![CDATA[+--+\t+--+]]></artwork></figure>',
      '<sourcecode>no tabs</sourcecode>'
    ].join('\n'))
    for (const mode of ALL_MODES) {
      const result = await validateTabs(doc, { mode })
      expect(result).toHaveLength(2)
      expect(result).toContainError('TABS_IN_CODE', ValidationWarning)
    }
    const [sourcecode, artwork] = await validateTabs(doc)
    expect(sourcecode.path).toBe('rfc.middle.section.sourcecode[0]')
    expect(sourcecode.message).toContain('<sourcecode> contains 2 tabs, first on line 4.')
    expect(sourcecode.lines).toEqual([{ line: 4, pos: 25 }, { line: 5, pos: 1 }])
    expect(artwork.path).toBe('rfc.middle.section.figure.artwork')
    expect(artwork.message).toContain('<artwork type="ascii-art"> contains a tab on line 7.')
    expect(artwork.lines).toEqual([{ line: 7, pos: 48 }])
  })

  test('tabs elsewhere, once per document', async () => {
    const doc = await parseDoc([
      '<t>One\ttwo</t>',
      '<artwork>untyped\tartwork</artwork>',
      '<artwork type="svg">\t<svg/></artwork>',
      '<sourcecode\ttype="c" name="a\tb">x</sourcecode>',
      '<!-- comment with a\ttab -->',
      '\t<t>Indented</t>',
      '<sourcecode>trailing\t \n\t\nx<![CDATA[\t]]>\ny\t<!-- c -->z\tz</sourcecode>'
    ].join('\n'))
    for (const mode of ALL_MODES) {
      const result = await validateTabs(doc, { mode })
      expect(result).toHaveLength(1)
      expect(result).toContainError('TABS_AS_WHITESPACE', ValidationComment)
    }
    const [result] = await validateTabs(doc)
    // -> xml2rfc strips trailing whitespace from each line of <sourcecode> before expanding tabs,
    //    and only expands them in its text before the first child, such as a comment
    expect(result.message).toContain('Document contains 12 tabs that xml2rfc treats as whitespace, first on line 4.')
    expect(result.path).toBeUndefined()
    expect(result.lines.map(({ line }) => line)).toEqual([4, 5, 6, 7, 7, 8, 9, 10, 11, 12, 13, 13])
  })

  test('a tab elsewhere', async () => {
    const [result] = await validateTabs(await parseDoc('<t>One\ttwo</t>'))
    expect(result.message).toBe('Document contains a tab that xml2rfc treats as whitespace, on line 4. xml2rfc only expands tabs, and warns about them, when other text follows them on a line of <sourcecode> or <artwork type="ascii-art">.')
    expect(result.lines).toEqual([{ line: 4, pos: 7 }])
  })

  test('first 20 tabs listed', async () => {
    const [result] = await validateTabs(await parseDoc(`<sourcecode>${'\tx'.repeat(25)}</sourcecode>`))
    expect(result.message).toContain('contains 25 tabs')
    expect(result.lines).toHaveLength(20)
  })

  test('<artwork> converted by xml2rfc from v2', async () => {
    const body = [
      '<figure><artwork><![CDATA[<CODE BEGINS>\nint\tx;\n<CODE ENDS>]]></artwork></figure>',
      '<figure><artwork>  &lt;CODE BEGINS&gt;\n\tx++;</artwork></figure>',
      '<figure><artwork src="a.svg">a\tb</artwork></figure>',
      '<figure><artwork src="a.svg">\t</artwork></figure>'
    ].join('\n')
    for (const version of ['2', null]) {
      const result = await validateTabs(await parseDoc(body, version))
      expect(result.map(r => r.name)).toEqual(['TABS_IN_CODE', 'TABS_IN_CODE', 'TABS_IN_CODE', 'TABS_AS_WHITESPACE'])
      expect(result[0].message).toContain('<artwork> (converted to <sourcecode> by xml2rfc as it starts with <CODE BEGINS>) contains a tab')
      expect(result[1].path).toBe('rfc.middle.section.figure[1].artwork')
      expect(result[2].message).toContain('<artwork> (converted to <artwork type="ascii-art"> by xml2rfc as it has both text and a src attribute) contains a tab')
    }
    // -> xml2rfc only converts documents that aren't version 3
    const result = await validateTabs(await parseDoc(body))
    expect(result).toHaveLength(1)
    expect(result[0].message).toContain('Document contains 4 tabs')
  })

  test('only the code of an <artwork> converted from <CODE BEGINS>', async () => {
    const doc = await parseDoc('<figure><artwork>\t<![CDATA[\t<CODE BEGINS> file "a\tb"\nint\tx;\n<CODE ENDS>\tx]]></artwork></figure>', '2')
    const result = await validateTabs(doc)
    expect(result.map(r => r.name)).toEqual(['TABS_IN_CODE', 'TABS_AS_WHITESPACE'])
    expect(result[0].lines).toEqual([{ line: 5, pos: 4 }])
    expect(result[1].message).toContain('Document contains 4 tabs')
  })

  test('labelled with the location of the element', async () => {
    const doc = await parseDoc('<sourcecode>\tx</sourcecode>')
    const result = await validateTabs(doc)
    labelFindings(result, doc)
    expect(result[0].label).toBe('Section 1 (Introduction), source code')
  })
})

describe('Size of <artwork> and <sourcecode>', () => {
  const ALL_MODES = [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]
  const parseDoc = async (body, version = '3') => {
    const { doc } = await parse(`<rfc${version ? ` version="${version}"` : ''}>\n<middle>\n<section><name>Introduction</name>\n${body}\n</section>\n</middle>\n</rfc>`, 'draft-test-artwork-00.xml')
    return doc
  }
  const art = (width, tag = 'artwork', attrs = '') => `<${tag}${attrs}>\n${'x'.repeat(width)}\n</${tag}>`
  const wide = async (body, version) => (await validateArtworkSize(await parseDoc(body, version))).filter(r => r.name === 'ARTWORK_TOO_WIDE').map(r => r.path)

  test('lines that fit', async () => {
    // -> Indented by 3 in a section, but xml2rfc reduces the indentation of <artwork> that doesn't fit
    await expect(validateArtworkSize(await parseDoc([art(72), art(69, 'sourcecode'), '<figure>' + art(72) + '</figure>'].join('\n')))).resolves.toHaveLength(0)
  })

  test('lines too wide, once per element', async () => {
    const doc = await parseDoc([
      '<sourcecode type="c">',
      `${'a'.repeat(70)}`,
      'short',
      `${'b'.repeat(75)}   `,
      `${'c'.repeat(71)}`,
      '</sourcecode>',
      `<figure><artwork type="ascii-art">\n${'d'.repeat(73)}\n</artwork></figure>`
    ].join('\n'))
    for (const mode of ALL_MODES) {
      const result = await validateArtworkSize(doc, { mode })
      expect(result).toHaveLength(2)
      expect(result).toContainError('ARTWORK_TOO_WIDE', mode === MODES.NORMAL ? ValidationError : ValidationWarning)
    }
    const [sourcecode, artwork] = await validateArtworkSize(doc)
    expect(sourcecode.path).toBe('rfc.middle.section.sourcecode')
    expect(sourcecode.message).toBe('<sourcecode> has 3 lines too wide for the 72 columns of xml2rfc\'s text output. The widest, line 3 of the sourcecode, is 75 characters long, and xml2rfc indents it by 3 columns there.')
    expect(artwork.path).toBe('rfc.middle.section.figure.artwork')
    expect(artwork.message).toBe('<artwork> has 1 line too wide for the 72 columns of xml2rfc\'s text output. The widest, line 1 of the artwork, is 73 characters long.')
    addXmlSourceLines([sourcecode], doc)
    expect(sourcecode.lines).toEqual([{ line: 4, pos: 1 }])
  })

  test('lines measured as xml2rfc renders them', async () => {
    // -> Tabs expanded to 8-column tab stops, trailing whitespace removed, characters counted
    //    rather than bytes, leading and trailing newlines removed
    await expect(wide([
      `<sourcecode>\tab\t${'x'.repeat(53)}\t \n</sourcecode>`,
      `<sourcecode>ab\t${'x'.repeat(62)}</sourcecode>`,
      `<sourcecode>${'é'.repeat(69)}</sourcecode>`,
      `<sourcecode>${'é'.repeat(70)}</sourcecode>`,
      `<sourcecode>${'x'.repeat(69)}\u00a0\u00a0</sourcecode>`,
      `<sourcecode><![CDATA[\n\n${'<'.repeat(69)}]]></sourcecode>`,
      `<sourcecode>${'&lt;'.repeat(70)}</sourcecode>`
    ].join('\n'))).resolves.toEqual(['rfc.middle.section.sourcecode[1]', 'rfc.middle.section.sourcecode[3]', 'rfc.middle.section.sourcecode[6]'])
  })

  test('indentation of lists, quotes and asides', async () => {
    const cases = [
      // -> In a list item, by 3 for the list (whatever its indent) and 3 for the art: <artwork> can be outdented
      [`<ul indent="8"><li><t>Item</t>${art(66, 'sourcecode')}${art(72)}</li></ul>`, []],
      [`<ol><li><t>Item</t>${art(67, 'sourcecode')}${art(73)}</li></ol>`, ['ol.li.sourcecode', 'ol.li.artwork']],
      // -> A <figure> is indented by the indent of the list
      [`<ul indent="8"><li><t>Item</t><figure>${art(61, 'sourcecode')}</figure></li></ul>`, []],
      [`<ul indent="8"><li><t>Item</t><figure>${art(62, 'sourcecode')}</figure></li></ul>`, ['ul.li.figure.sourcecode']],
      // -> ... "adaptive" fitting the widest number, a bare list fitting the first word of its last item
      [`<ol indent="adaptive" type="i">${'<li><t>Item</t></li>'.repeat(7)}<li><t>Item</t><figure>${art(62, 'sourcecode')}</figure></li></ol>`, []],
      [`<ol indent="adaptive" type="i">${'<li><t>Item</t></li>'.repeat(7)}<li><t>Item</t><figure>${art(63, 'sourcecode')}</figure></li></ol>`, ['ol.li[7].figure.sourcecode']],
      [`<ol indent="adaptive" type="Step %d:"><li><t>Item</t><figure>${art(61, 'sourcecode')}</figure></li></ol>`, ['ol.li.figure.sourcecode']],
      [`<ol indent="adaptive" type="a"><li><t>Item</t><figure>${art(66, 'sourcecode')}</figure></li></ol>`, ['ol.li.figure.sourcecode']],
      [`<ol><li><t>Item</t><figure>${art(65, 'sourcecode')}</figure></li></ol>`, []],
      [`<ol><li><t>Item</t><figure>${art(66, 'sourcecode')}</figure></li></ol>`, ['ol.li.figure.sourcecode']],
      // -> In a definition, by 3 (or the indent of the list) and not outdented
      [`<dl><dt>Term</dt><dd>${art(66)}</dd></dl>`, []],
      [`<dl><dt>Term</dt><dd>${art(67)}</dd></dl>`, ['dl.dd.artwork']],
      [`<dl indent="8"><dt>Term</dt><dd><t>Definition</t>${art(62, 'sourcecode')}</dd></dl>`, ['dl.dd.sourcecode']],
      // -> ... unless it is in a <figure>
      [`<dl><dt>Term</dt><dd><figure>${art(72)}</figure></dd></dl>`, []],
      // -> Quotes are indented by 3 and prefixed with "|  ", asides prefixed with "   |  "
      [`<blockquote>${art(69)}</blockquote>`, []],
      [`<blockquote>${art(70)}</blockquote>`, ['blockquote.artwork']],
      [`<blockquote><figure>${art(70)}</figure></blockquote>`, ['blockquote.figure.artwork']],
      [`<blockquote>${art(63, 'sourcecode')}</blockquote>`, []],
      [`<blockquote>${art(64, 'sourcecode')}</blockquote>`, ['blockquote.sourcecode']],
      [`<aside><t>Aside</t>${art(66)}</aside>`, []],
      [`<aside><t>Aside</t>${art(67)}</aside>`, ['aside.artwork']],
      [`<aside><t>Aside</t>${art(60, 'sourcecode')}</aside>`, []],
      [`<aside><t>Aside</t>${art(61, 'sourcecode')}</aside>`, ['aside.sourcecode']],
      // -> Nested lists
      [`<ul><li><t>Item</t><dl><dt>Term</dt><dd>${art(63)}</dd></dl></li></ul>`, []],
      [`<ul><li><t>Item</t><dl><dt>Term</dt><dd>${art(64)}</dd></dl></li></ul>`, ['ul.li.dl.dd.artwork']]
    ]
    for (const [body, paths] of cases) {
      await expect(wide(body), body).resolves.toEqual(paths.map(path => `rfc.middle.section.${path}`))
    }
    const [quote] = await validateArtworkSize(await parseDoc(`<blockquote>${art(70)}</blockquote>`))
    expect(quote.message).toContain('is 70 characters long, and xml2rfc can\'t reduce its indentation below 3 columns there.')
  })

  test('art not in the text output', async () => {
    await expect(validateArtworkSize(await parseDoc([
      `<artwork type="svg"><svg xmlns="http://www.w3.org/2000/svg"><desc>${'x'.repeat(80)}</desc></svg></artwork>`,
      `<artwork><svg xmlns="http://www.w3.org/2000/svg"><desc>${'x'.repeat(80)}</desc></svg></artwork>`,
      '<artwork src="https://example.com/art.txt"/>',
      `<artset><artwork type="svg" src="art.svg"/><artwork type="ascii-art">${'x'.repeat(72)}</artwork><artwork type="ascii-art">${'x'.repeat(80)}</artwork></artset>`,
      `<table><tbody><tr><td>${art(80)}</td></tr></tbody></table>`
    ].join('\n')))).resolves.toHaveLength(0)
  })

  test('v2 documents, as xml2rfc converts them', async () => {
    const body = [
      // -> The <figure> leaves the <t>
      `<t>Text<figure>${art(72)}</figure></t>`,
      // -> A hanging <list> becomes a <dl>, its <figure> removed if it has no anchor or title
      `<t><list style="hanging"><t hangText="Term">Definition<figure>${art(67)}</figure></t></list></t>`,
      `<t><list style="hanging"><t hangText="Term">Definition<figure anchor="fig">${art(72)}</figure></t></list></t>`,
      `<t><list style="hanging" hangIndent="8"><t hangText="Term"><figure anchor="fig2">${art(65, 'sourcecode')}</figure></t></list></t>`,
      // -> <artwork> starting with <CODE BEGINS> becomes <sourcecode>, which isn't outdented
      `<figure><artwork><![CDATA[<CODE BEGINS> file "a.c"\n${'x'.repeat(70)}\n<CODE ENDS>]]></artwork></figure>`,
      // -> Other lists become <ol> or <ul>, a list without style taking that of the list it is in
      `<t><list style="numbers"><t>Item<list><t>Item<figure anchor="fig3"><artwork>&lt;CODE BEGINS&gt;\n${'x'.repeat(61)}\n&lt;CODE ENDS&gt;</artwork></figure></t></list></t></list></t>`,
      `<t><list style="format R%d:"><t>Item<list><t>Item<figure anchor="fig5"><artwork>&lt;CODE BEGINS&gt;\n${'x'.repeat(60)}\n&lt;CODE ENDS&gt;</artwork></figure></t></list></t></list></t>`,
      `<t><list style="symbols"><t>Item<list><t>Item<figure anchor="fig4"><artwork>&lt;CODE BEGINS&gt;\n${'x'.repeat(64)}\n&lt;CODE ENDS&gt;</artwork></figure></t></list></t></list></t>`
    ].join('\n')
    await expect(wide(body, null)).resolves.toEqual([
      'rfc.middle.section.t[1].list.t.figure.artwork',
      'rfc.middle.section.t[3].list.t.figure.sourcecode',
      'rfc.middle.section.figure.artwork',
      'rfc.middle.section.t[5].list.t.list.t.figure.artwork',
      'rfc.middle.section.t[6].list.t.list.t.figure.artwork'
    ])
    // -> Not converted in a v3 document, where the <artwork> stays <artwork>
    await expect(wide(body)).resolves.toEqual([])
  })

  test('art longer than a page', async () => {
    const lines = (count) => Array.from({ length: count }, (_, idx) => `line ${idx + 1}`).join('\n')
    const doc = await parseDoc([
      `<artwork>\n\n${lines(48)}\n\n</artwork>`,
      `<figure><artwork>${lines(49)}</artwork></figure>`,
      `<sourcecode>${lines(60)}</sourcecode>`
    ].join('\n'))
    for (const mode of ALL_MODES) {
      const result = await validateArtworkSize(doc, { mode })
      expect(result).toHaveLength(1)
      expect(result).toContainError('ARTWORK_TOO_TALL', ValidationComment)
    }
    const [result] = await validateArtworkSize(doc)
    expect(result.path).toBe('rfc.middle.section.figure.artwork')
    expect(result.message).toBe('<artwork> has 49 lines, more than the 48 lines of a page of xml2rfc\'s paginated text output, so it will be split across pages. Consider splitting it into smaller figures.')
  })
})

describe('XML document should not contain text document refs', () => {
  test('valid <eref> ref', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.t', 'test <eref> test')
    await expect(validateTextLikeRefs(doc)).resolves.toHaveLength(0)
  })
  test('invalid ref in [1] format', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.t', 'test [1] test')
    await expect(validateTextLikeRefs(doc)).resolves.toContainError('TEXT_DOC_REF', ValidationWarning)
    await expect(validateTextLikeRefs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('TEXT_DOC_REF', ValidationWarning)
    await expect(validateTextLikeRefs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('invalid ref in [RFC1234] format', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc.t', 'test [RFC1234] test')
    await expect(validateTextLikeRefs(doc)).resolves.toContainError('TEXT_DOC_REF', ValidationWarning)
    await expect(validateTextLikeRefs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('TEXT_DOC_REF', ValidationWarning)
    await expect(validateTextLikeRefs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })
  test('paths of text document refs', async () => {
    const { doc } = await parse(`<rfc version="3"><middle><section><name>Introduction</name>
      <t>See [RFC1234].</t>
    </section><section><name>Details</name>
      <t>First</t>
      <t>See [2].</t>
    </section></middle></rfc>`, 'draft-test.xml')
    const result = await validateTextLikeRefs(doc)
    expect(result.map(r => r.path)).toEqual(['rfc.middle.section[0].t', 'rfc.middle.section[1].t[1]'])
  })
})

describe('XML document should have a valid submission type', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())

  const ALL_MODES = [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]

  function makeDoc (submissionType, docName) {
    const doc = cloneDeep(baseXMLDoc)
    if (submissionType) {
      set(doc, 'data.rfc._attr.submissionType', submissionType)
    }
    if (docName) {
      set(doc, 'data.rfc._attr.docName', docName)
    }
    set(doc, 'filename', 'draft-beep-boop.xml')
    return doc
  }

  test('valid submissionType', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.submissionType', 'ietf')
    set(doc, 'filename', 'draft-ietf-beep-boop.xml')
    await expect(validateSubmissionType(doc, { offline: true })).resolves.toHaveLength(0)
  })
  test('invalid stream', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.submissionType', 'xyz')
    set(doc, 'filename', 'draft-xyz-beep-boop.xml')
    await expect(validateSubmissionType(doc, { offline: true })).resolves.toContainError('SUBMISSION_TYPE_INVALID', ValidationError)
    await expect(validateSubmissionType(doc, { offline: true, mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_TYPE_INVALID', ValidationError)
    await expect(validateSubmissionType(doc, { offline: true, mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_TYPE_INVALID', ValidationError)
  })
  test('docName stream mismatch', async () => {
    const doc = makeDoc('IETF', 'draft-iab-beep-boop-00')
    await expect(validateSubmissionType(doc, { offline: true })).resolves.toContainError('SUBMISSION_TYPE_MISMATCH', ValidationError)
    await expect(validateSubmissionType(doc, { offline: true, mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_TYPE_MISMATCH', ValidationError)
    await expect(validateSubmissionType(doc, { offline: true, mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_TYPE_MISMATCH', ValidationError)
  })
  test('docName stream prefix matching submissionType', async () => {
    await expect(validateSubmissionType(makeDoc('IAB', 'draft-iab-beep-boop-00'), { offline: true })).resolves.toHaveLength(0)
    await expect(validateSubmissionType(makeDoc('IRTF', 'draft-irtf-beep-boop-00'), { offline: true })).resolves.toHaveLength(0)
  })
  test('name prefix check uses docName, not the input filename', async () => {
    const doc = makeDoc('IETF', 'draft-beep-boop-00')
    set(doc, 'filename', 'draft-iab-beep-boop.xml')
    await expect(validateSubmissionType(doc, { offline: true })).resolves.toHaveLength(0)
    set(doc, 'filename', 'draft-beep-boop.xml')
    set(doc, 'data.rfc._attr.docName', 'draft-irtf-beep-boop-00')
    await expect(validateSubmissionType(doc, { offline: true })).resolves.toContainError('SUBMISSION_TYPE_MISMATCH', ValidationError)
  })
  test('name prefix mismatch does not stop the Datatracker comparison', async () => {
    // Datatracker has draft-iab-beep-boop in the IETF stream
    const doc = makeDoc('IRTF', 'draft-iab-beep-boop-00')
    const result = await validateSubmissionType(doc)
    expect(result).toContainError('SUBMISSION_TYPE_MISMATCH', ValidationError)
    expect(result).toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
  })
  test('same stream on Datatracker', async () => {
    for (const mode of ALL_MODES) {
      await expect(validateSubmissionType(makeDoc('IETF', 'draft-ietf-beep-boop-01'), { mode })).resolves.toHaveLength(0)
    }
  })
  test('non-existent online doc', async () => {
    for (const mode of ALL_MODES) {
      await expect(validateSubmissionType(makeDoc('IETF', 'draft-ietf-beep-boop2'), { mode })).resolves.toHaveLength(0)
    }
  })
  test('different stream on Datatracker', async () => {
    const doc = makeDoc('IETF', 'draft-ietf-beep-boop3')
    await expect(validateSubmissionType(doc)).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
    await expect(validateSubmissionType(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationWarning)
    await expect(validateSubmissionType(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
    const [entry] = await validateSubmissionType(doc, { mode: MODES.SUBMISSION })
    expect(entry.message).toContain('IETF')
    expect(entry.message).toContain('IAB')
  })
  test('no stream on Datatracker yet', async () => {
    const doc = makeDoc('IETF', 'draft-ietf-beep-boop4')
    await expect(validateSubmissionType(doc)).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
    await expect(validateSubmissionType(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationWarning)
    await expect(validateSubmissionType(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationComment)
    const [entry] = await validateSubmissionType(doc, { mode: MODES.SUBMISSION })
    expect(entry.message).toContain('IETF stream')
    expect(entry.message).toContain('no stream')
  })
  test('independent matches Datatracker ise stream', async () => {
    for (const mode of ALL_MODES) {
      await expect(validateSubmissionType(makeDoc('independent', 'draft-beep-boop5'), { mode })).resolves.toHaveLength(0)
    }
    await expect(validateSubmissionType(makeDoc('IETF', 'draft-beep-boop5'))).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
  })
  test('independent compared when Datatracker has no stream or a different one', async () => {
    await expect(validateSubmissionType(makeDoc('independent', 'draft-ietf-beep-boop4'), { mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationComment)
    await expect(validateSubmissionType(makeDoc('independent', 'draft-ietf-beep-boop'), { mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
  })
  test('editorial stream compared', async () => {
    for (const mode of ALL_MODES) {
      await expect(validateSubmissionType(makeDoc('editorial', 'draft-beep-boop6'), { mode })).resolves.toHaveLength(0)
    }
    await expect(validateSubmissionType(makeDoc('editorial', 'draft-ietf-beep-boop'))).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
    await expect(validateSubmissionType(makeDoc('IETF', 'draft-beep-boop6'), { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationWarning)
  })
  test('missing submissionType is treated as IETF', async () => {
    for (const mode of ALL_MODES) {
      const result = await validateSubmissionType(makeDoc(null, 'draft-ietf-beep-boop'), { mode })
      expect(result).toHaveLength(1)
      expect(result).toContainError('SUBMISSION_TYPE_MISSING', ValidationComment)
      expect(result[0].message).toContain('submissionType="IETF"')
    }
    await expect(validateSubmissionType(makeDoc(null, 'draft-ietf-beep-boop3'))).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationError)
    await expect(validateSubmissionType(makeDoc(null, 'draft-ietf-beep-boop4'), { mode: MODES.SUBMISSION })).resolves.toContainError('SUBMISSION_TYPE_UNEXPECTED', ValidationComment)
  })
  test('offline skips the Datatracker comparison but keeps the missing submissionType comment', async () => {
    for (const mode of ALL_MODES) {
      await expect(validateSubmissionType(makeDoc('IETF', 'draft-ietf-beep-boop3'), { mode, offline: true })).resolves.toHaveLength(0)
      const result = await validateSubmissionType(makeDoc(null, 'draft-ietf-beep-boop3'), { mode, offline: true })
      expect(result).toHaveLength(1)
      expect(result).toContainError('SUBMISSION_TYPE_MISSING', ValidationComment)
    }
  })
})

describe('Validate IETF-TLP boilerplate for XML documents', () => {
  test('Valid IETF-TLP boilerplate and ipr attribute', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.ipr', 'trust200902')
    await expect(validateXMLBoilerplate(doc)).resolves.toHaveLength(0)
  })

  describe('boilerplate text outside <boilerplate>', () => {
    const parseDoc = async (middle, { front = '', back = '', name = 'draft-test-boilerplate-00' } = {}) => {
      const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" ipr="trust200902" docName="${name}">
  <front><title>Test</title>${front}</front>
  <middle><section><name>Introduction</name><t>Text</t>${middle}</section></middle>
  <back>${back}</back>
</rfc>`, `${name}.xml`)
      return doc
    }
    const boilerplateFindings = async (doc, opts) => (await validateXMLBoilerplate(doc, opts)).filter(r => r.name === 'UNNECESSARY_BOILERPLATE_TEXT')

    test('phrase wrapped across lines', async () => {
      const doc = await parseDoc(`<t>This Internet-Draft is submitted in full conformance with the
        provisions of BCP 78 and BCP 79.</t>`)
      const result = await validateXMLBoilerplate(doc)
      expect(result).toHaveLength(1)
      expect(result).toContainError('UNNECESSARY_BOILERPLATE_TEXT', ValidationWarning)
      expect(result[0].path).toBe('rfc.middle.section.t[1]')
      expect(result[0].message).toContain('"This Internet-Draft is submitted in full conformance"')
    })
    test('phrase split by inline markup, with curly quotes and odd case', async () => {
      const doc = await parseDoc(`<t>Copyright (c) 2025 <eref target="https://trustee.ietf.org/">IETF Trust</eref> and the
        persons identified as the <em>document authors</em>.</t>
        <t>&#8220;Internet-Drafts are draft documents valid for a MAXIMUM of six months&#8221;</t>`)
      const result = await boilerplateFindings(doc)
      expect(result.map(r => r.path)).toEqual(['rfc.middle.section.t[1]', 'rfc.middle.section.t[2]'])
    })
    test('one warning for an element with several phrases', async () => {
      const doc = await parseDoc(`<t>Internet-Drafts are working documents of the Internet Engineering Task
        Force (IETF). Internet-Drafts are draft documents valid for a maximum of six months.</t>`)
      const result = await boilerplateFindings(doc)
      expect(result).toHaveLength(1)
      expect(result[0].path).toBe('rfc.middle.section.t[1]')
      expect(result[0].message).toContain('"Internet-Drafts are working documents of the Internet Engineering Task Force", "Internet-Drafts are draft documents valid for a maximum of six months"')
    })
    test('phrase in a <blockquote> and in a list', async () => {
      const doc = await parseDoc(`<blockquote><t>Information about the current status of this document, any errata,
        and how to provide feedback on it may be obtained at <eref target="https://www.rfc-editor.org/info/rfc9999"/>.</t></blockquote>
        <ul><li>First</li><li>Code Components extracted from this document must include Revised BSD License text as
        described in Section 4.e of the Trust Legal Provisions</li></ul>`)
      const result = await boilerplateFindings(doc)
      expect(result.map(r => r.path)).toEqual(['rfc.middle.section.blockquote.t', 'rfc.middle.section.ul.li[1]'])
    })
    test('phrase in an RFC, in every mode', async () => {
      const doc = await parseDoc('<t>This document is not an Internet Standards Track specification; it is published for informational purposes.</t>', {
        front: '<seriesInfo name="RFC" value="9999"/>',
        name: 'rfc9999'
      })
      expect(doc.docKind).toBe('rfc')
      for (const mode of Object.values(MODES)) {
        const result = await boilerplateFindings(doc, { mode })
        expect(result).toHaveLength(1)
        expect(result).toContainError('UNNECESSARY_BOILERPLATE_TEXT', ValidationWarning)
      }
    })
    test('phrase in <front><boilerplate> or a <reference>', async () => {
      const doc = await parseDoc('', {
        front: `<boilerplate><section anchor="status-of-memo"><name>Status of This Memo</name>
          <t>This Internet-Draft is submitted in full conformance with the provisions of BCP 78 and BCP 79.</t></section></boilerplate>`,
        back: `<references><name>Informative References</name>
          <reference anchor="ID-GUIDELINES" target="https://www.ietf.org/standards/ids/guidelines/"><front>
            <title>Internet-Drafts are working documents of the Internet Engineering Task Force</title>
            <author><organization>IETF</organization></author><date/></front>
            <annotation>Internet-Drafts are draft documents valid for a maximum of six months.</annotation></reference>
        </references>`
      })
      await expect(boilerplateFindings(doc)).resolves.toHaveLength(0)
    })
    test('cited title of the Trust Legal Provisions', async () => {
      const doc = await parseDoc(`<t>This document is subject to <xref target="BCP78"/> and the IETF Trust's Legal Provisions
        Relating to IETF Documents <xref target="TLP"/>.</t>`, {
        back: `<references><name>Informative References</name>
          <reference anchor="TLP" target="https://trustee.ietf.org/license-info"><front>
            <title>Legal Provisions Relating to IETF Documents</title>
            <author><organization>IETF Trust</organization></author><date/></front></reference>
        </references>`
      })
      await expect(boilerplateFindings(doc)).resolves.toHaveLength(0)
    })
    test('prose about the boilerplate', async () => {
      const doc = await parseDoc(`<t>A proposal is an Internet-Draft (which must be submitted in full conformance with the
        provisions of <xref target="BCP78"/> and <xref target="BCP79"/>).</t>
        <t>Code components extracted from this document must include the following license text.</t>
        <t>However, this document is not an Internet Standards Track specification, and it does not
        represent the consensus of the IETF.</t>`)
      await expect(boilerplateFindings(doc)).resolves.toHaveLength(0)
    })
    test('no boilerplate or ipr issues in a clean document', async () => {
      const doc = await parseDoc('<t>This is a clean document without boilerplate.</t>')
      await expect(validateXMLBoilerplate(doc)).resolves.toHaveLength(0)
    })
  })
})

describe('Test ipr attribute and boilerplate', () => {
  test('should leave the ipr attribute to validateIprAttribute', async () => {
    // -> Missing and invalid ipr attributes are reported once, by validateIprAttribute
    for (const iprAttr of ['', ' ipr=""', ' ipr="somethingInvalid"', ' ipr="noDerivativesTrust200902"']) {
      const { doc } = await parse(`<rfc version="3" docName="draft-test-00"${iprAttr}><front><title>Test</title></front></rfc>`, 'draft-test-00.xml')
      await expect(validateXMLBoilerplate(doc)).resolves.toHaveLength(0)
    }
  })

  test('should leave a boilerplate element in a draft to detectPrepToolOutput', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.ipr', 'trust200902')
    set(doc, 'data.rfc.front.boilerplate', 'Foo bar')
    expect(await validateXMLBoilerplate(doc)).toHaveLength(0)
  })
})

describe('Validate IETF-TLP boilerplate for XML documents', () => {
  test('Valid IETF-TLP boilerplate and ipr attribute', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.ipr', 'trust200902')
    await expect(validateXMLBoilerplate(doc)).resolves.toHaveLength(0)
  })

  test('Unnecessary boilerplate text detected', async () => {
    const { doc } = await parse(`<rfc version="3" docName="draft-test-00"><front><title>Test</title>
      <t>This Internet-Draft is submitted in full conformance with the provisions of BCP 78 and BCP 79.</t></front></rfc>`, 'draft-test-00.xml')
    const result = await validateXMLBoilerplate(doc)
    expect(result).toHaveLength(1)
    expect(result).toContainError('UNNECESSARY_BOILERPLATE_TEXT', ValidationWarning)
    expect(result.find(r => r.name === 'UNNECESSARY_BOILERPLATE_TEXT').path).toBe('rfc.front.t')
  })

  test('No boilerplate or ipr issues in a clean document', async () => {
    const doc = cloneDeep(baseXMLDoc)
    set(doc, 'data.rfc._attr.ipr', 'trust200902')
    set(doc, 'data.rfc.front.t', 'This is a clean document without boilerplate.')
    await expect(validateXMLBoilerplate(doc)).resolves.toHaveLength(0)
  })
})

describe('Boilerplate of prepped RFCs', () => {
  // -> Paragraphs as xml2rfc's prep tool writes them in <front><boilerplate>
  const STATUS_IETF_STD = [
    'This is an Internet Standards Track document.',
    `This document is a product of the Internet Engineering Task Force
            (IETF).  It represents the consensus of the IETF community.  It has
            received public review and has been approved for publication by
            the Internet Engineering Steering Group (IESG).  Further
            information on Internet Standards is available in Section 2 of 
            RFC 7841.`,
    `Information about the current status of this document, any
            errata, and how to provide feedback on it may be obtained at
            <eref target="https://www.rfc-editor.org/info/rfc9999" brackets="none"/>.`
  ]
  const COPYRIGHT_IETF = [
    `Copyright (c) 2026 IETF Trust and the persons identified as the
            document authors. All rights reserved.`,
    `This document is subject to BCP 78 and the IETF Trust's Legal
            Provisions Relating to IETF Documents
            (<eref target="https://trustee.ietf.org/license-info" brackets="none"/>) in effect on the date of
            publication of this document. Please review these documents
            carefully, as they describe your rights and restrictions with
            respect to this document. Code Components extracted from this
            document must include Revised BSD License text as described in
            Section 4.e of the Trust Legal Provisions and are provided without
            warranty as described in the Revised BSD License.`
  ]
  const COPYRIGHT_ALT = [
    COPYRIGHT_IETF[0],
    `This document is subject to BCP 78 and the IETF Trust's Legal
            Provisions Relating to IETF Documents
            (<eref target="https://trustee.ietf.org/license-info" brackets="none"/>) in effect on the date of
            publication of this document. Please review these documents
            carefully, as they describe your rights and restrictions with
            respect to this document.`
  ]
  const PRE5378 = `This document may contain material from IETF Documents or IETF
            Contributions published or made publicly available before November
            10, 2008. The person(s) controlling the copyright in some of this
            material may not have granted the IETF Trust the right to allow
            modifications of such material outside the IETF Standards Process.
            Without obtaining an adequate license from the person(s)
            controlling the copyright in such materials, this document may not
            be modified outside the IETF Standards Process, and derivative
            works of it may not be created outside the IETF Standards Process,
            except to format it for publication as an RFC or to translate it
            into languages other than English.`

  const section = (anchor, name, paragraphs, n) => `
      <section anchor="${anchor}" numbered="false" removeInRFC="false" toc="exclude" pn="section-boilerplate.${n}">
        <name slugifiedName="name-${anchor}">${name}</name>
${paragraphs.map((t, idx) => `        <t indent="0" pn="section-boilerplate.${n}-${idx + 1}">\n            ${t}\n        </t>`).join('\n')}
      </section>`
  const parseRfc = async ({
    attrs = 'ipr="trust200902" category="std" consensus="true" submissionType="IETF"',
    prepTime = '2026-07-14T13:57:32',
    workgroup = '<workgroup>rats</workgroup>',
    date = '<date month="07" year="2026"/>',
    status = STATUS_IETF_STD,
    copyright = COPYRIGHT_IETF,
    boilerplate
  } = {}) => {
    const sections = [status && section('status-of-memo', 'Status of This Memo', status, 1), copyright && section('copyright', 'Copyright Notice', copyright, 2)]
    const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<rfc xmlns:xi="http://www.w3.org/2001/XInclude" version="3" ${attrs} docName="draft-ietf-rats-test-23" number="9999" xml:lang="en"${prepTime ? ` prepTime="${prepTime}"` : ''}>
  <front>
    <title>Test</title>
    <seriesInfo name="RFC" value="9999" stream="IETF"/>
    <author fullname="Test Author"><organization>Test</organization></author>
    ${date}
    ${workgroup}
    <abstract pn="section-abstract"><t indent="0" pn="section-abstract-1">Abstract.</t></abstract>
    ${boilerplate ?? `<boilerplate>${sections.filter(Boolean).join('')}
    </boilerplate>`}
  </front>
  <middle><section anchor="intro" numbered="true" toc="include" pn="section-1"><name slugifiedName="name-introduction">Introduction</name><t indent="0" pn="section-1-1">Text.</t></section></middle>
</rfc>`, 'rfc9999.xml')
    return doc
  }
  const findings = async (doc, opts) => (await validateXMLBoilerplate(doc, opts)).filter(r => r.name.startsWith('RFC_'))

  test('boilerplate as xml2rfc generates it, in every mode', async () => {
    const doc = await parseRfc()
    expect(doc.docKind).toBe('rfc')
    for (const mode of Object.values(MODES)) {
      await expect(validateXMLBoilerplate(doc, { mode })).resolves.toHaveLength(0)
    }
  })

  test('paragraph that differs, by mode', async () => {
    const copyright = [COPYRIGHT_IETF[0], COPYRIGHT_IETF[1].replaceAll('Revised BSD', 'Simplified BSD')]
    const doc = await parseRfc({ copyright })
    const result = await findings(doc)
    expect(result).toHaveLength(1)
    expect(result).toContainError('RFC_COPYRIGHT_BOILERPLATE_MISMATCH', ValidationError)
    expect(result[0].path).toBe('rfc.front.boilerplate.section[1].t[1]')
    expect(result[0].message).toContain('Paragraph 2 of the "Copyright Notice" section differs from the TLP 5.0 text for ipr="trust200902", submissionType="IETF" and a document dated 2026-07-01.')
    expect(result[0].message).toContain('Expected "...extracted from this document must include Revised BSD License text')
    expect(result[0].message).toContain('found "...extracted from this document must include Simplified BSD License text')

    const forgiving = await findings(doc, { mode: MODES.FORGIVE_CHECKLIST })
    expect(forgiving).toHaveLength(1)
    expect(forgiving).toContainError('RFC_COPYRIGHT_BOILERPLATE_MISMATCH', ValidationWarning)
    await expect(findings(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
  })

  test('URL of a differing paragraph', async () => {
    const doc = await parseRfc({ status: [STATUS_IETF_STD[0], STATUS_IETF_STD[1], STATUS_IETF_STD[2].replace('rfc9999', 'rfc9998')] })
    const result = await findings(doc)
    expect(result).toHaveLength(1)
    expect(result).toContainError('RFC_STATUS_BOILERPLATE_MISMATCH', ValidationError)
    expect(result[0].path).toBe('rfc.front.boilerplate.section[0].t[2]')
    expect(result[0].message).toContain('submissionType="IETF", category="std", consensus="true"')
    expect(result[0].message).toContain('https://www.rfc-editor.org/info/rfc9999.", found')
  })

  test('text of the xml2rfc release that prepped the RFC', async () => {
    // -> xml2rfc 3.11.0 (2021-10-29) changed "Simplified BSD License" to "Revised BSD License"
    const copyright = [COPYRIGHT_IETF[0].replace('2026', '2021'), COPYRIGHT_IETF[1].replaceAll('Revised BSD', 'Simplified BSD')]
    const date = '<date month="10" year="2021"/>'
    for (const prepTime of ['2021-06-30T10:00:00', '2021-10-29T09:11:22']) {
      await expect(findings(await parseRfc({ copyright, date, prepTime }))).resolves.toHaveLength(0)
    }
    const result = await findings(await parseRfc({ copyright, date, prepTime: '2021-11-09T15:33:13' }))
    expect(result).toHaveLength(1)
    expect(result).toContainError('RFC_COPYRIGHT_BOILERPLATE_MISMATCH', ValidationError)
    // -> Both texts on the day of the release, the new one after
    await expect(findings(await parseRfc({ copyright: [copyright[0], COPYRIGHT_IETF[1]], date, prepTime: '2021-10-29T11:28:07' }))).resolves.toHaveLength(0)
    const old = await findings(await parseRfc({ copyright: [copyright[0], COPYRIGHT_IETF[1]], date, prepTime: '2021-06-30T10:00:00' }))
    expect(old).toHaveLength(1)
    expect(old[0].message).toContain('TLP 5.0 text of xml2rfc releases before 2021-10-29')
  })

  test('copyright year and ipr variants', async () => {
    const wrongYear = await findings(await parseRfc({ date: '<date month="01" year="2027"/>' }))
    expect(wrongYear).toHaveLength(1)
    expect(wrongYear[0].path).toBe('rfc.front.boilerplate.section[1].t[0]')
    expect(wrongYear[0].message).toContain('Expected "Copyright (c) 2027 IETF Trust')

    const pre5378 = 'ipr="pre5378Trust200902" category="std" consensus="true" submissionType="IETF"'
    await expect(findings(await parseRfc({ attrs: pre5378, copyright: [...COPYRIGHT_IETF, PRE5378] }))).resolves.toHaveLength(0)
    const missing = await findings(await parseRfc({ attrs: pre5378 }))
    expect(missing).toHaveLength(1)
    expect(missing[0].path).toBe('rfc.front.boilerplate.section[1]')
    expect(missing[0].message).toContain('The "Copyright Notice" section is missing paragraph 3 of the TLP 5.0 text for ipr="pre5378Trust200902"')
    expect(missing[0].message).toContain('"This document may contain material from IETF Documents or IETF Contributions')

    const extra = await findings(await parseRfc({ copyright: [...COPYRIGHT_IETF, PRE5378] }))
    expect(extra).toHaveLength(1)
    expect(extra[0].path).toBe('rfc.front.boilerplate.section[1].t[2]')
    expect(extra[0].message).toContain('Paragraph 3 of the "Copyright Notice" section is not part of the TLP 5.0 text')

    const noModification = 'ipr="noModificationTrust200902" category="info" submissionType="IAB"'
    const iab = await parseRfc({
      attrs: noModification,
      workgroup: '',
      status: [
        'This document is not an Internet Standards Track specification; it is published for informational purposes.',
        `This document is a product of the Internet Architecture Board
            (IAB) and represents information that the IAB has deemed valuable
            to provide for permanent record.  Documents approved for publication
            by the IAB are not candidates for any level of Internet Standard; see
            Section 2 of RFC 7841.`,
        STATUS_IETF_STD[2]
      ],
      copyright: [
        COPYRIGHT_IETF[0],
        `This document is subject to BCP 78 and the IETF Trust's Legal Provisions Relating to IETF Documents
            (https://trustee.ietf.org/license-info) in effect on the date of publication of this document.
            Please review these documents carefully, as they describe your rights and restrictions with respect to this document.`,
        `This document may not be modified, and derivative works of it may not be created, except to format it for
            publication as an RFC or to translate it into languages other than English.`
      ]
    })
    // -> consensus defaults to "false", and an <eref> without text is compared as its URL
    await expect(findings(iab)).resolves.toHaveLength(0)
  })

  test('status text by stream, category and consensus', async () => {
    const irtfInfo = (group) => `This document is a product of the Internet Research Task Force
            (IRTF).  The IRTF publishes the results of Internet-related
            research and development activities.  These results might not be
            suitable for deployment.  This RFC represents the consensus of the ${group}
            Research Group of the Internet Research Task Force (IRTF).
            Documents approved for publication by the IRSG are not
            candidates for any level of Internet Standard; see Section 2 of RFC
            7841.`
    const infoFirst = 'This document is not an Internet Standards Track specification; it is published for informational purposes.'
    const irtf = 'ipr="trust200902" category="info" consensus="yes" submissionType="IRTF"'
    const workgroup = `<workgroup>Crypto
      Forum</workgroup>`
    await expect(findings(await parseRfc({ attrs: irtf, workgroup, status: [infoFirst, irtfInfo('Crypto Forum'), STATUS_IETF_STD[2]], copyright: COPYRIGHT_ALT }))).resolves.toHaveLength(0)
    const wrongGroup = await findings(await parseRfc({ attrs: irtf, workgroup, status: [infoFirst, irtfInfo('Thing-to-Thing'), STATUS_IETF_STD[2]], copyright: COPYRIGHT_ALT }))
    expect(wrongGroup).toHaveLength(1)
    expect(wrongGroup[0].message).toContain('consensus="true"')
    expect(wrongGroup[0].message).toContain('Expected "...This RFC represents the consensus of the Crypto Forum Research Group of the Internet')
    expect(wrongGroup[0].message).toContain('found "...This RFC represents the consensus of the Thing-to-Thing Research Group of the Internet')

    // -> Without a <workgroup>, the IRTF text doesn't name a group, whatever the consensus
    const noGroup = await findings(await parseRfc({ attrs: irtf, workgroup: '', status: [infoFirst, irtfInfo('Crypto Forum'), STATUS_IETF_STD[2]], copyright: COPYRIGHT_ALT }))
    expect(noGroup).toHaveLength(1)
    expect(noGroup[0].message).toContain('RFC 7841 text for submissionType="IRTF", category="info".')
    expect(noGroup[0].message).toContain('Expected "...results might not be suitable for deployment. Documents approved for publication by the IRSG are not')

    // -> A standards track document without consensus attribute: "true" is the only value allowed
    await expect(findings(await parseRfc({ attrs: 'ipr="trust200902" category="std" submissionType="IETF"' }))).resolves.toHaveLength(0)
    // -> The wrong text for the category
    const exp = await findings(await parseRfc({ attrs: 'ipr="trust200902" category="exp" consensus="true" submissionType="IETF"' }))
    expect(exp.map(r => r.path)).toEqual(['rfc.front.boilerplate.section[0].t[0]', 'rfc.front.boilerplate.section[0].t[1]'])
  })

  test('date of the document', async () => {
    // -> Month names, as in v2 documents
    await expect(findings(await parseRfc({ date: '<date day="3" month="Jul" year="2026"/>' }))).resolves.toHaveLength(0)
    // -> Without a date, the prep tool uses today's
    const year = String(new Date().getFullYear())
    await expect(findings(await parseRfc({ date: '', copyright: [COPYRIGHT_IETF[0].replace('2026', year), COPYRIGHT_IETF[1]] }))).resolves.toHaveLength(0)
    // -> URLs use http before 2017-08-21 (with the text of the xml2rfc release that prepped the RFC)
    const old = await findings(await parseRfc({ date: '<date month="06" year="2017"/>', prepTime: '2019-12-01T10:00:00', status: null }))
    expect(old.map(r => r.path)).toEqual(['rfc.front.boilerplate', 'rfc.front.boilerplate.section.t[0]', 'rfc.front.boilerplate.section.t[1]'])
    expect(old[1].message).toContain('Expected "Copyright (c) 2017 IETF Trust')
    expect(old[2].message).toContain('Expected "...Provisions Relating to IETF Documents (http://trustee.ietf.org/license-info) in effect')
    expect(old[2].message).toContain('TLP 5.0 text of xml2rfc releases before 2021-10-29')
    // -> An invalid date leaves the copyright notice unchecked
    await expect(findings(await parseRfc({ date: '<date month="13th" year="2026"/>', copyright: ['Copyright'] }))).resolves.toHaveLength(0)
  })

  test('no expected text where the prep tool would stop', async () => {
    const copyright = ['Something else']
    const status = ['Something else']
    // -> Unknown category or stream, a group name without <workgroup> text, an ipr from before TLP 2.0
    await expect(findings(await parseRfc({ attrs: 'ipr="trust200902" category="foo" submissionType="IETF"', status }))).resolves.toHaveLength(0)
    await expect(findings(await parseRfc({ attrs: 'ipr="trust200902" category="info" submissionType="ISE"', status, copyright: COPYRIGHT_ALT }))).resolves.toHaveLength(0)
    await expect(findings(await parseRfc({ attrs: 'ipr="trust200902" category="info" consensus="true" submissionType="IRTF"', workgroup: '<workgroup/>', status, copyright: COPYRIGHT_ALT }))).resolves.toHaveLength(0)
    await expect(findings(await parseRfc({ attrs: 'ipr="trust200811" category="std" consensus="true" submissionType="IETF"', copyright }))).resolves.toHaveLength(0)
    await expect(findings(await parseRfc({ date: '<date month="01" year="2009"/>', status: [STATUS_IETF_STD[0], STATUS_IETF_STD[1], STATUS_IETF_STD[2].replace('https', 'http')], copyright }))).resolves.toHaveLength(0)
    // -> No consensus value that the prep tool accepts
    await expect(findings(await parseRfc({ attrs: 'ipr="trust200902" category="std" consensus="false" submissionType="IETF"', status }))).resolves.toHaveLength(0)
    // -> A value it doesn't accept is replaced by "false"
    const consensus = await findings(await parseRfc({ attrs: 'ipr="trust200902" category="info" consensus="maybe" submissionType="IETF"' }))
    expect(consensus[0].message).toContain('category="info", consensus="false"')
  })

  test('sections found by name', async () => {
    const boilerplate = `<boilerplate>
      <section><name>Status of This Memo</name>${STATUS_IETF_STD.map(t => `<t>${t}</t>`).join('')}</section>
      <section><name>Copyright <em>Notice</em></name>${COPYRIGHT_IETF.map(t => `<t>${t.replace('2026', '2025')}</t>`).join('')}</section>
    </boilerplate>`
    const result = await findings(await parseRfc({ boilerplate }))
    expect(result.map(r => [r.name, r.path])).toEqual([['RFC_COPYRIGHT_BOILERPLATE_MISMATCH', 'rfc.front.boilerplate.section[1].t[0]']])
  })

  test('missing sections and paragraphs', async () => {
    const noStatus = await findings(await parseRfc({ status: null }))
    expect(noStatus).toHaveLength(1)
    expect(noStatus).toContainError('RFC_STATUS_BOILERPLATE_MISMATCH', ValidationError)
    expect(noStatus[0].path).toBe('rfc.front.boilerplate')
    expect(noStatus[0].message).toContain('The <boilerplate> element has no "Status of This Memo" section.')

    const missing = await findings(await parseRfc({ status: [STATUS_IETF_STD[0], STATUS_IETF_STD[2]] }))
    expect(missing).toHaveLength(1)
    expect(missing[0].path).toBe('rfc.front.boilerplate.section[0]')
    expect(missing[0].message).toContain('missing paragraph 2 of the RFC 7841 text')
  })

  test('prepped RFC without <boilerplate>', async () => {
    const result = await findings(await parseRfc({ boilerplate: '' }))
    expect(result).toHaveLength(1)
    expect(result).toContainError('RFC_BOILERPLATE_MISSING', ValidationError)
    expect(result[0].path).toBe('rfc.front')
    const forgiving = await findings(await parseRfc({ boilerplate: '' }), { mode: MODES.FORGIVE_CHECKLIST })
    expect(forgiving).toContainError('RFC_BOILERPLATE_MISSING', ValidationWarning)
    await expect(findings(await parseRfc({ boilerplate: '' }), { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    // -> Not prepped yet, or no boilerplate with ipr="none"
    await expect(findings(await parseRfc({ boilerplate: '', prepTime: null }))).resolves.toHaveLength(0)
    await expect(findings(await parseRfc({ boilerplate: '', attrs: 'ipr="none" category="std" consensus="true" submissionType="IETF"' }))).resolves.toHaveLength(0)
  })

  test('boilerplate of an RFC not prepped yet is that of the current xml2rfc', async () => {
    const copyright = [COPYRIGHT_IETF[0], COPYRIGHT_IETF[1].replaceAll('Revised BSD', 'Simplified BSD')]
    const result = await findings(await parseRfc({ copyright, prepTime: null }))
    expect(result).toHaveLength(1)
    expect(result).toContainError('RFC_COPYRIGHT_BOILERPLATE_MISMATCH', ValidationError)
  })

  test('nothing for a draft with a <boilerplate>', async () => {
    const { doc } = await parse(`<rfc version="3" ipr="trust200902" docName="draft-test-boilerplate-00" category="std">
  <front><title>Test</title><seriesInfo name="Internet-Draft" value="draft-test-boilerplate-00"/>
    <boilerplate><section anchor="copyright"><name>Copyright Notice</name><t>Not the copyright notice.</t></section></boilerplate>
  </front></rfc>`, 'draft-test-boilerplate-00.xml')
    await expect(findings(doc)).resolves.toHaveLength(0)
  })
})
