import { allowedDomainsDefault } from './config/externals.mjs'
import { decodeBufferToUTF8, validateContent, validateEncoding } from './modules/raw.mjs'
import { validateFilename, validateDocName } from './modules/filename.mjs'
import { MODES } from './config/modes.mjs'
import { validateAbstractSection, validateIntroductionSection } from './modules/sections.mjs'
import { validateIprAttribute } from './modules/xml.mjs'

/**
 * Check Nits
 *
 * @param {Buffer|ArrayBuffer} raw Document contents
 * @param {string} filename Filename of the document
 * @param {Object} opts Options
 * @param {number} opts.year Expect the given year in the boilerplate
 * @param {string[]} opts.allowedDomains List of authorized domains to fetch externals from
 * @returns Nits Results
 */
export async function checkNits (raw, filename, {
  year,
  allowedDomains = allowedDomainsDefault,
  mode = MODES.NORMAL
} = {}) {
  const result = []

  // Pre-parsing validations
  result.push(...validateFilename(filename, { mode }))
  result.push(...validateEncoding(raw, { mode }))

  const data = decodeBufferToUTF8(raw)
  result.push(...validateContent(data, { mode }))

  // Parse using appropriate parser
  const ext = filename.endsWith('.xml') ? 'xml' : 'txt'
  const { parse } = await (ext === 'xml' ? import('./parsers/xml.js') : import('./parsers/txt.js'))
  const doc = await parse(data)

  // Run common validations
  result.push(...validateDocName(filename, doc, { mode }))
  result.push(...validateAbstractSection(doc, { mode }))
  result.push(...validateIntroductionSection(doc, { mode }))

  // Run XML-only validations
  if (doc.type === 'xml') {
    result.push(...validateIprAttribute(doc, { mode }))
  }

  // Run TXT-only validations
  if (doc.type === 'txt') {
    // TODO: txt-only validations
  }

  return result
}
