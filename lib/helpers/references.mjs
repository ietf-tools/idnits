import { get, isNil, isPlainObject } from 'lodash-es'

/**
 * @typedef {Object} ReferencesSection
 * @property {string} path Path of the <references> element, e.g. rfc.back.references[0].references[1]
 * @property {string} name Section name, from <name> or the v2 title attribute ('' if none)
 * @property {string} nameKey Where the name comes from: 'name' or 'title'
 * @property {Object} section The <references> element itself
 * @property {Object[]} references Direct <reference> children
 * @property {Object[]} referencegroups Direct <referencegroup> children
 */

/**
 * Wrap a parsed XML child in an array, as the parser gives a single child as an object
 *
 * @param {*} value Parsed XML child
 * @returns {Array} Children as an array
 */
function toArray (value) {
  if (isNil(value)) { return [] }
  return Array.isArray(value) ? value : [value]
}

/**
 * Get the text of a parsed <name> element or of the v2 title attribute
 *
 * @param {Object} section <references> element
 * @returns {{ name: string, nameKey: string }} Name text and where it comes from
 */
function getSectionName (section) {
  const name = section.name
  if (!isNil(name) && name !== '') {
    return {
      name: isPlainObject(name) ? String(name['#text'] ?? '') : String(name),
      nameKey: 'name'
    }
  }
  if (section._attr?.title) {
    return { name: String(section._attr.title), nameKey: 'title' }
  }
  return { name: '', nameKey: 'name' }
}

/**
 * Get the leaf <references> sections of an XML document, whatever the layout:
 * flat or nested in a <references> wrapper (at any depth), single object or array.
 *
 * A <references> element that contains other <references> is a container and is
 * only returned if it also holds <reference> or <referencegroup> entries directly.
 *
 * @param {Object} doc Parsed XML document
 * @returns {ReferencesSection[]} Leaf sections, in document order
 */
export function getReferencesSections (doc) {
  const sections = []

  const walk = (value, path) => {
    toArray(value).forEach((entry, idx) => {
      // -> An empty <references/> is parsed as an empty string
      const section = isPlainObject(entry) ? entry : {}
      const sectionPath = `${path}[${idx}]`
      const references = toArray(section.reference)
      const referencegroups = toArray(section.referencegroup)
      const hasChildSections = !isNil(section.references)
      if (!hasChildSections || references.length > 0 || referencegroups.length > 0) {
        sections.push({
          path: sectionPath,
          ...getSectionName(section),
          section,
          references,
          referencegroups
        })
      }
      if (hasChildSections) {
        walk(section.references, `${sectionPath}.references`)
      }
    })
  }

  walk(get(doc, 'data.rfc.back.references'), 'rfc.back.references')
  return sections
}
