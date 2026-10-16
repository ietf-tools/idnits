import { describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationWarning } from '../lib/helpers/error.mjs'
import { validateFQDNs } from '../lib/modules/fqdn.mjs'
import { baseXMLDoc } from './fixtures/base-doc.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
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

    test('Ignore domain matches that start with numeric sequences', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            fqdnDomains: [
              '012.3456.identifier.org'
            ]
          }
        }
      }

      const result = await validateFQDNs(doc, { mode: MODES.NORMAL, offline: true })
      expect(result).toHaveLength(0)
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

    test('Ignore domain matches that are dotdot sequences', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            fqdnDomains: [
              'a.b.c.identifier.org'
            ]
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
    test('the continuation of a wrapped URL is no domain mention', async () => {
      // From draft-bichot-msync-20: the URL of a reference wraps after "rfc-"
      const doc = await parseTXT(`
   [RFC2236] W. Fenner, "Internet Group Management Protocol, Version 2",
              RFC 2236, November 1997, <https://www.rfc-
              editor.org/info/rfc2236>
      `, 'draft-bichot-msync-20.txt')

      const result = await validateFQDNs(doc, { mode: MODES.NORMAL, offline: true })
      expect(result).toHaveLength(0)
    })
    test('an email address broken mid-word is reported as such, not as a domain', async () => {
      // From draft-ietf-scitt-architecture-20: xml2rfc broke "iesg@ietf.org" to fit the 72-column line
      const doc = await parseTXT(`
   Person and email address to contact for further information:  iesg@ie
      tf.org
   Intended usage:  COMMON
      `, 'draft-ietf-scitt-architecture-20.txt')

      const expected = [
        new ValidationWarning('TOKEN_SPLIT_ACROSS_LINES', 'Email address "iesg@ietf.org" is broken mid-word across lines 2 and 3 ("iesg@ie" / "tf.org"). Avoid putting the address where it cannot fit on the line: in XML, for example, use <dl newline="true"> so that it starts a line of its own.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#dl',
          lines: [{ line: 2, pos: 66 }],
          text: 'iesg@ietf.org'
        })
      ]
      await expect(validateFQDNs(doc, { mode: MODES.NORMAL, offline: true })).resolves.toEqual(expected)
      await expect(validateFQDNs(doc, { mode: MODES.FORGIVE_CHECKLIST, offline: true })).resolves.toEqual(expected)
      await expect(validateFQDNs(doc, { mode: MODES.SUBMISSION, offline: true })).resolves.toHaveLength(0)
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
    test('invalid TLD in a section with sibling <t> elements', async () => {
      const doc = cloneDeep(baseXMLDoc)
      // Repeated <t> tags parse to an array of strings, not to separate keys.
      set(doc, 'data.rfc.middle.section.t', [
        'Lorem ipsum dolor sit amet.',
        'Lorem ipsum www.something.org lorem ipsum.'
      ])
      await expect(validateFQDNs(doc)).resolves.toContainError('INVALID_DOMAIN_TLD', ValidationWarning)
      await expect(validateFQDNs(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    describe('text inside cited references', () => {
      const parseXML = async ({ middle = '', back = '' }) => {
        const { doc } = await parse(`<rfc docName="draft-ietf-beep-boop-00">
  <front><title>Test</title></front>
  <middle><section><name>Introduction</name><t>Lorem ipsum.</t>${middle}</section></middle>
  <back>${back}</back>
</rfc>`, 'draft-ietf-beep-boop-00.xml')
        return doc
      }

      test('domains in a reference abstract are not checked', async () => {
        const doc = await parseXML({
          back: `<references><name>Informative References</name>
            <reference anchor="RFC9999"><front><title>Cited</title>
              <abstract><t>Lorem ipsum www.something.org lorem ipsum.</t></abstract>
            </front></reference>
          </references>`
        })
        await expect(validateFQDNs(doc)).resolves.toHaveLength(0)
      })
      test('domains in a reference nested in a referencegroup are not checked', async () => {
        const doc = await parseXML({
          back: `<references><name>Informative References</name>
            <referencegroup anchor="STD99">
              <reference anchor="RFC9999"><front><title>Cited</title>
                <abstract><t>Lorem ipsum www.something.org lorem ipsum.</t></abstract>
              </front></reference>
            </referencegroup>
          </references>`
        })
        await expect(validateFQDNs(doc)).resolves.toHaveLength(0)
      })
      test('the same domain written by the author is still flagged', async () => {
        const doc = await parseXML({ middle: '<t>Lorem ipsum www.something.org lorem ipsum.</t>' })
        await expect(validateFQDNs(doc)).resolves.toContainError('INVALID_DOMAIN_TLD', ValidationWarning)
      })
    })
    // TODO: non-latin domains (xn--)
  })
})
