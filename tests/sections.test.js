import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateAbstractSection, validateIntroductionSection, validateSecurityConsiderationsSection } from '../lib/modules/sections.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'

expect.extend({
  toContainError
})

describe('document should have a valid abstract section', () => {
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
