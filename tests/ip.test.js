import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationWarning } from '../lib/helpers/error.mjs'
import {
  validateIPs
} from '../lib/modules/ip.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'

expect.extend({
  toContainError
})

describe('document should have valid IP Address mentions', () => {
  describe('XML Document Type', () => {
    test('valid IP Addresses in text section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum 255.0.0.123, 2001:DB8:0:0:8:800:200C:417A and 0:0:0:0:0:0:0:0.')
      await expect(validateIPs(doc)).resolves.toHaveLength(0)
    })
    test('invalid IPv4', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum 256.0.0.123 lorem ipsum.')
      await expect(validateIPs(doc)).resolves.toContainError('INVALID_IPV4_ADDRESS', ValidationWarning)
      await expect(validateIPs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_IPV4_ADDRESS', ValidationWarning)
      await expect(validateIPs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    // TODO: More IPv4 variations, with cidr
    test('invalid IPv6', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum F:0DB8:0000:CD30:0000:0000:0000:0000/60 lorem ipsum.')
      await expect(validateIPs(doc)).resolves.toContainError('INVALID_IPV6_ADDRESS', ValidationWarning)
      await expect(validateIPs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_IPV6_ADDRESS', ValidationWarning)
      await expect(validateIPs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    // TODO: More IPv6 variations, compressed, mix with v4, etc.
  })
})
