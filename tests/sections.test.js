import { describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import {
  validateAbstractSection,
  validateIntroductionSection,
  validateSecurityConsiderationsSection,
  validateAuthorSection,
  validateReferencesSection,
  validateIANAConsiderationsSection,
  validateReferencesInText
} from '../lib/modules/sections.mjs'
import { getMiddleSections, getSectionName } from '../lib/helpers/sections.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
import { CANONICAL_TXT } from './generators/doc-txt.js'
import { baseTXTDoc, baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set, times } from 'lodash-es'

expect.extend({
  toContainError
})

describe('document should have a valid abstract section', () => {
  describe('document should have a valid abstract section (TXT Document Type)', () => {
    test('valid abstract section', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { abstract: { start: 10 } },
          content: { abstract: ['Abstract', 'This document provides an overview of the system.'] }
        }
      }
      await expect(validateAbstractSection(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    })

    test('missing abstract section', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { abstract: { start: 0 } },
          content: { abstract: [] }
        }
      }
      await expect(validateAbstractSection(doc, { mode: MODES.NORMAL })).resolves.toContainError(
        'MISSING_ABSTRACT_SECTION',
        ValidationError
      )
    })

    test('empty abstract section', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { abstract: { start: 10 } },
          content: { abstract: [] }
        }
      }
      await expect(validateAbstractSection(doc, { mode: MODES.NORMAL })).resolves.toContainError(
        'EMPTY_ABSTRACT_SECTION',
        ValidationError
      )
    })

    test('abstract section contains RFC reference', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { abstract: { start: 10 } },
          content: { abstract: ['Abstract', 'This document references [RFC1234].'] }
        }
      }
      await expect(validateAbstractSection(doc, { mode: MODES.NORMAL })).resolves.toContainError(
        'INVALID_ABSTRACT_SECTION_REF',
        ValidationError
      )
    })

    test('abstract section contains URL', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { abstract: { start: 10 } },
          content: { abstract: ['Abstract', 'More information can be found at https://example.com.'] }
        }
      }
      await expect(validateAbstractSection(doc, { mode: MODES.NORMAL })).resolves.toContainError(
        'INVALID_ABSTRACT_SECTION_URL',
        ValidationError
      )
    })

    test('abstract section contains section reference', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { abstract: { start: 10 } },
          content: { abstract: ['Abstract', 'See Section 5 for more details.'] }
        }
      }
      await expect(validateAbstractSection(doc, { mode: MODES.NORMAL })).resolves.toContainError(
        'INVALID_ABSTRACT_SECTION_REF',
        ValidationError
      )
    })

    test('valid abstract section in FORGIVE_CHECKLIST mode with RFC reference', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { abstract: { start: 10 } },
          content: { abstract: ['Abstract', 'This document references [RFC1234].'] }
        }
      }
      await expect(validateAbstractSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError(
        'INVALID_ABSTRACT_SECTION_REF',
        ValidationWarning
      )
    })

    test('abstract section with multiple issues', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { abstract: { start: 10 } },
          content: {
            abstract: [
              'Abstract',
              'See Section 5 for details. More info at https://example.com. [RFC1234] is also referenced.'
            ]
          }
        }
      }

      const expectedErrors = [
        {
          name: 'INVALID_ABSTRACT_SECTION_REF',
          refUrl: 'https://authors.ietf.org/required-content#abstract'
        },
        {
          name: 'INVALID_ABSTRACT_SECTION_URL',
          refUrl: 'https://authors.ietf.org/required-content#abstract'
        },
        {
          name: 'INVALID_ABSTRACT_SECTION_REF',
          refUrl: 'https://authors.ietf.org/required-content#abstract'
        }
      ]

      const actualResult = await validateAbstractSection(doc, { mode: MODES.NORMAL })
      await expect(actualResult).toEqual(
        expect.arrayContaining(expectedErrors.map(error => expect.objectContaining(error)))
      )
    })

    test('abstract section contains Internet-Draft reference', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { abstract: { start: 10 } },
          content: { abstract: ['Abstract', 'This document references [I-D.ietf-example-01].'] }
        }
      }
      await expect(validateAbstractSection(doc, { mode: MODES.NORMAL })).resolves.toContainError(
        'INVALID_ABSTRACT_SECTION_ID_REF',
        ValidationError
      )
    })

    test('abstract section contains custom reference', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { abstract: { start: 10 } },
          content: { abstract: ['Abstract', 'This document references [REST].'] }
        }
      }
      await expect(validateAbstractSection(doc, { mode: MODES.NORMAL })).resolves.toContainError(
        'INVALID_ABSTRACT_SECTION_CUSTOM_REF',
        ValidationError
      )
    })

    test('abstract section with multiple new reference types', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { abstract: { start: 10 } },
          content: {
            abstract: [
              'Abstract',
              'This document references [I-D.ietf-example-01] and [REST].'
            ]
          }
        }
      }

      const expectedErrors = [
        {
          name: 'INVALID_ABSTRACT_SECTION_ID_REF',
          refUrl: 'https://authors.ietf.org/required-content#abstract'
        },
        {
          name: 'INVALID_ABSTRACT_SECTION_CUSTOM_REF',
          refUrl: 'https://authors.ietf.org/required-content#abstract'
        }
      ]

      const actualResult = await validateAbstractSection(doc, { mode: MODES.NORMAL })
      await expect(actualResult).toEqual(
        expect.arrayContaining(expectedErrors.map(error => expect.objectContaining(error)))
      )
    })

    test('valid abstract section in FORGIVE_CHECKLIST mode with Internet-Draft reference', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { abstract: { start: 10 } },
          content: { abstract: ['Abstract', 'This document references [I-D.ietf-example-01].'] }
        }
      }
      await expect(validateAbstractSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError(
        'INVALID_ABSTRACT_SECTION_ID_REF',
        ValidationWarning
      )
    })

    describe('findings locate what they are about', () => {
      // The abstract of CANONICAL_TXT replaced: "Abstract" is on line 18, the text starts on line 20
      const parseWithAbstract = (abstract) => parseTXT(CANONICAL_TXT.replace('   This document obsoletes RFC 5678.\n', `${abstract}
Status of This Memo
`), '')
      const ref = 'https://authors.ietf.org/required-content#abstract'

      // From draft-ahearn-seal-01
      test('each RFC reference', async () => {
        const doc = await parseWithAbstract(`   This document defines the Signed Email Authentication Layer (SEAL), a
   cryptographically signed identity envelope carried within a new
   message header field, SEAL-Envelope.  SEAL provides a stable,
   forwarding-resilient identity assertion that binds the origin domain
   to a specific message instance using the SEAL-MSGID header, which
   contains a SEAL-protected copy of the [RFC5322] Message-ID present at
   message creation time.  After SEAL-MSGID is set, intermediaries may
   modify or discard the visible [RFC5322] Message-ID header without
   affecting SEAL validity.
`)
        const error = { ref, lines: [{ line: 25, pos: 42 }, { line: 27, pos: 34 }] }
        await expect(validateAbstractSection(doc)).resolves.toEqual([
          new ValidationError('INVALID_ABSTRACT_SECTION_REF', 'The abstract section should not contain references to RFCs.', error)
        ])
        await expect(validateAbstractSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toEqual([
          new ValidationWarning('INVALID_ABSTRACT_SECTION_REF', 'The abstract section should not contain references to RFCs.', error)
        ])
        await expect(validateAbstractSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
      })

      test('not the RFCs the document updates or obsoletes', async () => {
        const doc = await parseWithAbstract(`   This document updates [RFC1234] and obsoletes [RFC5678], and
   carries a copy of the [RFC5322] Message-ID.
`)
        await expect(validateAbstractSection(doc)).resolves.toEqual([
          new ValidationError('INVALID_ABSTRACT_SECTION_REF', 'The abstract section should not contain references to RFCs.', {
            ref,
            lines: [{ line: 21, pos: 26 }]
          })
        ])
      })

      // From draft-bates-atp-test-vectors-00
      test('each section and custom reference', async () => {
        const doc = await parseWithAbstract(`   This document publishes golden test vectors for the Agent Transaction
   Protocol (ATP) [ATP-CORE].  The vectors cover canonicalization (RFC
   8785 JCS), nodeId computation, and Ed25519 signature generation and
   verification.  ATP Core conformance per [ATP-CORE] Section 13.7
   requires that conformant implementations pass all vectors in this
   document for canonicalization, nodeId computation, and Ed25519
   signature verification.
`)
        await expect(validateAbstractSection(doc)).resolves.toEqual([
          new ValidationError('INVALID_ABSTRACT_SECTION_REF', 'The abstract section should not contain references to sections or appendices.', {
            ref,
            lines: [{ line: 23, pos: 55 }]
          }),
          new ValidationError('INVALID_ABSTRACT_SECTION_CUSTOM_REF', 'The abstract section should not contain custom references like [REST].', {
            ref,
            lines: [{ line: 21, pos: 19 }, { line: 23, pos: 44 }]
          })
        ])
      })

      // From draft-bruynooghe-n0-quic-nat-traversal-00
      test('each URL, even one wrapped across lines', async () => {
        const doc = await parseWithAbstract(`   A description of how noq (https://github.com/n0-computer/noq)
   performs NAT traversal for iroh (https://github.com/n0-computer/
   iroh), including all current bugs.  This is not yet a specification,
   though further revisions migth be.
`)
        await expect(validateAbstractSection(doc)).resolves.toEqual([
          new ValidationError('INVALID_ABSTRACT_SECTION_URL', 'The abstract section should not contain URLs.', {
            ref,
            lines: [{ line: 20, pos: 30 }, { line: 21, pos: 37 }]
          })
        ])
      })

      // From draft-bryce-cose-receipts-mmr-profile-03
      test('each Internet-Draft reference', async () => {
        const doc = await parseWithAbstract(`   This document defines a new verifiable data structure type for COSE
   Receipts [I-D.ietf-cose-merkle-tree-proofs] specifically for use with
   ledgers based on post-order traversal binary Merkle trees.
`)
        await expect(validateAbstractSection(doc)).resolves.toEqual([
          new ValidationError('INVALID_ABSTRACT_SECTION_ID_REF', 'The abstract section should not contain references to Internet-Drafts.', {
            ref,
            lines: [{ line: 21, pos: 13 }]
          })
        ])
      })

      test('an empty abstract at its heading', async () => {
        const doc = await parseWithAbstract('')
        await expect(validateAbstractSection(doc)).resolves.toEqual([
          new ValidationError('EMPTY_ABSTRACT_SECTION', 'The abstract section is present but contains no meaningful content.', {
            ref,
            lines: [{ line: 18, pos: 1 }]
          })
        ])
      })
    })
  })

  describe('XML Document Type', () => {
    test('valid abstract section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.abstract.t', 'test')
      await expect(validateAbstractSection(doc)).resolves.toHaveLength(0)
    })
    test('missing abstract section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front', {})
      await expect(validateAbstractSection(doc)).resolves.toContainError('MISSING_ABSTRACT_SECTION', ValidationError)
    })
    test('invalid abstract section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      // -> Empty object child
      set(doc, 'data.rfc.front.abstract', {})
      await expect(validateAbstractSection(doc)).resolves.toContainError('INVALID_ABSTRACT_SECTION', ValidationError)
      // -> String child
      set(doc, 'data.rfc.front.abstract', 'test')
      await expect(validateAbstractSection(doc)).resolves.toContainError('INVALID_ABSTRACT_SECTION', ValidationError)
    })
    test('invalid abstract section children', async () => {
      const doc = cloneDeep(baseXMLDoc)
      // -> Invalid child element
      set(doc, 'data.rfc.front.abstract.abc', 'test')
      await expect(validateAbstractSection(doc)).resolves.toContainError('INVALID_ABSTRACT_SECTION_CHILD', ValidationError)
      // -> Add a valid child but keep the invalid one
      set(doc, 'data.rfc.front.abstract.t', 'test')
      await expect(validateAbstractSection(doc)).resolves.toContainError('INVALID_ABSTRACT_SECTION_CHILD', ValidationError)
    })
    test('abstract section with attributes', async () => {
      const { doc } = await parse(`<rfc version="3"><front><abstract pn="section-abstract">
        <t indent="0" pn="section-abstract-1">Lorem ipsum dolor sit amet.</t>
      </abstract></front></rfc>`, 'rfc9999.xml')
      await expect(validateAbstractSection(doc)).resolves.toHaveLength(0)
    })
    test('abstract section with attributes only', async () => {
      const { doc } = await parse('<rfc version="3"><front><abstract pn="section-abstract"/></front></rfc>', 'rfc9999.xml')
      await expect(validateAbstractSection(doc)).resolves.toContainError('INVALID_ABSTRACT_SECTION', ValidationError)
    })
    test('abstract section with line processing instructions', async () => {
      const { doc } = await parse(`<rfc version="3"><front><abstract>
<?line 30?>
        <t>Lorem ipsum dolor sit amet.</t>
<?line 32?>
        <t>Consectetur adipiscing elit.</t>
      </abstract></front></rfc>`, 'draft-test.xml')
      await expect(validateAbstractSection(doc)).resolves.toHaveLength(0)
    })
    test('abstract section children with reference', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.abstract.t', ['test', { xref: {} }])
      await expect(validateAbstractSection(doc)).resolves.toContainError('INVALID_ABSTRACT_SECTION_REF', ValidationError)
      await expect(validateAbstractSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_ABSTRACT_SECTION_REF', ValidationWarning)
      await expect(validateAbstractSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
  })
})

