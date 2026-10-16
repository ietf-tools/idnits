import { UNICODE_NAME_BLOCKS } from '../config/unicode-names.mjs'

/**
 * Unicode character names by code point, built from UNICODE_NAME_BLOCKS on first use
 */
let unicodeNames = null

/**
 * Hangul jamo short names, used to build the names of Hangul syllables
 * (Unicode Standard, Section 3.12)
 */
const HANGUL_L = ['G', 'GG', 'N', 'D', 'DD', 'R', 'M', 'B', 'BB', 'S', 'SS', '', 'J', 'JJ', 'C', 'K', 'T', 'P', 'H']
const HANGUL_V = ['A', 'AE', 'YA', 'YAE', 'EO', 'E', 'YEO', 'YE', 'O', 'WA', 'WAE', 'OE', 'YO', 'U', 'WEO', 'WE', 'WI', 'YU', 'EU', 'YI', 'I']
const HANGUL_T = ['', 'G', 'GG', 'GS', 'N', 'NJ', 'NH', 'D', 'L', 'LG', 'LM', 'LB', 'LS', 'LT', 'LP', 'LH', 'M', 'B', 'BS', 'S', 'SS', 'NG', 'J', 'C', 'K', 'T', 'P', 'H']

/**
 * General categories, used to describe characters that have no name in UNICODE_NAME_BLOCKS
 */
const CATEGORIES = [
  ['Lu', 'uppercase letter'],
  ['Ll', 'lowercase letter'],
  ['Lt', 'titlecase letter'],
  ['Lm', 'modifier letter'],
  ['Lo', 'letter'],
  ['Mn', 'combining mark'],
  ['Mc', 'spacing mark'],
  ['Me', 'enclosing mark'],
  ['Nd', 'digit'],
  ['Nl', 'letter number'],
  ['No', 'number'],
  ['Pc', 'connector punctuation'],
  ['Pd', 'dash'],
  ['Ps', 'opening punctuation'],
  ['Pe', 'closing punctuation'],
  ['Pi', 'initial quotation mark'],
  ['Pf', 'final quotation mark'],
  ['Po', 'punctuation'],
  ['Sm', 'math symbol'],
  ['Sc', 'currency symbol'],
  ['Sk', 'modifier symbol'],
  ['So', 'symbol'],
  ['Zs', 'space'],
  ['Zl', 'line separator'],
  ['Zp', 'paragraph separator'],
  ['Cc', 'control character'],
  ['Cf', 'format character'],
  ['Co', 'private use character'],
  ['Cn', 'unassigned code point']
].map(([cat, label]) => [new RegExp(`^\\p{gc=${cat}}$`, 'u'), label])

/**
 * Scripts named when describing letters that have no name in UNICODE_NAME_BLOCKS
 */
const SCRIPTS = [
  'Latin', 'Greek', 'Cyrillic', 'Armenian', 'Hebrew', 'Arabic', 'Devanagari', 'Bengali',
  'Gurmukhi', 'Gujarati', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Thai', 'Lao',
  'Tibetan', 'Georgian', 'Ethiopic', 'Hangul', 'Hiragana', 'Katakana', 'Han'
].map(script => [new RegExp(`^\\p{Script=${script}}$`, 'u'), script])

/**
 * Characters that are not shown when printed on their own (spaces, marks, format
 * and control characters)
 */
const INVISIBLE_RE = /^[\p{Z}\p{M}\p{C}]$/u

/**
 * Format a code point in U+ notation (e.g. U+00E9)
 *
 * @param {number} codePoint Code point
 * @returns {string} Code point in U+ notation
 */
export function toUplus (codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * Get the Unicode name of a character, if known
 *
 * @param {number} codePoint Code point
 * @returns {string|null} Character name or null if not known
 */
export function getCharacterName (codePoint) {
  if (!unicodeNames) {
    unicodeNames = new Map()
    for (const [first, names] of UNICODE_NAME_BLOCKS) {
      names.split('\n').forEach((name, idx) => {
        if (name) {
          unicodeNames.set(first + idx, name)
        }
      })
    }
  }
  if (unicodeNames.has(codePoint)) {
    return unicodeNames.get(codePoint)
  }
  const char = String.fromCodePoint(codePoint)
  // -> CJK compatibility ideographs (U+F900 to U+FAFF) have names that are not derived this way
  if (/^\p{Unified_Ideograph}$/u.test(char) && (codePoint < 0xF900 || codePoint > 0xFAFF)) {
    return `CJK UNIFIED IDEOGRAPH-${codePoint.toString(16).toUpperCase()}`
  }
  if (codePoint >= 0xAC00 && codePoint <= 0xD7A3) {
    const idx = codePoint - 0xAC00
    return `HANGUL SYLLABLE ${HANGUL_L[Math.floor(idx / 588)]}${HANGUL_V[Math.floor((idx % 588) / 28)]}${HANGUL_T[idx % 28]}`
  }
  return null
}

/**
 * Describe a character with its U+ notation and its name, e.g. "é (U+00E9, LATIN SMALL LETTER E WITH ACUTE)".
 * Characters without a known name are described by their general category (and script, for letters).
 * Characters that don't show on their own are not repeated in front of the description.
 *
 * @param {number} codePoint Code point
 * @returns {string} Character description
 */
export function describeCharacter (codePoint) {
  const char = String.fromCodePoint(codePoint)
  let name = getCharacterName(codePoint)
  if (!name) {
    const category = CATEGORIES.find(([re]) => re.test(char))?.[1] ?? 'character'
    const script = /^\p{L}$/u.test(char) ? SCRIPTS.find(([re]) => re.test(char))?.[1] : null
    name = script ? `${script} ${category}` : category
  }
  const description = `(${toUplus(codePoint)}, ${name})`
  return INVISIBLE_RE.test(char) ? description : `${char} ${description}`
}
