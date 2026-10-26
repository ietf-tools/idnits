import { get, isNil, isPlainObject } from 'lodash-es'

// The kind of references a section heading names: "Normative References", "Normative Reference" and
// "References - Normative" are normative; "Informative References", "Informational References" (a misspelling
// the RFC Production Center corrects, informative as in idnits 2), "Non-normative References" and
// "References - Informative" informative
const NORMATIVE_HEADING = String.raw`(?<!\bnon[-\s]?)\bnormative\s+references?\b|\breferences?\s*[-\u2013:]\s*normative\b`
const INFORMATIVE_HEADING = String.raw`\b(?:informat(?:ive|ional)|non[-\s]?normative)\s+references?\b|\breferences?\s*[-\u2013:]\s*informat(?:ive|ional)\b`
const NORMATIVE_HEADING_RE = new RegExp(NORMATIVE_HEADING, 'i')
const INFORMATIVE_HEADING_RE = new RegExp(INFORMATIVE_HEADING, 'i')

// A text heading of normative or informative references: a subsection of the references section
// ("9.1.  Normative References", the trailing dot sometimes left out) or a top-level section of its own
// ("9.  Normative References"), numbered or not
export const NORMATIVE_REFERENCES_HEADING_RE = new RegExp(String.raw`^(?:\d+\.(?:\d+\.?)?\s+)?(?:${NORMATIVE_HEADING})$`, 'i')
export const INFORMATIVE_REFERENCES_HEADING_RE = new RegExp(String.raw`^(?:\d+\.(?:\d+\.?)?\s+)?(?:${INFORMATIVE_HEADING})$`, 'i')
// A text heading that starts the references section: "References", or one naming a kind of references
export const REFERENCES_SECTION_HEADING_RE = new RegExp(String.raw`^(?:\d+\.\s+)?(?:References|${NORMATIVE_HEADING}|${INFORMATIVE_HEADING})$`, 'i')

/**
 * Classify a references section by its heading, in text or XML alike
 *
 * @example
 * getReferencesKind('Normative Reference') // 'normative'
 * getReferencesKind('Non-normative References') // 'informative'
 * getReferencesKind('Infomative References') // 'unclassified'
 *
 * @param {string} heading Section heading or <name>
 * @returns {string} 'normative', 'informative' or 'unclassified'
 */
export function getReferencesKind (heading) {
  const text = String(heading ?? '')
  if (NORMATIVE_HEADING_RE.test(text)) {
    return 'normative'
  } else if (INFORMATIVE_HEADING_RE.test(text)) {
    return 'informative'
  }
  return 'unclassified'
}

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
