/* c8 ignore start */
import { ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { castArray, get, toSafeInteger } from 'lodash-es'
import { findProcessingInstructions } from '../helpers/xml-references.mjs'

const externalEntityRgx = /<!ENTITY\s+([a-zA-Z0-9-._]+)\s+(SYSTEM|PUBLIC)\s+(?:(?:"[^"]*"|'[^']*')\s+)?(?:"([^"]*)"|'([^']*)')\s*>/g
const internalSubsetRgx = /<!DOCTYPE[^[>]*\[[\s\S]*?\]\s*>/
const commentRgx = /<!--[\s\S]*?-->/g
const piRgx = /<\?(?!xml\s)[\s\S]*?\?>/g
const cdataRgx = /(<!\[CDATA\[[\s\S]*?\]\]>)/
// A character reference as fxp reads one: from "&#" to the next ";" (fxp decodes it from its value)
const characterReferenceRgx = /&#([^;&<>"']*);/g
// A well-formed character reference: decimal, or hexadecimal (fxp also accepts "X")
const characterCodeRgx = /^(?:(\d+)|[xX]([\da-fA-F]+))$/
// Longest reference fxp decodes: it looks for the ";" at most 32 characters after the "&#"
const MAX_FXP_REFERENCE_TOKEN = 32
// Names fxp refuses for an element or an attribute (they could reach the prototype of an object)
const reservedNameErrorRgx = /^\[SECURITY\] Invalid name: "([^"]+)"/

/**
 * Trim the text and attribute values of a parsed tree, in place.
 *
 * Parsing keeps whitespace so that the text runs of a mixed-content element
 * stay apart once joined (see trimValues below), which leaves every value
 * padded and turns the indentation between two tags into a text node of its
 * own. Trimming after the runs have been joined gives back the values
 * callers expect while keeping the separation.
 *
 * @param {Object|Array} node Parsed node to normalize
 * @returns {Object|Array} The same node
 */
function normalizeValues (node) {
  if (Array.isArray(node)) {
    for (const [idx, entry] of node.entries()) {
      if (typeof entry === 'string') {
        node[idx] = entry.trim()
      } else if (entry !== null && typeof entry === 'object') {
        normalizeValues(entry)
      }
    }
    return node
  }

  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      // A text node that is only whitespace is the indentation between two
      // sibling tags, which the parser discards when it trims for itself.
      if (trimmed === '' && key === '#text') {
        delete node[key]
      } else {
        node[key] = trimmed
      }
    } else if (value !== null && typeof value === 'object') {
      normalizeValues(value)
    }
  }
  return node
}

/**
 * @typedef {Object} XMLDocObject
 * @property {string} body Raw XML text, as given to the parser
 * @property {Object} data Parsed XML tree
 * @property {string} docKind Whether the document is an Internet Draft (draft) or an RFC (rfc)
 * @property {string} docKindCertainty Whether the document kind was explicity specified (strict) or guessed (guess)
 * @property {Object[]} externalEntities Array of external entities
 * @property {string} filename Filename of the document
 * @property {Object[]} processingInstructions Processing instructions (other than the XML declaration),
 *                                             with their offset in body
 * @property {string} type Document file type (xml)
 * @property {number} version Document version number (2 or 3)
 * @property {string} versionCertainty Whether the version was explicity specified (strict) or guessed (guess)
 */

/**
 * Parse XML document
 *
 * @param {string} rawText Input text
 * @param {string} filename Filename of the document
 * @returns {XMLDocObject} Parsed document object
 */
