// Elements whose content is cited from another document rather than written by the author
const CITED_REFERENCE_TAGS = ['reference', 'referencegroup']

/**
 * Whether an XML path goes through a cited <reference> or <referencegroup>
 *
 * Text inside a reference (e.g. the abstract of an included bibxml entry) comes
 * from the cited document, which the author has no control over.
 *
 * @param {string[]} path Path segments, as given by traverseAllValues()
 * @returns {boolean} True if the path is inside a cited reference
 */
export function isInCitedReference (path) {
  return path.some(seg => CITED_REFERENCE_TAGS.includes(seg.replace(/\[\d+\]$/, '')))
}
