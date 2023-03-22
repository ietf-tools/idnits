import { validateFilename } from './modules/filename.mjs'
import { allowedDomainsDefault } from './config/externals.mjs'
import { validateRawContent } from './modules/raw.mjs'

/**
 * Check Nits
 *
 * @param {string} data Document contents
 * @param {string} filename Filename of the document
 * @param {Object} opts Options
 * @param {number} opts.year Expect the given year in the boilerplate
 * @param {string[]} opts.allowedDomains List of authorized domains to fetch externals from
 * @returns Nits Results
 */
export async function checkNits (data, filename, {
  year,
  allowedDomains = allowedDomainsDefault
} = {}) {
  // Pre-parsing validations
  validateFilename(filename)
  validateRawContent(data)

  // Parse using appropriate parser
  const ext = filename.endsWith('.xml') ? 'xml' : 'txt'
  const { parse } = await (ext === 'xml' ? import('./parsers/xml.js') : import('./parsers/txt.js'))
  const doc = await parse(data)

  console.info(doc)
}
