import { ValidationComment, ValidationWarning } from '../helpers/error.mjs'
import { traverseAllValues } from '../helpers/traversal.mjs'
import { fetchRemoteDocInfo, fetchRemoteRfcInfo } from '../helpers/remote.mjs'
import { MODES } from '../config/modes.mjs'
import { difference, get } from 'lodash-es'
import { DateTime } from 'luxon'

const OBSOLETES_RE = /(?:obsoletes|replaces) ((?:\[?rfcs? ?)?[0-9]+\]?(?:, | and )?)+/gi
const UPDATES_RE = /updates ((?:\[?rfcs? ?)?[0-9]+\]?(?:, | and )?)+/gi
const RFC_NUM_RE = /[0-9]+/g
const VERSION_SUFFIX_RE = /-([0-9]{2})$/

const today = DateTime.now()

/**
 * Validate document date
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateDate (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  switch (doc.type) {
    case 'txt': {
      // TODO: Text type validation
      break
    }
    case 'xml': {
      const docDate = get(doc, 'data.rfc.front.date._attr')
      if (!docDate) {
        result.push(new ValidationWarning('MISSING_DOC_DATE', 'The document date could not be determined.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date'
        }))
      } else {
        const dt = DateTime.fromObject({
          year: docDate.year || today.year,
          month: docDate.month ? DateTime.fromFormat(docDate.month, 'MMMM').month : today.month,
          day: docDate.day || today.day
        })
        const daysDiff = Math.round(dt.diffNow().as('days'))
        if (daysDiff < -3) {
          result.push(new ValidationWarning('DOC_DATE_IN_PAST', `The document date is ${daysDiff * -1} days in the past. Is this intentional?`, {
            ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date',
            path: 'rfc.front.date'
          }))
        } else if (daysDiff > 3) {
          result.push(new ValidationWarning('DOC_DATE_IN_FUTURE', `The document date is ${daysDiff} days in the future. Is this intentional?`, {
            ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date',
            path: 'rfc.front.date'
          }))
        }
      }
      break
    }
  }

  return result
}

/**
 * Validate document category (status / intended status)
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateCategory (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  switch (doc.type) {
    case 'txt': {
      // TODO: Text type validation
      break
    }
    case 'xml': {
      const docCategory = get(doc, 'data.rfc._attr.category')
      const docName = get(doc, 'data.rfc._attr.docName')
      if (!docName.startsWith('draft-') && !docCategory) {
        result.push(new ValidationWarning('MISSING_DOC_CATEGORY', 'The document category attribute is missing on the <rfc> element.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#category',
          path: 'rfc.category'
        }))
      } else if (docCategory && !['std', 'bcp', 'info', 'exp', 'historic'].includes(docCategory)) {
        result.push(new ValidationWarning('INVALID_DOC_CATEGORY', 'The document category has an invalid value. Allowed values are std, bcp, info, exp and historic.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#category',
          path: 'rfc.category'
        }))
      }
      break
    }
  }

  return result
}

/**
 * Validate that the document updates / obsoletes another document correctly
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {boolean} [opts.offline=false] Disable checks that require an internet connection
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateObsoleteUpdateRef (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  switch (doc.type) {
    case 'txt': {
      const abstract = doc.data.content.abstract.join(' ') || ''
      const obsoletesRfc = doc.data.extractedElements.obsoletesRfc
      const updatesRfc = doc.data.extractedElements.updatesRfc

      const mentionedObsoletesRfcs = [...abstract.matchAll(OBSOLETES_RE)]
        .flatMap(match => (match[0].match(RFC_NUM_RE) || []))
      const mentionedUpdatesRfcs = [...abstract.matchAll(UPDATES_RE)]
        .flatMap(match => (match[0].match(RFC_NUM_RE) || []))

      // RFCs in obsoletes/updates but not mentioned in abstract
      const obsoletesNotInAbstract = obsoletesRfc.filter(rfc => !mentionedObsoletesRfcs.includes(rfc))
      const updatesNotInAbstract = updatesRfc.filter(rfc => !mentionedUpdatesRfcs.includes(rfc))

      obsoletesNotInAbstract.forEach(rfc => {
        result.push(new ValidationComment(
          'OBSOLETES_NOT_IN_ABSTRACT',
          `RFC ${rfc} is listed as "obsoleted" in metadata but is not mentioned in the abstract.`,
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'data.content.abstract'
          }
        ))
      })

      updatesNotInAbstract.forEach(rfc => {
        result.push(new ValidationComment(
          'UPDATES_NOT_IN_ABSTRACT',
          `RFC ${rfc} is listed as "updated" in metadata but is not mentioned in the abstract.`,
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'data.content.abstract'
          }
        ))
      })

      const mentionedButNotObsoletes = mentionedObsoletesRfcs.filter(rfc => !obsoletesRfc.includes(rfc))
      const mentionedButNotUpdates = mentionedUpdatesRfcs.filter(rfc => !updatesRfc.includes(rfc))

      mentionedButNotObsoletes.forEach(rfc => {
        result.push(new ValidationComment(
          'MENTIONED_NOT_IN_OBSOLETES',
          `RFC ${rfc} is mentioned as "obsoleted" or "replaced" in the abstract but not listed in metadata.`,
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'data.content.abstract'
          }
        ))
      })

      mentionedButNotUpdates.forEach(rfc => {
        result.push(new ValidationComment(
          'MENTIONED_NOT_IN_UPDATES',
          `RFC ${rfc} is mentioned as "updated" in the abstract but not listed in metadata.`,
          {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'data.content.abstract'
          }
        ))
      })
      break
    }
    case 'xml': {
      const obsoletesRef = get(doc, 'data.rfc._attr.obsoletes', '').split(',').map(r => r.trim()).filter(r => r)
      const updatesRef = get(doc, 'data.rfc._attr.updates', '').split(',').map(r => r.trim()).filter(r => r)

      const obsoletesAbs = []
      await traverseAllValues(get(doc, 'data.rfc.front.abstract', {}), (val, key) => {
        const matches = val.replaceAll('\n', ' ').matchAll(OBSOLETES_RE)
        for (const match of matches) {
          const numMatches = match[0].matchAll(RFC_NUM_RE)
          for (const numMatch of numMatches) {
            obsoletesAbs.push(numMatch[0])
          }
        }
      })

      const updatesAbs = []
      await traverseAllValues(get(doc, 'data.rfc.front.abstract', {}), (val, key) => {
        const matches = val.replaceAll('\n', ' ').matchAll(UPDATES_RE)
        for (const match of matches) {
          const numMatches = match[0].matchAll(RFC_NUM_RE)
          for (const numMatch of numMatches) {
            updatesAbs.push(numMatch[0])
          }
        }
      })

      // -> Obsoletes in <rfc> but no in <abstract>
      const obsoletesNotInAbs = difference(obsoletesRef, obsoletesAbs)
      if (obsoletesNotInAbs.length > 0) {
        for (const ref of obsoletesNotInAbs) {
          result.push(new ValidationWarning('OBSOLETES_NOT_IN_ABSTRACT', `The document states that it obsoletes RFC ${ref} but doesn't explicitely mention it in the <abstract> section.`, {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'rfc.front.abstract'
          }))
        }
      }

      // -> Obsoletes in <abstract> but no in <rfc>
      const obsoletesNotInRef = difference(obsoletesAbs, obsoletesRef)
      if (obsoletesNotInRef.length > 0) {
        for (const ref of obsoletesNotInRef) {
          result.push(new ValidationWarning('OBSOLETES_NOT_IN_RFC', `The document abstract states that it obsoletes RFC ${ref} but it's not mentionned in the obsoletes <rfc> field.`, {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'rfc.front.abstract'
          }))
        }
      }

      // -> Updates in <rfc> but no in <abstract>
      const updatesNotInAbs = difference(updatesRef, updatesAbs)
      if (updatesNotInAbs.length > 0) {
        for (const ref of updatesNotInAbs) {
          result.push(new ValidationWarning('UPDATES_NOT_IN_ABSTRACT', `The document states that it updates RFC ${ref} but doesn't explicitely mention it in the <abstract> section.`, {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'rfc.front.abstract'
          }))
        }
      }

      // -> Updates in <abstract> but no in <rfc>
      const updatesNotInRef = difference(updatesAbs, updatesRef)
      if (updatesNotInRef.length > 0) {
        for (const ref of updatesNotInRef) {
          result.push(new ValidationWarning('UPDATES_NOT_IN_RFC', `The document abstract states that it updates RFC ${ref} but it's not mentionned in the updates <rfc> field.`, {
            ref: 'https://authors.ietf.org/en/required-content#abstract',
            path: 'rfc.front.abstract'
          }))
        }
      }

      if (!offline) {
        // -> Obsoletes an already obsoleted rfc
        if (mode !== MODES.SUBMISSION && obsoletesRef.length > 0) {
          for (const ref of obsoletesRef) {
            if (RFC_NUM_RE.test(ref)) {
              const rfcInfo = await fetchRemoteRfcInfo(ref)
              if (!rfcInfo) {
                result.push(new ValidationWarning('OBSOLETES_RFC_NOT_FOUND', `The <rfc> field states that it obsoletes RFC ${ref} but no matching RFC could be found on rfc-editor.org.`, {
                  ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#obsoletes',
                  path: 'rfc.obsoletes'
                }))
              } else if (rfcInfo.obsoleted_by?.length > 0) {
                result.push(new ValidationWarning('OBSOLETES_OSOLETED_RFC', `The <rfc> field states that it obsoletes RFC ${ref} but it's already obsoleted by RFC ${rfcInfo.obsoleted_by.join(', ')}.`, {
                  ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#obsoletes',
                  path: 'rfc.obsoletes'
                }))
              }
            }
          }
        }

        // -> Updates an already obsoleted rfc
        if (mode !== MODES.SUBMISSION && updatesRef.length > 0) {
          for (const ref of updatesRef) {
            if (RFC_NUM_RE.test(ref)) {
              const rfcInfo = await fetchRemoteRfcInfo(ref)
              if (!rfcInfo) {
                result.push(new ValidationWarning('UPDATES_RFC_NOT_FOUND', `The <rfc> field states that it updates RFC ${ref} but no matching RFC could be found on rfc-editor.org.`, {
                  ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates',
                  path: 'rfc.updates'
                }))
              } else if (rfcInfo.obsoleted_by?.length > 0) {
                result.push(new ValidationWarning('UPDATES_OSOLETED_RFC', `The <rfc> field states that it updates RFC ${ref} but it's already obsoleted by RFC ${rfcInfo.obsoleted_by.join(', ')}.`, {
                  ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates',
                  path: 'rfc.updates'
                }))
              } else if (rfcInfo.updated_by?.length > 0) {
                result.push(new ValidationWarning('UPDATES_UPDATED_RFC', `The <rfc> field states that it updates RFC ${ref} but it's already updated by RFC ${rfcInfo.updated_by.join(', ')}.`, {
                  ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates',
                  path: 'rfc.updates'
                }))
              }
            }
          }
        }
      }
      break
    }
  }

  return result
}

/**
 * Validate document version
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {boolean} [opts.offline=false] Disable checks that require an internet connection
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateVersion (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []

  if (offline) {
    return result
  }

  switch (doc.type) {
    case 'txt': {
      const docName = doc.data.slug
      const versionMatch = docName.match(VERSION_SUFFIX_RE)
      if (versionMatch?.[1]) {
        const docInfo = await fetchRemoteDocInfo(docName)
        if (docInfo && docInfo.rev) {
          const latestVersion = parseInt(docInfo.rev)
          const docVersion = parseInt(versionMatch[1])
          if (latestVersion === docVersion) {
            result.push(new ValidationWarning('DUPLICATE_DOC_VERSION', 'A document with this version already exists.'))
          } else if (latestVersion > docVersion) {
            result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version is ${latestVersion} but your document is ${docVersion}.`))
          } else if (docVersion > latestVersion + 1) {
            result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version is ${latestVersion} but your document is ${docVersion} and leaves a gap.`))
          }
        } else if (versionMatch[1] !== '00') {
          result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', 'The document version is unexpected. As no document already exists, it should be version 00.'))
        }
      }
      break
    }
    case 'xml': {
      const docName = get(doc, 'data.rfc._attr.docName')
      const versionMatch = docName.match(VERSION_SUFFIX_RE)
      if (versionMatch?.[1]) {
        const docInfo = await fetchRemoteDocInfo(docName)
        if (docInfo && docInfo.rev) {
          const latestVersion = parseInt(docInfo.rev)
          const docVersion = parseInt(versionMatch[1])
          if (latestVersion === docVersion) {
            result.push(new ValidationWarning('DUPLICATE_DOC_VERSION', 'A document with this version already exists.', {
              path: 'rfc.docName'
            }))
          } else if (latestVersion > docVersion) {
            result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version is ${latestVersion} but your document is ${docVersion}.`, {
              path: 'rfc.docName'
            }))
          } else if (docVersion > latestVersion + 1) {
            result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version is ${latestVersion} but your document is ${docVersion} and leaves a gap.`, {
              path: 'rfc.docName'
            }))
          }
        } else if (versionMatch[1] !== '00') {
          result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', 'The document version is unexpected. As no document already exists, it should be version 00.', {
            path: 'rfc.docName'
          }))
        }
      }
      break
    }
  }

  return result
}