export async function parse (rawText, filename) {
  const result = []

  const parser = new XMLParser({
    allowBooleanAttributes: true,
    attributesGroupName: '_attr',
    attributeNamePrefix: '',
    ignoreAttributes: false,
    ignorePiTags: true,
    // Decode character references (&#39;, &#x2019;...), as XML requires, and no named entity other than the
    // five XML ones: fxp decodes character references only with htmlEntities, and an object gives the
    // named entities to add (none). See protectCharacterReferences() for the references left as written.
    htmlEntities: {},
    // Keep names such as hasOwnProperty or toString as they are, rather than renamed with a "__" prefix
    // (the parsed tree is read with Object.hasOwn() and the like, not as a plain lookup)
    onDangerousProperty: name => name,
    // An inline tag splits a paragraph into separate text runs, which the
    // parser trims individually before concatenating them with no separator.
    // That fuses the words on either side of e.g. an <xref>, hiding them from
    // every check that matches on word boundaries. Keep the whitespace here
    // and trim in normalizeValues() once the runs have been joined.
    trimValues: false
  })

  // strip comments from the DTD internal subset, as fxp miscounts any > they contain
  // (newlines are kept so that line numbers in parsing errors stay accurate)
  let cleanRawText = rawText.replace(internalSubsetRgx, dtd => dtd.replaceAll(commentRgx, keepNewlines))

  // extract remote external entities before parsing, as this is not supported by fxp
  const externalEntities = []
  cleanRawText = cleanRawText.replaceAll(externalEntityRgx, (match, name, type, dqUrl, sqUrl) => {
    externalEntities.push({
      original: match,
      name,
      type,
      url: dqUrl ?? sqUrl
    })
    return keepNewlines(match)
  })

  // capture processing instructions before they are stripped below, as some of them carry
  // content (e.g. <?rfc include?> pulls in a reference)
  const processingInstructions = findProcessingInstructions(rawText)

  // outside CDATA sections (whose content is verbatim, e.g. in <sourcecode>):
  // - remove references to the extracted external entities, which fxp would reject as undefined
  // - strip processing instructions (other than the XML declaration), as fxp chokes on unbalanced
  //   quotes in them and ignores them anyway
  cleanRawText = replaceOutsideCdata(cleanRawText, text => {
    for (const entity of externalEntities) {
      text = text.replaceAll(`&${entity.name};`, '')
    }
    return text.replaceAll(piRgx, keepNewlines)
  })

  // validate the document as written, then parse it with the character references fxp mustn't decode
  // written so that it doesn't (validating the text parsed would accept a malformed reference there)
  const validation = XMLValidator.validate(cleanRawText)
  if (validation !== true) {
    throw new ValidationError('XML_PARSING_FAILED', `${validation.err.msg}:${validation.err.line}:${validation.err.col}`)
  }
  const parseText = replaceOutsideCdata(cleanRawText, protectCharacterReferences)

  // parse XML document
  let data
  try {
    data = parser.parse(parseText)
  } catch (err) {
    throw new ValidationError('XML_PARSING_FAILED', parsingErrorMessage(err.message, cleanRawText))
  }
  normalizeValues(data)

  // determine document version
  let version = get(data, 'rfc._attr.version')
  let versionCertainty = 'guess'

  if (version) {
    version = toSafeInteger(version)
    versionCertainty = 'strict'
  } else {
    if (get(data, 'rfc.front.seriesInfo._attr.value')) {
      version = 3
    } else {
      version = 2
    }
    versionCertainty = 'guess'
  }
  if (version < 2 || version > 3) {
    throw new ValidationError('XML_UNSUPPORTED_VERSION', 'The schema version of this document is unsupported.', {
      path: 'rfc.version'
    })
  }

  // determine document kind
  // A <seriesInfo> in <front> says what the document is. Without one (e.g. v2
  // documents), go by what xml2rfc would render: an RFC number makes it an RFC,
  // a declared name a draft. The filename is only a last resort, as it is often
  // not the document's name (draft-foo.xml, draft-foo-00.v2v3.xml, paper.xml).
  let docKind = 'draft'
  let docKindCertainty = 'guess'

  const seriesInfoNames = castArray(get(data, 'rfc.front.seriesInfo', [])).map(si => get(si, '_attr.name'))
  if (seriesInfoNames.includes('Internet-Draft')) {
    docKind = 'draft'
    docKindCertainty = 'strict'
  } else if (seriesInfoNames.includes('RFC')) {
    docKind = 'rfc'
    docKindCertainty = 'strict'
  } else {
    for (const seriesInfoName of seriesInfoNames.filter(Boolean)) {
      result.push(new ValidationWarning('XML_UNEXPECTED_SERIESINFO_NAME', `The <seriesInfo> name "${seriesInfoName}" in <front> is neither "Internet-Draft" nor "RFC".`, {
        path: 'rfc.front.seriesInfo.name'
      }))
    }

    const number = String(get(data, 'rfc._attr.number') ?? '').trim()
    const docName = String(get(data, 'rfc._attr.docName') ?? '').trim()
    if (number) {
      docKind = 'rfc'
    } else if (docName) {
      docKind = 'draft'
    } else if (filename.startsWith('draft-')) {
      docKind = 'draft'
    } else if (filename.startsWith('rfc')) {
      docKind = 'rfc'
    } else {
      throw new ValidationError('XML_UNRECOGNIZED_DOC_KIND', 'Unable to determine whether the document is an Internet Draft or RFC. Use the <seriesInfo> tag, or the docName or number attribute of the <rfc> element.')
    }

    docKindCertainty = 'guess'
  }

  return {
    doc: {
      body: rawText,
      data,
      docKind,
      docKindCertainty,
      externalEntities,
      filename,
      processingInstructions,
      type: 'xml',
      version,
      versionCertainty
    },
    nits: result
  }
}

