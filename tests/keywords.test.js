import { describe, expect, test } from '@jest/globals'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment, ValidationError, ValidationWarning } from '../lib/helpers/error.mjs'
import {
  validate2119Keywords,
  validateTermsStyle
} from '../lib/modules/keywords.mjs'
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
            rfc8174: false
          },
          references: {
            rfc2119: false,
            rfc8174: false
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
          'One or more RFC2119 keywords are present but an RFC2119 boilerplate and a reference are missing.',
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
            rfc8174: false
          },
          references: {
            rfc2119: true,
            rfc8174: false
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
          'One or more RFC2119 keywords are present but an RFC2119 boilerplate is missing.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
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
            rfc8174: false
          },
          references: {
            rfc2119: true,
            rfc8174: false
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
          'An RFC2119 boilerplate is present but no keywords are used in the document.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
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
            rfc8174: false
          },
          references: {
            rfc2119: true,
            rfc8174: false
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
            ref: 'https://datatracker.ietf.org/doc/html/rfc2119',
            lines: [{ line: 20, pos: 5 }]
          }
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
            rfc8174: false
          },
          references: {
            rfc2119: false,
            rfc8174: false
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
          'One or more RFC2119 keywords are present but an RFC2119 boilerplate and a reference are missing.',
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
            rfc8174: false
          },
          references: {
            rfc2119: true,
            rfc8174: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual([
        new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE', 'One or more RFC2119 keywords are present but an RFC2119 boilerplate is missing.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
        })
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
            rfc8174: false
          },
          references: {
            rfc2119: false,
            rfc8174: false
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
          'One or more RFC2119 keywords are present but an RFC2119 boilerplate and a reference are missing.',
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
            rfc8174: false
          },
          references: {
            rfc2119: true,
            rfc8174: false
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
          'One or more RFC2119 keywords are present but an RFC2119 boilerplate is missing.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
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
            rfc8174: false
          },
          references: {
            rfc2119: true,
            rfc8174: false
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
          'An RFC2119 boilerplate is present but no keywords are used in the document.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
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
            rfc8174: false
          },
          references: {
            rfc2119: true,
            rfc8174: false
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
            ref: 'https://datatracker.ietf.org/doc/html/rfc2119',
            lines: [{ line: 20, pos: 5 }]
          }
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
            rfc8174: false
          },
          references: {
            rfc2119: false,
            rfc8174: false
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
          'One or more RFC2119 keywords are present but an RFC2119 boilerplate and a reference are missing.',
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
            rfc8174: false
          },
          references: {
            rfc2119: true,
            rfc8174: false
          },
          possibleIssues: {
            misspeled2119Keywords: []
          }
        }
      }

      const result = await validate2119Keywords(doc, { mode: MODES.NORMAL })

      expect(result).toEqual([
        new ValidationWarning('MISSING_REQLEVEL_BOILERPLATE', 'One or more RFC2119 keywords are present but an RFC2119 boilerplate is missing.', {
          ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2'
        })
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
            rfc8174: false
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
            'An RFC2119 boilerplate is missing but a similar boilerplate was found.',
            { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
          ),
          new ValidationError(
            'MISSING_REQLEVEL_BOILERPLATE',
            'One or more RFC2119 keywords are present but an RFC2119 boilerplate and a reference are missing.',
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
            rfc8174: false
          },
          references: {
            rfc2119: true,
            rfc8174: false
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
          'The keyword NOT RECOMMENDED appears but not included in the RFC2119 boilerplate.',
          { ref: 'https://www.rfc-editor.org/rfc/rfc7322.html#section-4.8.2' }
        )
      ])
    })
  })

  describe('XML Document Type', () => {
    const boilerplate = `The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL
      NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED",  "MAY", and
      "OPTIONAL" in this document are to be interpreted as described in RFC 2119.`
    test('valid keywords', async () => {
      const doc = cloneDeep(baseXMLDoc)
      doc.externalEntities = [{ name: 'RFC2119' }]
      set(doc, 'data.rfc.middle.t', [
        boilerplate,
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
      doc.externalEntities = [{ name: 'RFC2119' }]
      set(doc, 'data.rfc.middle.t', [
        `The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL
        NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
        "OPTIONAL" in this document are to be interpreted as described in RFC 2119.`,
        'Lorem ipsum SHALL lorem ipsum MUST NOT lorem NOT RECOMMENDED.'
      ])
      await expect(validate2119Keywords(doc)).resolves.toHaveLength(0)
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

    test('should not match "public-key infrastructure"', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The system uses a public-key infrastructure for security.'
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
    })

    test('should not match "time-stamp verification"', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The time-stamp verification process is crucial.'
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
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

    test('should not match "public-key infrastructure" in XML', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'The system uses a public-key infrastructure for security.')
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
    })

    test('should not match "time-stamp verification" in XML', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.t', 'The time-stamp verification process is crucial.')
      await expect(validateTermsStyle(doc)).resolves.toHaveLength(0)
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
