import { get, isNil, isPlainObject, uniq } from 'lodash-es'

/**
 * @typedef {Object} XmlReference
 * @property {string} section Kind of references section it is listed in: 'normative', 'informative'
 *                            or 'unclassified' (any other name, or none)
 * @property {string|null} rfc RFC number, without leading zeros
 * @property {string|null} draft Internet-Draft name, with its version if the reference gives one
 * @property {string} source How the reference is given: 'reference', 'xi:include', 'entity' or 'pi'
 */

// Comments and CDATA sections, whose content is not markup
const commentOrCdataRgx = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g
// Processing instructions other than the XML declaration
const piRgx = /<\?(?!xml\s)([^\s?]+)\s*([\s\S]*?)\?>/g
const referencesTagRgx = /<references(?=[\s/>])[^>]*?(\/?)>|<\/references\s*>/g
// -> Quotes are not always balanced in the wild, e.g. include="reference.RFC.1112'
const includeAttrRgx = /^include\s*=\s*["']?([^"'\s]+)/

// Bibliography entries, from the file a reference is included from
const rfcTargetRgx = /(?:^|\/)reference\.RFC\.0*(\d+)(?:\.xml)?$/i
const draftTargetRgx = /(?:^|\/)reference\.I-D\.(?:draft-)?([a-z0-9._-]+?)(?:\.xml)?$/i
const datatrackerDraftTargetRgx = /\/bibxml3\/(draft-[a-z0-9._-]+?)(?:\.xml)?$/i

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
 * Blank out comments and CDATA sections, keeping the length of the text so
 * that offsets in it stay valid
 *
 * @param {string} text XML text
 * @returns {string} Text with comments and CDATA sections replaced by spaces
 */
export function maskCommentsAndCdata (text) {
  return text.replace(commentOrCdataRgx, match => ' '.repeat(match.length))
}

/**
 * Find the processing instructions of an XML text, other than the XML declaration
 *
 * @param {string} text XML text
 * @returns {Array<{ target: string, content: string, offset: number }>} Processing instructions,
 *          with their offset in the text
 */
export function findProcessingInstructions (text) {
  return [...maskCommentsAndCdata(text).matchAll(piRgx)].map(match => ({
    target: match[1],
    content: match[2].trim(),
    offset: match.index
  }))
}

/**
 * Classify a <references> element by its name, from <name> or the v2 title attribute
 *
 * @param {Object} section <references> element
 * @returns {string} 'normative', 'informative' or 'unclassified'
 */
function getSectionKind (section) {
  const name = isPlainObject(section.name) ? section.name['#text'] : (section.name || section._attr?.title)
  if (/normative references/i.test(name ?? '')) {
    return 'normative'
  } else if (/informative references/i.test(name ?? '')) {
    return 'informative'
  }
  return 'unclassified'
}

/**
 * Get the RFC and draft cited by an included bibliography file
 *
 * @param {string} target URL or name of the included file, e.g. reference.RFC.2119.xml
 * @returns {{ rfc: string|null, draft: string|null }} Cited document
 */
function parseIncludeTarget (target) {
  const path = String(target ?? '').trim().replace(/[?#].*$/, '')
  const rfc = path.match(rfcTargetRgx)?.[1] ?? null
  const draftName = path.match(draftTargetRgx)?.[1]
  const draft = draftName ? `draft-${draftName}` : (path.match(datatrackerDraftTargetRgx)?.[1] ?? null)
  return { rfc, draft }
}

/**
 * Get the RFC and draft cited by a <reference>, from its <seriesInfo> or, failing that, its anchor
 *
 * @param {Object} reference <reference> element
 * @returns {{ rfc: string|null, draft: string|null }} Cited document
 */
function parseReference (reference) {
  const seriesInfo = [...toArray(reference.seriesInfo), ...toArray(reference.front?.seriesInfo)]
  const seriesValue = name => seriesInfo.find(si => si?._attr?.name === name && si._attr.value)?._attr.value
  const rfcValue = seriesValue('RFC')
  const draftValue = seriesValue('Internet-Draft')

  if (isNil(rfcValue) && isNil(draftValue)) {
    // -> No <seriesInfo> for either, so go by the anchor (e.g. RFC2119, I-D.draft-ietf-foo-bar-03)
    const anchor = String(reference._attr?.anchor ?? '').trim().replace(/^I-D\./i, '')
    return {
      rfc: anchor.match(/^RFC0*(\d+)$/i)?.[1] ?? null,
      draft: anchor.startsWith('draft-') ? anchor : null
    }
  }
  // -> The draft name is sometimes given with the I-D. prefix of its anchor
  const draft = String(draftValue ?? '').trim().replace(/^I-D\./i, '')
  return {
    rfc: String(rfcValue ?? '').trim().match(/^(?:RFC\s*)?0*(\d+)$/i)?.[1] ?? null,
    draft: draft.startsWith('draft-') ? draft : null
  }
}

/**
 * Get the <references> elements of a parsed document, in document order
 *
 * @param {Object} doc Parsed XML document
 * @returns {Object[]} <references> elements, containers included
 */
function getAllReferencesElements (doc) {
  const elements = []
  const walk = value => {
    for (const entry of toArray(value)) {
      // -> An empty <references/> is parsed as an empty string
      const section = isPlainObject(entry) ? entry : {}
      elements.push(section)
      walk(section.references)
    }
  }
  walk(get(doc, 'data.rfc.back.references'))
  return elements
}

/**
 * Find the references pulled in through the raw text of a document, which the
 * parser drops: external entities (&RFC2119;) and <?rfc include?> instructions
 *
 * They are located in the <references> section that contains them, by their
 * offset in the text.
 *
 * @param {Object} doc Parsed XML document
 * @param {number} sectionCount Number of <references> elements in the parsed document
 * @returns {Array<{ index: number, target: string, source: string }>} Includes, with the
 *          position of their <references> element in document order
 */
function findRawIncludes (doc, sectionCount) {
  const body = doc.body ?? ''
  const includes = []

  for (const pi of doc.processingInstructions ?? []) {
    const match = pi.target === 'rfc' && pi.content.match(includeAttrRgx)
    if (match) {
      includes.push({ offset: pi.offset, target: match[1], source: 'pi' })
    }
  }

  const masked = maskCommentsAndCdata(body).replace(piRgx, match => ' '.repeat(match.length))
  for (const entity of doc.externalEntities ?? []) {
    let offset = masked.indexOf(`&${entity.name};`)
    while (offset >= 0) {
      includes.push({ offset, target: entity.url, source: 'entity' })
      offset = masked.indexOf(`&${entity.name};`, offset + 1)
    }
  }

  if (includes.length === 0) {
    return []
  }

  // Spans of the <references> elements, in the order of their start tags
  const spans = []
  const open = []
  for (const match of masked.matchAll(referencesTagRgx)) {
    if (match[0].startsWith('</')) {
      const span = open.pop()
      if (span) { span.end = match.index }
    } else if (match[1]) {
      spans.push({ start: match.index, end: match.index })
    } else {
      const span = { start: match.index, end: body.length }
      spans.push(span)
      open.push(span)
    }
  }
  // -> The text does not line up with the parsed document, so sections can't be told apart
  if (spans.length !== sectionCount) {
    return []
  }

  return includes.flatMap(({ offset, target, source }) => {
    const index = spans.findLastIndex(span => span.start <= offset && offset < span.end)
    return index >= 0 ? [{ index, target, source }] : []
  })
}

/**
 * Collect the references of an XML document, whichever way they are given:
 * <reference> elements (also inside a <referencegroup>), <xi:include>,
 * external entities and <?rfc include?> instructions, in <references>
 * sections named with <name> or the v2 title attribute, flat or nested.
 *
 * A reference is only returned if it cites an RFC or an Internet-Draft.
 *
 * @param {Object} doc Parsed XML document
 * @returns {XmlReference[]} References, in document order per section and kind of source
 */
export function collectXmlReferences (doc) {
  const elements = getAllReferencesElements(doc)
  const result = elements.map(() => [])

  elements.forEach((section, idx) => {
    const kind = getSectionKind(section)
    const groups = toArray(section.referencegroup).filter(isPlainObject)
    for (const parent of [section, ...groups]) {
      for (const reference of toArray(parent.reference).filter(isPlainObject)) {
        result[idx].push({ section: kind, ...parseReference(reference), source: 'reference' })
      }
      for (const [key, value] of Object.entries(parent)) {
        if (/^[^:]+:include$/.test(key)) {
          for (const include of toArray(value)) {
            result[idx].push({ section: kind, ...parseIncludeTarget(include?._attr?.href), source: 'xi:include' })
          }
        }
      }
    }
  })

  for (const { index, target, source } of findRawIncludes(doc, elements.length)) {
    result[index].push({ section: getSectionKind(elements[index]), ...parseIncludeTarget(target), source })
  }

  return result.flat().filter(ref => ref.rfc || ref.draft)
}

/**
 * Get the RFC numbers cited in the given kinds of references sections
 *
 * @param {XmlReference[]} references References from collectXmlReferences()
 * @param {string[]} [sections] Kinds of sections to keep, all if not set
 * @returns {string[]} Distinct RFC numbers
 */
export function getCitedRfcs (references, sections) {
  return uniq(references.filter(ref => ref.rfc && (!sections || sections.includes(ref.section))).map(ref => ref.rfc))
}

/**
 * Get the draft names cited in the given kinds of references sections
 *
 * @param {XmlReference[]} references References from collectXmlReferences()
 * @param {string[]} [sections] Kinds of sections to keep, all if not set
 * @returns {string[]} Distinct draft names, with their version if given
 */
export function getCitedDrafts (references, sections) {
  return uniq(references.filter(ref => ref.draft && (!sections || sections.includes(ref.section))).map(ref => ref.draft))
}
