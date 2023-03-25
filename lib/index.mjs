import { allowedDomainsDefault } from './config/externals.mjs'
import { decodeBufferToUTF8, validateContent, validateEncoding } from './modules/raw.mjs'
import { validateFilename } from './modules/filename.mjs'
import { MODES } from './config/modes.mjs'
import { validateAbstractSection } from './modules/sections.mjs'

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
  result.push(...validateAbstractSection(doc, { mode }))

  return result
}
