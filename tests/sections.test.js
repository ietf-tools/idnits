import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateAbstractSection, validateIntroductionSection } from '../lib/modules/sections.mjs'
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
      expect(validateAbstractSection(doc)).toHaveLength(0)
    })
    test('missing abstract section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front', {})
      expect(validateAbstractSection(doc)).toContainError('MISSING_ABSTRACT_SECTION', ValidationError)
    })
    test('invalid abstract section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      // -> Empty object child
      set(doc, 'data.rfc.front.abstract', {})
      expect(validateAbstractSection(doc)).toContainError('INVALID_ABSTRACT_SECTION', ValidationError)
      // -> String child
      set(doc, 'data.rfc.front.abstract', 'test')
      expect(validateAbstractSection(doc)).toContainError('INVALID_ABSTRACT_SECTION', ValidationError)
    })
    test('invalid abstract section children', async () => {
      const doc = cloneDeep(baseXMLDoc)
      // -> Invalid child element
      set(doc, 'data.rfc.front.abstract.abc', 'test')
      expect(validateAbstractSection(doc)).toContainError('INVALID_ABSTRACT_SECTION_CHILD', ValidationError)
      // -> Add a valid child but keep the invalid one
      set(doc, 'data.rfc.front.abstract.t', 'test')
      expect(validateAbstractSection(doc)).toContainError('INVALID_ABSTRACT_SECTION_CHILD', ValidationError)
    })
    test('abstract section children with reference', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.front.abstract.t', ['test', { xref: {} }])
      expect(validateAbstractSection(doc)).toContainError('INVALID_ABSTRACT_SECTION_REF', ValidationError)
      expect(validateAbstractSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).toContainError('INVALID_ABSTRACT_SECTION_REF', ValidationWarning)
      expect(validateAbstractSection(doc, { mode: MODES.SUBMISSION })).toHaveLength(0)
    })
  })
})

describe('document should have a valid introduction section', () => {
  describe('XML Document Type', () => {
    test('valid introduction section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section[0].name', 'Introduction')
      set(doc, 'data.rfc.middle.section[0].t', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      expect(validateIntroductionSection(doc)).toHaveLength(0)
    })
    test('missing introduction section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section', [])
      expect(validateIntroductionSection(doc)).toContainError('MISSING_INTRODUCTION_SECTION', ValidationError)
      expect(validateIntroductionSection(doc, { mode: MODES.FORGIVE_CHECKLIST })).toContainError('MISSING_INTRODUCTION_SECTION', ValidationWarning)
      expect(validateIntroductionSection(doc, { mode: MODES.SUBMISSION })).toHaveLength(0)
    })
    test('invalid introduction section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section[0].name', 'Introduction')
      expect(validateIntroductionSection(doc)).toContainError('INVALID_INTRODUCTION_SECTION', ValidationError)
    })
    test('invalid introduction section children', async () => {
      const doc = cloneDeep(baseXMLDoc)
      // -> Invalid child element
      set(doc, 'data.rfc.middle.section[0].name', 'Introduction')
      set(doc, 'data.rfc.middle.section[0].t', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      set(doc, 'data.rfc.middle.section[0].abc', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
      expect(validateIntroductionSection(doc)).toContainError('INVALID_INTRODUCTION_SECTION_CHILD', ValidationError)
    })
  })
})
