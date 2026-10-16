#!/usr/bin/env node
/**
 * Generate lib/config/unicode-names.mjs, the table of Unicode character names
 * used to describe non-ASCII characters (lib/helpers/unicode.mjs).
 *
 * Node has no table of character names, so this takes them from
 * UnicodeData.txt of the Unicode Character Database, version UNICODE_VERSION
 * below, which is recorded in the generated file. Names are those of Python's
 * unicodedata.name(), which the table was first generated with: control
 * characters ("<control>" in UnicodeData.txt, their Unicode 1.0 name in
 * field 10 is not used) have none, and of the code points given as ranges
 * (<..., First> and <..., Last>), only the CJK unified ideographs and Hangul
 * syllables have names, derived from their code points.
 *
 * Usage: node scripts/generate-unicode-names.mjs [path to UnicodeData.txt] > lib/config/unicode-names.mjs
 * Without a path, UnicodeData.txt is downloaded from unicode.org.
 */
import { readFileSync } from 'node:fs'

const UNICODE_VERSION = '15.1.0'
const UNICODE_DATA_URL = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/UnicodeData.txt`

// Unicode blocks (first and last code point) whose characters are commonly
// found in Internet-Drafts and RFCs, keeping the table small: blocks that are
// large and rarely used (e.g. Latin Extended Additional) are left out or cut
// down. CJK unified ideographs and Hangul syllables are not listed, as their
// names are derived from their code points.
const BLOCKS = [
  [0x0080, 0x00FF, 'Latin-1 Supplement'],
  [0x0100, 0x017F, 'Latin Extended-A'],
  // -> Only the Romanian letters with comma below, not the whole Latin Extended-B block
  [0x0218, 0x021B, 'Latin Extended-B (U+0218 to U+021B)'],
  [0x0300, 0x036F, 'Combining Diacritical Marks'],
  [0x0370, 0x03FF, 'Greek and Coptic'],
  // -> Only the basic Russian alphabet and its extensions, not the whole Cyrillic block
  [0x0400, 0x045F, 'Cyrillic (U+0400 to U+045F)'],
  [0x2000, 0x206F, 'General Punctuation'],
  [0x2070, 0x209F, 'Superscripts and Subscripts'],
  [0x20A0, 0x20CF, 'Currency Symbols'],
  [0x2100, 0x214F, 'Letterlike Symbols'],
  [0x2150, 0x218F, 'Number Forms'],
  [0x2190, 0x21FF, 'Arrows'],
  [0x2200, 0x22FF, 'Mathematical Operators'],
  [0x2500, 0x257F, 'Box Drawing'],
  [0x25A0, 0x25FF, 'Geometric Shapes'],
  [0xFEFF, 0xFEFF, 'Byte order mark (from Arabic Presentation Forms-B)'],
  [0xFFFD, 0xFFFD, 'Replacement character (from Specials)']
]

// Hangul syllable names (Unicode chapter 3.12), as unicodedata.name() derives them
const HANGUL_L = ['G', 'GG', 'N', 'D', 'DD', 'R', 'M', 'B', 'BB', 'S', 'SS', '', 'J', 'JJ', 'C', 'K', 'T', 'P', 'H']
const HANGUL_V = ['A', 'AE', 'YA', 'YAE', 'EO', 'E', 'YEO', 'YE', 'O', 'WA', 'WAE', 'OE', 'YO', 'U', 'WEO', 'WE', 'WI', 'YU', 'EU', 'YI', 'I']
const HANGUL_T = ['', 'G', 'GG', 'GS', 'N', 'NJ', 'NH', 'D', 'L', 'LG', 'LM', 'LB', 'LS', 'LT', 'LP', 'LH', 'M', 'B', 'BS', 'S', 'SS', 'NG', 'J', 'C', 'K', 'T', 'P', 'H']

function fail (message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

/**
 * Names of the code points of UnicodeData.txt, as Python's unicodedata.name() gives them
 *
 * @param {string} data Content of UnicodeData.txt
 * @returns {function(number): string} Name of a code point, empty if it has none
 */
function nameTable (data) {
  const names = new Map()
  const ranges = []
  let rangeStart = null
  for (const [idx, line] of data.split('\n').entries()) {
    if (!line.trim()) { continue }
    const fields = line.split(';')
    if (fields.length !== 15 || !/^[0-9A-F]{4,6}$/.test(fields[0])) {
      fail(`UnicodeData.txt, line ${idx + 1}: unexpected line ${line}`)
    }
    const cp = parseInt(fields[0], 16)
    const name = fields[1]
    const range = name.match(/^<(.+), (First|Last)>$/)
    if (range) {
      if (range[2] === 'First') {
        rangeStart = { cp, label: range[1] }
      } else if (rangeStart?.label === range[1]) {
        ranges.push({ first: rangeStart.cp, last: cp, label: range[1] })
        rangeStart = null
      } else {
        fail(`UnicodeData.txt, line ${idx + 1}: range end without a start`)
      }
    } else if (!name.startsWith('<')) {
      // -> "<control>" and the like are not names
      names.set(cp, name)
    }
  }

  return (cp) => {
    if (names.has(cp)) { return names.get(cp) }
    const range = ranges.find(r => r.first <= cp && cp <= r.last)
    if (!range) { return '' }
    if (range.label.startsWith('CJK Ideograph')) {
      return `CJK UNIFIED IDEOGRAPH-${cp.toString(16).toUpperCase()}`
    }
    if (range.label === 'Hangul Syllable') {
      const s = cp - 0xAC00
      return `HANGUL SYLLABLE ${HANGUL_L[Math.floor(s / 588)]}${HANGUL_V[Math.floor((s % 588) / 28)]}${HANGUL_T[s % 28]}`
    }
    // -> Other ranges (private use, surrogates...) have no names in unicodedata
    return ''
  }
}

const hex = (cp) => cp.toString(16).toUpperCase().padStart(4, '0')

async function main () {
  const args = process.argv.slice(2)
  if (args.length > 1 || args[0]?.startsWith('-')) {
    fail('Usage: node scripts/generate-unicode-names.mjs [path to UnicodeData.txt]')
  }
  let data
  if (args[0]) {
    data = readFileSync(args[0], 'utf8')
  } else {
    const response = await fetch(UNICODE_DATA_URL)
    if (!response.ok) { fail(`Could not download ${UNICODE_DATA_URL}: ${response.status}`) }
    data = await response.text()
  }
  const name = nameTable(data)

  const out = [
    '/**',
    ' * Unicode character names, by block.',
    ' *',
    ' * GENERATED FILE, do not edit: run scripts/generate-unicode-names.mjs to regenerate it.',
    ` * Names are from the Unicode Character Database, version ${UNICODE_VERSION}.`,
    ' *',
    ' * Each entry is the first code point of a run of names and the names, one per line,',
    ' * of it and the code points that follow. Code points without a name have an empty line.',
    ' */',
    'export const UNICODE_NAME_BLOCKS = ['
  ]
  for (const [first, last, block] of BLOCKS) {
    const names = []
    for (let cp = first; cp <= last; cp++) { names.push(name(cp)) }
    // -> Drop code points without a name at both ends of the block
    const start = names.findIndex(Boolean)
    const end = names.findLastIndex(Boolean)
    if (start < 0) { fail(`No names in the block ${block}`) }
    const text = names.slice(start, end + 1).join('\n')
    // -> Names never contain quotes or backticks; a single name is a plain string (lint rule)
    const quote = text.includes('\n') ? '`' : "'"
    out.push(`  // ${block}`)
    out.push(`  [0x${hex(first + start)}, ${quote}${text}${quote}],`)
  }
  out.push(']')
  process.stdout.write(out.join('\n') + '\n')
}

await main()
