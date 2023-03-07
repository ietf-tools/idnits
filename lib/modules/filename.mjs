import { ValidationError } from '../helpers/error.mjs'

const validBaseNameCharsRgx = /^[a-z0-9-]+$/

/**
 * Validate a filename
 *
 * @param {string} filename Filename to check
 * @returns True if valid
 */
export function validateFilename (filename) {
  const filenameParts = filename.split('.')

  // Check filename parts
  if (filenameParts.length < 2) {
    throw new ValidationError('FILENAME_MISSING_EXTENSION', 'Filename must have an extension.')
  } else if (filenameParts.length > 2) {
    throw new ValidationError('FILENAME_TOO_MANY_DOTS', 'Filename cannot have more than 1 dot, only to separate the base name from the extension.')
  }

  // Check filename characters
  if (!validBaseNameCharsRgx.test(filenameParts[0])) {
    throw new ValidationError('FILENAME_INVALID_CHARS', 'Filename contains invalid characters. Must consist of lower alpha, digits and dash only.')
  }

  // Check extension
  if (!['txt', 'xml'].includes(filenameParts[1])) {
    throw new ValidationError('FILENAME_EXTENSION_INVALID', 'Filename extension must be either .txt or .xml.')
  }

  // Check length
  if (filename.length > 50) {
    throw new ValidationError('FILENAME_TOO_LONG', 'Filename cannot exceed 50 characters, including the extension.')
  }

  return true
}
