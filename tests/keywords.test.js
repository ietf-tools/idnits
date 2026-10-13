import { describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import {
  validate2119Keywords,
  validateTermsStyle
} from '../lib/modules/keywords.mjs'
import { baseTXTDoc, baseXMLDoc } from './fixtures/base-doc.mjs'
import { parse } from '../lib/parsers/xml.mjs'
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
  })
})