describe('document should have a valid introduction section', () => {
  describe('document should have a valid introduction section (TXT Document Type)', () => {
    test('valid introduction section', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, introduction: { start: 43 } },
          content: { introduction: ['1. Introduction', 'This is the introduction section.'] }
        },
        body: `
        1. Introduction
        This is the introduction section.
        `
      }
      await expect(validateIntroductionSection(doc)).resolves.toHaveLength(0)
    })

    test('missing introduction section', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, introduction: { start: 0 } }
        },
        body: `
        1. NotAnIntroduction
        This is not an introduction section.
        `
      }
      await expect(validateIntroductionSection(doc)).resolves.toContainError(
        'MISSING_INTRODUCTION_SECTION',
        ValidationError
      )
    })

    test('introduction section in TOC is ignored', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, introduction: { start: 34 } },
          content: { introduction: ['1. Introduction', 'This is the actual introduction section.'] }
        },
        body: `
        Table of Contents
        1. Introduction...........................1
        2. Overview...............................2

        1. Introduction
        This is the actual introduction section.`
      }
      await expect(validateIntroductionSection(doc)).resolves.toHaveLength(0)
    })

    test('empty introduction section', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, introduction: { start: 12 } },
          content: { introduction: [] }
        },
        body: `
        1. Introduction
        `
      }
      await expect(validateIntroductionSection(doc)).resolves.toContainError(
        'EMPTY_INTRODUCTION_SECTION',
        ValidationError
      )
    })

    test('missing document header or title', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: false }, title: false }
        },
        body: `
        1. Introduction
        This is the introduction section.
        `
      }
      await expect(validateIntroductionSection(doc)).resolves.toContainError(
        'INVALID_DOCUMENT_STRUCTURE',
        ValidationError
      )
    })

    test('introduction section with alternative names', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, introduction: { start: 12 } },
          content: { introduction: ['1. Introduction', 'This is the introduction section under an alternative name.'] }
        },
        body: `
        1. Overview
        This is the introduction section under an alternative name.
        `
      }
      await expect(validateIntroductionSection(doc)).resolves.toHaveLength(0)
    })

    test('missing introduction section but forgiving', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, introduction: { start: 0 } }
        },
        body: `
        1. NotAnIntroduction
        This is not an introduction section.
        `
      }
      await expect(validateIntroductionSection(doc, { mode: 'FORGIVE_CHECKLIST' })).resolves.toHaveLength(0)
    })

    test('empty introduction section is located at its heading', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

2.  Terminology

   The key words "MUST" and "MUST NOT" are to be interpreted as described.
`, '')
      await expect(validateIntroductionSection(doc)).resolves.toEqual([
        new ValidationError('EMPTY_INTRODUCTION_SECTION', 'The first section is present but contains no meaningful content.', {
          ref: 'https://authors.ietf.org/en/required-content#introduction',
          lines: [{ line: 22, pos: 1 }]
        })
      ])
    })
  })

  describe('XML Document Type', () => {
    test('valid introduction section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section[0].name', 'Introduction')
      set(doc, 'data.rfc.middle.section[0].t', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      await expect(validateIntroductionSection(doc)).resolves.toHaveLength(0)
    })
    test('missing introduction section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section', [])
      await expect(validateIntroductionSection(doc)).resolves.toContainError('MISSING_INTRODUCTION_SECTION', ValidationError)
      await expect(validateIntroductionSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_INTRODUCTION_SECTION', ValidationWarning)
      await expect(validateIntroductionSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid introduction section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section[0].name', 'Introduction')
      await expect(validateIntroductionSection(doc)).resolves.toContainError('INVALID_INTRODUCTION_SECTION', ValidationError)
    })
    test('invalid introduction section children', async () => {
      const doc = cloneDeep(baseXMLDoc)
      // -> Invalid child element
      set(doc, 'data.rfc.middle.section[0].name', 'Introduction')
      set(doc, 'data.rfc.middle.section[0].t', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      set(doc, 'data.rfc.middle.section[0].abc', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      await expect(validateIntroductionSection(doc)).resolves.toContainError('INVALID_INTRODUCTION_SECTION_CHILD', ValidationError)
    })
    test('valid introduction section with nested section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section[0].name', 'Introduction')
      set(doc, 'data.rfc.middle.section[0].t', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      set(doc, 'data.rfc.middle.section[0].section', [{ name: 'Background', t: 'Some background.' }])
      await expect(validateIntroductionSection(doc)).resolves.toHaveLength(0)
    })
    test('introduction section with <artset>, <contact> and <author> children', async () => {
      const { doc } = await parse(`<rfc version="3"><middle>
        <section><name>Other</name><t>Text.</t></section>
        <section anchor="s"><name>Introduction</name>
          <t>Text.</t>
          <artset>
            <artwork type="svg"><svg xmlns="http://www.w3.org/2000/svg"/></artwork>
            <artwork type="ascii-art">+---+</artwork>
          </artset>
          <t>Thanks to <contact fullname="Jane Doe"/>.</t>
          <contact fullname="John Doe"><organization>Example</organization></contact>
          <author fullname="Alice Doe" initials="A." surname="Doe"/>
          <section><name>More</name><t>Text.</t></section>
        </section>
      </middle></rfc>`, 'draft-test-sections-00.xml')
      await expect(validateIntroductionSection(doc)).resolves.toHaveLength(0)
    })
    test('introduction section with text outside of any element', async () => {
      const { doc } = await parse(`<rfc version="3"><middle>
        <section anchor="s"><name>Introduction</name>
          Stray text.
          <t>Text.</t>
        </section>
      </middle></rfc>`, 'draft-test-sections-00.xml')
      const result = await validateIntroductionSection(doc)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('INVALID_INTRODUCTION_SECTION_CHILD')
      expect(result[0].message).toContain('contains text outside of any element')
      expect(result[0].path).toBe('rfc.middle.section[0]')
    })
    test('introduction section children not allowed by the grammar are named', async () => {
      const { doc } = await parse(`<rfc version="3"><middle>
        <section><name>Other</name><t>Text.</t></section>
        <section anchor="s"><name>Introduction</name>
          <t>Text.</t>
          <list><t>Item.</t></list>
          <t>More text.</t>
          <list><t>Item.</t></list>
          <note><t>A note.</t></note>
        </section>
      </middle></rfc>`, 'draft-test-sections-00.xml')
      const result = await validateIntroductionSection(doc)
      expect(result).toHaveLength(2)
      expect(result.map(e => e.name)).toEqual(['INVALID_INTRODUCTION_SECTION_CHILD', 'INVALID_INTRODUCTION_SECTION_CHILD'])
      expect(result[0].message).toContain('contains a <list> element')
      expect(result[0].message).toContain('<artset>')
      expect(result[0].path).toBe('rfc.middle.section[1].list')
      expect(result[1].message).toContain('contains a <note> element')
      expect(result[1].path).toBe('rfc.middle.section[1].note')
    })
    test('introduction section with line processing instructions', async () => {
      const { doc } = await parse(`<rfc version="3"><middle>
<?line 40?>
        <section anchor="intro"><name>Introduction</name>
<?line 42?>
          <t>Lorem ipsum dolor sit amet.</t>
<?line 44?>
          <t>Consectetur adipiscing elit.</t>
        </section>
        <section><name>Terminology</name><t>Some terms.</t></section>
      </middle></rfc>`, 'draft-test.xml')
      await expect(validateIntroductionSection(doc)).resolves.toHaveLength(0)
    })
    describe('section names', () => {
      const parseMiddle = async (middle) => {
        const { doc } = await parse(`<rfc version="3"><middle>${middle}</middle></rfc>`, 'draft-test-sections-00.xml')
        return doc
      }

      test('getSectionName reads a plain <name>', async () => {
        const doc = await parseMiddle('<section><name>Introduction</name><t>Text.</t></section>')
        expect(getSectionName(getMiddleSections(doc)[0])).toBe('Introduction')
      })
      test('getSectionName reads a <name> with attributes (prepped XML)', async () => {
        const doc = await parseMiddle('<section><name slugifiedName="name-introduction">Introduction</name><t>Text.</t></section>')
        expect(getSectionName(getMiddleSections(doc)[0])).toBe('Introduction')
      })
      test('getSectionName reads a <name> with inline markup', async () => {
        const doc = await parseMiddle(`<section><name>Use of <tt>foo</tt>
          in   Practice</name><t>Text.</t></section>
          <section><name><em>Overview</em></name><t>Text.</t></section>`)
        const sections = getMiddleSections(doc)
        expect(getSectionName(sections[0])).toBe('Use of in Practice')
        expect(getSectionName(sections[1])).toBe('Overview')
      })
      test('getSectionName reads the v2 title attribute', async () => {
        const doc = await parseMiddle('<section title="Introduction"><t>Text.</t></section>')
        expect(getSectionName(getMiddleSections(doc)[0])).toBe('Introduction')
      })
      test('getSectionName returns an empty string when there is no name', async () => {
        const doc = await parseMiddle('<section><t>Text.</t></section>')
        expect(getSectionName(getMiddleSections(doc)[0])).toBe('')
        expect(getSectionName('')).toBe('')
      })
      test('getMiddleSections wraps a single <section> in an array', async () => {
        const doc = await parseMiddle('<section><name>Introduction</name><t>Text.</t></section>')
        expect(doc.data.rfc.middle.section).not.toBeInstanceOf(Array)
        expect(getMiddleSections(doc)).toHaveLength(1)
        expect(getMiddleSections(cloneDeep(baseXMLDoc))).toEqual([])
      })
      test('introduction section with slugifiedName, title attribute or as single section', async () => {
        for (const middle of [
          '<section><name slugifiedName="name-introduction">Introduction</name><t>Text.</t></section><section><name>Other</name><t>Text.</t></section>',
          '<section title="Introduction"><t>Text.</t></section><section title="Other"><t>Text.</t></section>',
          '<section><name>Introduction</name><t>Text.</t></section>'
        ]) {
          await expect(validateIntroductionSection(await parseMiddle(middle))).resolves.toHaveLength(0)
        }
      })
      test('invalid introduction section reports its index', async () => {
        const doc = await parseMiddle('<section title="Terminology"><t>Text.</t></section><section title="Introduction"/>')
        const result = await validateIntroductionSection(doc)
        expect(result).toHaveLength(1)
        expect(result).toContainError('INVALID_INTRODUCTION_SECTION', ValidationError)
        expect(result[0].path).toBe('rfc.middle.section[1]')
      })
    })
  })
})

describe('document should have a valid security considerations section', () => {
  describe('document should have a valid security considerations section (TXT Document Type)', () => {
    test('valid security considerations section', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, securityConsiderations: { start: 56 } },
          content: { securityConsiderations: ['5. Security Considerations', 'This is the security considerations section.'] }
        },
        body: `
        4. Security Considerations
        This is the security considerations section.
        `
      }
      await expect(validateSecurityConsiderationsSection(doc)).resolves.toHaveLength(0)
    })

    test('missing security considerations section', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, securityConsiderations: { start: 0 } }
        },
        body: `
        4. NotSecurityConsiderations
        This is not the security considerations section.
        `
      }
      await expect(validateSecurityConsiderationsSection(doc)).resolves.toContainError(
        'MISSING_SECURITY_CONSIDERATIONS_SECTION',
        ValidationError
      )
    })

    test('security considerations section in TOC is ignored', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, securityConsiderations: { start: 78 } },
          content: { securityConsiderations: ['5. Security Considerations', 'This is the actual security considerations section.'] }
        },
        body: `
        Table of Contents
        4. Security Considerations...........................4
        5. IANA Considerations...............................5

        4. Security Considerations
        This is the actual security considerations section.
        `
      }
      await expect(validateSecurityConsiderationsSection(doc)).resolves.toHaveLength(0)
    })

    test('empty security considerations section', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, securityConsiderations: { start: 34 } },
          content: { securityConsiderations: [] }
        },
        body: `
        4. Security Considerations
        `
      }
      await expect(validateSecurityConsiderationsSection(doc)).resolves.toContainError(
        'EMPTY_SECURITY_CONSIDERATIONS_SECTION',
        ValidationError
      )
    })

    // From draft-chen-rdma-windowless-ack-00
    test('empty security considerations section is located at its heading', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

      Fallback timeout mechanism serves only as safety backup; primary
      loss recovery relies on extended T/C AETH SACK reports.

7.  Security Considerations

8.  IANA Considerations

   This document has no requests to IANA.
`, '')
      await expect(validateSecurityConsiderationsSection(doc)).resolves.toEqual([
        new ValidationError('EMPTY_SECURITY_CONSIDERATIONS_SECTION', 'The security considerations section is present but contains no meaningful content.', {
          ref: 'https://authors.ietf.org/en/required-content#security-considerations',
          lines: [{ line: 27, pos: 1 }]
        })
      ])
    })
  })

  describe('XML Document Type', () => {
    test('valid security considerations section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section[0].name', 'Security Considerations')
      set(doc, 'data.rfc.middle.section[0].t', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      await expect(validateSecurityConsiderationsSection(doc)).resolves.toHaveLength(0)
    })
    test('missing security considerations section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section', [])
      await expect(validateSecurityConsiderationsSection(doc)).resolves.toContainError('MISSING_SECURITY_CONSIDERATIONS_SECTION', ValidationError)
      await expect(validateSecurityConsiderationsSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_SECURITY_CONSIDERATIONS_SECTION', ValidationWarning)
      await expect(validateSecurityConsiderationsSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid security considerations section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section[0].name', 'Security Considerations')
      await expect(validateSecurityConsiderationsSection(doc)).resolves.toContainError('INVALID_SECURITY_CONSIDERATIONS_SECTION', ValidationError)
    })
    test('invalid security considerations section children', async () => {
      const doc = cloneDeep(baseXMLDoc)
      // -> Invalid child element
      set(doc, 'data.rfc.middle.section[0].name', 'Security Considerations')
      set(doc, 'data.rfc.middle.section[0].t', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      set(doc, 'data.rfc.middle.section[0].abc', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      await expect(validateSecurityConsiderationsSection(doc)).resolves.toContainError('INVALID_SECURITY_CONSIDERATIONS_SECTION_CHILD', ValidationError)
    })
    test('valid security considerations section with nested section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section[0].name', 'Security Considerations')
      set(doc, 'data.rfc.middle.section[0].t', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      set(doc, 'data.rfc.middle.section[0].section', [{ name: 'Threat Model', t: 'Some threats.' }])
      await expect(validateSecurityConsiderationsSection(doc)).resolves.toHaveLength(0)
    })
    test('security considerations section with <artset>, <contact> and <author> children', async () => {
      const { doc } = await parse(`<rfc version="3"><middle>
        <section><name>Other</name><t>Text.</t></section>
        <section anchor="s"><name>Security Considerations</name>
          <t>Text.</t>
          <artset>
            <artwork type="svg"><svg xmlns="http://www.w3.org/2000/svg"/></artwork>
            <artwork type="ascii-art">+---+</artwork>
          </artset>
          <t>Thanks to <contact fullname="Jane Doe"/>.</t>
          <contact fullname="John Doe"><organization>Example</organization></contact>
          <author fullname="Alice Doe" initials="A." surname="Doe"/>
          <section><name>More</name><t>Text.</t></section>
        </section>
      </middle></rfc>`, 'draft-test-sections-00.xml')
      await expect(validateSecurityConsiderationsSection(doc)).resolves.toHaveLength(0)
    })
    test('security considerations section children not allowed by the grammar are named', async () => {
      const { doc } = await parse(`<rfc version="3"><middle>
        <section><name>Other</name><t>Text.</t></section>
        <section anchor="s"><name>Security Considerations</name>
          <t>Text.</t>
          <list><t>Item.</t></list>
          <t>More text.</t>
          <list><t>Item.</t></list>
          <note><t>A note.</t></note>
        </section>
      </middle></rfc>`, 'draft-test-sections-00.xml')
      const result = await validateSecurityConsiderationsSection(doc)
      expect(result).toHaveLength(2)
      expect(result.map(e => e.name)).toEqual(['INVALID_SECURITY_CONSIDERATIONS_SECTION_CHILD', 'INVALID_SECURITY_CONSIDERATIONS_SECTION_CHILD'])
      expect(result[0].message).toContain('contains a <list> element')
      expect(result[0].message).toContain('<artset>')
      expect(result[0].path).toBe('rfc.middle.section[1].list')
      expect(result[1].message).toContain('contains a <note> element')
      expect(result[1].path).toBe('rfc.middle.section[1].note')
    })
    test('security considerations section with slugifiedName, title attribute or as single section', async () => {
      for (const middle of [
        '<section><name slugifiedName="name-security-considerations">Security Considerations</name><t>Text.</t></section><section><name>Other</name><t>Text.</t></section>',
        '<section title="Security Considerations"><t>Text.</t></section><section title="Other"><t>Text.</t></section>',
        '<section><name>Security Considerations</name><t>Text.</t></section>'
      ]) {
        const { doc } = await parse(`<rfc version="3"><middle>${middle}</middle></rfc>`, 'draft-test-sections-00.xml')
        await expect(validateSecurityConsiderationsSection(doc)).resolves.toHaveLength(0)
      }
    })
  })
})

