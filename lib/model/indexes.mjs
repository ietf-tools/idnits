// Indexes on a parsed document: answers to questions that the checks of both formats ask, each format
// answering in its own way (see lib/model/sections.mjs). An answer is computed when a check first asks for
// it and kept for the other checks of the same run.

/**
 * How certain an answer is: declared by the document (XML elements and attributes) or inferred
 * from its text (text documents, by matching headings and lines)
 */
export const CERTAINTY = {
  DECLARED: 'declared',
  INFERRED: 'inferred'
}

// Answers computed for each document, by name. Keyed by the document, so they go away with it and
// nothing is shared between runs.
const indexesByDoc = new WeakMap()

/**
 * Get an index of a document, computing it on first use
 *
 * @param {Object} doc Parsed document
 * @param {string} name Name of the index, unique among the indexes
 * @param {function(Object): *} compute Computes the index from the document
 * @returns {*} The index
 */
export function getIndex (doc, name, compute) {
  let indexes = indexesByDoc.get(doc)
  if (!indexes) {
    indexes = new Map()
    indexesByDoc.set(doc, indexes)
  }
  if (!indexes.has(name)) {
    indexes.set(name, compute(doc))
  }
  return indexes.get(name)
}
