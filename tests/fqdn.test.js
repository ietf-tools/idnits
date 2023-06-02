import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationWarning } from '../lib/helpers/error.mjs'
import {
  validateFQDNs
} from '../lib/modules/fqdn.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'

expect.extend({
  toContainError
})

describe('document should have valid FQDN mentions', () => {
  describe('XML Document Type', () => {
    test('valid FQDNs in text section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum something.example, www.ietf.org and 123.in-addr.arpa.')
      await expect(validateFQDNs(doc)).resolves.toHaveLength(0)
    })
    test('invalid TLD', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum something.invalidtld lorem ipsum.')
      await expect(validateFQDNs(doc)).resolves.toContainError('INVALID_DOMAIN_TLD', ValidationWarning)
      await expect(validateFQDNs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_DOMAIN_TLD', ValidationWarning)
      await expect(validateFQDNs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid ARPA domain', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum invalid123.arpa lorem ipsum.')
      await expect(validateFQDNs(doc)).resolves.toContainError('INVALID_ARPA_DOMAIN', ValidationWarning)
      await expect(validateFQDNs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_ARPA_DOMAIN', ValidationWarning)
      await expect(validateFQDNs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    // TODO: non-latin domains (xn--)
  })
})
