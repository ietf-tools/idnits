import { ValidationComment, ValidationWarning } from '../helpers/error.mjs'
import { traverseAllValues } from '../helpers/traversal.mjs'
import { fetchRemoteDocInfo, fetchRemoteRfcInfo } from '../remote/common.mjs'
import { MODES } from '../config/modes.mjs'
import { fetchDatatrackerStream, getDocumentStream, streamDisplayName } from '../helpers/stream.mjs'
import { difference, get, uniq } from 'lodash-es'
import { DateTime } from 'luxon'

import { rfcStatusHierarchy } from '../config/rfc-status-hierarchy.mjs'

const OBSOLETES_RE = /(?:obsoletes|replaces) ((?:\[?rfcs? ?)?[0-9]+\]?(?:, | and )?)+/gi
const UPDATES_RE = /updates ((?:\[?rfcs? ?)?[0-9]+\]?(?:, | and )?)+/gi
const RFC_NUM_RE_GENERAL = /[0-9]+/
const RFC_NUM_RE = /[0-9]+/g
const VERSION_SUFFIX_RE = /-([0-9]{2})$/

const today = DateTime.now()

/**
 * Resolve a document-date month to a number, or null when it is not one.
 *
 * Both callers used to hand the result of DateTime.fromFormat straight to
 * DateTime.fromObject. An unparseable month makes that NaN, and fromObject
 * throws on NaN, so an abbreviated or malformed month aborted the run instead
 * of being reported. The locale is pinned because these are English-language
 * drafts: without it the accepted spellings would follow whichever machine ran
 * the tool.
 *
 * @param {string|number} value Month as it appeared in the document
 * @returns {number|null} Month number 1-12, or null
 */
function parseDocMonth (value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 && value <= 12 ? value : null
  }
  if (typeof value !== 'string') {
    return null
  }
  // Tolerate trailing punctuation ("Sep.", "September,") and the common "Sept"
  const trimmed = value.trim().replace(/[.,]$/, '').replace(/^sept$/i, 'Sep')
  if (/^[0-9]{1,2}$/.test(trimmed)) {
    const asNumber = Number(trimmed)
    return asNumber >= 1 && asNumber <= 12 ? asNumber : null
  }
  for (const format of ['MMMM', 'MMM']) {
    const parsed = DateTime.fromFormat(trimmed, format, { locale: 'en-US' })
    if (parsed.isValid) {
      return parsed.month
    }
  }
  return null
}

/**
 * Resolve a document-date day or year to a number, or null when it is not one.
 *
 * DateTime.fromObject throws on a non-numeric unit, so a malformed attribute
 * must be caught here to be reported rather than abort the run.
 *
 * @param {string|number} value Day or year as it appeared in the document
 * @param {number} min Smallest accepted value
 * @param {number} max Largest accepted value
 * @returns {number|null} The value as an integer, or null
 */