describe('document should have valid security author sections', () => {
  describe('document should have a valid author section (TXT Document Type)', () => {
    test('valid author section with correct header', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, authorAddress: { start: 100 } },
          content: { authorAddress: ['John Doe, ACME Inc.', 'Email: john.doe@example.com'] }
        },
        body: `
        Authors' Addresses
        John Doe, ACME Inc.
        Email: john.doe@example.com
        `
      }
      await expect(validateAuthorSection(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    })

    test('missing author section in NORMAL mode', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, authorAddress: { start: 0 } }
        },
        body: `
        Introduction
        This document has no author section.
        `
      }
      await expect(validateAuthorSection(doc, { mode: MODES.NORMAL })).resolves.toContainError(
        'MISSING_AUTHOR_SECTION',
        ValidationError
      )
    })

    test('missing author section in FORGIVE_CHECKLIST mode', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, authorAddress: { start: 0 } }
        },
        body: `
        Introduction
        This document has no author section.
        `
      }
      await expect(validateAuthorSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError(
        'MISSING_AUTHOR_SECTION',
        ValidationWarning
      )
    })

    test('author section in TOC is ignored', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { header: { start: true }, title: true, authorAddress: { start: 112 } },
          content: { authorAddress: ['John Doe, ACME Inc.', 'Email: john.doe@example.com'] }
        },
        body: `
        Table of Contents
        Authors' Addresses...........................7

        Authors' Addresses
        John Doe, ACME Inc.
        Email: john.doe@example.com
        `
      }
      await expect(validateAuthorSection(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    })

    // Address from draft-acosta-deepspace-celestial-bodies-registry-03
    test('misused possessive mark is located at the section title', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

   This document uses [RFC4360].

Authors" Addresses

   Alejandro Acosta
   LACNIC
   Email: alejandro@lacnic.net
`, '')
      await expect(validateAuthorSection(doc)).resolves.toEqual([
        new ValidationWarning('MISUSED_POSSESSIVE_MARK', 'The author\'s address section title "Authors" Addresses" uses an incorrect possessive mark or character other than a single quote.', {
          ref: 'https://authors.ietf.org/en/required-content#authors-addresses',
          lines: [{ line: 26, pos: 1 }]
        })
      ])
    })
  })

  describe('XML Document Type', () => {
    function generateAuthorSection () {
      return {
        _attr: {
          initials: 'J.',
          surname: 'Doe',
          fullname: 'John Doe'
        },
        organization: 'ACME',
        address: { email: 'john.doe@example.com' }
      }
    }

    test('valid author section (array)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.author', times(2, generateAuthorSection))
      await expect(validateAuthorSection(doc)).resolves.toHaveLength(0)
    })
    test('valid author section (object)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.author', generateAuthorSection())
      await expect(validateAuthorSection(doc)).resolves.toHaveLength(0)
    })
    test('missing author section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.author', [])
      await expect(validateAuthorSection(doc)).resolves.toContainError('MISSING_AUTHOR_SECTION', ValidationError)
      await expect(validateAuthorSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_AUTHOR_SECTION', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('too many author sections', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.author', times(6, generateAuthorSection))
      await expect(validateAuthorSection(doc)).resolves.toContainError('TOO_MANY_AUTHORS', ValidationComment)
      await expect(validateAuthorSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('TOO_MANY_AUTHORS', ValidationComment)
      await expect(validateAuthorSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('author section with empty organization', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.author', {
        ...generateAuthorSection(),
        organization: ''
      })
      await expect(validateAuthorSection(doc)).resolves.toContainError('EMPTY_AUTHOR_ORGANIZATION', ValidationComment)
      await expect(validateAuthorSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('EMPTY_AUTHOR_ORGANIZATION', ValidationComment)
      await expect(validateAuthorSection(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('EMPTY_AUTHOR_ORGANIZATION', ValidationComment)
    })
    test('author section with empty organization (parsed XML)', async () => {
      const { doc } = await parse('<rfc version="3"><front><author fullname="John Doe"><organization/></author></front></rfc>', 'draft-test-author-00.xml')
      for (const mode of [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]) {
        const result = await validateAuthorSection(doc, { mode })
        expect(result).toHaveLength(1)
        expect(result).toContainError('EMPTY_AUTHOR_ORGANIZATION', ValidationComment)
      }
    })
    test('author section with an organization that only has attributes', async () => {
      const { doc } = await parse('<rfc version="3"><front><author fullname="John Doe"><organization abbrev="ACME"/></author></front></rfc>', 'draft-test-author-00.xml')
      await expect(validateAuthorSection(doc)).resolves.toContainError('EMPTY_AUTHOR_ORGANIZATION', ValidationComment)
    })
    test('author section with an organization that has attributes and text', async () => {
      const { doc } = await parse('<rfc version="3"><front><author><organization abbrev="ACME">ACME Corp</organization></author></front></rfc>', 'draft-test-author-00.xml')
      await expect(validateAuthorSection(doc)).resolves.toHaveLength(0)
    })
    test('author section with a numeric organization', async () => {
      const { doc } = await parse('<rfc version="3"><front><author><organization>3</organization></author></front></rfc>', 'draft-test-author-00.xml')
      await expect(validateAuthorSection(doc)).resolves.toHaveLength(0)
    })
    test('author section with no fullname + empty organization', async () => {
      const { doc } = await parse('<rfc version="3"><front><author><organization> </organization></author></front></rfc>', 'draft-test-author-00.xml')
      await expect(validateAuthorSection(doc)).resolves.toContainError('MISSING_AUTHOR_FULLNAME', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_AUTHOR_FULLNAME', ValidationWarning)
      const result = await validateAuthorSection(doc, { mode: MODES.SUBMISSION })
      expect(result.map(r => r.name)).toEqual(['EMPTY_AUTHOR_ORGANIZATION'])
    })
    test('author section with no org + empty fullname', async () => {
      const doc = cloneDeep(baseXMLDoc)
      const author = generateAuthorSection()
      author._attr.fullname = ''
      delete author.organization
      set(doc, 'data.rfc.front.author', author)
      await expect(validateAuthorSection(doc)).resolves.toContainError('MISSING_AUTHOR_FULLNAME', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_AUTHOR_FULLNAME', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('author section with ascii properties + empty fullname', async () => {
      const doc = cloneDeep(baseXMLDoc)
      const author = generateAuthorSection()
      author._attr.fullname = ''
      author._attr.asciiFullname = 'John Doe'
      set(doc, 'data.rfc.front.author', author)
      await expect(validateAuthorSection(doc)).resolves.toContainError('MISSING_AUTHOR_FULLNAME_WITH_ASCII', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_AUTHOR_FULLNAME_WITH_ASCII', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
      delete author._attr.asciiFullname
      author._attr.asciiSurname = 'Doe'
      set(doc, 'data.rfc.front.author', author)
      await expect(validateAuthorSection(doc)).resolves.toContainError('MISSING_AUTHOR_FULLNAME_WITH_ASCII', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_AUTHOR_FULLNAME_WITH_ASCII', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
      delete author._attr.asciiSurname
      author._attr.asciiInitials = 'J.'
      set(doc, 'data.rfc.front.author', author)
      await expect(validateAuthorSection(doc)).resolves.toContainError('MISSING_AUTHOR_FULLNAME_WITH_ASCII', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_AUTHOR_FULLNAME_WITH_ASCII', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('author section with editor role', async () => {
      const { doc } = await parse('<rfc version="3"><front><author fullname="John Doe" role="editor"><organization>ACME</organization></author></front></rfc>', 'draft-test-author-00.xml')
      await expect(validateAuthorSection(doc)).resolves.toHaveLength(0)
    })
    test('author section with incorrect role', async () => {
      const { doc } = await parse('<rfc version="3"><front><author fullname="John Doe" role="emperor"><organization>ACME</organization></author></front></rfc>', 'draft-test-author-00.xml')
      await expect(validateAuthorSection(doc)).resolves.toContainError('INVALID_AUTHOR_ROLE', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_AUTHOR_ROLE', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    describe('author names in a non-Latin script', () => {
      const parseAuthor = async (attrs) => {
        const { doc } = await parse(`<rfc version="3"><front><author ${attrs}><organization>ACME</organization></author></front></rfc>`, 'draft-test-author-00.xml')
        return doc
      }
      test('non-Latin fullname without asciiFullname', async () => {
        for (const fullname of ['张三', 'Ελένη Παπαδοπούλου', 'Иван Петров', '김철수', 'Zhang San (张三)']) {
          const doc = await parseAuthor(`fullname="${fullname}"`)
          await expect(validateAuthorSection(doc)).resolves.toContainError('MISSING_LATIN_AUTHOR_NAME', ValidationError)
          await expect(validateAuthorSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_LATIN_AUTHOR_NAME', ValidationWarning)
          await expect(validateAuthorSection(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('MISSING_LATIN_AUTHOR_NAME', ValidationWarning)
        }
      })
      test('non-Latin fullname given as character references', async () => {
        const doc = await parseAuthor('fullname="&#x5F20;&#x4E09;"')
        const result = await validateAuthorSection(doc)
        expect(result).toContainError('MISSING_LATIN_AUTHOR_NAME', ValidationError)
        expect(result[0].path).toBe('rfc.front.author[0].fullname')
      })
      test('non-Latin fullname with asciiFullname', async () => {
        const doc = await parseAuthor('fullname="张三" asciiFullname="Zhang San"')
        for (const mode of [MODES.NORMAL, MODES.FORGIVE_CHECKLIST, MODES.SUBMISSION]) {
          await expect(validateAuthorSection(doc, { mode })).resolves.toHaveLength(0)
        }
      })
      test('Latin fullnames with diacritics', async () => {
        for (const fullname of ['Hans Müller', 'Łukasz Ćwik', 'Ştefan Ţurcanu', 'Bjørn Åsmund', 'Đorđe Nguyễn', 'Seán O\'Brien', 'Kaʻiulani Kawānanakoa']) {
          const doc = await parseAuthor(`fullname="${fullname}"`)
          await expect(validateAuthorSection(doc)).resolves.toHaveLength(0)
        }
      })
    })
  })
})

describe('document should have valid references sections', () => {
  describe('document should have a valid references section (TXT Document Type)', () => {
    test('valid references section with classified subsections', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { references: { start: 100 } },
          content: {
            references: [
              '7.1. Normative References',
              '[RFC4360] Sangli, S., Tappan, D., and Y. Rekhter, "BGP Extended Communities Attribute", RFC 4360, February 2006.',
              '7.2. Informative References',
              '[RFC7153] Rosen, E., "IANA Registries for BGP Extended Communities", RFC 7153, March 2014.'
            ]
          }
        },
        body: `
        7. References

        7.1. Normative References
        [RFC4360] Sangli, S., Tappan, D., and Y. Rekhter, "BGP Extended Communities Attribute", RFC 4360, February 2006.

        7.2. Informative References
        [RFC7153] Rosen, E., "IANA Registries for BGP Extended Communities", RFC 7153, March 2014.
        `
      }
      await expect(validateReferencesSection(doc, { mode: MODES.NORMAL })).resolves.toHaveLength(0)
    })

    test('missing references section', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { references: { start: 0 } },
          content: {}
        },
        body: `
        6. Security Considerations
        This document does not contain a references section.
        `
      }
      await expect(validateReferencesSection(doc, { mode: MODES.NORMAL })).resolves.toContainError(
        'MISSING_REFERENCES_SECTION',
        ValidationError
      )
    })

    test('empty references section', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { references: { start: 120 } },
          content: { references: [] }
        },
        body: `
        7. References

        `
      }
      await expect(validateReferencesSection(doc, { mode: MODES.NORMAL })).resolves.toContainError(
        'EMPTY_REFERENCES_SECTION',
        ValidationError
      )
    })

    test('references section with unclassified subsections', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { references: { start: 100 } },
          content: {
            references: [
              '7.1. Related References',
              '[RFC4360] Sangli, S., "BGP Extended Communities Attribute", RFC 4360, February 2006.',
              '7.2. Further Reading',
              '[RFC7153] Rosen, E., "IANA Registries for BGP Extended Communities", RFC 7153, March 2014.'
            ]
          }
        },
        body: `
        7. References

        7.1. Related References
        [RFC4360] Sangli, S., "BGP Extended Communities Attribute", RFC 4360, February 2006.

        7.2. Further Reading
        [RFC7153] Rosen, E., "IANA Registries for BGP Extended Communities", RFC 7153, March 2014.
        `
      }
      await expect(validateReferencesSection(doc, { mode: MODES.NORMAL })).resolves.toContainError(
        'UNCLASSIFIED_REFERENCES_SUBSECTION',
        ValidationError
      )
    })

    test('missing references subsections but forgiving mode', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { references: { start: 100 } },
          content: { references: [] }
        },
        body: `
        7. References

        `
      }
      await expect(validateReferencesSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError(
        'EMPTY_REFERENCES_SECTION',
        ValidationWarning
      )
    })

    test('references section with unclassified subsections in forgiving mode', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { references: { start: 100 } },
          content: {
            references: [
              '7.1. Related References',
              '[RFC4360] Sangli, S., "BGP Extended Communities Attribute", RFC 4360, February 2006.',
              '7.2. Further Reading',
              '[RFC7153] Rosen, E., "IANA Registries for BGP Extended Communities", RFC 7153, March 2014.'
            ]
          }
        },
        body: `
        7. References

        7.1. Related References
        [RFC4360] Sangli, S., "BGP Extended Communities Attribute", RFC 4360, February 2006.

        7.2. Further Reading
        [RFC7153] Rosen, E., "IANA Registries for BGP Extended Communities", RFC 7153, March 2014.
        `
      }
      await expect(validateReferencesSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError(
        'UNCLASSIFIED_REFERENCES_SUBSECTION',
        ValidationWarning
      )
    })

    test('Should throw an error on bare reference section with no classified subsection', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { references: { start: 100 } },
          content: {
            references: [
              'References',
              '[RFC4360] Sangli, S., "BGP Extended Communities Attribute", RFC 4360, February 2006.'
            ]
          }
        },
        body: `
        7. References
        [RFC4360] Sangli, S., "BGP Extended Communities Attribute", RFC 4360, February 2006.
        `
      }
      await expect(validateReferencesSection(doc, { mode: MODES.NORMAL })).resolves.toContainError(
        'REFERENCE_TYPE_NOT_DECLARED',
        ValidationError
      )
      await expect(validateReferencesSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError(
        'REFERENCE_TYPE_NOT_DECLARED',
        ValidationWarning
      )
    })

    test('references type must be declared, but a single Normative or Informative section is fine', async () => {
      const parseWithReferences = (title) => parseTXT(`${CANONICAL_TXT}
1.  Introduction

   This document uses [RFC4360].

2.  ${title}

   [RFC4360]  Sangli, S., "BGP Extended Communities Attribute",
              RFC 4360, February 2006.
`, '')
      await expect(validateReferencesSection(await parseWithReferences('References'))).resolves.toEqual([
        new ValidationError('REFERENCE_TYPE_NOT_DECLARED', 'References must be identified as Normative or Informative.', {
          ref: 'https://authors.ietf.org/required-content#references',
          lines: [{ line: 26, pos: 1 }]
        })
      ])
      await expect(validateReferencesSection(await parseWithReferences('Normative References'))).resolves.toHaveLength(0)
      await expect(validateReferencesSection(await parseWithReferences('Informative References'))).resolves.toHaveLength(0)
    })

    // From draft-cheng-lsr-igp-shortcut-enhancement-10
    test('unclassified subsection is located at its title', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

   This document uses [RFC9825] and [RFC9012].

9.  References

9.1.  Normative References

   [RFC9825] Lindem, A., Psenak, P., and Y. Qu, "Extensions to OSPF for
             Advertising Prefix Administrative Tags", RFC9825, DOI
             10.17487/RFC9825, July 2025, < https://www.rfc-
             editor.org/info/rfc9825>.

            9.2. Informational References

   [RFC9012] Patel, K., Van de Velde, G., Sangli, S., and J. Scudder,
             "The BGP Tunnel Encapsulation Attribute", RFC 9012, DOI
             10.17487/RFC9012, April 2021, <https://www.rfc-
             editor.org/info/rfc9012>.

Authors' Addresses
`, '')
      await expect(validateReferencesSection(doc)).resolves.toEqual([
        new ValidationError('UNCLASSIFIED_REFERENCES_SUBSECTION', 'The subsection "9.2. Informational References" is not classified as Normative or Informative.', {
          ref: 'https://authors.ietf.org/required-content#references',
          lines: [{ line: 35, pos: 13 }]
        })
      ])
    })

    test('empty references section is located at its heading', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

   This document uses no references.

2.  References

Authors' Addresses
`, '')
      const opts = { ref: 'https://authors.ietf.org/required-content#references', lines: [{ line: 26, pos: 1 }] }
      await expect(validateReferencesSection(doc)).resolves.toEqual([
        new ValidationError('EMPTY_REFERENCES_SECTION', 'The references section is present but contains no meaningful content.', opts),
        new ValidationError('REFERENCE_TYPE_NOT_DECLARED', 'References must be identified as Normative or Informative.', opts)
      ])
    })

    describe('references split into separate sections', () => {
      const entry = `   [RFC4360]  Sangli, S., "BGP Extended Communities Attribute",
              RFC 4360, February 2006.
`
      const parseWithBack = (back) => parseTXT(`${CANONICAL_TXT}
1.  Introduction

   This document uses [RFC4360].

${back}`, '')
      // -> Located at each section title
      const warning = (lines) => new ValidationWarning('MULTIPLE_REFERENCES_SECTION_TITLES', 'References should be one section with Normative and Informative subsections (RFC 7322, Section 4.8.6).', {
        ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.6',
        lines
      })

      test('top-level Normative and Informative References sections', async () => {
        const doc = await parseWithBack(`2.  Normative References

${entry}
3.  Informative References

${entry}`)
        const lines = [{ line: 26, pos: 1 }, { line: 31, pos: 1 }]
        await expect(validateReferencesSection(doc)).resolves.toEqual([warning(lines)])
        await expect(validateReferencesSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toEqual([warning(lines)])
        await expect(validateReferencesSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
      })
      test('an empty References section before the one holding the references', async () => {
        const doc = await parseWithBack(`2.  References

3.  References

3.1.  Normative References

${entry}`)
        await expect(validateReferencesSection(doc)).resolves.toEqual([warning([{ line: 26, pos: 1 }, { line: 28, pos: 1 }])])
      })
      test('unnumbered References section with unnumbered subsections', async () => {
        const doc = await parseWithBack(`References

Normative References

${entry}
Informative References

${entry}`)
        await expect(validateReferencesSection(doc)).resolves.toHaveLength(0)
      })
      test('indented References lines are not section titles', async () => {
        const doc = await parseWithBack(`2.  References

2.1.  Normative References

${entry}
   The registration template has these fields:

   References
      A citation for the specification.
`)
        await expect(validateReferencesSection(doc)).resolves.toHaveLength(0)
      })
    })
  })

  describe('XML Document Type', () => {
    test('valid references section (object)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references.name', 'Normative References')
      await expect(validateReferencesSection(doc)).resolves.toHaveLength(0)
    })
    test('valid references sections (array)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references[0].name', 'Normative References')
      set(doc, 'data.rfc.back.references[1].name', 'Informative References')
      set(doc, 'data.rfc.back.references[1].name["#text"]', 'Informative References')
      await expect(validateReferencesSection(doc)).resolves.toHaveLength(0)
    })
    test('references section title attribute is left to DEPRECATED_ATTRIBUTE', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references[0]._attr.title', 'Normative References')
      await expect(validateReferencesSection(doc)).resolves.toHaveLength(0)
    })
    test('missing references section name', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references[0]', {})
      await expect(validateReferencesSection(doc)).resolves.toContainError('MISSING_REFERENCES_NAME', ValidationError)
      await expect(validateReferencesSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_REFERENCES_NAME', ValidationWarning)
      await expect(validateReferencesSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid references section name', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references[0].name', 'test')
      await expect(validateReferencesSection(doc)).resolves.toContainError('INVALID_REFERENCES_NAME', ValidationError)
      await expect(validateReferencesSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_REFERENCES_NAME', ValidationWarning)
      await expect(validateReferencesSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    describe('parsed XML layouts', () => {
      const parseBack = async (back) => {
        const { doc } = await parse(`<rfc version="3"><back>${back}</back></rfc>`, 'draft-test-references-00.xml')
        return doc
      }
      const normative = '<references><name>Normative References</name><reference anchor="RFC2119"/></references>'
      const informative = '<references><name>Informative References</name><reference anchor="RFC8174"/></references>'

      test('valid nested references wrapper with inner normative and informative sections', async () => {
        const doc = await parseBack(`<references><name>References</name>${normative}${informative}</references>`)
        await expect(validateReferencesSection(doc)).resolves.toHaveLength(0)
      })
      test('nested references wrapper with an invalid inner section name reports the inner path', async () => {
        const doc = await parseBack(`<references><name>References</name>${normative}
          <references><name>Other Stuff</name><reference anchor="RFC8174"/></references>
        </references>`)
        const result = await validateReferencesSection(doc)
        expect(result).toHaveLength(1)
        expect(result).toContainError('INVALID_REFERENCES_NAME', ValidationError)
        expect(result[0].path).toBe('rfc.back.references[0].references[1].name')
      })
      test('nested references wrapper with single inner section', async () => {
        const doc = await parseBack(`<references><name>References</name>${normative}</references>`)
        await expect(validateReferencesSection(doc)).resolves.toHaveLength(0)
      })
      test('flat single references section', async () => {
        await expect(validateReferencesSection(await parseBack(normative))).resolves.toHaveLength(0)
        const result = await validateReferencesSection(await parseBack('<references><name>References</name><reference anchor="RFC2119"/></references>'))
        expect(result).toHaveLength(1)
        expect(result).toContainError('INVALID_REFERENCES_NAME', ValidationError)
        expect(result[0].path).toBe('rfc.back.references[0].name')
      })
      test('references wrapper that also holds references directly', async () => {
        const doc = await parseBack(`<references><name>References</name><reference anchor="RFC7322"/>${normative}${informative}</references>`)
        const result = await validateReferencesSection(doc)
        expect(result).toHaveLength(1)
        expect(result).toContainError('INVALID_REFERENCES_NAME', ValidationError)
        expect(result[0].path).toBe('rfc.back.references[0].name')
      })
      test('references wrapper next to another top-level references section', async () => {
        const doc = await parseBack(`<references><name>References</name>${normative}</references>
          <references><name>Other Stuff</name><reference anchor="RFC8174"/></references>`)
        const result = await validateReferencesSection(doc)
        expect(result).toHaveLength(1)
        expect(result).toContainError('INVALID_REFERENCES_NAME', ValidationError)
        expect(result[0].path).toBe('rfc.back.references[1].name')
      })
      test('v2 title attribute layout', async () => {
        const doc = await parseBack(`<references title="Normative References"><reference anchor="RFC2119"/></references>
          <references title="Other Stuff"><reference anchor="RFC8174"/></references>`)
        const result = await validateReferencesSection(doc)
        expect(result.map(r => [r.name, r.path])).toEqual([
          ['INVALID_REFERENCES_NAME', 'rfc.back.references[1].title']
        ])
        await expect(validateReferencesSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
      })
    })
  })
})

describe('document should have a valid IANA considerations section', () => {
  describe('XML Document Type', () => {
    test('valid IANA considerations section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section[0].name', 'IANA Considerations')
      set(doc, 'data.rfc.middle.section[0].t', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      await expect(validateIANAConsiderationsSection(doc)).resolves.toHaveLength(0)
    })
    test('missing IANA considerations section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section', [])
      doc.docKind = 'draft'
      await expect(validateIANAConsiderationsSection(doc)).resolves.toContainError('MISSING_IANA_CONSIDERATIONS_SECTION', ValidationError)
      await expect(validateIANAConsiderationsSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_IANA_CONSIDERATIONS_SECTION', ValidationWarning)
      await expect(validateIANAConsiderationsSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
      doc.docKind = 'rfc'
      await expect(validateIANAConsiderationsSection(doc)).resolves.toContainError('MISSING_IANA_CONSIDERATIONS_SECTION', ValidationComment)
      await expect(validateIANAConsiderationsSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_IANA_CONSIDERATIONS_SECTION', ValidationComment)
      await expect(validateIANAConsiderationsSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid IANA considerations section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section[0].name', 'IANA Considerations')
      await expect(validateIANAConsiderationsSection(doc)).resolves.toContainError('INVALID_IANA_CONSIDERATIONS_SECTION', ValidationError)
    })
    test('invalid IANA considerations section children', async () => {
      const doc = cloneDeep(baseXMLDoc)
      // -> Invalid child element
      set(doc, 'data.rfc.middle.section[0].name', 'IANA Considerations')
      set(doc, 'data.rfc.middle.section[0].t', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      set(doc, 'data.rfc.middle.section[0].abc', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      await expect(validateIANAConsiderationsSection(doc)).resolves.toContainError('INVALID_IANA_CONSIDERATIONS_SECTION_CHILD', ValidationError)
    })
    test('valid IANA considerations section with nested section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section[0].name', 'IANA Considerations')
      set(doc, 'data.rfc.middle.section[0].t', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      set(doc, 'data.rfc.middle.section[0].section', [{ name: 'New Registries', t: 'Some registries.' }])
      await expect(validateIANAConsiderationsSection(doc)).resolves.toHaveLength(0)
    })
    test('IANA considerations section with <artset>, <contact> and <author> children', async () => {
      const { doc } = await parse(`<rfc version="3"><middle>
        <section><name>Other</name><t>Text.</t></section>
        <section anchor="s"><name>IANA Considerations</name>
          <t>Text.</t>
          <artset>
            <artwork type="svg"><svg xmlns="http://www.w3.org/2000/svg"/></artwork>
            <artwork type="ascii-art">+---+</artwork>
          </artset>
          <t>Thanks to <contact fullname="Jane Doe"/>.</t>
          <contact fullname="John Doe"><organization>Example</organization></contact>
          <author fullname="Alice Doe" initials="A." surname="Doe"/>
          <section><name>More</name><t>Text.</t></section>
        </section>
      </middle></rfc>`, 'draft-test-sections-00.xml')
      await expect(validateIANAConsiderationsSection(doc)).resolves.toHaveLength(0)
    })
    test('IANA considerations section children not allowed by the grammar are named', async () => {
      const { doc } = await parse(`<rfc version="3"><middle>
        <section><name>Other</name><t>Text.</t></section>
        <section anchor="s"><name>IANA Considerations</name>
          <t>Text.</t>
          <list><t>Item.</t></list>
          <t>More text.</t>
          <list><t>Item.</t></list>
          <note><t>A note.</t></note>
        </section>
      </middle></rfc>`, 'draft-test-sections-00.xml')
      const result = await validateIANAConsiderationsSection(doc)
      expect(result).toHaveLength(2)
      expect(result.map(e => e.name)).toEqual(['INVALID_IANA_CONSIDERATIONS_SECTION_CHILD', 'INVALID_IANA_CONSIDERATIONS_SECTION_CHILD'])
      expect(result[0].message).toContain('contains a <list> element')
      expect(result[0].message).toContain('<artset>')
      expect(result[0].path).toBe('rfc.middle.section[1].list')
      expect(result[1].message).toContain('contains a <note> element')
      expect(result[1].path).toBe('rfc.middle.section[1].note')
    })
    test('IANA considerations section with slugifiedName, title attribute or as single section', async () => {
      for (const middle of [
        '<section><name slugifiedName="name-iana-considerations">IANA Considerations</name><t>Text.</t></section><section><name>Other</name><t>Text.</t></section>',
        '<section title="IANA Considerations"><t>Text.</t></section><section title="Other"><t>Text.</t></section>',
        '<section><name>IANA Considerations</name><t>Text.</t></section>'
      ]) {
        const { doc } = await parse(`<rfc version="3"><middle>${middle}</middle></rfc>`, 'draft-test-sections-00.xml')
        await expect(validateIANAConsiderationsSection(doc)).resolves.toHaveLength(0)
      }
    })
  })
  describe('TXT Document Type', () => {
    test('valid IANA considerations section', async () => {
      const doc = cloneDeep(baseTXTDoc)

      doc.data.content.ianaConsiderations = ['IANA Considerations']
      doc.data.content.ianaConsiderations.push('Lorem ipsum dolor sit amet, consectetur adipiscing elit.')

      await expect(validateIANAConsiderationsSection(doc)).resolves.toHaveLength(0)
    })
    test('missing IANA considerations section', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.data.content.ianaConsiderations = []
      doc.docKind = 'draft'
      await expect(validateIANAConsiderationsSection(doc)).resolves.toContainError('MISSING_IANA_CONSIDERATIONS_SECTION', ValidationError)
      await expect(validateIANAConsiderationsSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_IANA_CONSIDERATIONS_SECTION', ValidationWarning)
      await expect(validateIANAConsiderationsSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
      doc.docKind = 'rfc'
      await expect(validateIANAConsiderationsSection(doc)).resolves.toContainError('MISSING_IANA_CONSIDERATIONS_SECTION', ValidationComment)
      await expect(validateIANAConsiderationsSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_IANA_CONSIDERATIONS_SECTION', ValidationComment)
      await expect(validateIANAConsiderationsSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid IANA considerations section', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.data.content.ianaConsiderations = ['IANA Considerations']
      await expect(validateIANAConsiderationsSection(doc)).resolves.toContainError('INVALID_IANA_CONSIDERATIONS_SECTION', ValidationError)
    })
    // From draft-ietf-mailmaint-aprf-00
    test('empty IANA considerations section is located at its heading', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

   to every entity requesting these reports.

11.  IANA Considerations

12.  FAQ

   *  Can the SDI (segment) configuration be leveraged to differentiate
      reporting for promotional/transactional, or even at the campaign
      or audience segment level?  If so, how does this mechanism work?
`, '')
      await expect(validateIANAConsiderationsSection(doc)).resolves.toEqual([
        new ValidationError('INVALID_IANA_CONSIDERATIONS_SECTION', 'The IANA considerations section is empty.', {
          ref: 'https://authors.ietf.org/en/required-content#iana-considerations',
          lines: [{ line: 26, pos: 1 }]
        })
      ])
    })
  })
})

