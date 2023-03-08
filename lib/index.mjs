import { ValidationError } from './helpers/error.mjs'
import { validateFilename } from './modules/filename.mjs'
import { XMLParser } from 'fast-xml-parser'

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

  if (filename.endsWith('.xml')) {
    const parser = new XMLParser({
      allowBooleanAttributes: true,
      ignoreAttributes: false
    })

    let doc
    try {
      // TODO: remove remote external entities before parsing
      doc = parser.parse(data)
    } catch (err) {
      throw new ValidationError('XML_PARSING_FAILED', err.message)
    }

    console.info(doc)
  }
}
