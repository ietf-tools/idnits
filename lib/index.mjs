import { validateFilename } from './modules/filename.mjs'

/**
 * Check Nits
 *
 * @param {Object} opts Options
 * @param {number} opts.year Expect the given year in the boilerplate
 * @returns Nits Results
 */
export async function checkNits ({ year, filename } = {}) {
  validateFilename(filename)
}
