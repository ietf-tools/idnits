import { describe, expect, test } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { toContainError, ValidationComment } from '../lib/helpers/error.mjs'
import { validateSpellingConsistency } from '../lib/modules/spelling.mjs'
import { SPELLING_FORM_INDEX } from '../lib/config/spelling.mjs'
import { baseTXTDoc, baseXMLDoc } from './fixtures/base-doc.mjs'
import { cloneDeep, set } from 'lodash-es'

expect.extend({
  toContainError
})

describe('document should not mix British and American spellings', () => {
  describe('TXT Document Type', () => {
    test('consistent American spelling', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The neighbor behavior is initialized at the center of the tunneling domain.'
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })

    test('consistent British spelling', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The neighbour behaviour is initialised at the centre of the tunnelling domain.'
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })

    test('same word spelled both ways', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The neighbor table is stale.\nEach neighbour entry is refreshed.'
      const result = await validateSpellingConsistency(doc)
      await expect(result).toContainError('INCONSISTENT_SPELLING_VARIANT', ValidationComment)
      expect(result[0].lines).toEqual([{ line: 1, pos: 4 }, { line: 2, pos: 5 }])
      await expect(validateSpellingConsistency(doc, { mode: MODES.FORGIVE_CHECKLIST })).resolves.toContainError('INCONSISTENT_SPELLING_VARIANT', ValidationComment)
      await expect(validateSpellingConsistency(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })

    test('inflected forms of the same word count as the same word', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'Signalling is required. The signaled value is discarded.'
      await expect(validateSpellingConsistency(doc)).resolves.toContainError('INCONSISTENT_SPELLING_VARIANT', ValidationComment)
    })

    test('different words, mixed conventions', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The behaviour of the resolver is undefined.\nThe defense mechanism is in the center.'
      await expect(validateSpellingConsistency(doc)).resolves.toContainError('MIXED_SPELLING_CONVENTION', ValidationComment)
    })

    test('-ize alone is not evidence of American convention', async () => {
      // Oxford spelling is British and uses -ize, so this document is
      // internally consistent.
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The behaviour is normalized before the colour is initialized.'
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })

    test('-ise and -ize of the same verb is still a nit', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'Values are normalised on receipt.\nKeys are normalized on export.'
      await expect(validateSpellingConsistency(doc)).resolves.toContainError('INCONSISTENT_SPELLING_VARIANT', ValidationComment)
    })

    test('acknowledgement alone is not evidence of British convention', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The acknowledgement number is echoed. The defense in depth center holds.'
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })

    test('both acknowledgment spellings is a nit', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The acknowledgement number is echoed.\nAn acknowledgment is sent.'
      await expect(validateSpellingConsistency(doc)).resolves.toContainError('INCONSISTENT_SPELLING_VARIANT', ValidationComment)
    })

    test('whilst counts as a British marker', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'Whilst the timer runs, the defense center is unreachable.'
      await expect(validateSpellingConsistency(doc)).resolves.toContainError('MIXED_SPELLING_CONVENTION', ValidationComment)
    })

    test('code blocks are ignored', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = [
        'The neighbor cache is authoritative.',
        '<CODE BEGINS>',
        '  leaf neighbour-state { type string; }',
        '<CODE ENDS>'
      ].join('\n')
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })

    test('references section is ignored', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = [
        'The neighbor cache is authoritative.',
        '',
        '7.  References',
        '',
        '  [BEHAVE] Smith, J., "Neighbour Discovery Behaviour", 2019.'
      ].join('\n')
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })

    test('scanning resumes after a skipped section', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = [
        '7.  References',
        '',
        '  [X] Doe, J., "Colour Management", 2019.',
        '',
        'Appendix A.  Examples',
        '',
        '  The colour of the neighbour is grey and the defense is centred.'
      ].join('\n')
      await expect(validateSpellingConsistency(doc)).resolves.toContainError('MIXED_SPELLING_CONVENTION', ValidationComment)
    })

    test('URLs and identifiers are ignored', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = [
        'The neighbor cache is authoritative.',
        'See https://example.com/neighbour-discovery for details.',
        'The neighbour_state field is opaque.'
      ].join('\n')
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })

    test('proper names are ignored', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The Advanced Defence Research Centre published the defense analysis.'
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })

    test('sentence-initial words are still checked', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'Colour is significant.\nThe color is encoded as a triplet.'
      await expect(validateSpellingConsistency(doc)).resolves.toContainError('INCONSISTENT_SPELLING_VARIANT', ValidationComment)
    })

    test('program is not treated as an Americanism', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The programme initialises the colour table for the neighbour.'
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })

    test('analog and dialog are not treated as Americanisms', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'The analog dialog box shows the colour of each neighbour.'
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })

    test('metre implies British usage but meter does not', async () => {
      const consistent = cloneDeep(baseTXTDoc)
      consistent.body = 'The meter reports the defense center status.'
      await expect(validateSpellingConsistency(consistent)).resolves.toHaveLength(0)

      const mixed = cloneDeep(baseTXTDoc)
      mixed.body = 'The cable is one metre long and the defense center is nearby.'
      await expect(validateSpellingConsistency(mixed)).resolves.toContainError('MIXED_SPELLING_CONVENTION', ValidationComment)
    })

    test('license boilerplate does not trigger a nit', async () => {
      const doc = cloneDeep(baseTXTDoc)
      doc.body = 'Code Components extracted from this document must include Revised BSD License text. The licence was granted.'
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })
  })

  describe('XML Document Type', () => {
    test('consistent spelling', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section.t', 'The neighbor behavior is centered on the resolver.')
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })

    test('same word spelled both ways', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section.t', ['The neighbor cache is stale.', 'Each neighbour is probed.'])
      const result = await validateSpellingConsistency(doc)
      await expect(result).toContainError('INCONSISTENT_SPELLING_VARIANT', ValidationComment)
      expect(result[0].path).toContain('rfc.middle.section')
      await expect(validateSpellingConsistency(doc, { mode: MODES.SUBMISSION })).resolves.toHaveLength(0)
    })

    test('mixed conventions across words', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section.t', ['The behaviour is undefined.', 'The defense center is unreachable.'])
      await expect(validateSpellingConsistency(doc)).resolves.toContainError('MIXED_SPELLING_CONVENTION', ValidationComment)
    })

    test('sourcecode blocks are ignored', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section', {
        t: 'The neighbor cache is authoritative.',
        sourcecode: { '#text': 'struct neighbour_entry { int colour; };', _attr: { type: 'c' } }
      })
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })

    test('cited reference titles are ignored', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section.t', 'The neighbor cache is authoritative.')
      set(doc, 'data.rfc.back.references.reference.front.title', { '#text': 'Neighbour Discovery Behaviour' })
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })

    test('author addresses are ignored', async () => {
      const doc = cloneDeep(baseXMLDoc)
      set(doc, 'data.rfc.middle.section.t', 'The neighbor cache is authoritative.')
      set(doc, 'data.rfc.front.author.address.postal.street', { '#text': 'Defence Centre Road' })
      await expect(validateSpellingConsistency(doc)).resolves.toHaveLength(0)
    })
  })

  describe('variant table', () => {
    test('no form is claimed by two varieties', () => {
      for (const [form, entry] of SPELLING_FORM_INDEX) {
        expect(typeof form).toBe('string')
        expect(['us', 'gb']).toContain(entry.variety)
      }
    })

    test('excludes verbs that are always spelled -ise', () => {
      for (const form of ['advertize', 'comprize', 'exercize', 'supervize', 'revize', 'promize']) {
        expect(SPELLING_FORM_INDEX.has(form)).toBe(false)
      }
    })

    test('excludes the licence/practise pairs', () => {
      for (const form of ['licence', 'license', 'practise']) {
        expect(SPELLING_FORM_INDEX.has(form)).toBe(false)
      }
    })
  })
})
