import { describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import {
  validate2119Keywords,
  validateTermsStyle
} from '../lib/modules/keywords.mjs'
import { parse as parseXml } from '../lib/parsers/xml.mjs'
import { baseTXTDoc, baseXMLDoc } from './fixtures/base-doc.mjs'
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
          'PREFER_BCP14_REF',
          'Consider referencing BCP14 instead of (or in addition to) RFC2119/RFC8174, as BCP14 encompasses both specifications.',
          { ref: 'https://www.rfc-editor.org/info/bcp14' }
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
          'PREFER_BCP14_REF',
          'Consider referencing BCP14 instead of (or in addition to) RFC2119/RFC8174, as BCP14 encompasses both specifications.',
          { ref: 'https://www.rfc-editor.org/info/bcp14' }
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
          'PREFER_BCP14_REF',
          'Consider referencing BCP14 instead of (or in addition to) RFC2119/RFC8174, as BCP14 encompasses both specifications.',
          { ref: 'https://www.rfc-editor.org/info/bcp14' }
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
          'PREFER_BCP14_REF',
          'Consider referencing BCP14 instead of (or in addition to) RFC2119/RFC8174, as BCP14 encompasses both specifications.',
          { ref: 'https://www.rfc-editor.org/info/bcp14' }
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
          'PREFER_BCP14_REF',
          'Consider referencing BCP14 instead of (or in addition to) RFC2119/RFC8174, as BCP14 encompasses both specifications.',
          { ref: 'https://www.rfc-editor.org/info/bcp14' }
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
          'PREFER_BCP14_REF',
          'Consider referencing BCP14 instead of (or in addition to) RFC2119/RFC8174, as BCP14 encompasses both specifications.',
          { ref: 'https://www.rfc-editor.org/info/bcp14' }
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
          'PREFER_BCP14_REF',
          'Consider referencing BCP14 instead of (or in addition to) RFC2119/RFC8174, as BCP14 encompasses both specifications.',
          { ref: 'https://www.rfc-editor.org/info/bcp14' }
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
          'PREFER_BCP14_REF',
          'Consider referencing BCP14 instead of (or in addition to) RFC2119/RFC8174, as BCP14 encompasses both specifications.',
          { ref: 'https://www.rfc-editor.org/info/bcp14' }
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
          'PREFER_BCP14_REF',
          'Consider referencing BCP14 instead of (or in addition to) RFC2119/RFC8174, as BCP14 encompasses both specifications.',
          { ref: 'https://www.rfc-editor.org/info/bcp14' }
        )
      ])
    })

    test('BCP14: valid case – keywords, BCP14-boilerplate and reference to BCP14 are', async () => {
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
      expect(result).toHaveLength(0)
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
        'Lorem ipsum SHALL lorem ipsum MUST NOT lorem RECOMMENDED.'
      ])
      await expect(validate2119Keywords(doc)).resolves.toHaveLength(0)
    })
    test('valid keywords with BCP14', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'BCP14' }]
      set(doc, 'data.rfc.middle.t', [
        boilerplateWithBCP14,
        'Lorem ipsum SHALL lorem ipsum MUST NOT lorem RECOMMENDED.'
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
        'Lorem ipsum SHALL lorem ipsum MUST NOT lorem NOT RECOMMENDED.'
      ])
      await expect(validate2119Keywords(doc)).resolves.toHaveLength(0)
    })
    test('valid keywords with xi:include-sourced BCP14 reference', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'BCP14', type: 'xi:include', url: 'https://bib.ietf.org/public/rfc/bibxml/reference.BCP.0014.xml' }]
      set(doc, 'data.rfc.middle.t', [
        boilerplateWithBCP14,
        'Lorem ipsum SHALL lorem ipsum MUST NOT lorem RECOMMENDED.'
      ])
      await expect(validate2119Keywords(doc)).resolves.toHaveLength(0)
    })
  })
})

describe('xi:include extraction should only accept bib.ietf.org URLs', () => {
  const makeXml = (href) => `<?xml version='1.0' encoding='utf-8'?>
<rfc version="3">
  <front>
    <title>Test</title>
    <seriesInfo name="Internet-Draft" value="draft-test-00" />
    <author fullname="Test Author"><organization>Test</organization></author>
    <date year="2026" month="1" day="1" />
    <abstract><t>Test.</t></abstract>
  </front>
  <middle><section><name>Introduction</name><t>Test.</t></section></middle>
  <back>
    <references>
      <name>Normative References</name>
      <xi:include href="${href}" />
    </references>
  </back>
</rfc>`

  test('accepts bib.ietf.org bibxml URL', async () => {
    const { doc } = await parseXml(makeXml('https://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml'), 'draft-test-00.xml')
    expect(doc.externalEntities).toContainEqual(expect.objectContaining({ name: 'RFC2119', type: 'xi:include' }))
  })
  test('accepts bib.ietf.org BCP URL and strips leading zeros', async () => {
    const { doc } = await parseXml(makeXml('https://bib.ietf.org/public/rfc/bibxml/reference.BCP.0014.xml'), 'draft-test-00.xml')
    expect(doc.externalEntities).toContainEqual(expect.objectContaining({ name: 'BCP14', type: 'xi:include' }))
  })
  test('rejects non-bib.ietf.org host', async () => {
    const { doc } = await parseXml(makeXml('https://evil.com/public/rfc/bibxml/reference.RFC.2119.xml'), 'draft-test-00.xml')
    expect(doc.externalEntities).toHaveLength(0)
  })
  test('rejects subdomain spoofing of bib.ietf.org', async () => {
    const { doc } = await parseXml(makeXml('https://bib.ietf.org.evil.com/public/rfc/bibxml/reference.RFC.2119.xml'), 'draft-test-00.xml')
    expect(doc.externalEntities).toHaveLength(0)
  })
  test('rejects file:// scheme', async () => {
    const { doc } = await parseXml(makeXml('file:///etc/passwd'), 'draft-test-00.xml')
    expect(doc.externalEntities).toHaveLength(0)
  })
  test('rejects ftp:// scheme', async () => {
    const { doc } = await parseXml(makeXml('ftp://bib.ietf.org/public/rfc/bibxml/reference.RFC.2119.xml'), 'draft-test-00.xml')
    expect(doc.externalEntities).toHaveLength(0)
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
