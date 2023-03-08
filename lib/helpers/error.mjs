/**
 * Error with a Custom Name
 */
/* c8 ignore start */
export class ValidationError extends Error {
  /**
   * Create new ValidationError
   *
   * @param {string} name Name of the error, in UPPERCASE snake case. (e.g. FILENAME_MISSING_EXT)
   * @param {string} message Long description of the error, in human-readable format.
   * @param {object} opts Additional options
   * @param {string} opts.ref URL to the web reference for this error.
   */
  constructor (name, message, opts = {}) {
    super(message ?? name)
    this.name = name
    this.refUrl = opts.ref
  }
}
/* c8 ignore stop */

/**
 * Custom Jest Expect Matcher to validate whether a function throws an error with a specific name
 *
 * @param {Function} received Function that should throw an error
 * @param {string} expected Expected error name
 * @returns Jest result object
 */
/* c8 ignore start */
export function toThrowWithErrorName (received, expected) {
  let receivedErrorName = null
  let didNotThrow = false
  try {
    received()
    didNotThrow = true
  } catch (err) {
    receivedErrorName = err.name
  }

  if (didNotThrow) {
    return {
      pass: false,
      message: () => `expected to throw with error name ${this.utils.printExpected(expected)}`
    }
  }

  if (receivedErrorName === expected) {
    return {
      pass: true,
      message: () => `expected error name ${this.utils.printReceived(receivedErrorName)} to equal ${this.utils.printExpected(expected)}`
    }
  } else {
    return {
      pass: false,
      message: () => `expected error name ${this.utils.printReceived(receivedErrorName)} to equal ${this.utils.printExpected(expected)}`
    }
  }
}
/* c8 ignore stop */
