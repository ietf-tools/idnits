import { describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateFQDNs } from '../lib/modules/fqdn.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'

expect.extend({
  toContainError
})

describe('document should have valid FQDN mentions', () => {
  describe('validateFQDNs (TXT Document Type)', () => {
    test('valid reserved domains', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            fqdnDomains: []
          }
        }
      }

      const result = await validateFQDNs(doc, { mode: MODES.NORMAL, offline: true })
      expect(result).toHaveLength(0)
    })

    test('invalid TLD domains', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            fqdnDomains: [
              'invalid.not-example.com',
              'another.org'
            ]
          }
        }
      }

      const result = await validateFQDNs(doc, { mode: MODES.NORMAL, offline: false })
      expect(result).toEqual([
        new ValidationWarning('INVALID_DOMAIN_TLD', 'Domain "invalid.not-example.com" is not an allowed reserved domain. Consider using ".example.(com|org|net)" instead.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc6761',
          text: 'invalid.not-example.com'
        }),
        new ValidationWarning('INVALID_DOMAIN_TLD', 'Domain "another.org" is not an allowed reserved domain. Consider using ".example.(com|org|net)" instead.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc6761',
          text: 'another.org'
        })
      ])
    })

    test('invalid ARPA domain usage', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            fqdnDomains: [
              'random.arpa',
              'invalid.arpa'
            ]
          }
        }
      }

      const result = await validateFQDNs(doc, { mode: MODES.NORMAL, offline: false })
      expect(result).toEqual([
        new ValidationWarning('INVALID_ARPA_DOMAIN', 'ARPA domain "random.arpa" usage is invalid.', {
          ref: 'https://www.iana.org/domains/arpa',
          text: 'random.arpa'
        }),
        new ValidationWarning('INVALID_ARPA_DOMAIN', 'ARPA domain "invalid.arpa" usage is invalid.', {
          ref: 'https://www.iana.org/domains/arpa',
          text: 'invalid.arpa'
        })
      ])
    })

    test('www.ietf.org is always valid', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            fqdnDomains: []
          }
        }
      }

      const result = await validateFQDNs(doc, { mode: MODES.NORMAL, offline: true })
      expect(result).toHaveLength(0)
    })

    test('github-like domains should be mentionned as a comment', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            fqdnDomains: [
              'github.com',
              'abcdef.gitlab.io'
            ]
          }
        }
      }

      const result = await validateFQDNs(doc, { mode: MODES.NORMAL, offline: true })
      expect(result).toEqual([
        new ValidationComment('POSSIBLE_INVALID_TLD', 'Ensure "github.com" isn\'t used as a example. For example domains, consider using ".example.(com|org|net)" instead.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc6761',
          text: 'github.com'
        }),
        new ValidationComment('POSSIBLE_INVALID_TLD', 'Ensure "abcdef.gitlab.io" isn\'t used as a example. For example domains, consider using ".example.(com|org|net)" instead.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc6761',
          text: 'abcdef.gitlab.io'
        })
      ])
    })

    test('mixed valid and invalid domains', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            fqdnDomains: [
              'random.arpa',
              'invalid.not-example.com',
              'example.org'
            ]
          }
        }
      }

      const result = await validateFQDNs(doc, { mode: MODES.NORMAL, offline: false })
      expect(result).toEqual([
        new ValidationWarning('INVALID_ARPA_DOMAIN', 'ARPA domain "random.arpa" usage is invalid.', {
          ref: 'https://www.iana.org/domains/arpa',
          text: 'random.arpa'
        }),
        new ValidationWarning('INVALID_DOMAIN_TLD', 'Domain "invalid.not-example.com" is not an allowed reserved domain. Consider using ".example.(com|org|net)" instead.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc6761',
          text: 'invalid.not-example.com'
        })
      ])
    })
  })

  describe('XML Document Type', () => {
    test('valid FQDNs in text section', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum something.example, www.ietf.org and 123.in-addr.arpa.')
      await expect(validateFQDNs(doc)).resolves.toHaveLength(0)
    })
    test('invalid TLD', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum www.something.org lorem ipsum.')
      await expect(validateFQDNs(doc)).resolves.toContainError('INVALID_DOMAIN_TLD', ValidationWarning)
      await expect(validateFQDNs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_DOMAIN_TLD', ValidationWarning)
      await expect(validateFQDNs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid ARPA domain', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum www.invalid123.arpa lorem ipsum.')
      await expect(validateFQDNs(doc)).resolves.toContainError('INVALID_ARPA_DOMAIN', ValidationWarning)
      await expect(validateFQDNs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_ARPA_DOMAIN', ValidationWarning)
      await expect(validateFQDNs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('github-like domain', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum abcdef.github.com lorem ipsum.')
      await expect(validateFQDNs(doc)).resolves.toContainError('POSSIBLE_INVALID_TLD', ValidationComment)
      await expect(validateFQDNs(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('POSSIBLE_INVALID_TLD', ValidationComment)
      await expect(validateFQDNs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    // TODO: non-latin domains (xn--)
  })
})
