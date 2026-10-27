import { describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import {
  validate2119Keywords,
  validateTermsStyle
} from '../lib/modules/keywords.mjs'
import { baseTXTDoc, baseXMLDoc } from './fixtures/base-doc.mjs'
import { parse } from '../lib/parsers/xml.mjs'
import { parse as parseTXT } from '../lib/parsers/txt.mjs'
import { cloneDeep, set } from 'lodash-es'

expect.extend({
  toContainError
})

describe('document should have valid RFC2119 keywords', () => {
  describe('validate2119Keywords (TXT Document Type)', () => {
    test('keywords found but no boilerplate and no references', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'MUST', line: 5 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual([
        new ValidationError(
          'MISSING_REQLEVEL_BOILERPLATE',
          'One or more BCP14 keywords are present but a BCP14 boilerplate and a reference are missing.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
        )
      ])
    })

    test('keywords found, reference found but no boilerplate', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'MUST', line: 10 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual([
        new ValidationWarning(
          'MISSING_REQLEVEL_BOILERPLATE',
          'One or more BCP14 keywords are present but a BCP14 boilerplate is missing.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
        ),
        new ValidationWarning(
          'MISSING_RFC8174_REF',
          'RFC 2119 is referenced but RFC 8174 is not. BCP 14 should be cited as "BCP 14 [RFC2119] [RFC8174]".',
          { ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2' }
        )
      ])
    })

    test('boilerplate present but no non-boilerplate keywords', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'MUST', line: 15 }],
            boilerplate2119Keywords: [{ keyword: 'MUST', line: 15 }]
          },
          boilerplate: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual([
        new ValidationWarning(
          'MISSING_REQLEVEL_KEYWORDS',
          'A BCP14 boilerplate is present but no keywords are used in the document.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
        ),
        new ValidationWarning(
          'MISSING_RFC8174_REF',
          'RFC 2119 is referenced but RFC 8174 is not. BCP 14 should be cited as "BCP 14 [RFC2119] [RFC8174]".',
          { ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2' }
        )
      ])
    })

    test('invalid keyword combinations found', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'MUST', line: 8 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: [
              { invalidKeyword: 'MUST not', line: 20, pos: 5 }
            ]
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual([
        new ValidationComment(
          'INCORRECT_KEYWORD_SPELLING',
          'The keyword "MUST not" is misspelled.',
          {
            ref: 'https://www.rfc-editor.org/info/bcp14',
            lines: [{ line: 20, pos: 5 }]
          }
        ),
        new ValidationWarning(
          'MISSING_RFC8174_REF',
          'RFC 2119 is referenced but RFC 8174 is not. BCP 14 should be cited as "BCP 14 [RFC2119] [RFC8174]".',
          { ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2' }
        )
      ])
    })

    test('forgive-checklist mode skips errors', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'MUST', line: 10 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })

      expect(result).toEqual([
        new ValidationWarning(
          'MISSING_REQLEVEL_BOILERPLATE',
          'One or more BCP14 keywords are present but a BCP14 boilerplate and a reference are missing.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
        )
      ])
    })

    test('missing reference with boilerplate', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'MUST', line: 10 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual([
        new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE', 'One or more BCP14 keywords are present but a BCP14 boilerplate is missing.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
        }),
        new ValidationWarning(
          'MISSING_RFC8174_REF',
          'RFC 2119 is referenced but RFC 8174 is not. BCP 14 should be cited as "BCP 14 [RFC2119] [RFC8174]".',
          { ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2' }
        )
      ])
    })

    test('keywords found but no boilerplate and no references', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'MUST', line: 5 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual([
        new ValidationError(
          'MISSING_REQLEVEL_BOILERPLATE',
          'One or more BCP14 keywords are present but a BCP14 boilerplate and a reference are missing.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
        )
      ])
    })

    test('keywords found, reference found but no boilerplate', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'MUST', line: 10 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual([
        new ValidationWarning(
          'MISSING_REQLEVEL_BOILERPLATE',
          'One or more BCP14 keywords are present but a BCP14 boilerplate is missing.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
        ),
        new ValidationWarning(
          'MISSING_RFC8174_REF',
          'RFC 2119 is referenced but RFC 8174 is not. BCP 14 should be cited as "BCP 14 [RFC2119] [RFC8174]".',
          { ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2' }
        )
      ])
    })

    test('boilerplate present but no non-boilerplate keywords', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'MUST', line: 15 }],
            boilerplate2119Keywords: [{ keyword: 'MUST', line: 15 }]
          },
          boilerplate: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual([
        new ValidationWarning(
          'MISSING_REQLEVEL_KEYWORDS',
          'A BCP14 boilerplate is present but no keywords are used in the document.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
        ),
        new ValidationWarning(
          'MISSING_RFC8174_REF',
          'RFC 2119 is referenced but RFC 8174 is not. BCP 14 should be cited as "BCP 14 [RFC2119] [RFC8174]".',
          { ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2' }
        )
      ])
    })

    test('invalid keyword combinations found', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'MUST', line: 8 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: [
              { invalidKeyword: 'MUST not', line: 20, pos: 5 }
            ]
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual([
        new ValidationComment(
          'INCORRECT_KEYWORD_SPELLING',
          'The keyword "MUST not" is misspelled.',
          {
            ref: 'https://www.rfc-editor.org/info/bcp14',
            lines: [{ line: 20, pos: 5 }]
          }
        ),
        new ValidationWarning(
          'MISSING_RFC8174_REF',
          'RFC 2119 is referenced but RFC 8174 is not. BCP 14 should be cited as "BCP 14 [RFC2119] [RFC8174]".',
          { ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2' }
        )
      ])
    })

    test('forgive-checklist mode skips errors', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'MUST', line: 10 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })

      expect(result).toEqual([
        new ValidationWarning(
          'MISSING_REQLEVEL_BOILERPLATE',
          'One or more BCP14 keywords are present but a BCP14 boilerplate and a reference are missing.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
        )
      ])
    })

    test('missing reference with boilerplate', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'MUST', line: 10 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual([
        new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE', 'One or more BCP14 keywords are present but a BCP14 boilerplate is missing.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
        }),
        new ValidationWarning(
          'MISSING_RFC8174_REF',
          'RFC 2119 is referenced but RFC 8174 is not. BCP 14 should be cited as "BCP 14 [RFC2119] [RFC8174]".',
          { ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2' }
        )
      ])
    })

    test('similar boilerplate found but no RFC2119 boilerplate present', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'SHOULD', line: 15 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: false,
            rfc8174: false,
            similar2119boilerplate: true
          },
          references: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual(
        expect.arrayContaining([
          new ValidationError(
            'MISSING_REQLEVEL_BOILERPLATE',
            'A BCP14 boilerplate is missing but a similar boilerplate was found.',
            { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
          ),
          new ValidationError(
            'MISSING_REQLEVEL_BOILERPLATE',
            'One or more BCP14 keywords are present but a BCP14 boilerplate and a reference are missing.',
            { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
          )
        ])
      )
    })

    test('NOT RECOMMENDED used but not in boilerplate', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'NOT RECOMMENDED', line: 25 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: true,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual([
        new ValidationWarning(
          'MISSING_NOTRECOMMENDED_IN_BOILERPLATE',
          'The keyword NOT RECOMMENDED appears but not included in the BCP14 boilerplate.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
        ),
        new ValidationWarning(
          'MISSING_RFC8174_REF',
          'RFC 2119 is referenced but RFC 8174 is not. BCP 14 should be cited as "BCP 14 [RFC2119] [RFC8174]".',
          { ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2' }
        )
      ])
    })

    test('BCP14: keywords, BCP14-boilerplate and a [BCP14] citation', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'MUST', line: 5 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: false,
            rfc8174: false,
            bcp14: true
          },
          references: {
            rfc2119: false,
            rfc8174: false,
            bcp14: true
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'BCP14_CITED_INSTEAD_OF_RFCS',
          'BCP 14 is cited as [BCP14]. Cite it as "BCP 14 [RFC2119] [RFC8174]", as RFC 8174 prescribes; the RFC Editor will change it to that.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2' }
        )
      ])
    })

    test('BCP14: keywords and reference to BCP14, but missing boilerplate', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'SHOULD', line: 12 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: false,
            rfc8174: false,
            bcp14: true
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'MISSING_REQLEVEL_BOILERPLATE',
          'One or more BCP14 keywords are present but a BCP14 boilerplate is missing.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
        ),
        new ValidationWarning(
          'BCP14_CITED_INSTEAD_OF_RFCS',
          'BCP 14 is cited as [BCP14]. Cite it as "BCP 14 [RFC2119] [RFC8174]", as RFC 8174 prescribes; the RFC Editor will change it to that.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2' }
        )
      ])
    })

    test('BCP14: BCP14-boilerplate exist, but any keywords are missing', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: false,
            rfc8174: false,
            bcp14: true
          },
          references: {
            rfc2119: false,
            rfc8174: false,
            bcp14: true
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationWarning(
          'MISSING_REQLEVEL_KEYWORDS',
          'A BCP14 boilerplate is present but no keywords are used in the document.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
        ),
        new ValidationWarning(
          'BCP14_CITED_INSTEAD_OF_RFCS',
          'BCP 14 is cited as [BCP14]. Cite it as "BCP 14 [RFC2119] [RFC8174]", as RFC 8174 prescribes; the RFC Editor will change it to that.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc8174.html#section-2' }
        )
      ])
    })

    test('BCP14: keywords are present, but neither boilerplate (RFC2119 or BCP14) nor any reference is present', async () => {
      const doc = {
        type: 'txt',
        data: {
          extractedElements: {
            keywords2119: [{ keyword: 'RECOMMENDED', line: 7 }],
            boilerplate2119Keywords: []
          },
          boilerplate: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          references: {
            rfc2119: false,
            rfc8174: false,
            bcp14: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })
      expect(result).toEqual([
        new ValidationError(
          'MISSING_REQLEVEL_BOILERPLATE',
          'One or more BCP14 keywords are present but a BCP14 boilerplate and a reference are missing.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
        )
      ])
    })

    describe('locations of findings in a text draft', () => {
      // Text of the document at a location
      const at = (doc, { line, pos }) => doc.body.split('\n')[line - 1].slice(pos - 1)

      test('similar boilerplate, keywords without a boilerplate and RFC 2119 cited without RFC 8174', async () => {
        const doc = await parseTXT(`
1.1.  Requirements Language

   The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
   "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this
   document are to be interpreted as described in RFC 2119 [RFC2119].

   In a component that may at some time be interpreted to be a URI by
   some system the "@" MUST NOT be placed prior to the userinfo
   component:

9.  Normative References

   [RFC2119]  Bradner, S., "Key words for use in RFCs to Indicate
              Requirement Levels", BCP 14, RFC 2119, March 1997.
`, 'draft-accilent-at-sign-00.txt')

        const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })
        expect(result.map((e) => [e.name, e.lines])).toEqual([
          // The paragraph starting as a boilerplate does
          ['MISSING_REQLEVEL_BOILERPLATE', [{ line: 4, pos: 4 }]],
          // The keywords, the paragraph's included as it isn't a boilerplate
          ['MISSING_REQLEVEL_BOILERPLATE', [
            { line: 4, pos: 19 }, { line: 4, pos: 27 }, { line: 4, pos: 39 }, { line: 4, pos: 51 }, { line: 4, pos: 60 },
            { line: 5, pos: 5 }, { line: 5, pos: 15 }, { line: 5, pos: 29 }, { line: 5, pos: 44 }, { line: 5, pos: 55 },
            { line: 9, pos: 24 }
          ]],
          // The citation and the reference
          ['MISSING_RFC8174_REF', [{ line: 6, pos: 60 }, { line: 14, pos: 4 }]]
        ])
        expect(at(doc, result[0].lines[0])).toMatch(/^The key words/)
        expect(at(doc, result[1].lines[10])).toMatch(/^MUST NOT be placed/)
        expect(result[2].lines.map((loc) => at(doc, loc))).toEqual([
          expect.stringMatching(/^\[RFC2119\]\.$/),
          expect.stringMatching(/^\[RFC2119\] {2}Bradner/)
        ])
      })

      test('keywords: at most 20 locations, the first ones', async () => {
        const doc = await parseTXT(`
1.3.  Specification Requirements

   The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
   "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
   "OPTIONAL" in this document are to be interpreted as described in BCP
   14 RFC2119 [RFC8174] when, and only when, they appear in all
   capitals, as shown here.

   The key deriviations described below MUST be done when the inner
   method is EAP (i.e. when the parties exchange EAP-Payload TLVs).  The
   key deriviations described below MUST NOT be done when the inner
   method is anything other than EAP (i.e. when the inner method does
   not include EAP-Payload TLVs).

   Since the Crypto-Binding TLV depends on the key derivations, it has
   the same requirements.  A Crypto-Binding TLV MUST be used when the
   inner method is EAP.  A Crypto-Binding TLV MUST NOT be used when the
   inner method is anything other than EAP.

   Inner EAP methods MUST produce an MSK and/or an EMSK.  Inner EAP
   methods which produce neither MSK or EMSK (e.g. EAP-GTC) MUST NOT be
   used.  A party which sees an attempt to use a forbidden inner EAP
   method MUST either respond with an EAP NAK that suggests one or more
   acceptable EAP methods, or else respond with a fatal error, and an

   *  The Version field MUST set to two (2).

   *  The Received-Ver field MUST be set to two (2), to indicate TEAPv2.

   *  The Flags field MUST have value 2, to indicate that only the MSK
      Compound-MAC is present.

   *  The ESMK Compound-MAC field is not used.  It SHOULD be set to
      zeros by the sender.  The receiver MUST ignore it.
`, 'draft-ietf-emu-teapv2-00.txt')

        const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })
        const keywordsFinding = result.find((e) => e.name === 'MISSING_REQLEVEL_BOILERPLATE' && e.message.includes('keywords are present'))
        expect(doc.data.extractedElements.keywords2119).toHaveLength(23)
        expect(keywordsFinding.lines).toHaveLength(20)
        expect(keywordsFinding.lines[0]).toEqual({ line: 4, pos: 19 })
        expect(keywordsFinding.lines.at(-1)).toEqual({ line: 29, pos: 30 })
        for (const loc of keywordsFinding.lines) {
          expect(at(doc, loc)).toMatch(/^(NOT )?(MUST|REQUIRED|SHALL|SHOULD|RECOMMENDED|OPTIONAL|MAY)/)
        }
        // RFC 8174 is only cited
        expect(result.find((e) => e.name === 'MISSING_RFC2119_REF').lines).toEqual([{ line: 7, pos: 15 }])
        expect(at(doc, { line: 7, pos: 15 })).toMatch(/^\[RFC8174\] when/)
      })

      test('boilerplate without keywords: the boilerplate', async () => {
        const doc = await parseTXT(`
2.  Conventions and Definitions

   The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
   "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
   "OPTIONAL" in this document are to be interpreted as described in
   BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all
   capitals, as shown here.
`, 'draft-bg-onions-update-network-service-models-01.txt')

        const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })
        expect(result.map((e) => e.name)).toEqual(['MISSING_REQLEVEL_KEYWORDS'])
        expect(result[0].lines).toEqual([
          { line: 4, pos: 19 }, { line: 4, pos: 27 }, { line: 4, pos: 39 }, { line: 4, pos: 51 }, { line: 4, pos: 60 },
          { line: 5, pos: 5 }, { line: 5, pos: 15 }, { line: 5, pos: 29 }, { line: 5, pos: 44 }, { line: 5, pos: 63 },
          { line: 6, pos: 5 }
        ])
        expect(result[0].lines.map((loc) => at(doc, loc).slice(0, 4))).toEqual(['MUST', 'MUST', 'REQU', 'SHAL', 'SHAL', 'SHOU', 'SHOU', 'RECO', 'NOT ', 'MAY"', 'OPTI'])
      })

      test('NOT RECOMMENDED used but not in the boilerplate: where it is used', async () => {
        const doc = await parseTXT(`
2.  Terminology

   The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
   "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this
   document are to be interpreted as described in RFC 2119.

   errors (REQUIRED):  An array of named error conditions that this
      endpoint may return.  Each error condition MUST be named and
      SHOULD include a description.  Generic error names (e.g., "error",
      "failure") are NOT RECOMMENDED.  Specific descriptive error names
      (e.g., "reservation_unavailable", "invalid_datetime",
      "restaurant_not_found") are REQUIRED for conformance.
`, 'draft-hood-independent-agis-01.txt')

        const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })
        expect(result.map((e) => [e.name, e.lines])).toEqual([
          ['MISSING_NOTRECOMMENDED_IN_BOILERPLATE', [{ line: 11, pos: 22 }]]
        ])
        expect(at(doc, result[0].lines[0])).toMatch(/^NOT RECOMMENDED\./)
      })

      test('[BCP14] citation: in the text and in the references', async () => {
        const doc = await parseTXT(`
1.2.  Requirements Language and Applicability

   The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
   "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
   "OPTIONAL" in this document are to be interpreted as described in BCP
   14 [BCP14] when, and only when, they appear in all capitals, as shown
   here.

   A mapping instance MUST identify its source objects, source format

10.  Normative References

   [BCP14]    Best Current Practice 14,
`, 'draft-abak-ai-evaluation-claim-preservation-00.txt')

        const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })
        const finding = result.find((e) => e.name === 'BCP14_CITED_INSTEAD_OF_RFCS')
        expect(finding.lines).toEqual([{ line: 7, pos: 7 }, { line: 14, pos: 4 }])
        expect(finding.lines.map((loc) => at(doc, loc).slice(0, 7))).toEqual(['[BCP14]', '[BCP14]'])
      })

      test('misspelled keyword: where the keyword starts', async () => {
        const doc = await parseTXT(`
   The "@" SHOULD not be placed prior to the userinfo component even in
`, 'draft-accilent-at-sign-00.txt')

        const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })
        const finding = result.find((e) => e.name === 'INCORRECT_KEYWORD_SPELLING')
        expect(finding.lines).toEqual([{ line: 2, pos: 12 }])
        expect(at(doc, finding.lines[0])).toMatch(/^SHOULD not be placed/)
      })
    })
  })

  describe('XML Document Type', () => {
    const boilerplate = `The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL
      NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED",  "MAY", and
      "OPTIONAL" in this document are to be interpreted as described in RFC 2119.`

    const boilerplateWithBCP14 = `The key words "<bcp14>MUST</bcp14>", "<bcp14>MUST NOT</bcp14>", "<bcp14>REQUIRED</bcp14>", "<bcp14>SHALL</bcp14>", "<bcp14>SHALL
      NOT</bcp14>", "<bcp14>SHOULD</bcp14>", "<bcp14>SHOULD NOT</bcp14>", "<bcp14>RECOMMENDED</bcp14>", "<bcp14>NOT RECOMMENDED</bcp14>",
      "<bcp14>MAY</bcp14>", and "<bcp14>OPTIONAL</bcp14>" in this document are to be interpreted as
      described in BCP¤14 <xref target="BCP14"/> when, and only when, they appear in all capitals, as shown here.`
    test('valid keywords with default boilerplate', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'BCP14' }]
      set(doc, 'data.rfc.middle.t', [
        boilerplate,
        { '#text': 'Lorem ipsum  lorem ipsum  lorem .', bcp14: ['SHALL', 'MUST NOT', 'RECOMMENDED'] }
      ])
      await expect(validate2119Keywords(doc)).resolves.toHaveLength(0)
    })
    test('valid keywords with BCP14', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'BCP14' }]
      set(doc, 'data.rfc.middle.t', [
        boilerplateWithBCP14,
        { '#text': 'Lorem ipsum  lorem ipsum  lorem .', bcp14: ['SHALL', 'MUST NOT', 'RECOMMENDED'] }
      ])
      await expect(validate2119Keywords(doc)).resolves.toHaveLength(0)
    })
    test('invalid combinations', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum NOT OPTIONAL.')
      await expect(validate2119Keywords(doc)).resolves.toContainError('INVALID_REQLEVEL_KEYWORD', ValidationComment)
      await expect(validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_REQLEVEL_KEYWORD', ValidationComment)
      await expect(validate2119Keywords(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid combinations (case mismatch)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum MUST not lorem ipsum.')
      await expect(validate2119Keywords(doc)).resolves.toContainError('INVALID_REQLEVEL_KEYWORD', ValidationComment)
      await expect(validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_REQLEVEL_KEYWORD', ValidationComment)
      await expect(validate2119Keywords(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid combinations (case mismatch)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum MUST not lorem ipsum.')
      await expect(validate2119Keywords(doc)).resolves.toContainError('INVALID_REQLEVEL_KEYWORD', ValidationComment)
      await expect(validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INVALID_REQLEVEL_KEYWORD', ValidationComment)
      await expect(validate2119Keywords(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('missing boilerplate', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum SHALL lorem ipsum MUST NOT lorem RECOMMENDED.')
      await expect(validate2119Keywords(doc)).resolves.toContainError('MISSING_REQLEVEL_BOILERPLATE', ValidationError)
      await expect(validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_REQLEVEL_BOILERPLATE', ValidationWarning)
      await expect(validate2119Keywords(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('missing reference', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', [
        boilerplate,
        'Lorem ipsum SHALL lorem ipsum MUST NOT lorem RECOMMENDED.'
      ])
      await expect(validate2119Keywords(doc)).resolves.toContainError('MISSING_REQLEVEL_REF', ValidationError)
      await expect(validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_REQLEVEL_REF', ValidationError)
      await expect(validate2119Keywords(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('missing reference with bcp14', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', [
        boilerplateWithBCP14,
        'Lorem ipsum SHALL lorem ipsum MUST NOT lorem RECOMMENDED.'
      ])
      await expect(validate2119Keywords(doc)).resolves.toContainError('MISSING_REQLEVEL_REF', ValidationError)
      await expect(validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_REQLEVEL_REF', ValidationError)
      await expect(validate2119Keywords(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('reference present but no boilerplate', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'RFC2119' }]
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum SHALL lorem ipsum MUST NOT lorem RECOMMENDED.')
      await expect(validate2119Keywords(doc)).resolves.toContainError('MISSING_REQLEVEL_BOILERPLATE', ValidationWarning)
      await expect(validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_REQLEVEL_BOILERPLATE', ValidationWarning)
      await expect(validate2119Keywords(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('boilerplate present but no keywords', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'RFC2119' }]
      set(doc, 'data.rfc.middle.t', [
        boilerplate,
        'Lorem ipsum lorem ipsum lorem ipsum.'
      ])
      await expect(validate2119Keywords(doc)).resolves.toContainError('MISSING_REQLEVEL_KEYWORDS', ValidationWarning)
      await expect(validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_REQLEVEL_KEYWORDS', ValidationWarning)
      await expect(validate2119Keywords(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('boilerplate present but no keywords with bcp14', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'RFC2119' }]
      set(doc, 'data.rfc.middle.t', [
        boilerplateWithBCP14,
        'Lorem ipsum lorem ipsum lorem ipsum.'
      ])
      await expect(validate2119Keywords(doc)).resolves.toContainError('MISSING_REQLEVEL_KEYWORDS', ValidationWarning)
      await expect(validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_REQLEVEL_KEYWORDS', ValidationWarning)
      await expect(validate2119Keywords(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('NOT RECOMMENDED present but not in boilerplate', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'RFC2119' }]
      set(doc, 'data.rfc.middle.t', [
        boilerplate,
        'Lorem ipsum NOT RECOMMENDED lorem ipsum.'
      ])
      await expect(validate2119Keywords(doc)).resolves.toContainError('MISSING_NOTRECOMMENDED_IN_BOILERPLATE', ValidationWarning)
      await expect(validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_NOTRECOMMENDED_IN_BOILERPLATE', ValidationWarning)
      await expect(validate2119Keywords(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('NOT RECOMMENDED present and appears in boilerplate', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'BCP14' }]
      set(doc, 'data.rfc.middle.t', [
        `The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL
        NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
        "OPTIONAL" in this document are to be interpreted as described in RFC 2119.`,
        { '#text': 'Lorem ipsum  lorem ipsum  lorem .', bcp14: ['SHALL', 'MUST NOT', 'NOT RECOMMENDED'] }
      ])
      await expect(validate2119Keywords(doc)).resolves.toHaveLength(0)
    })
    test('untagged keyword not wrapped in bcp14 tags', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'BCP14' }]
      set(doc, 'data.rfc.middle.t', [
        boilerplate,
        'The server MUST respond to the request.'
      ])
      await expect(validate2119Keywords(doc)).resolves.toContainError('MISSING_BCP14_TAGS', ValidationComment)
      await expect(validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_BCP14_TAGS', ValidationComment)
      await expect(validate2119Keywords(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('keyword wrapped in bcp14 tags is not flagged', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'BCP14' }]
      set(doc, 'data.rfc.middle.t', [
        boilerplate,
        { '#text': 'The server  respond to the request.', bcp14: 'MUST' }
      ])
      const result = await validate2119Keywords(doc)
      expect(result.find(r => r.name === 'MISSING_BCP14_TAGS')).toBeUndefined()
    })
    test('untagged keyword inside artwork is ignored', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'BCP14' }]
      set(doc, 'data.rfc.middle.section', {
        artwork: 'The parser MUST accept this artwork verbatim.'
      })
      const result = await validate2119Keywords(doc)
      expect(result.find(r => r.name === 'MISSING_BCP14_TAGS')).toBeUndefined()
    })
    test('untagged keyword inside sourcecode is ignored', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'BCP14' }]
      set(doc, 'data.rfc.middle.section', {
        sourcecode: { '#text': 'if (ready) { /* SHOULD run here */ }', _attr: { type: 'c' } }
      })
      const result = await validate2119Keywords(doc)
      expect(result.find(r => r.name === 'MISSING_BCP14_TAGS')).toBeUndefined()
    })
    test('untagged keyword in a list item is flagged', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'BCP14' }]
      set(doc, 'data.rfc.middle.section', {
        t: boilerplate,
        ul: { li: ['The client MUST retry.', 'The server logs the attempt.'] }
      })
      await expect(validate2119Keywords(doc)).resolves.toContainError('MISSING_BCP14_TAGS', ValidationComment)
    })
    test('untagged keyword in a lone list item is flagged', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'BCP14' }]
      set(doc, 'data.rfc.middle.section', {
        t: boilerplate,
        ul: { li: 'The client MUST retry.' }
      })
      await expect(validate2119Keywords(doc)).resolves.toContainError('MISSING_BCP14_TAGS', ValidationComment)
    })
    test('untagged keyword in <strong> or <em> is flagged, but not in <tt>', async () => {
      const { doc } = await parse(`<rfc docName="draft-ietf-beep-boop-00">
  <front><title>Test</title></front>
  <middle><section><name>Introduction</name>
    <t>${boilerplate}</t>
    <t>The client <strong>MUST</strong> retry.</t>
    <t>The server <em>SHOULD</em> log the attempt.</t>
    <t>The field is <tt>OPTIONAL</tt> in ASN.1.</t>
  </section></middle>
</rfc>`, 'draft-ietf-beep-boop-00.xml')
      doc.externalEntities = [{ name: 'BCP14' }]
      const result = await validate2119Keywords(doc)
      const tagErrors = result.filter(r => r.name === 'MISSING_BCP14_TAGS')
      expect(tagErrors.map(r => r.message).join(' ')).toMatch(/MUST/)
      expect(tagErrors.map(r => r.message).join(' ')).toMatch(/SHOULD/)
      expect(tagErrors.map(r => r.message).join(' ')).not.toMatch(/OPTIONAL/)
    })
    describe('text inside cited references', () => {
      const abstract = '<front><title>Cited</title><abstract><t>Implementations MUST use US-ASCII.</t></abstract></front>'
      const parseXML = async ({ middle = '', back = '' }) => {
        const { doc } = await parse(`<rfc docName="draft-ietf-beep-boop-00">
  <front><title>Test</title></front>
  <middle><section><name>Introduction</name><t>Lorem ipsum.</t>${middle}</section></middle>
  <back>${back}</back>
</rfc>`, 'draft-ietf-beep-boop-00.xml')
        return doc
      }

      test('keywords in a reference abstract are not BCP14 keyword uses', async () => {
        const doc = await parseXML({
          back: `<references><name>Informative References</name>
            <reference anchor="RFC9999">${abstract}</reference>
          </references>`
        })
        await expect(validate2119Keywords(doc)).resolves.toHaveLength(0)
      })
      test('keywords in a reference nested in a referencegroup are not BCP14 keyword uses', async () => {
        const doc = await parseXML({
          back: `<references><name>Informative References</name>
            <referencegroup anchor="STD99">
              <reference anchor="RFC9998"><front><title>Other</title></front></reference>
              <reference anchor="RFC9999">${abstract}</reference>
            </referencegroup>
          </references>`
        })
        await expect(validate2119Keywords(doc)).resolves.toHaveLength(0)
      })
      test('the same keywords written by the author are still flagged', async () => {
        const doc = await parseXML({ middle: '<t>Implementations MUST use US-ASCII.</t>' })
        const result = await validate2119Keywords(doc)
        expect(result).toContainError('MISSING_BCP14_TAGS', ValidationComment)
        expect(result).toContainError('MISSING_REQLEVEL_BOILERPLATE', ValidationError)
      })
    })

    describe('keywords of a tagged boilerplate (parsed XML)', () => {
      const tagged = (nr = true) => `<t>The key words "<bcp14>MUST</bcp14>", "<bcp14>MUST NOT</bcp14>", "<bcp14>REQUIRED</bcp14>",
        "<bcp14>SHALL</bcp14>", "<bcp14>SHALL NOT</bcp14>", "<bcp14>SHOULD</bcp14>", "<bcp14>SHOULD NOT</bcp14>",
        "<bcp14>RECOMMENDED</bcp14>", ${nr ? '"<bcp14>NOT RECOMMENDED</bcp14>", ' : ''}"<bcp14>MAY</bcp14>", and "<bcp14>OPTIONAL</bcp14>"
        in this document are to be interpreted as described in BCP 14 <xref target="RFC2119"/> <xref target="RFC8174"/>
        when, and only when, they appear in all capitals, as shown here.</t>`
      const untagged = `<t>The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
        "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14
        <xref target="RFC2119"/> <xref target="RFC8174"/> when, and only when, they appear in all capitals, as shown here.</t>`
      const parseXML = async ({ abstract = '<t>An abstract.</t>', boilerplate = tagged(), body = '<t>Nothing required.</t>' } = {}) => {
        const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-test-bcp14-tagged-00" category="std">
  <front><title>Test</title><abstract>${abstract}</abstract></front>
  <middle>
    <section><name>Terminology</name>${boilerplate}</section>
    <section><name>Protocol</name>${body}</section>
  </middle>
  <back><references><name>Normative References</name>
    <reference anchor="RFC2119"><front><title>Key words for use in RFCs to Indicate Requirement Levels</title></front><seriesInfo name="RFC" value="2119"/></reference>
    <reference anchor="RFC8174"><front><title>Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words</title></front><seriesInfo name="RFC" value="8174"/></reference>
  </references></back>
</rfc>`, 'draft-test-bcp14-tagged-00.xml')
        return doc
      }
      const names = async (doc) => (await validate2119Keywords(doc)).map(r => r.name).filter(n => n !== 'MISSING_BCP14_TAGS')

      test('tagged boilerplate and no keywords elsewhere', async () => {
        expect(await names(await parseXML())).toEqual(['MISSING_REQLEVEL_KEYWORDS'])
      })
      test('tagged boilerplate and a keyword in a section', async () => {
        expect(await names(await parseXML({ body: '<t>The client <bcp14>MUST</bcp14> connect.</t>' }))).toEqual([])
      })
      test('tagged boilerplate and an untagged keyword in a section', async () => {
        expect(await names(await parseXML({ body: '<t>The client MUST connect.</t>' }))).toEqual([])
      })
      test('untagged boilerplate, as before', async () => {
        expect(await names(await parseXML({ boilerplate: untagged }))).toEqual(['MISSING_REQLEVEL_KEYWORDS'])
        expect(await names(await parseXML({ boilerplate: untagged, body: '<t>The client <bcp14>MUST</bcp14> connect.</t>' }))).toEqual([])
      })
      test('tagged boilerplate listing NOT RECOMMENDED, and NOT RECOMMENDED used', async () => {
        const doc = await parseXML({ body: '<t>Retrying is <bcp14>NOT RECOMMENDED</bcp14>.</t>' })
        expect(await names(doc)).toEqual([])
      })
      test('tagged boilerplate without NOT RECOMMENDED, and NOT RECOMMENDED used', async () => {
        const doc = await parseXML({ boilerplate: tagged(false), body: '<t>Retrying is <bcp14>NOT RECOMMENDED</bcp14>.</t>' })
        expect(await names(doc)).toEqual(['MISSING_NOTRECOMMENDED_IN_BOILERPLATE'])
      })
      test('NOT RECOMMENDED used before a boilerplate without it', async () => {
        const doc = await parseXML({ abstract: '<t>Retrying is <bcp14>NOT RECOMMENDED</bcp14>.</t>', boilerplate: tagged(false) })
        expect(await names(doc)).toEqual(['MISSING_NOTRECOMMENDED_IN_BOILERPLATE'])
        const untaggedDoc = await parseXML({ abstract: '<t>Retrying is <bcp14>NOT RECOMMENDED</bcp14>.</t>', boilerplate: untagged })
        expect(await names(untaggedDoc)).toEqual(['MISSING_NOTRECOMMENDED_IN_BOILERPLATE'])
      })
      test('keywords used only in a YANG module that repeats the boilerplate', async () => {
        const yang = `<sourcecode type="yang" markers="true"><![CDATA[
module example {
  description
    "The key words 'MUST', 'MUST NOT', 'REQUIRED', 'SHALL', 'SHALL NOT', 'SHOULD', 'SHOULD NOT',
     'RECOMMENDED', 'NOT RECOMMENDED', 'MAY', and 'OPTIONAL' in this document are to be
     interpreted as described in BCP 14 (RFC 2119) (RFC 8174) when, and only when, they
     appear in all capitals, as shown here.";
  leaf a { description "A server MUST reject it."; }
}
]]></sourcecode>`
        expect(await names(await parseXML({ body: yang }))).toEqual([])
        expect(await names(await parseXML({ body: yang.replace('MUST reject', 'rejects') }))).toEqual(['MISSING_REQLEVEL_KEYWORDS'])
      })
      test('boilerplate listing NOT RECOMMENDED but other keywords used', async () => {
        const doc = await parseXML({ body: '<t>The client <bcp14>SHOULD</bcp14> retry.</t>' })
        expect(await names(doc)).toEqual([])
      })
    })

    describe('BCP14 reference detection (parsed XML)', () => {
      const parsedBoilerplate = `<t>The key words "<bcp14>MUST</bcp14>", "<bcp14>MUST NOT</bcp14>", "<bcp14>REQUIRED</bcp14>",
        "<bcp14>SHALL</bcp14>", "<bcp14>SHALL NOT</bcp14>", "<bcp14>SHOULD</bcp14>", "<bcp14>SHOULD NOT</bcp14>",
        "<bcp14>RECOMMENDED</bcp14>", "<bcp14>NOT RECOMMENDED</bcp14>", "<bcp14>MAY</bcp14>", and "<bcp14>OPTIONAL</bcp14>"
        in this document are to be interpreted as described in BCP 14 XREFS when, and only when, they appear in all capitals, as shown here.</t>`
      const parseXML = async ({ xrefs = '', back = '', entities = '' } = {}) => {
        const { doc } = await parse(`<?xml version="1.0" encoding="UTF-8"?>
${entities}<rfc xmlns:xi="http://www.w3.org/2001/XInclude" version="3">
  <middle>
    <section><name>Terminology</name>${parsedBoilerplate.replace('XREFS', xrefs)}</section>
    <section><name>Protocol</name><t>The client <bcp14>MUST</bcp14> connect.</t></section>
  </middle>
  <back>${back}</back>
</rfc>`, 'draft-test-bcp14-refs-00.xml')
        return doc
      }
      const errorNames = async (doc) => (await validate2119Keywords(doc)).map(r => r.name)

      test('netconf-style layout: nested references, xref to RFC2119, reference via xi:include', async () => {
        const doc = await parseXML({
          xrefs: '<xref target="RFC2119"/> <xref target="RFC8174"/>',
          back: `<references><name>References</name>
            <references><name>Normative References</name>
              <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml"/>
              <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8174.xml"/>
            </references>
          </references>`
        })
        const names = await errorNames(doc)
        expect(names).not.toContain('MISSING_REQLEVEL_REF')
        expect(names).not.toContain('MISSING_REQLEVEL_BOILERPLATE')
        expect(names).not.toContain('MISSING_RFC8174_REF')
        expect(names).not.toContain('MISSING_RFC2119_REF')
        expect(names).not.toContain('BCP14_CITED_INSTEAD_OF_RFCS')
      })
      test('BCP14 reference group cited as [RFC2119] [RFC8174]', async () => {
        const doc = await parseXML({
          xrefs: '<xref target="RFC2119"/> <xref target="RFC8174"/>',
          back: `<references><name>Normative References</name>
            <referencegroup anchor="BCP14" target="https://www.rfc-editor.org/info/bcp14">
              <reference anchor="RFC2119"><front><title>Key words for use in RFCs to Indicate Requirement Levels</title></front></reference>
              <reference anchor="RFC8174"><front><title>Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words</title></front></reference>
            </referencegroup>
          </references>`
        })
        const names = await errorNames(doc)
        expect(names).not.toContain('MISSING_REQLEVEL_REF')
        expect(names).not.toContain('MISSING_RFC8174_REF')
        expect(names).not.toContain('MISSING_RFC2119_REF')
        expect(names).not.toContain('BCP14_CITED_INSTEAD_OF_RFCS')
      })
      test('xi:include of the BCP14 bibxml file only', async () => {
        const doc = await parseXML({
          back: `<references><name>Normative References</name>
            <xi:include href="https://bib.ietf.org/public/rfc/bibxml-rfcsubseries/reference.BCP.0014.xml"/>
          </references>`
        })
        const names = await errorNames(doc)
        expect(names).not.toContain('MISSING_REQLEVEL_REF')
        expect(names).not.toContain('BCP14_CITED_INSTEAD_OF_RFCS')
      })
      test('xref to BCP14 only (case-insensitive)', async () => {
        const doc = await parseXML({ xrefs: '<xref target="bcp14"/>' })
        const names = await errorNames(doc)
        expect(names).not.toContain('MISSING_REQLEVEL_REF')
        expect(names).toContain('BCP14_CITED_INSTEAD_OF_RFCS')
      })
      test('inline reference with a non-standard anchor and an RFC seriesInfo', async () => {
        const doc = await parseXML({
          back: `<references><name>Normative References</name>
            <reference anchor="KEYWORDS" target="https://www.rfc-editor.org/info/rfc2119">
              <front><title>Key words for use in RFCs to Indicate Requirement Levels</title></front>
              <seriesInfo name="BCP" value="14"/>
              <seriesInfo name="RFC" value="2119"/>
            </reference>
          </references>`
        })
        const names = await errorNames(doc)
        expect(names).not.toContain('MISSING_REQLEVEL_REF')
        expect(names).toContain('MISSING_RFC8174_REF')
      })
      test('reference anchor in flat references', async () => {
        const doc = await parseXML({
          back: `<references><name>Normative References</name>
            <reference anchor="RFC8174"><front><title>Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words</title></front></reference>
          </references>`
        })
        const names = await errorNames(doc)
        expect(names).not.toContain('MISSING_REQLEVEL_REF')
        expect(names).toContain('MISSING_RFC2119_REF')
      })
      test('external entity URL naming the RFC2119 bibxml file', async () => {
        const doc = await parseXML({
          entities: '<!DOCTYPE rfc [\n<!ENTITY KEYWORDS SYSTEM "https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml">\n]>\n'
        })
        expect(await errorNames(doc)).not.toContain('MISSING_REQLEVEL_REF')
      })
      test('keywords and boilerplate but no RFC2119/RFC8174/BCP14 reference', async () => {
        const doc = await parseXML({
          xrefs: '<xref target="RFC9000"/>',
          back: `<references><name>Normative References</name>
            <references><name>Normative References</name>
              <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.9000.xml"/>
              <reference anchor="RFC21190"><seriesInfo name="RFC" value="21190"/></reference>
            </references>
          </references>`
        })
        await expect(validate2119Keywords(doc)).resolves.toContainError('MISSING_REQLEVEL_REF', ValidationError)
        await expect(validate2119Keywords(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('MISSING_REQLEVEL_REF', ValidationError)
        await expect(validate2119Keywords(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
      })
      test('document whose only keyword is SHOULD / SHOULD NOT uses keywords', async () => {
        const doc = cloneDeep(baseXMLDoc)
        doc.externalEntities = [{ name: 'BCP14' }]
        set(doc, 'data.rfc.middle.t', [
          boilerplate,
          'The client SHOULD retry, but SHOULD NOT retry forever.'
        ])
        const result = await validate2119Keywords(doc)
        expect(result.map(r => r.name)).not.toContain('MISSING_REQLEVEL_KEYWORDS')
        expect(result.map(r => r.name)).not.toContain('INVALID_REQLEVEL_KEYWORD')

        const noBoilerplate = cloneDeep(baseXMLDoc)
        set(noBoilerplate, 'data.rfc.middle.t', 'The client SHOULD retry.')
        await expect(validate2119Keywords(noBoilerplate)).resolves.toContainError('MISSING_REQLEVEL_BOILERPLATE', ValidationError)
      })
      test('SHOULD with lowercase not is an invalid keyword', async () => {
        const doc = cloneDeep(baseXMLDoc)
        set(doc, 'data.rfc.middle.t', 'Lorem ipsum SHOULD not lorem ipsum.')
        await expect(validate2119Keywords(doc)).resolves.toContainError('INVALID_REQLEVEL_KEYWORD', ValidationComment)
      })
    })
  })
})

describe('document should have valid term spelling', () => {
  describe('TXT Document Type', () => {
    test('valid terms', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'Lorem ipsum email subdomain Internet-Draft IPsec.'
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
    })
    test('invalid spelling (email)', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'Lorem ipsum e-mail address.'
      await expect(validateTermsStyle(doc)).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      // (located where the term starts, counting columns from 1)
      expect((await validateTermsStyle(doc))[0].lines).toEqual([{ line: 1, pos: 13 }])
      await expect(validateTermsStyle(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid spelling (Internet-Draft)', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'Lorem ipsum Internet Draft.'
      await expect(validateTermsStyle(doc)).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })

    test('Valid spelling, but it might look suspicious to validator function', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'Reason lines), but all of them MUST have different protocol values'
      await expect(validateTermsStyle(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toHaveLength(0)
    })

    test('should not match "serve mail"', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The server will serve mail to clients.'
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
    })

    test('should not match "ragtime-stampede"', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The ragtime-stampede event was a great success.'
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
    })

    test('invalid spelling (public-key)', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The system uses a public-key infrastructure for security.'
      await expect(validateTermsStyle(doc)).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })

    test('invalid spelling (time-stamp)', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The time-stamp verification process is crucial.'
      await expect(validateTermsStyle(doc)).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })

    test('should not match "email client"', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The email client supports multiple protocols.'
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
    })

    test('should not match "online banking"', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'Online banking services have improved security.'
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
    })
  })
  describe('XML Document Type', () => {
    test('valid terms', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum email subdomain Internet-Draft IPsec.')
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
    })
    test('invalid spelling (email)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum e-mail address.')
      await expect(validateTermsStyle(doc)).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('invalid spelling (Internet-Draft)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Lorem ipsum Internet Draft.')
      await expect(validateTermsStyle(doc)).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })
    test('should not match "serve mail" in XML', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'The server will serve mail to clients.')
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
    })

    test('should not match "ragtime-stampede" in XML', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'The ragtime-stampede event was a great success.')
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
    })

    test('invalid spelling (public-key)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'The system uses a public-key infrastructure for security.')
      await expect(validateTermsStyle(doc)).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })

    test('invalid spelling (time-stamp)', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'The time-stamp verification process is crucial.')
      await expect(validateTermsStyle(doc)).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })

    test('should not match "email client" in XML', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'The email client supports multiple protocols.')
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
    })

    test('should not match "online banking" in XML', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'Online banking services have improved security.')
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
    })

    test('invalid spelling in a section with sibling <t> elements', async () => {
      const doc = cloneDeep(baseXMLDoc)
      // Repeated <t> tags parse to an array of strings, not to separate keys.
      set(doc, 'data.rfc.middle.section.t', [
        'The system is described below.',
        'Lorem ipsum e-mail address.'
      ])
      await expect(validateTermsStyle(doc)).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      await expect(validateTermsStyle(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
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

      test('terms in a reference abstract are not checked', async () => {
        const doc = await parseXML({
          back: `<references><name>Normative References</name>
            <reference anchor="RFC3629"><front><title>UTF-8</title>
              <abstract><t>UTF-8 has the characteristic of preserving the full US-ASCII range.</t></abstract>
            </front></reference>
          </references>`
        })
        await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
      })
      test('terms in a reference nested in a referencegroup are not checked', async () => {
        const doc = await parseXML({
          back: `<references><name>Normative References</name>
            <referencegroup anchor="STD63">
              <reference anchor="RFC3629"><front><title>UTF-8</title>
                <abstract><t>Lorem ipsum.</t><t>UTF-8 has the characteristic of preserving the full US-ASCII range.</t></abstract>
              </front></reference>
            </referencegroup>
          </references>`
        })
        await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
      })
      test('the same terms written by the author are still flagged', async () => {
        const doc = await parseXML({ middle: '<t>UTF-8 has the characteristic of preserving the full US-ASCII range.</t>' })
        await expect(validateTermsStyle(doc)).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      })
      test('terms in a back section written by the author are still flagged', async () => {
        const doc = await parseXML({
          back: `<references><name>Normative References</name>
            <reference anchor="RFC3629"><front><title>UTF-8</title></front></reference>
          </references>
          <section><name>Acknowledgments</name><t>Thanks for the e-mail feedback.</t></section>`
        })
        await expect(validateTermsStyle(doc)).resolves.toContainError('INCORRECT_TERM_SPELLING', ValidationComment)
      })
    })
  })
})
