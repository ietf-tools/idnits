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
  })
})