describe('validateReferencesInText', () => {
  describe('TXT documents', () => {
    // From draft-eastlake-6man-hide-options-11 and draft-ietf-pim-rfc1112bis-09
    test('an RFC number inside an entry is not a reference of its own', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

   IPv4 [RFC0791] numbers are listed in [RFC3232].

2.  Normative References

   [RFC0791]  Postel, J., "Internet Protocol", STD 5, RFC 791,
              DOI 10.17487/RFC0791, September 1981.

   [RFC3232]  Reynolds, J., Ed., "Assigned Numbers: RFC 1700 is Replaced
              by an On-line Database", RFC 3232, January 2002.

Author's Address
`, '')
      await expect(validateReferencesInText(doc)).resolves.toEqual([])
    })

    test('an unused entry is named by its label, whatever its kind', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

   This document uses [RFC8446] and [QUIC].

2.  Normative References

   [RFC8446]  Rescorla, E., "The Transport Layer Security (TLS) Protocol
              Version 1.3", RFC 8446, August 2018.

   [RFC2119]  Bradner, S., "Key words for use in RFCs to Indicate
              Requirement Levels", BCP 14, RFC 2119, March 1997.

   [QUIC]     Iyengar, J., Ed. and M. Thomson, Ed., "QUIC", RFC 9000,
              May 2021.

   [TLS]      Rescorla, E., "TLS 1.3", RFC 8446, August 2018.

Author's Address
`, '')
      await expect(validateReferencesInText(doc)).resolves.toEqual([
        new ValidationWarning('REFERENCE_NOT_USED', 'The reference [RFC2119] is listed in the References section but is not mentioned in the document text.', {
          ref: 'https://authors.ietf.org/en/required-content#references',
          lines: [{ line: 31, pos: 4 }]
        }),
        new ValidationWarning('REFERENCE_NOT_USED', 'The reference [TLS] is listed in the References section but is not mentioned in the document text.', {
          ref: 'https://authors.ietf.org/en/required-content#references',
          lines: [{ line: 37, pos: 4 }]
        })
      ])
    })

    test('should handle a document without references', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

   Nothing is cited.

Author's Address
`, '')
      await expect(validateReferencesInText(doc)).resolves.toEqual([])
    })

    test('should filter appendix references and don\'t return warnings for them', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.data.extractedElements.referenceSectionRfc = [
        { value: '2119', subsection: 'appendix' },
        { value: '8174', subsection: 'appendix' } // This should be ignored
      ]

      const result = await validateReferencesInText(doc)
      expect(result).toEqual([])
    })

    // From draft-ietf-ccamp-yang-otn-slicing-12
    test('should return a comment for an RFC Editor placeholder in a TXT document', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
           | tet      | ietf-te-topology           | [RFC8795] |
           +----------+----------------------------+-----------+
           | ietf-nss | ietf-network-slice-service | [RFCVVVV] |
           +----------+----------------------------+-----------+
`, 'draft-ietf-ccamp-yang-otn-slicing-12.txt')

      const result = await validateReferencesInText(doc)

      expect(result).toContainEqual(new ValidationComment(
        'PLACEHOLDER_REFERENCE',
        'Document has [RFCVVVV], a placeholder reference; the RFC Editor will replace it.',
        { ref: 'https://authors.ietf.org/en/required-content#references', lines: [{ line: 24, pos: 54 }] }
      ))
    })

    // From draft-acosta-deepspace-celestial-bodies-registry-03
    test('an unused reference is located at its entry', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

   Celestial bodies are named as the Minor Planet Center designates them
   [MPC-Packed].

2.  Informative References

   [RFC1591]  Postel, J., "Domain Name System Structure and Delegation",
              RFC 1591, March 1994, <https://rfc-editor.org>.

   [MPC-Packed]
              Minor Planet Center, "Packed Provisional and Permanent
              Designations", <https://minorplanetcenter.net>.

Author's Address
`, '')
      await expect(validateReferencesInText(doc)).resolves.toEqual([
        new ValidationWarning('REFERENCE_NOT_USED', 'The reference [RFC1591] is listed in the References section but is not mentioned in the document text.', {
          ref: 'https://authors.ietf.org/en/required-content#references',
          lines: [{ line: 29, pos: 4 }]
        })
      ])
    })

    test('an unused reference is located at its entry, not where another entry mentions it', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

   This document uses [RFC8446].

2.  Normative References

   [RFC8446]  Rescorla, E., "The Transport Layer Security (TLS) Protocol
              Version 1.3", RFC 8446, August 2018 (obsoletes [RFC5246]).

   [RFC5246]  Dierks, T. and E. Rescorla, "The Transport Layer Security
              (TLS) Protocol Version 1.2", RFC 5246, August 2008.

Author's Address
`, '')
      await expect(validateReferencesInText(doc)).resolves.toEqual([
        new ValidationWarning('REFERENCE_NOT_USED', 'The reference [RFC5246] is listed in the References section but is not mentioned in the document text.', {
          ref: 'https://authors.ietf.org/en/required-content#references',
          lines: [{ line: 31, pos: 4 }]
        })
      ])
    })
  })

  describe('XML documents', () => {
    test('should return warnings for unused references in an XML document', async () => {
      const xmlDoc = {
        type: 'xml',
        data: {
          rfc: {
            back: {
              references: {
                references: [
                  {
                    reference: [
                      { _attr: { anchor: 'RFC2119' } },
                      { _attr: { anchor: 'RFC8174' } },
                      { _attr: { anchor: 'RFC1234' } }
                    ]
                  }
                ]
              }
            },
            xref: [
              { _attr: { target: 'RFC2119' } }
            ]
          }
        }
      }

      const result = await validateReferencesInText(xmlDoc)

      expect(result).toEqual([
        new ValidationWarning(
          'REFERENCE_NOT_USED',
          'The reference RFC8174 is listed in the References section but is not mentioned in the document text.',
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        ),
        new ValidationWarning(
          'REFERENCE_NOT_USED',
          'The reference RFC1234 is listed in the References section but is not mentioned in the document text.',
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        )
      ])
    })

    test('should return an empty array if all references are used in an XML document', async () => {
      const xmlDoc = {
        type: 'xml',
        data: {
          rfc: {
            back: {
              references: {
                references: [
                  {
                    reference: [
                      { _attr: { anchor: 'RFC2119' } },
                      { _attr: { anchor: 'RFC8174' } }
                    ]
                  }
                ]
              }
            },
            xref: [
              { _attr: { target: 'RFC2119' } },
              { _attr: { target: 'RFC8174' } }
            ]
          }
        }
      }

      const result = await validateReferencesInText(xmlDoc)

      expect(result).toEqual([])
    })

    test('should return warnings for unused references in a parsed XML document (flat and nested layouts)', async () => {
      const references = `<references><name>Normative References</name>
        <reference anchor="RFC2119"/>
        <reference anchor="RFC8174"/>
      </references>`
      const unused = [
        new ValidationWarning(
          'REFERENCE_NOT_USED',
          'The reference RFC8174 is listed in the References section but is not mentioned in the document text.',
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        )
      ]
      for (const back of [references, `<references><name>References</name>${references}</references>`]) {
        const { doc } = await parse(`<rfc version="3">
          <middle><section><name>Terminology</name><t>See <xref target="RFC2119"/>.</t></section></middle>
          <back>${back}</back>
        </rfc>`, 'draft-test-references-00.xml')
        await expect(validateReferencesInText(doc)).resolves.toEqual(unused)
      }
    })

    describe('included references', () => {
      const unusedWarning = (ref, path) => new ValidationWarning(
        'REFERENCE_NOT_USED',
        `The reference ${ref} is listed in the References section but is not mentioned in the document text.`,
        { ref: 'https://authors.ietf.org/en/required-content#references', ...(path ? { path } : {}) }
      )
      const parseDoc = async (text, references) => (await parse(`<rfc version="3" xmlns:xi="http://www.w3.org/2001/XInclude">
          <middle><section><name>Terminology</name><t>${text}</t></section></middle>
          <back><references><name>Normative References</name>${references}</references></back>
        </rfc>`, 'draft-test-references-00.xml')).doc
      const includes = `<xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml"/>
        <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8174.xml"/>
        <xi:include href="https://bib.ietf.org/public/rfc/bibxml3/reference.I-D.ietf-foo-bar.xml"/>`

      test('reports an included RFC or draft that is not cited', async () => {
        const doc = await parseDoc('See <xref target="RFC2119"/>.', includes)
        await expect(validateReferencesInText(doc)).resolves.toEqual([
          unusedWarning('RFC8174', 'rfc.back.references[0].xi:include[1]'),
          unusedWarning('I-D.ietf-foo-bar', 'rfc.back.references[0].xi:include[2]')
        ])
      })

      test('matches an included reference to <xref> by the document it cites', async () => {
        const doc = await parseDoc('See <xref target="RFC2119"/>, <xref target="RFC8174"/> and <xref target="I-D.draft-ietf-foo-bar-03"/>.', includes)
        await expect(validateReferencesInText(doc)).resolves.toEqual([])
      })

      const citedAsText = (ref, path) => new ValidationWarning(
        'REFERENCE_CITED_AS_TEXT',
        `${ref} is mentioned only as typed text; cite it with <xref>.`,
        { ref: 'https://authors.ietf.org/en/references-in-rfcxml', path }
      )

      test('reports a reference mentioned only as typed text in prose', async () => {
        const doc = await parseDoc('See [RFC2119], RFC 8174 and draft-ietf-foo-bar.', includes)
        await expect(validateReferencesInText(doc)).resolves.toEqual([
          citedAsText('RFC2119', 'rfc.back.references[0].xi:include[0]'),
          citedAsText('RFC8174', 'rfc.back.references[0].xi:include[1]'),
          citedAsText('I-D.ietf-foo-bar', 'rfc.back.references[0].xi:include[2]')
        ])
      })

      test('counts a typed mention in <artwork> or <sourcecode> as a use', async () => {
        const doc = await parseDoc('See <xref target="RFC2119"/>.</t><artwork>-- RFC 8174</artwork><sourcecode>reference "draft-ietf-foo-bar";</sourcecode><t>End.', includes)
        await expect(validateReferencesInText(doc)).resolves.toEqual([])
      })

      test('reports a <reference> mentioned only as typed text, and not one cited with <xref>', async () => {
        const doc = await parseDoc('See [TLS13] and <xref target="RFC2119"/>; nothing else.', `<reference anchor="TLS13"><front><title>TLS</title></front></reference>
          <reference anchor="RFC2119"><front><title>Key words</title></front></reference>
          <reference anchor="QUIC"><front><title>QUIC</title></front></reference>`)
        await expect(validateReferencesInText(doc)).resolves.toEqual([
          new ValidationWarning('REFERENCE_CITED_AS_TEXT', 'TLS13 is mentioned only as typed text; cite it with <xref>.', {
            ref: 'https://authors.ietf.org/en/references-in-rfcxml'
          }),
          new ValidationWarning('REFERENCE_NOT_USED', 'The reference QUIC is listed in the References section but is not mentioned in the document text.', {
            ref: 'https://authors.ietf.org/en/required-content#references'
          })
        ])
      })

      // From draft-ietf-nfsv4-internationalization-17
      test('leaves <?rfc include?> members of a <referencegroup> to the group', async () => {
        const doc = await parseDoc('See <xref target="IDNA2008"/>.', `<referencegroup anchor="IDNA2008">
          <?rfc include="reference.RFC.5890.xml"?>
          <?rfc include="reference.RFC.5891.xml"?>
        </referencegroup>`)
        await expect(validateReferencesInText(doc)).resolves.toEqual([])
      })

      test('counts the RFCs the document updates as mentioned, as the text header names them', async () => {
        // From draft-dahm-tacacs-sshpk-00
        const { doc } = await parse(`<rfc version="3" updates="RFC8907" xmlns:xi="http://www.w3.org/2001/XInclude">
          <middle><section><name>Introduction</name><t>Nothing cited.</t></section></middle>
          <back><references><name>Normative References</name>
            <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8907.xml"/>
          </references></back>
        </rfc>`, 'draft-test-references-00.xml')
        await expect(validateReferencesInText(doc)).resolves.toEqual([])
      })

      test('leaves the members of a <referencegroup> to the group', async () => {
        const doc = await parseDoc('See <xref target="BCP14"/>.', `<referencegroup anchor="BCP14">
          <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml"/>
          <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8174.xml"/>
        </referencegroup>`)
        await expect(validateReferencesInText(doc)).resolves.toEqual([])
      })
    })

    describe('RFC 8792 folding header', () => {
      const references = `<references><name>Informative References</name>
        <reference anchor="RFC2119"/>
        <reference anchor="RFC8174"/>
        <reference anchor="RFC8792"><front><title>Handling Long Lines</title></front><seriesInfo name="RFC" value="8792"/></reference>
        <reference anchor="LONG-LINES"><front><title>Handling Long Lines</title></front><seriesInfo name="RFC" value="8792"/></reference>
      </references>`
      const unusedWarning = (ref) => new ValidationWarning(
        'REFERENCE_NOT_USED',
        `The reference ${ref} is listed in the References section but is not mentioned in the document text.`,
        { ref: 'https://authors.ietf.org/en/required-content#references' }
      )
      const parseWithFigure = async (figure) => {
        const { doc } = await parse(`<rfc version="3">
          <middle><section><name>Example</name><t>See <xref target="RFC2119"/>.</t>${figure}</section></middle>
          <back>${references}</back>
        </rfc>`, 'draft-test-references-00.xml')
        return doc
      }

      test('should treat RFC 8792 as used when the folding header is in <sourcecode>', async () => {
        const doc = await parseWithFigure(`<sourcecode type="json">
=============== NOTE: '\\' line wrapping per RFC 8792 ================

{"key": "a very long \\
  value"}
</sourcecode>`)
        await expect(validateReferencesInText(doc)).resolves.toEqual([unusedWarning('RFC8174')])
      })

      test('should treat RFC 8792 as used when the folding header is in <artwork> CDATA', async () => {
        const doc = await parseWithFigure(`<artwork><![CDATA[
NOTE: '\\\\' line wrapping per RFC 8792

a very long \\
\\line
]]></artwork>`)
        await expect(validateReferencesInText(doc)).resolves.toEqual([unusedWarning('RFC8174')])
      })

      test('should still report RFC 8792 as unused without the folding header', async () => {
        const doc = await parseWithFigure(`<sourcecode type="json">
{"key": "a very long value, not folded"}
</sourcecode>`)
        await expect(validateReferencesInText(doc)).resolves.toEqual([
          unusedWarning('RFC8174'),
          unusedWarning('RFC8792'),
          unusedWarning('LONG-LINES')
        ])
      })

      test('should treat a reference mentioned as typed text in <sourcecode> as used, as in text', async () => {
        const doc = await parseWithFigure(`<sourcecode type="json">
{"key": "RFC 8792 is mentioned here but this is not a folding header"}
</sourcecode>`)
        await expect(validateReferencesInText(doc)).resolves.toEqual([
          unusedWarning('RFC8174'),
          unusedWarning('LONG-LINES')
        ])
      })
    })

    test('should handle empty references in an XML document', async () => {
      const xmlDoc = {
        type: 'xml',
        data: {
          rfc: {
            back: {
              references: {
                references: []
              }
            },
            xref: []
          }
        }
      }

      const result = await validateReferencesInText(xmlDoc)

      expect(result).toEqual([])
    })
  })
})

