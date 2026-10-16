import { describe, expect, test } from 'vitest'
import { BOILERPLATE_PHRASES } from '../lib/config/boilerplate-phrases.mjs'
import { DRAFT_STATUS_OF_MEMO, RFC_STATUS_OF_MEMO, TLP_COPYRIGHT_NOTICE, TLP_PERIODS } from '../lib/config/xml2rfc-boilerplate.mjs'
import { normalizeBoilerplateText } from '../lib/modules/xml.mjs'

describe('Boilerplate phrases', () => {
  // -> The boilerplate that xml2rfc generates now: the I-D and RFC 7841 status
  //    text, and the copyright text of the TLP version currently in effect
  const currentTlp = TLP_PERIODS.at(-1).tlp
  const paragraphs = [
    ...DRAFT_STATUS_OF_MEMO,
    ...Object.values(RFC_STATUS_OF_MEMO).flatMap(byCategory => Object.values(byCategory).flatMap(byConsensus => Object.values(byConsensus).flat())),
    ...Object.values(TLP_COPYRIGHT_NOTICE[currentTlp]).flat()
  ].map(paragraph => normalizeBoilerplateText(paragraph.replace(/<[^>]*>/g, '')))

  test.each(BOILERPLATE_PHRASES)('"%s" is in the boilerplate of xml2rfc', (phrase) => {
    // -> A change of wording in xml2rfc (e.g. a new TLP version) needs an update of the phrases
    expect(paragraphs.some(paragraph => paragraph.includes(normalizeBoilerplateText(phrase)))).toBe(true)
  })

  test('the current TLP version has a copyright notice for every stream and ipr', () => {
    expect(Object.keys(TLP_COPYRIGHT_NOTICE[currentTlp])).toEqual(expect.arrayContaining(['IETF', 'alt', 'noModification', 'noDerivatives', 'pre5378']))
  })
})
