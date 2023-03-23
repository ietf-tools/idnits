/* c8 ignore start */

/**
 * Validation Error
 */
export class ValidationError extends Error {
  /**
   * Create new ValidationError
   *
   * @param {string} name Name of the error, in UPPERCASE snake case. (e.g. FILENAME_MISSING_EXT)
   * @param {string} message Long description of the error, in human-readable format.
   * @param {Object} opts Additional options
   * @param {string} opts.ref URL to the web reference for this error.
   */
  constructor (name, message, opts = {}) {
    super(message ?? name)
    this.name = name
    this.refUrl = opts.ref
    this.lines = opts.lines
  }
}

export class ValidationWarning extends ValidationError {}
export class ValidationComment extends ValidationError {}

/**
 * Custom Jest Expect Matcher to validate whether a function throws an error with a specific name
 *
 * @param {function} received Function that should throw an error
 * @param {string} expected Expected error name
 * @returns Jest result object
 */
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

/**
 * Custom Jest Expect Matcher to validate whether an array contains an error with a specific name
 *
 * @param {Array} received Received array
 * @param {string} expected Expected error name
 * @param {string|Class} [severity] Optional error type to check (ValidationError, ValidationWarning or ValidationComment)
 * @returns Jest result object
 */
export function toContainError (received, expected, severity) {
  const checkSeverity = severity !== undefined && severity !== null
  let severityName = ''

  if (!Array.isArray(received)) {
    return {
      pass: false,
      message: () => 'expected a result array'
    }
  } else if (received.length === 0) {
    return {
      pass: false,
      message: () => 'expected a result array with at least 1 error of type ValidationError'
    }
  }

  if (checkSeverity) {
    if (typeof severity === 'string') {
      severityName = severity
    } else {
      severityName = severity.name
    }
  }

  let hasNameMatch = false
  let hasSeverityMatch = false
  for (const entry of received) {
    if (entry.name === expected) {
      hasNameMatch = true
      if (checkSeverity) {
        if (entry.constructor.name === severityName) {
          hasSeverityMatch = true
          break
        }
      } else {
        break
      }
    }
  }

  if (hasNameMatch) {
    if (!checkSeverity || (checkSeverity && hasSeverityMatch)) {
      return {
        pass: true,
        message: () => `expected result array ${this.utils.printReceived(received)} to contain error ${this.utils.printExpected(expected)}`
      }
    } else {
      return {
        pass: false,
        message: () => `expected result array ${this.utils.printReceived(received)} to contain error ${this.utils.printExpected(expected)} with severity ${this.utils.printExpected(severityName)}`
      }
    }
  } else {
    return {
      pass: false,
      message: () => `expected result array ${this.utils.printReceived(received)} to contain error ${this.utils.printExpected(expected)}`
    }
  }
}
/* c8 ignore stop */