describe('an empty section is a Warning in submission mode, an Error in the other modes', () => {
  // -> The class of each finding with this code, in each mode
  const severities = async (validate, doc, code) => {
    const out = {}
    for (const [label, mode] of [['normal', MODES.NORMAL], ['forgive-checklist', MODES.FORGIVE_CHECKLIST], ['submission', MODES.SUBMISSION]]) {
      out[label] = (await validate(doc, { mode })).filter(e => e.name === code).map(e => e.constructor.name)
    }
    return out
  }
  const expected = { normal: ['ValidationError'], 'forgive-checklist': ['ValidationError'], submission: ['ValidationWarning'] }

  describe('TXT Document Type', () => {
    test('EMPTY_ABSTRACT_SECTION', async () => {
      const doc = await parseTXT(CANONICAL_TXT.replace('   This document obsoletes RFC 5678.\n', '\nStatus of This Memo\n'), '')
      await expect(severities(validateAbstractSection, doc, 'EMPTY_ABSTRACT_SECTION')).resolves.toEqual(expected)
    })

    test('EMPTY_INTRODUCTION_SECTION', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

2.  Terminology

   The key words "MUST" and "MUST NOT" are to be interpreted as described.
`, '')
      await expect(severities(validateIntroductionSection, doc, 'EMPTY_INTRODUCTION_SECTION')).resolves.toEqual(expected)
    })

    // From draft-chen-rdma-windowless-ack-00
    test('EMPTY_SECURITY_CONSIDERATIONS_SECTION', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

      Fallback timeout mechanism serves only as safety backup; primary
      loss recovery relies on extended T/C AETH SACK reports.

7.  Security Considerations

8.  IANA Considerations

   This document has no requests to IANA.
`, '')
      await expect(severities(validateSecurityConsiderationsSection, doc, 'EMPTY_SECURITY_CONSIDERATIONS_SECTION')).resolves.toEqual(expected)
    })

    // From draft-hdong-dnsop-ml-dsa-mtl-dnssec-sigtag-ext-00
    test('INVALID_IANA_CONSIDERATIONS_SECTION', async () => {
      const doc = await parseTXT(`${CANONICAL_TXT}
1.  Introduction

   This document defines a SigTag extension for ML-DSA-MTL signatures.

8.  IANA Considerations

9.  Implementation Status

   NOTE: Please remove this section and the reference to RFC 7942 prior
   to publication as an RFC.
`, '')
      await expect(severities(validateIANAConsiderationsSection, doc, 'INVALID_IANA_CONSIDERATIONS_SECTION')).resolves.toEqual(expected)
    })
  })

  describe('XML Document Type', () => {
    const parseMiddle = async (middle) => {
      const { doc } = await parse(`<rfc version="3" docName="draft-test-sections-00"><front><abstract><t>Text.</t></abstract></front><middle>${middle}</middle></rfc>`, 'draft-test-sections-00.xml')
      return doc
    }

    test('INVALID_ABSTRACT_SECTION', async () => {
      const { doc } = await parse('<rfc version="3" docName="draft-test-sections-00"><front><abstract/></front></rfc>', 'draft-test-sections-00.xml')
      await expect(severities(validateAbstractSection, doc, 'INVALID_ABSTRACT_SECTION')).resolves.toEqual(expected)
    })

    test('INVALID_INTRODUCTION_SECTION', async () => {
      const doc = await parseMiddle('<section anchor="intro" title="Introduction"/><section title="Other"><t>Text.</t></section>')
      await expect(severities(validateIntroductionSection, doc, 'INVALID_INTRODUCTION_SECTION')).resolves.toEqual(expected)
    })

    // From draft-chen-rdma-windowless-ack-00
    test('INVALID_SECURITY_CONSIDERATIONS_SECTION', async () => {
      const doc = await parseMiddle(`<section anchor="Security" title="Security Considerations"/>

    <section anchor="IANA" title="IANA Considerations">
      <t>This document has no requests to IANA.</t>
    </section>`)
      await expect(severities(validateSecurityConsiderationsSection, doc, 'INVALID_SECURITY_CONSIDERATIONS_SECTION')).resolves.toEqual(expected)
    })

    // From draft-hdong-dnsop-ml-dsa-mtl-dnssec-sigtag-ext-00
    test('INVALID_IANA_CONSIDERATIONS_SECTION', async () => {
      const doc = await parseMiddle(`<section anchor="iana_considerations"><name>IANA Considerations</name>
</section>

<section anchor="implementations"><name>Implementation Status</name>
<t>NOTE: Please remove this section and the reference to RFC 7942 prior to publication as an RFC.</t>
</section>`)
      await expect(severities(validateIANAConsiderationsSection, doc, 'INVALID_IANA_CONSIDERATIONS_SECTION')).resolves.toEqual(expected)
    })

    test('a disallowed child stays an Error in submission mode', async () => {
      const doc = await parseMiddle('<section><name>Security Considerations</name><t>Text.</t><list><t>Item.</t></list></section>')
      await expect(validateSecurityConsiderationsSection(doc, { mode: MODES.SUBMISSION })).resolves.toContainError('INVALID_SECURITY_CONSIDERATIONS_SECTION_CHILD', ValidationError)
      const abstract = await parse('<rfc version="3" docName="draft-test-sections-00"><front><abstract><t>Text.</t><figure><artwork>x</artwork></figure></abstract></front></rfc>', 'draft-test-sections-00.xml')
      await expect(validateAbstractSection(abstract.doc, { mode: MODES.SUBMISSION })).resolves.toContainError('INVALID_ABSTRACT_SECTION_CHILD', ValidationError)
    })
  })
})
