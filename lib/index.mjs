import { ValidationError } from './helpers/error.mjs'
import { validateFilename } from './modules/filename.mjs'

/**
 * Check Nits
 *
 * @param {string} data Document contents
 * @param {string} filename Filename of the document
 * @param {Object} opts Options
 * @param {number} opts.year Expect the given year in the boilerplate
 * @returns Nits Results
 */
export async function checkNits (data, filename, { year } = {}) {
  validateFilename(filename)

  const ext = filename.endsWith('.xml') ? 'xml' : 'txt'
  const { parse } = await (ext === 'xml' ? import('./parsers/xml.js') : import('./parsers/txt.js'))
  const doc = await parse(data)

  console.info(doc)
}
