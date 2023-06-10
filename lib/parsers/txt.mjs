import { ValidationError } from '../helpers/error.mjs'
import { DateTime } from 'luxon'

const LINE_VALUES_EXTRACT_RE = /^(?<left>.*)\s{2,}(?<right>.*)$/
const AUTHOR_NAME_RE = /^[a-z]\.\s[a-z]+$/i
const DATE_RE = /^(?:(?<day>[0-9]{1,2})\s)?(?<month>[a-z]{3,})\s(?<year>[0-9]{4})$/i

/**
 * @typedef {Object} TXTDocObject
 * @property {Object} data Parsed TXT tree
 * @property {string} docKind Whether the document is an Internet Draft (draft) or an RFC (rfc)
 * @property {string} filename Filename of the document
 * @property {string} type Document file type (txt)
 * @property {number} version Document version number (2 or 3)
 * @property {string} versionCertainty Whether the version was explicity specified (strict) or guessed (guess)
 */

/**
 * Parse Text document
 *
 * @param {string} rawText Input text
 * @param {string} filename Filename of the document
 * @returns {TXTDocObject} Parsed document object
 */
export async function parse (rawText, filename) {
  const data = {
    pageCount: 1,
    header: {
      authors: [],
      date: null,
      source: null,
      expires: null
    },
    title: null,
    slug: null
  }
  let docKind = null
  let lineIdx = 0
  try {
    const markers = {
      header: { start: 0, end: 0, closed: false },
      title: 0,
      slug: 0
    }

    for (const line of rawText.split('\n')) {
      const trimmedLine = line.trim()
      lineIdx++

      // Page Break
      // --------------------------------------------------------------
      if (line.indexOf('\f') >= 0) {
        data.pageCount++
        continue
      }

      // Empty line
      // --------------------------------------------------------------
      if (!trimmedLine) {
        continue
      }

      // Header
      // --------------------------------------------------------------
      if (!markers.header.start) {
        // -> First Line
        markers.header.start = lineIdx
        markers.header.end = lineIdx
        const values = LINE_VALUES_EXTRACT_RE.exec(trimmedLine)
        // --> Source
        data.header.source = values.groups.left
        // --> Author
        data.header.authors.push({
          name: values.groups.right
        })
      } else if (!markers.header.closed) {
        if (lineIdx > markers.header.end + 1) {
          markers.header.closed = true
          markers.title = lineIdx
          data.title = trimmedLine
        } else {
          markers.header.end = lineIdx

          const extractedValues = LINE_VALUES_EXTRACT_RE.exec(line)
          const values = extractedValues ? extractedValues.groups : { left: trimmedLine, right: null }

          if (values.left) {
            // --> Document Kind
            if (values.left === 'Internet-Draft') {
              docKind = 'draft'
            } else if (values.left.startsWith('Request for Comments')) {
              data.header.rfcNumber = values.left.split(':')?.[1]?.trim()
              docKind = 'rfc'
            }

            // --> Intended status
            if (values.left.startsWith('Intended')) {
              data.header.intendedStatus = values.left.split(':')?.[1]?.trim()
            }

            // --> Obsoletes
            if (values.left.startsWith('Obsoletes')) {
              const obsoletesValues = values.left.split(':')?.[1]?.trim()
              data.header.obsoletes = obsoletesValues.indexOf(',') >= 0 ? obsoletesValues.split(',').map(o => o.trim()) : [obsoletesValues]
            }

            // --> Category
            if (values.left.startsWith('Category')) {
              data.header.category = values.left.split(':')?.[1]?.trim()
            }

            // --> ISSN
            if (values.left.startsWith('ISSN')) {
              data.header.issn = values.left.split(':')?.[1]?.trim()
            }

            // --> Expires
            if (values.left.startsWith('Expires')) {
              const dateValue = DATE_RE.exec(values.left.split(':')?.[1]?.trim())
              if (dateValue) {
                data.header.expires = DateTime.fromFormat(`${dateValue.groups.day || 1} ${dateValue.groups.month} ${dateValue.groups.year}`, 'd MMMM yyyy')
              }
            }
          }
          if (values.right) {
            // --> Date
            const dateValue = DATE_RE.exec(values.right)
            if (dateValue) {
              data.header.date = DateTime.fromFormat(`${dateValue.groups.day || 1} ${dateValue.groups.month} ${dateValue.groups.year}`, 'd MMMM yyyy')
            }

            if (!data.header.date) {
              // --> Author
              const authorNameValue = AUTHOR_NAME_RE.exec(values.right)
              if (authorNameValue) {
                data.header.authors.push({
                  name: authorNameValue[0]
                })
              } else if (values.right) {
                // --> Author Org
                data.header.authors.findLast(el => {
                  if (el.org) {
                    return true
                  } else {
                    el.org = values.right
                    return false
                  }
                })
              }
            }
          }
        }
      }
      if (data.title && lineIdx === markers.title + 1) {
        markers.slug = lineIdx
        data.slug = trimmedLine
      }
    }
    data.markers = markers
  } catch (err) {
    throw new ValidationError('TXT_PARSING_FAILED', `Error while parsing Line ${lineIdx}: ${err.message}`)
  }

  return {
    docKind,
    body: rawText,
    data,
    filename,
    type: 'txt'
  }
}
