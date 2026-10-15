#!/usr/bin/env python3
"""Generate lib/config/unicode-names.mjs, the table of Unicode character names
used to describe non-ASCII characters (lib/helpers/unicode.mjs).

Node has no table of character names, so this takes them from the Unicode
Character Database bundled with Python (unicodedata). The output depends only
on the block list below and on Python's Unicode version, which is recorded in
the generated file.

Usage: python3 scripts/generate-unicode-names.py > lib/config/unicode-names.mjs
"""
import unicodedata

# Unicode blocks (first and last code point) whose characters are commonly
# found in Internet-Drafts and RFCs, keeping the table small: blocks that are
# large and rarely used (e.g. Latin Extended Additional) are left out or cut
# down. CJK unified ideographs and Hangul syllables are not listed, as their
# names are derived from their code points.
BLOCKS = [
    (0x0080, 0x00FF, 'Latin-1 Supplement'),
    (0x0100, 0x017F, 'Latin Extended-A'),
    # -> Only the Romanian letters with comma below, not the whole Latin Extended-B block
    (0x0218, 0x021B, 'Latin Extended-B (U+0218 to U+021B)'),
    (0x0300, 0x036F, 'Combining Diacritical Marks'),
    (0x0370, 0x03FF, 'Greek and Coptic'),
    # -> Only the basic Russian alphabet and its extensions, not the whole Cyrillic block
    (0x0400, 0x045F, 'Cyrillic (U+0400 to U+045F)'),
    (0x2000, 0x206F, 'General Punctuation'),
    (0x2070, 0x209F, 'Superscripts and Subscripts'),
    (0x20A0, 0x20CF, 'Currency Symbols'),
    (0x2100, 0x214F, 'Letterlike Symbols'),
    (0x2150, 0x218F, 'Number Forms'),
    (0x2190, 0x21FF, 'Arrows'),
    (0x2200, 0x22FF, 'Mathematical Operators'),
    (0x2500, 0x257F, 'Box Drawing'),
    (0x25A0, 0x25FF, 'Geometric Shapes'),
    (0xFEFF, 0xFEFF, 'Byte order mark (from Arabic Presentation Forms-B)'),
    (0xFFFD, 0xFFFD, 'Replacement character (from Specials)'),
]


def main():
    print('/**')
    print(' * Unicode character names, by block.')
    print(' *')
    print(' * GENERATED FILE, do not edit: run scripts/generate-unicode-names.py to regenerate it.')
    print(' * Names are from the Unicode Character Database, version %s.' % unicodedata.unidata_version)
    print(' *')
    print(' * Each entry is the first code point of a run of names and the names, one per line,')
    print(' * of it and the code points that follow. Code points without a name have an empty line.')
    print(' */')
    print('export const UNICODE_NAME_BLOCKS = [')
    for first, last, block in BLOCKS:
        names = [unicodedata.name(chr(c), '') for c in range(first, last + 1)]
        # -> Drop code points without a name at both ends of the block
        start = next(i for i, name in enumerate(names) if name)
        end = max(i for i, name in enumerate(names) if name)
        text = '\n'.join(names[start:end + 1])
        # -> Names never contain quotes or backticks; a single name is a plain string (lint rule)
        quote = '`' if '\n' in text else "'"
        print('  // %s' % block)
        print('  [0x%04X, %s%s%s],' % (first + start, quote, text, quote))
    print(']')


if __name__ == '__main__':
    main()
