import { get, isNil, isPlainObject } from 'lodash-es'

/**
 * Get the plain text of a parsed element (string, number or object with a #text property).
 * Text of inline markup (e.g. <tt>) is only used when there is no other text, as the
 * parser doesn't keep track of where it was in the surrounding text.
 *
 * @param {*} value Parsed element
 * @returns {string} Text content, with whitespace collapsed
 */
function getText (value) {
  let text = ''
  if (typeof value === 'string' || typeof value === 'number') {
    text = String(value)
  } else if (isPlainObject(value)) {
    if (!isNil(value['#text']) && String(value['#text']).trim() !== '') {
      text = String(value['#text'])
    } else {
      text = Object.entries(value).filter(([k]) => k !== '_attr').map(([, v]) => getText(v)).join(' ')
    }
  } else if (Array.isArray(value)) {
    text = value.map(getText).join(' ')
  }
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Get the name of a section, from its <name> child (plain or with attributes
 * and inline markup, e.g. <name slugifiedName="...">) or the v2 title attribute
 *
 * @param {Object} section Parsed <section> element
 * @returns {string} Section name, or an empty string if none
 */
export function getSectionName (section) {
  if (!isPlainObject(section)) {
    return ''
  }
  return getText(section.name) || getText(section._attr?.title)
}

/**
 * Get the top-level sections of the document <middle>, as an array
 * (the parser gives a single <section> as an object)
 *
 * @param {Object} doc Parsed XML document
 * @returns {Object[]} Sections, in document order
 */
export function getMiddleSections (doc) {
  const sections = get(doc, 'data.rfc.middle.section')
  if (isNil(sections)) { return [] }
  return Array.isArray(sections) ? sections : [sections]
}
