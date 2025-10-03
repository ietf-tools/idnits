/* c8 ignore start */
import { ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { XMLParser } from 'fast-xml-parser'
import { get, toSafeInteger } from 'lodash-es'

const linePIRgx = /<\?line [0-9]+\?>/gi
const externalEntityRgx = /<!ENTITY\s+([a-zA-Z0-9-._]+)\s+(SYSTEM|PUBLIC)\s+"(.*)">/g

/**
 * @typedef {Object} XMLDocObject
 * @property {Object} data Parsed XML tree
 * @property {string} docKind Whether the document is an Internet Draft (draft) or an RFC (rfc)
 * @property {string} docKindCertainty Whether the document kind was explicity specified (strict) or guessed (guess)
 * @property {Object[]} externalEntities Array of external entities
 * @property {string} filename Filename of the document
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
    ignorePiTags: true
  })

  // Strip line PIs and warn about it
  if (rawText.match(linePIRgx)) {
    result.push(new ValidationWarning('LINE_PI', 'Document contains <?line 123?> processing instruction tags.'))
  }

  // extract remote external entities before parsing, as this is not supported by fxp
  const externalEntities = []
  const cleanRawText = rawText.replaceAll(externalEntityRgx, (match, name, type, url) => {
    externalEntities.push({
      original: match,
      name,
      type,
      url
    })
    return ''
  })

  // parse XML document
  let data
  try {
    data = parser.parse(cleanRawText, true)
  } catch (err) {
    throw new ValidationError('XML_PARSING_FAILED', err.message)
  }

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
  let docKind = 'draft'
  let docKindCertainty = 'guess'

  if (get(data, 'rfc.front.seriesInfo._attr.name') === 'Internet-Draft') {
    docKind = 'draft'
    docKindCertainty = 'strict'
  } else if (get(data, 'rfc.front.seriesInfo._attr.name') === 'RFC') {
    docKind = 'rfc'
    docKindCertainty = 'strict'
  } else if (get(data, 'rfc.front.seriesInfo._attr.name')) {
    throw new ValidationError('XML_UNSUPPORTED_DOC_KIND', 'The document is neither an Internet Draft or RFC.', {
      path: 'rfc.front.seriesInfo.name'
    })
  } else {
    if (filename.startsWith('draft-')) {
      docKind = 'draft'
    } else if (filename.startsWith('rfc')) {
      docKind = 'rfc'
    } else {
      throw new ValidationError('XML_UNRECOGNIZED_DOC_KIND', 'Unable to determine whether the document is an Internet Draft or RFC. Use the <seriesInfo> tag or a proper prefix (draft-, rfc) in your filename.')
    }

    docKindCertainty = 'guess'
  }

  return {
    doc: {
      data,
      docKind,
      docKindCertainty,
      externalEntities,
      filename,
      type: 'xml',
      version,
      versionCertainty
    },
    nits: result
  }
}
/* c8 ignore end */