function parseDocDateNumber (value, min, max) {
  const asNumber = typeof value === 'string' && /^[0-9]+$/.test(value.trim()) ? Number(value.trim()) : value
  return Number.isInteger(asNumber) && asNumber >= min && asNumber <= max ? asNumber : null
}

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
  const DATE_THRESHOLD = 3

  switch (doc.type) {
    case 'txt': {
      const docDate = doc.data.header.date

      if (!docDate || !Object.keys(docDate).length) {
        result.push(new ValidationWarning('MISSING_DOC_DATE', 'The document date could not be determined.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date'
        }))
      } else {
        const docDateMonth = docDate.month ? parseDocMonth(docDate.month) : today.month
        if (docDateMonth === null) {
          result.push(new ValidationWarning('MISSING_DOC_DATE', 'The document date could not be determined.', {
            ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date'
          }))
          break
        }
        const dt = DateTime.fromObject({
          year: docDate.year || today.year,
          month: docDateMonth,
          day: docDate.day || today.day
        })
        const daysDiff = Math.round(dt.diffNow().as('days'))
        if (daysDiff < -DATE_THRESHOLD) {
          result.push(new ValidationWarning('DOC_DATE_IN_PAST', `The document date is ${daysDiff * -1} days in the past. Is this intentional?`, {
            ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date'
          }))
        } else if (daysDiff > DATE_THRESHOLD) {
          result.push(new ValidationWarning('DOC_DATE_IN_FUTURE', `The document date is ${daysDiff} days in the future. Is this intentional?`, {
            ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date'
          }))
        }
      }
      break
    }
    case 'xml': {
      const dateEl = get(doc, 'data.rfc.front.date')
      if (dateEl === undefined) {
        // RFC 7998 Section 5.2.3: the prep tool inserts a missing <date>
        result.push(new ValidationComment('MISSING_DOC_DATE', 'The document has no <date> element. The current date will be filled in when the document is prepared.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date',
          path: 'rfc.front.date'
        }))
        break
      }
      // An empty <date/> parses as '' with no _attr. RFC 7991 Section 2.17
      // fills every missing attribute from the current date, so it is today.
      const docDate = get(dateEl, '_attr') || {}
      const docDateYear = docDate.year ? parseDocDateNumber(docDate.year, 1000, 9999) : today.year
      const docDateMonth = docDate.month ? parseDocMonth(docDate.month) : today.month
      const docDateDay = docDate.day ? parseDocDateNumber(docDate.day, 1, 31) : null
      let dt = null
      if (docDateYear !== null && docDateMonth !== null && (docDateDay !== null || !docDate.day)) {
        // Without a day, take today's, clamped so that e.g. February stays valid.
        // An explicit impossible day (31 February) leaves dt invalid.
        dt = DateTime.fromObject({
          year: docDateYear,
          month: docDateMonth,
          day: docDateDay ?? Math.min(today.day, DateTime.fromObject({ year: docDateYear, month: docDateMonth }).daysInMonth)
        })
      }
      if (!dt?.isValid) {
        result.push(new ValidationWarning('MISSING_DOC_DATE', 'The document date could not be determined.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date',
          path: 'rfc.front.date'
        }))
        break
      }
      const daysDiff = Math.round(dt.diffNow().as('days'))
      if (daysDiff < -DATE_THRESHOLD) {
        result.push(new ValidationWarning('DOC_DATE_IN_PAST', `The document date is ${daysDiff * -1} days in the past. Is this intentional?`, {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date',
          path: 'rfc.front.date'
        }))
      } else if (daysDiff > DATE_THRESHOLD) {
        result.push(new ValidationWarning('DOC_DATE_IN_FUTURE', `The document date is ${daysDiff} days in the future. Is this intentional?`, {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#date',
          path: 'rfc.front.date'
        }))
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
      const docCategory = doc.data.header.intendedStatus

      if (!docCategory) {
        result.push(new ValidationWarning('MISSING_DOC_CATEGORY', 'The document category attribute is missing on the RFC element.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#category'
        }))
      } else if (docCategory && !rfcStatusHierarchy.find(item => item.name.toLowerCase() === docCategory.toLowerCase())) {
        result.push(new ValidationWarning('INVALID_DOC_CATEGORY', 'The document category has an invalid value. Allowed values are Standards Track, Best Current Practice, Informational, Experimental and Historic.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#category'
        }))
      }
      break
    }
    case 'xml': {
      const docCategory = get(doc, 'data.rfc._attr.category')
      const docName = get(doc, 'data.rfc._attr.docName')
      if (docName && !docName.startsWith('draft-') && !docCategory) {
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
 * Check whether the RFCs a document obsoletes or updates are in its stream
 *
 * The stream of each RFC comes from Datatracker, the stream of the document
 * from getDocumentStream. RFCs Datatracker doesn't know (or has no stream for)
 * are not checked.
 *
 * | RFC stream | Document stream | Finding |
 * |------------|-----------------|---------|
 * | Legacy     | any             | Comment |
 * | other      | same            | -       |
 * | other      | different       | Warning |
 * | other      | unknown         | Comment |
 *
 * @param {Object} doc Document to validate
 * @param {Object} refs RFC numbers the document obsoletes and updates
 * @param {Array<string>} refs.obsoletes RFC numbers the document obsoletes
 * @param {Array<string>} refs.updates RFC numbers the document updates
 * @returns {Promise<Array>} List of CROSS_STREAM_OBSOLETES_UPDATES findings
 */
async function checkCrossStream (doc, { obsoletes, updates }) {
  const result = []
  const lines = doc.body?.split('\n') ?? []
  let ownStream

  for (const [verb, refs] of [['obsolete', obsoletes], ['update', updates]]) {
    const attr = `${verb}s`
    for (const ref of refs) {
      const target = (await fetchDatatrackerStream(`rfc${ref}`))?.stream
      if (!target) {
        continue
      }
      const findingOpts = { ref: `https://authors.ietf.org/en/rfcxml-vocabulary#${attr}` }
      if (doc.type === 'xml') {
        findingOpts.path = `rfc.${attr}`
      } else {
        const lineIdx = lines.findIndex(line => line.toLowerCase().startsWith(`${attr}:`))
        if (lineIdx >= 0) {
          findingOpts.lines = [{ line: lineIdx + 1, pos: 1 }]
        }
      }

      // -> Legacy RFCs predate the streams: nothing to compare with
      if (target === 'legacy') {
        result.push(new ValidationComment('CROSS_STREAM_OBSOLETES_UPDATES', `This document attempts to ${verb} RFC ${ref}, which is in the Legacy stream (published before the current RFC streams were defined). Check whether specific rules apply to this process.`, findingOpts))
        continue
      }

      if (ownStream === undefined) {
        ownStream = await getDocumentStream(doc)
      }
      // -> Stream of this document unknown
      if (!ownStream) {
        result.push(new ValidationComment('CROSS_STREAM_OBSOLETES_UPDATES', `This document attempts to ${verb} RFC ${ref}, which is in the ${streamDisplayName(target)} stream. If this document is not in that stream, specific rules may apply to this process, and you will need sign-off from both stream heads before this document can proceed.`, findingOpts))
      // -> Different streams
      } else if (ownStream !== target) {
        result.push(new ValidationWarning('CROSS_STREAM_OBSOLETES_UPDATES', `This document (${streamDisplayName(ownStream)} stream) attempts to ${verb} RFC ${ref}, an RFC from another stream (${streamDisplayName(target)}). Specific rules may apply to this process, and you will need sign-off from both stream heads before this document can proceed.`, findingOpts))
      }
    }
  }

  return result
}

/**
 * Validate that the document updates / obsoletes another document correctly
 *
 * In submission mode, only the cross-stream check (see checkCrossStream) runs.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {boolean} [opts.offline=false] Disable checks that require an internet connection
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateObsoleteUpdateRef (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []

  // -> Obsoletes / updates an RFC of another stream
  let crossStream = []
  if (!offline) {
    const rfcNumbers = refs => uniq(refs.flatMap(ref => String(ref).match(RFC_NUM_RE) ?? []).map(Number))
    crossStream = await checkCrossStream(doc, doc.type === 'xml'
      ? {
          obsoletes: rfcNumbers(get(doc, 'data.rfc._attr.obsoletes', '').split(',')),
          updates: rfcNumbers(get(doc, 'data.rfc._attr.updates', '').split(','))
        }
      : {
          obsoletes: rfcNumbers(doc.data.extractedElements.obsoletesRfc),
          updates: rfcNumbers(doc.data.extractedElements.updatesRfc)
        })
  }

  if (mode === MODES.SUBMISSION) {
    return crossStream
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

      if (!offline) {
        // -> Obsoletes an already obsoleted rfc
        if (mode !== MODES.SUBMISSION && obsoletesRfc.length > 0) {
          for (const ref of obsoletesRfc) {
            if (RFC_NUM_RE_GENERAL.test(ref)) {
              const rfcInfo = await fetchRemoteRfcInfo(ref)
              if (!rfcInfo) {
                result.push(
                  new ValidationWarning(
                    'OBSOLETES_RFC_NOT_FOUND',
                    `The <rfc> field states that it obsoletes RFC ${ref} but no matching RFC could be found on rfc-editor.org.`,
                    {
                      ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#obsoletes'
                    }
                  )
                )
              } else if (rfcInfo.obsoleted_by?.length > 0) {
                result.push(
                  new ValidationWarning(
                    'OBSOLETES_OBSOLETED_RFC',
                    `The <rfc> field states that it obsoletes RFC ${ref} but it's already obsoleted by RFC ${rfcInfo.obsoleted_by.join(
                      ', '
                    )}.`,
                    {
                      ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#obsoletes'
                    }
                  )
                )
              }
            }
          }
        }

        // -> Updates an already obsoleted rfc
        if (mode !== MODES.SUBMISSION && updatesRfc.length > 0) {
          for (const ref of updatesRfc) {
            if (RFC_NUM_RE_GENERAL.test(ref)) {
              const rfcInfo = await fetchRemoteRfcInfo(ref)
              if (!rfcInfo) {
                result.push(
                  new ValidationWarning(
                    'UPDATES_RFC_NOT_FOUND',
                    `The <rfc> field states that it updates RFC ${ref} but no matching RFC could be found on rfc-editor.org.`,
                    {
                      ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates'
                    }
                  )
                )
              } else if (rfcInfo.obsoleted_by?.length > 0) {
                result.push(
                  new ValidationWarning(
                    'UPDATES_OBSOLETED_RFC',
                    `The <rfc> field states that it updates RFC ${ref} but it's already obsoleted by RFC ${rfcInfo.obsoleted_by.join(
                      ', '
                    )}.`,
                    {
                      ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates'
                    }
                  )
                )
              }
            }
          }
        }
      }

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
            if (RFC_NUM_RE_GENERAL.test(ref)) {
              const rfcInfo = await fetchRemoteRfcInfo(ref)
              if (!rfcInfo) {
                result.push(new ValidationWarning('OBSOLETES_RFC_NOT_FOUND', `The <rfc> field states that it obsoletes RFC ${ref} but no matching RFC could be found on rfc-editor.org.`, {
                  ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#obsoletes',
                  path: 'rfc.obsoletes'
                }))
              } else if (rfcInfo.obsoleted_by?.length > 0) {
                result.push(new ValidationWarning('OBSOLETES_OBSOLETED_RFC', `The <rfc> field states that it obsoletes RFC ${ref} but it's already obsoleted by RFC ${rfcInfo.obsoleted_by.join(', ')}.`, {
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
            if (RFC_NUM_RE_GENERAL.test(ref)) {
              const rfcInfo = await fetchRemoteRfcInfo(ref)
              if (!rfcInfo) {
                result.push(new ValidationWarning('UPDATES_RFC_NOT_FOUND', `The <rfc> field states that it updates RFC ${ref} but no matching RFC could be found on rfc-editor.org.`, {
                  ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates',
                  path: 'rfc.updates'
                }))
              } else if (rfcInfo.obsoleted_by?.length > 0) {
                result.push(new ValidationWarning('UPDATES_OBSOLETED_RFC', `The <rfc> field states that it updates RFC ${ref} but it's already obsoleted by RFC ${rfcInfo.obsoleted_by.join(', ')}.`, {
                  ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#updates',
                  path: 'rfc.updates'
                }))
              } else if (rfcInfo.updated_by?.length > 0) {
                result.push(new ValidationWarning('UPDATES_UPDATED_RFC', `This document updates RFC ${ref}. That RFC is already updated by ${rfcInfo.updated_by.join(', ')}. Verify that this document does not conflict with those.`, {
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

  result.push(...crossStream)
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

  if (offline || mode !== MODES.SUBMISSION) {
    return result
  }

  switch (doc.type) {
    case 'txt': {
      const docName = doc.data.slug
      const versionMatch = docName?.match(VERSION_SUFFIX_RE)
      if (versionMatch?.[1]) {
        const docInfo = await fetchRemoteDocInfo(docName)
        if (docInfo && docInfo.rev) {
          const latestVersion = parseInt(docInfo.rev)
          const docVersion = parseInt(versionMatch[1])
          if (latestVersion === docVersion) {
            result.push(new ValidationWarning('DUPLICATE_DOC_VERSION', 'A document with this name and version already exists in the Internet-Draft repository.', {
              ref: `https://datatracker.ietf.org/doc/${docInfo.name}`
            }))
          } else if (latestVersion > docVersion) {
            result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version in the Internet-Draft repository is ${latestVersion} but your document is ${docVersion}.`, {
              ref: `https://datatracker.ietf.org/doc/${docInfo.name}`
            }))
          } else if (docVersion > latestVersion + 1) {
            result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version in the Internet-Draft repository is ${latestVersion} but your document is ${docVersion} and leaves a gap.`, {
              ref: `https://datatracker.ietf.org/doc/${docInfo.name}`
            }))
          }
        } else if (versionMatch[1] !== '00') {
          result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', 'The document version is unexpected. As no document with this name exists in the Internet-Draft repository, it should be version 00.'))
        }
      }
      break
    }
    case 'xml': {
      const docName = get(doc, 'data.rfc._attr.docName')
      const versionMatch = docName?.match(VERSION_SUFFIX_RE)
      if (versionMatch?.[1]) {
        const docInfo = await fetchRemoteDocInfo(docName)
        if (docInfo && docInfo.rev) {
          const latestVersion = parseInt(docInfo.rev)
          const docVersion = parseInt(versionMatch[1])
          if (latestVersion === docVersion) {
            result.push(new ValidationWarning('DUPLICATE_DOC_VERSION', 'A document with this version already exists in the Internet-Draft repository.', {
              path: 'rfc.docName',
              ref: `https://datatracker.ietf.org/doc/${docInfo.name}`
            }))
          } else if (latestVersion > docVersion) {
            result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version in the Internet-Draft repository is ${latestVersion} but your document is ${docVersion}.`, {
              path: 'rfc.docName',
              ref: `https://datatracker.ietf.org/doc/${docInfo.name}`
            }))
          } else if (docVersion > latestVersion + 1) {
            result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', `The document version is unexpected. The latest version in the Internet-Draft repository is ${latestVersion} but your document is ${docVersion} and leaves a gap.`, {
              path: 'rfc.docName',
              ref: `https://datatracker.ietf.org/doc/${docInfo.name}`
            }))
          }
        } else if (versionMatch[1] !== '00') {
          result.push(new ValidationWarning('UNEXPECTED_DOC_VERSION', 'The document version is unexpected. As no document with this name exists in the Internet-Draft repository, it should be version 00.', {
            path: 'rfc.docName'
          }))
        }
      }
      break
    }
  }

  return result
}
