import { ValidationError } from '../helpers/error.mjs'
import { XMLParser } from 'fast-xml-parser'

const externalEntityRgx = /<!ENTITY\s+([a-zA-Z0-9-._]+)\s+(SYSTEM|PUBLIC)\s+"(.*)">/g

export async function parse (rawText) {
  const parser = new XMLParser({
    allowBooleanAttributes: true,
    ignoreAttributes: false
  })

  let doc
  const externalEntities = []
  try {
    // extract remote external entities before parsing, as this is not supported by fxp
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
    doc = parser.parse(cleanRawText)
  } catch (err) {
    throw new ValidationError('XML_PARSING_FAILED', err.message)
  }

  console.info(externalEntities)

  return doc
}
