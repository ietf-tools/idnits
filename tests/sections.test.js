import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateAbstractSection } from '../lib/modules/sections.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { set } from 'lodash-es'

expect.extend({
  toContainError
})

describe('document should have a valid abstract section', () => {
  describe('XML Document Type', () => {
    test('valid abstract section', async () => {
      const doc = { ...baseXMLDoc }
      set(doc, 'data.rfc.front.abstract.t', 'test')
      expect(validateAbstractSection(doc)).toHaveLength(0)
    })
    test('missing abstract section', async () => {
      const doc = { ...baseXMLDoc }
      set(doc, 'data.rfc.front', {})
      expect(validateAbstractSection(doc)).toContainError('MISSING_ABSTRACT_SECTION', ValidationError)
    })
    test('invalid abstract section', async () => {
      const doc = { ...baseXMLDoc }
      // -> Empty object child
      set(doc, 'data.rfc.front.abstract', {})
      expect(validateAbstractSection(doc)).toContainError('INVALID_ABSTRACT_SECTION', ValidationError)
      // -> String child
      set(doc, 'data.rfc.front.abstract', 'test')
      expect(validateAbstractSection(doc)).toContainError('INVALID_ABSTRACT_SECTION', ValidationError)
    })
    test('invalid abstract section children', async () => {
      const doc = { ...baseXMLDoc }
      // -> Invalid child element
      set(doc, 'data.rfc.front.abstract.abc', 'test')
      expect(validateAbstractSection(doc)).toContainError('INVALID_ABSTRACT_SECTION_CHILD', ValidationError)
      // -> Add a valid child but keep the invalid one
      set(doc, 'data.rfc.front.abstract.t', 'test')
      expect(validateAbstractSection(doc)).toContainError('INVALID_ABSTRACT_SECTION_CHILD', ValidationError)
    })
  })
})