/**
 * Replace text with only the newlines it contains
 *
 * @param {string} text Text to blank out
 * @returns {string} Newlines from the text
 */
function keepNewlines (text) {
  return text.replace(/[^\n]/g, '')
}

/**
 * Write the character references fxp would decode wrongly so that it reads them right
 *
 * fxp decodes a reference to any code point, except that it removes those to U+0000, a surrogate or a C0
 * control character other than tab, line feed and carriage return, and leaves one over 32 characters long. A
 * reference to a character XML doesn't allow (anything but tab, line feed, carriage return, U+0020-U+D7FF,
 * U+E000-U+FFFD and U+10000-U+10FFFF) or one that is malformed stays as written in the parsed text: its "&" is
 * written "&amp;". The checks of the raw text (e.g. invisible and control characters) report it there. A long
 * reference to an allowed character is written in hexadecimal, short enough for fxp.
 *
 * @param {string} text XML text outside CDATA sections
 * @returns {string} Text with those references rewritten
 */
function protectCharacterReferences (text) {
  return text.replaceAll(characterReferenceRgx, (reference, token) => {
    const codePoint = characterCode(token)
    if (codePoint === null) {
      return `&amp;#${token};`
    }
    if (token.length > MAX_FXP_REFERENCE_TOKEN) {
      return `&#x${codePoint.toString(16)};`
    }
    return reference
  })
}

/**
 * Code point of a character reference, if it is well-formed and to a character XML allows
 *
 * @param {string} token Reference between "&#" and ";"
 * @returns {number|null} Code point, or null
 */
function characterCode (token) {
  const match = token.match(characterCodeRgx)
  if (match === null) {
    return null
  }
  let codePoint
  if (match[1] === undefined) {
    codePoint = Number.parseInt(match[2], 16)
  } else {
    codePoint = Number.parseInt(match[1], 10)
  }
  const isAllowed = codePoint === 0x9 || codePoint === 0xA || codePoint === 0xD ||
    (codePoint >= 0x20 && codePoint <= 0xD7FF) ||
    (codePoint >= 0xE000 && codePoint <= 0xFFFD) ||
    (codePoint >= 0x10000 && codePoint <= 0x10FFFF)
  if (!isAllowed) {
    return null
  }
  return codePoint
}

/**
 * Message of an XML_PARSING_FAILED error, from the error fxp throws
 *
 * fxp refuses an element or attribute named constructor, prototype or __proto__ with a message about
 * prototype pollution and no position. It's given in plain words here, with the line and column of the
 * first such name in the document.
 *
 * @param {string} message Message of the error fxp throws
 * @param {string} text XML text parsed
 * @returns {string} Message
 */
function parsingErrorMessage (message, text) {
  const reserved = message.match(reservedNameErrorRgx)
  if (reserved === null) {
    return message
  }
  const name = reserved[1]
  const plain = `idnits can't process an element or attribute named "${name}".`
  const position = findMarkupName(text, name)
  if (position === null) {
    return plain
  }
  return `${plain}:${position.line}:${position.col}`
}

/**
 * Line and column of the first element or attribute with a name, outside comments and CDATA sections
 *
 * @param {string} text XML text
 * @param {string} name Element or attribute name
 * @returns {{line: number, col: number}|null} Position (both from 1), or null
 */
function findMarkupName (text, name) {
  const masked = text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, part => part.replace(/[^\n]/g, ' '))
  const tagRgx = /<[^\s/>!?]+(?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*\s*\/?>/g
  for (const tag of masked.matchAll(tagRgx)) {
    // attribute values are blanked, so that a name is only read where one can be
    const unquoted = tag[0].replace(/"[^"]*"|'[^']*'/g, value => ' '.repeat(value.length))
    const names = [...unquoted.matchAll(/(?<=^<|\s)([^\s=/>]+)/g)]
    const found = names.find(candidate => candidate[1] === name)
    if (found !== undefined) {
      const offset = tag.index + found.index
      const before = text.slice(0, offset)
      const line = before.split('\n').length
      const col = offset - before.lastIndexOf('\n')
      return { line, col }
    }
  }
  return null
}

/**
 * Apply a replacement to the parts of a document outside CDATA sections
 *
 * @param {string} text Document text
 * @param {function(string): string} replacer Replacement for each part outside CDATA
 * @returns {string} Text with CDATA sections unchanged
 */
function replaceOutsideCdata (text, replacer) {
  return text.split(cdataRgx).map((part, idx) => idx % 2 === 0 ? replacer(part) : part).join('')
}
/* c8 ignore end */
