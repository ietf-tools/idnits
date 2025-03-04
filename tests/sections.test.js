import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import {
  validateAbstractSection,
  validateIntroductionSection,
  validateSecurityConsiderationsSection,
  validateAuthorSection,
  validateReferencesSection,
  validateIANAConsiderationsSection
} from '../lib/modules/sections.mjs'
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
      await expect(validateAuthorSection(doc)).resolves.toContainError('EMPTY_AUTHOR_ORGANIZATION', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('EMPTY_AUTHOR_ORGANIZATION', ValidationWarning)
      await expect(validateAuthorSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
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
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.author', {
        ...generateAuthorSection(),
        role: 'editor'
      })
      await expect(validateAuthorSection(doc)).resolves.toHaveLength(0)
    })
    test('author section with incorrect role', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.author', {
        ...generateAuthorSection(),
        role: 'emperor'
      })
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
  })

  describe('XML Document Type', () => {
    test('valid references section (object)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references._attr.title', 'Normative References')
      await expect(validateReferencesSection(doc)).resolves.toHaveLength(0)
    })
    test('valid references sections (array)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references[0]._attr.title', 'Normative References')
      set(doc, 'data.rfc.back.references[1]._attr.title', 'Informative References')
      await expect(validateReferencesSection(doc)).resolves.toHaveLength(0)
    })
    test('missing references section title', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references[0]', {})
      await expect(validateReferencesSection(doc)).resolves.toContainError('MISSING_REFERENCES_TITLE', ValidationError)
      await expect(validateReferencesSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_REFERENCES_TITLE', ValidationWarning)
      await expect(validateReferencesSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid references section title', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.back.references[0]._attr.title', 'test')
      await expect(validateReferencesSection(doc)).resolves.toContainError('INVALID_REFERENCES_TITLE', ValidationError)
      await expect(validateReferencesSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_REFERENCES_TITLE', ValidationWarning)
      await expect(validateReferencesSection(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
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
  })
})
