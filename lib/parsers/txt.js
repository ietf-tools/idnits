import { ValidationError } from './helpers/error.mjs'

export async function parse (rawText) {
  let doc
  try {

  } catch (err) {
    throw new ValidationError('TXT_PARSING_FAILED', err.message)
  }

  return doc
}
