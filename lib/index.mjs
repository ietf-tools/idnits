import { ALLOWED_DOMAINS_DEFAULT } from './config/externals.mjs'
import { decodeBufferToUTF8, validateContent, validateEncoding } from './modules/raw.mjs'
import { validateFilename, validateDocName } from './modules/filename.mjs'
import { MODES } from './config/modes.mjs'
import {
  validateAbstractSection,
  validateIntroductionSection,
  validateSecurityConsiderationsSection,
  validateAuthorSection
} from './modules/sections.mjs'
import { detectDeprecatedElements, validateIprAttribute } from './modules/xml.mjs'
import { validateLineLength } from './modules/txt.mjs'

/**
 * Check Nits
 *
 * @param {Buffer|ArrayBuffer} raw Document contents
 * @param {string} filename Filename of the document
 * @param {Object} opts Options
 * @param {number} opts.year Expect the given year in the boilerplate
 * @param {string[]} opts.allowedDomains List of authorized domains to fetch externals from
 * @param {string} opts.mode Validation mode to use
 * @param {Function} opts.progressClb Callback function for progress messages
 * @returns Nits Results
 */
export async function checkNits (raw, filename, {
  year,
  allowedDomains = ALLOWED_DOMAINS_DEFAULT,
  mode = MODES.NORMAL,
  progressClb = () => {}
} = {}) {
  const result = []

  // Pre-parsing validations
  progressClb('Validating filename...')
  result.push(...(await validateFilename(filename, { mode })))
  progressClb('Validating encoding...')
  result.push(...(await validateEncoding(raw, { mode })))

  progressClb('Decoding document to UTF-8...')
  const data = await decodeBufferToUTF8(raw)
  progressClb('Validating text...')
  result.push(...(await validateContent(data, { mode })))

  // Parse using appropriate parser
  const ext = filename.endsWith('.xml') ? 'xml' : 'txt'
  let doc = null
  switch (ext) {
    case 'txt': {
      progressClb('Parsing TXT document...')
      const { parse } = await import('./parsers/txt.mjs')
      doc = await parse(data, filename)
      break
    }
    case 'xml': {
      progressClb('Parsing XML document...')
      const { parse } = await import('./parsers/xml.mjs')
      doc = await parse(data, filename)
      break
    }
    default: {
      throw new Error('Invalid Document Format')
    }
  }

  // Run common validations
  progressClb('Validating document name...')
  result.push(...(await validateDocName(doc, { mode })))
  progressClb('Validating abstract section...')
  result.push(...(await validateAbstractSection(doc, { mode })))
  progressClb('Validating introduction section...')
  result.push(...(await validateIntroductionSection(doc, { mode })))
  progressClb('Validating security considerations section...')
  result.push(...(await validateSecurityConsiderationsSection(doc, { mode })))
  progressClb('Validating author section(s)...')
  result.push(...(await validateAuthorSection(doc, { mode })))

  // Run XML-only validations
  if (doc.type === 'xml') {
    progressClb('Looking for deprecated elements...')
    result.push(...(await detectDeprecatedElements(doc, { mode })))
    progressClb('Validating ipr attribute...')
    result.push(...(await validateIprAttribute(doc, { mode })))
  }

  // Run TXT-only validations
  if (doc.type === 'txt') {
    progressClb('Validating line length...')
    result.push(...(await validateLineLength(doc, { mode })))
  }

  return result
}
