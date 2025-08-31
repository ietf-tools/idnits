import { describe, expect, test } from 'vitest'
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
  describe('document should have valid IPv4 mentions (TXT Document Type)', () => {
    test('valid IPv4 addresses', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            ipv4: [
              '192.0.2.1',
              '198.51.100.23',
              '203.0.113.45',
              '233.252.0.10',
              '0.0.0.0',
              '255.255.255.255'
            ]
          }
        }
      }

      const result = await validateIPs(doc, { mode: MODES.NORMAL })
      expect(result).toHaveLength(0)
    })

    test('invalid IPv4 addresses', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            ipv4: [
              '256.0.0.1',
              '192.0.2.300',
              '192.0.2',
              '192.0.2.1/999',
              'abc.def.ghi.jkl'
            ]
          }
        }
      }

      const result = await validateIPs(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning('INVALID_IPV4_ADDRESS', 'IPv4 address is invalid.', {
          ref: 'https://datatracker.ietf.org/doc/html/rfc791',
          text: '256.0.0.1'
        }),
        new ValidationWarning('INVALID_IPV4_ADDRESS', 'IPv4 address is invalid.', {
          ref: 'https://datatracker.ietf.org/doc/html/rfc791',
          text: '192.0.2.300'
        }),
        new ValidationWarning('INVALID_IPV4_ADDRESS', 'IPv4 address is invalid.', {
          ref: 'https://datatracker.ietf.org/doc/html/rfc791',
          text: '192.0.2'
        }),
        new ValidationWarning('INVALID_IPV4_ADDRESS', 'IPv4 address is invalid.', {
          ref: 'https://datatracker.ietf.org/doc/html/rfc791',
          text: '192.0.2.1/999'
        }),
        new ValidationWarning('INVALID_IPV4_ADDRESS', 'IPv4 address is invalid.', {
          ref: 'https://datatracker.ietf.org/doc/html/rfc791',
          text: 'abc.def.ghi.jkl'
        })
      ])
    })

    test('Documentation IPv4 addresses', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            ipv4: [
              '8.8.8.8',
              '1.1.1.1',
              '123.45.67.89'
            ]
          }
        }
      }

      const result = await validateIPs(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([])
    })

    test('Valid IPv6 documentation address', async () => {
      const input = { type: 'txt', data: { extractedElements: { ipv6: ['2001:db8::1'] } } }
      const result = await validateIPs(input, { mode: 0 })
      expect(result).toEqual([])
    })

    test('Invalid IPv6 address', async () => {
      const input = { type: 'txt', data: { extractedElements: { ipv4: [], ipv6: ['1234:5678:90ab::g'] } } }
      const result = await validateIPs(input, { mode: 0 })
      expect(result).toEqual([
        new ValidationWarning('INVALID_IPV6_ADDRESS', 'IPv6 address is invalid.', {
          ref: 'https://datatracker.ietf.org/doc/html/rfc4291',
          text: '1234:5678:90ab::g'
        })
      ])
    })

    test('Non-tandard IPv6 address', async () => {
      const input = { type: 'txt', data: { extractedElements: { ipv4: [], ipv6: ['abcd::1234'] } } }
      const result = await validateIPs(input, { mode: 0 })
      expect(result).toEqual([])
    })

    test('Mixed valid IPv4 and IPv6', async () => {
      const input = { type: 'txt', data: { extractedElements: { ipv4: ['192.0.2.1'], ipv6: ['2001:db8::1'] } } }
      const result = await validateIPs(input, { mode: 0 })
      expect(result).toEqual([])
    })

    test('Mixed invalid IPv4 and IPv6', async () => {
      const input = { type: 'txt', data: { extractedElements: { ipv4: ['999.999.999.999'], ipv6: ['abcd::g'] } } }
      const result = await validateIPs(input, { mode: 0 })
      expect(result).toEqual([
        new ValidationWarning('INVALID_IPV4_ADDRESS', 'IPv4 address is invalid.', {
          ref: 'https://datatracker.ietf.org/doc/html/rfc791',
          text: '999.999.999.999'
        }),
        new ValidationWarning('INVALID_IPV6_ADDRESS', 'IPv6 address is invalid.', {
          ref: 'https://datatracker.ietf.org/doc/html/rfc4291',
          text: 'abcd::g'
        })
      ])
    })
  })

  describe('XML Document Type', () => {
    test('valid IP Addresses in text section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum 255.0.0.123, 2001:DB8:0:0:8:800:200C:417A and 0:0:0:0:0:0:0:0.')
      await expect(validateIPs(doc)).resolves.toHaveLength(0)
    })
    test('valid IP Addresses with cidr in text section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum 255.0.0.0/16, 2001:DB8:0:0::/100 and 2001:DB8::/128.')
      await expect(validateIPs(doc)).resolves.toHaveLength(0)
    })
    test('invalid IPv4', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum 256.0.0.123 lorem ipsum.')
      await expect(validateIPs(doc)).resolves.toContainError('INVALID_IPV4_ADDRESS', ValidationWarning)
      await expect(validateIPs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_IPV4_ADDRESS', ValidationWarning)
      await expect(validateIPs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid IPv4 cidr', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum 10.11.22.1/33 lorem ipsum.')
      await expect(validateIPs(doc)).resolves.toContainError('INVALID_IPV4_ADDRESS', ValidationWarning)
      await expect(validateIPs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_IPV4_ADDRESS', ValidationWarning)
      await expect(validateIPs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid IPv6', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum F:0DB8:0000:CD30:0000:0000111:0000:0000 lorem ipsum.')
      await expect(validateIPs(doc)).resolves.toContainError('INVALID_IPV6_ADDRESS', ValidationWarning)
      await expect(validateIPs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_IPV6_ADDRESS', ValidationWarning)
      await expect(validateIPs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid IPv6 cidr', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum 2001:DB8:0:0:8:800::/129 lorem ipsum.')
      await expect(validateIPs(doc)).resolves.toContainError('INVALID_IPV6_ADDRESS', ValidationWarning)
      await expect(validateIPs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_IPV6_ADDRESS', ValidationWarning)
      await expect(validateIPs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    // TODO: More IPv6 variations, compressed, mix with v4, etc.
  })
})
