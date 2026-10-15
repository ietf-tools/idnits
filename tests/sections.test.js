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
          ref: 'https://authors.ietf.org/required-content#references'
        })
      ])
      await expect(validateReferencesSection(await parseWithReferences('Normative References'))).resolves.toHaveLength(0)
      await expect(validateReferencesSection(await parseWithReferences('Informative References'))).resolves.toHaveLength(0)
    })

    test('Should throw an error when reference content has two or more section titles', async () => {
      const doc = {
        type: 'txt',
        data: {
          markers: { references: { start: 100 } },
          content: {
            references: [
              '2. Normative References',
              '[RFC4360] Sangli, S., "BGP Extended Communities Attribute", RFC 4360, February 2006.',
              '3. Informative References',
              '[RFC4360] Sangli, S., "BGP Extended Communities Attribute", RFC 4360, February 2006.'
            ]
          }
        },
        body: `
        7. References
        [RFC4360] Sangli, S., "BGP Extended Communities Attribute", RFC 4360, February 2006.
        3. Informative References
        [RFC4360] Sangli, S., "BGP Extended Communities Attribute", RFC 4360, February 2006.
        `
      }
      await expect(validateReferencesSection(doc, { mode: MODES.NORMAL })).resolves.toContainError(
        'MULTIPLE_REFERENCES_SECTION_TITLES',
        ValidationError
      )
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
  })
})

describe('validateReferencesInText', () => {
  describe('TXT documents', () => {
    test('should return warnings for unused references in a TXT document', async () => {
      const txtDoc = {
        type: 'txt',
        data: {
          extractedElements: {
            referenceSectionRfc: [{ value: '2119' }, { value: '8174' }, { value: '1234' }],
            referenceSectionDraftReferences: [{ value: 'draft-ietf-abc-01' }],
            nonReferenceSectionRfc: ['2119'],
            nonReferenceSectionDraftReferences: []
          }
        }
      }

      const result = await validateReferencesInText(txtDoc)

      expect(result).toEqual([
        new ValidationWarning(
          'REFERENCE_NOT_USED',
          'The reference 8174 is listed in the References section but is not mentioned in the document text.',
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        ),
        new ValidationWarning(
          'REFERENCE_NOT_USED',
          'The reference 1234 is listed in the References section but is not mentioned in the document text.',
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        ),
        new ValidationWarning(
          'REFERENCE_NOT_USED',
          'The reference draft-ietf-abc-01 is listed in the References section but is not mentioned in the document text.',
          { ref: 'https://authors.ietf.org/en/required-content#references' }
        )
      ])
    })

    test('should return an empty array if all references are used in a TXT document', async () => {
      const txtDoc = {
        type: 'txt',
        data: {
          extractedElements: {
            referenceSectionRfc: [{ value: '2119' }],
            referenceSectionDraftReferences: [{ value: 'draft-ietf-abc-01' }],
            nonReferenceSectionRfc: ['2119'],
            nonReferenceSectionDraftReferences: ['draft-ietf-abc-01']
          }
        }
      }

      const result = await validateReferencesInText(txtDoc)

      expect(result).toEqual([])
    })

    test('should handle empty references in a TXT document', async () => {
      const txtDoc = {
        type: 'txt',
        data: {
          extractedElements: {
            referenceSectionRfc: [],
            referenceSectionDraftReferences: [],
            nonReferenceSectionRfc: [],
            nonReferenceSectionDraftReferences: []
          }
        }
      }

      const result = await validateReferencesInText(txtDoc)

      expect(result).toEqual([])
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
{"key": "RFC 8792 is mentioned here but this is not a folding header"}
</sourcecode>`)
        await expect(validateReferencesInText(doc)).resolves.toEqual([
          unusedWarning('RFC8174'),
          unusedWarning('RFC8792'),
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
