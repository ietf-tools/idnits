import { parse } from '../../lib/parsers/txt.mjs'
import { cloneDeep, mergeWith } from 'lodash-es'

// Minimal but realistic TXT RFC draft that the parser can fully process.
// Produces: docKind='draft', slug='draft-ietf-beep-boop-01',
//   obsoletesRfc=['5678'], updatesRfc=['1234'],
//   abstract=['Abstract', 'This document obsoletes RFC 5678.']
//
// Every line is ≤72 trimmed chars so validator tests that append lines and
// expect no LINE_TOO_LONG errors continue to pass.
export const CANONICAL_TXT = `




idr                                                    A. Author
Internet-Draft
Intended status: Standards Track                       IETF
Expires: 8 September 2023
Obsoletes: 5678
                                                1 January 2025
Updates: 1234 (if approved)


         Test Document Title
              draft-ietf-beep-boop-01

Abstract

   This document obsoletes RFC 5678.
`

let _cachedBase = null

async function parsedBase () {
  if (!_cachedBase) {
    _cachedBase = await parse(CANONICAL_TXT, '')
  }
  return _cachedBase
}

/**
 * Return a deep clone of the canonical parser output, optionally deep-merged
 * with caller-supplied overrides.  Arrays in overrides replace (not merge
 * into) their counterparts in the base, matching the same behaviour as
 * assigning to a cloned object with lodash set().
 *
 * @param {Object} [overrides={}] Deep-merge overrides applied on top of the
 *   parsed base document.
 * @returns {Promise<Object>} Parser-derived document object.
 */
export async function generateTXTDoc (overrides = {}) {
  const base = cloneDeep(await parsedBase())
  if (!Object.keys(overrides).length) return base
  return mergeWith(base, overrides, (_baseVal, srcVal) => {
    if (Array.isArray(srcVal)) return srcVal
  })
}
