import { get, isNil, isPlainObject, uniq } from 'lodash-es'

/**
 * @typedef {Object} XmlReference
 * @property {string} section Kind of references section it is listed in: 'normative', 'informative'
 *                            or 'unclassified' (any other name, or none)
 * @property {string|null} rfc RFC number, without leading zeros
 * @property {string|null} draft Internet-Draft name, with its version if the reference gives one
 * @property {string} source How the reference is given: 'reference', 'xi:include', 'entity' or 'pi'
 */

/**
 * @typedef {Object} XmlReferenceEntry A reference of an XML document, whatever it cites
 * @property {string} section Kind of references section it is listed in: 'normative', 'informative'
 *                            or 'unclassified' (any other name, or none)
 * @property {string|null} rfc RFC number, without leading zeros, as for XmlReference
 * @property {string|null} draft Internet-Draft name, with its version if the reference gives one, as for XmlReference
 * @property {string|null} bcp BCP number, without leading zeros
 * @property {string|null} std STD number, without leading zeros
 * @property {boolean|null} external Whether it cites a document that is neither an RFC (numbered or not yet),
 *                            a BCP, an STD nor an Internet-Draft; null when that can't be told, for an included
 *                            file that is not a bibliography entry (e.g. refs/tls.xml)
 * @property {string|null} anchor Its anchor; for an included bibliography entry, the name of the entry
 *                            (e.g. W3C.REC-xml-20081126 for reference.W3C.REC-xml-20081126.xml)
 * @property {string} path Path of the <reference> or include element, e.g. rfc.back.references[0].reference[2];
 *                            for an external entity or <?rfc include?>, that of its <references> element
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
// Any bibliography entry: its series and its name in the series, e.g. reference.W3C.REC-xml-20081126.xml,
// bibxml7/reference.DOI.10.6028/NIST.SP.800-185.xml
const bibliographyTargetRgx = /(?:^|\/)reference\.([A-Za-z0-9-]+)\.(.+?)(?:\.xml)?$/i
// The DOI of an RFC
const rfcDoiRgx = /^10\.17487\/RFC0*(\d+)$/i
// A link to a draft or an RFC, as the text parser finds them in a references entry (lib/parsers/txt.mjs)
const targetDraftRgx = /\bdraft-[a-z0-9]+(?:-[a-z0-9]+)+/i
const targetRfcRgx = /\bRFC[\s-]?0*\d{1,5}\b/i
// Series of RFCs and Internet-Drafts, as <seriesInfo> names and bibliography entries name them
const IETF_SERIES = ['RFC', 'INTERNET-DRAFT', 'I-D', 'BCP', 'STD', 'FYI']

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
  } else if (/informat(?:ive|ional) references/i.test(name ?? '')) {
    // "Informational References" is a misspelling the RFC Production Center corrects, as in idnits 2
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
 * Get what an included file cites, from its name: an RFC, an Internet-Draft, a BCP or an STD
 * (reference.RFC.2119.xml, reference.I-D.ietf-foo-bar.xml, bibxml3/draft-foo-bar.xml, reference.BCP.14.xml,
 * reference.STD.0068.xml), or a document from elsewhere (reference.W3C.REC-xml-20081126.xml,
 * reference.IEEE.754-2019.xml, reference.DOI.10.6028/NIST.FIPS.202.xml; but reference.DOI.10.17487/RFC8446.xml
 * is an RFC, if not given as one: rfc and draft are those of parseIncludeTarget())
 *
 * @param {string} target URL or name of the included file
 * @returns {{ rfc: string|null, draft: string|null, bcp: string|null, std: string|null, external: boolean|null, anchor: string|null }}
 *          Cited document; external is null for a file that is not a bibliography entry
 */
function classifyIncludeTarget (target) {
  const { rfc, draft } = parseIncludeTarget(target)
  const entry = String(target ?? '').trim().replace(/[?#].*$/, '').match(bibliographyTargetRgx)
  const series = entry?.[1].toUpperCase()
  const number = entry?.[2].match(/^0*(\d+)$/)?.[1] ?? null
  const bcp = series === 'BCP' ? number : null
  const std = series === 'STD' ? number : null
  const rfcDoi = series === 'DOI' && rfcDoiRgx.test(entry[2])
  const known = Boolean(rfc || draft || bcp || std || rfcDoi || IETF_SERIES.includes(series))
  return {
    rfc,
    draft,
    bcp,
    std,
    external: known ? false : (entry ? true : null),
    anchor: entry ? `${entry[1]}.${entry[2]}` : draft
  }
}

/**
 * Get what a <reference> cites: its RFC and draft (see parseReference()), its BCP and STD from its <seriesInfo>,
 * failing that the bibliography entry it includes, and failing that its anchor, and whether it cites a document that is none of these, nor an RFC still to be
 * numbered (<seriesInfo name="RFC" value="XXXX"/>), given by its DOI only, by a link, by a draft name in another
 * <seriesInfo>, or by the bibliography entry it includes (<reference><xi:include href=".../reference.RFC.6085.xml"
 * xpointer="xpointer(/reference/*)"/></reference>)
 *
 * @param {Object} reference <reference> element
 * @returns {{ rfc: string|null, draft: string|null, bcp: string|null, std: string|null, external: boolean }} Cited document
 */
function classifyReference (reference) {
  const included = classifyInnerIncludes(reference)
  const { rfc, draft } = parseReference(reference, included)
  const seriesInfo = [...toArray(reference.seriesInfo), ...toArray(reference.front?.seriesInfo)].filter(si => si?._attr)
  const seriesName = si => String(si._attr.name ?? '').trim().toUpperCase()
  const seriesNumber = name => {
    const value = seriesInfo.find(si => seriesName(si) === name)?._attr.value
    return String(value ?? '').trim().replace(new RegExp(`^${name}\\s*`, 'i'), '').match(/^0*(\d+)$/)?.[1] ?? null
  }
  const anchor = String(reference._attr?.anchor ?? '').trim()
  const includedNumber = name => included.find(include => include[name])?.[name]
  const bcp = seriesNumber('BCP') ?? includedNumber('bcp') ?? anchor.match(/^BCP0*(\d+)$/i)?.[1] ?? null
  const std = seriesNumber('STD') ?? includedNumber('std') ?? anchor.match(/^STD0*(\d+)$/i)?.[1] ?? null
  const rfcDoi = seriesInfo.some(si => seriesName(si) === 'DOI' && rfcDoiRgx.test(String(si._attr.value ?? '').trim()))
  const ietfSeries = seriesInfo.some(si => IETF_SERIES.includes(seriesName(si)))
  // -> A reference written by hand may give no <seriesInfo>, only an I-D. anchor or a link to the
  //    draft or the RFC, which its rendering shows, e.g. https://datatracker.ietf.org/doc/draft-foo-bar/
  const target = String(reference._attr?.target ?? '')
  const ietfLink = /^I-D\./i.test(anchor) || targetDraftRgx.test(target) || targetRfcRgx.test(target)
  // -> A draft named in a <seriesInfo> of another name, e.g. <seriesInfo name="Work in Progress," value="draft-foo-bar-05"/>
  const draftSeries = seriesInfo.some(si => targetDraftRgx.test(String(si._attr.value ?? '')))
  const ietfInclude = included.some(include => include.external === false)
  return { rfc, draft, bcp, std, external: !rfc && !draft && !bcp && !std && !rfcDoi && !ietfSeries && !ietfLink && !draftSeries && !ietfInclude }
}

/**
 * Classify the bibliography entries a <reference> pulls its content from with xi:include and an xpointer,
 * e.g. <reference anchor="MCinUC"><xi:include href=".../reference.RFC.6085.xml" xpointer="xpointer(/reference/*)"/></reference>
 *
 * @param {Object} reference <reference> element
 * @returns {Array<ReturnType<typeof classifyIncludeTarget>>} What each include cites, see classifyIncludeTarget()
 */
function classifyInnerIncludes (reference) {
  return Object.entries(reference)
    .filter(([key]) => /^[^:]+:include$/.test(key))
    .flatMap(([, value]) => toArray(value))
    .map(include => classifyIncludeTarget(include?._attr?.href))
}

/**
 * Get the RFC and draft cited by a <reference>, from its <seriesInfo>, failing that the bibliography entry
 * it includes (see classifyInnerIncludes()), and failing that its anchor
 *
 * @param {Object} reference <reference> element
 * @param {Array<ReturnType<typeof classifyIncludeTarget>>} [included] Its included entries, from classifyInnerIncludes()
 * @returns {{ rfc: string|null, draft: string|null }} Cited document
 */
function parseReference (reference, included = classifyInnerIncludes(reference)) {
  const seriesInfo = [...toArray(reference.seriesInfo), ...toArray(reference.front?.seriesInfo)]
  const seriesValue = name => seriesInfo.find(si => si?._attr?.name === name && si._attr.value)?._attr.value
  const rfcValue = seriesValue('RFC')
  const draftValue = seriesValue('Internet-Draft')

  if (isNil(rfcValue) && isNil(draftValue)) {
    // -> No <seriesInfo> for either, so go by the included entry, whose content the reference takes
    const include = included.find(entry => entry.rfc || entry.draft)
    if (include) {
      return { rfc: include.rfc, draft: include.draft }
    }
    // -> Nor an included entry, so go by the anchor (e.g. RFC2119, I-D.draft-ietf-foo-bar-03)
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
 * @returns {Array<{ section: Object, path: string }>} <references> elements, containers included, with their
 *          path, e.g. rfc.back.references[0].references[1]
 */
function getAllReferencesElements (doc) {
  const elements = []
  const walk = (value, path) => {
    toArray(value).forEach((entry, idx) => {
      // -> An empty <references/> is parsed as an empty string
      const section = isPlainObject(entry) ? entry : {}
      elements.push({ section, path: `${path}[${idx}]` })
      walk(section.references, `${path}[${idx}].references`)
    })
  }
  walk(get(doc, 'data.rfc.back.references'), 'rfc.back.references')
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
  return listXmlReferences(doc)
    .filter(ref => ref.rfc || ref.draft)
    .map(({ section, rfc, draft, source }) => ({ section, rfc, draft, source }))
}

/**
 * List all the references of an XML document, whatever they cite, found as collectXmlReferences() finds
 * them, with what each cites and where it is
 *
 * @example
 * // <references><name>Normative References</name>
 * //   <reference anchor="XML"><front>...</front><seriesInfo name="W3C" value="REC-xml-20081126"/></reference>
 * //   <xi:include href="https://bib.ietf.org/public/rfc/bibxml/reference.RFC.8446.xml"/>
 * // </references>
 * // -> [{ section: 'normative', rfc: null, draft: null, bcp: null, std: null, external: true, anchor: 'XML',
 * //       path: 'rfc.back.references[0].reference[0]', source: 'reference' },
 * //     { section: 'normative', rfc: '8446', draft: null, bcp: null, std: null, external: false, anchor: 'RFC.8446',
 * //       path: 'rfc.back.references[0].xi:include[0]', source: 'xi:include' }]
 *
 * @param {Object} doc Parsed XML document
 * @returns {XmlReferenceEntry[]} References, in document order per section and kind of source
 */
export function listXmlReferences (doc) {
  const elements = getAllReferencesElements(doc)
  const result = elements.map(() => [])

  elements.forEach(({ section, path }, idx) => {
    const kind = getSectionKind(section)
    const groups = toArray(section.referencegroup)
      .map((group, groupIdx) => ({ parent: group, parentPath: `${path}.referencegroup[${groupIdx}]` }))
      .filter(({ parent }) => isPlainObject(parent))
    for (const { parent, parentPath } of [{ parent: section, parentPath: path }, ...groups]) {
      toArray(parent.reference).forEach((reference, refIdx) => {
        if (isPlainObject(reference)) {
          result[idx].push({
            section: kind,
            ...classifyReference(reference),
            anchor: String(reference._attr?.anchor ?? '').trim() || null,
            path: `${parentPath}.reference[${refIdx}]`,
            source: 'reference'
          })
        }
      })
      for (const [key, value] of Object.entries(parent)) {
        if (/^[^:]+:include$/.test(key)) {
          toArray(value).forEach((include, includeIdx) => {
            result[idx].push({
              section: kind,
              ...classifyIncludeTarget(include?._attr?.href),
              path: `${parentPath}.${key}[${includeIdx}]`,
              source: 'xi:include'
            })
          })
        }
      }
    }
  })

  for (const { index, target, source } of findRawIncludes(doc, elements.length)) {
    const { section, path } = elements[index]
    result[index].push({ section: getSectionKind(section), ...classifyIncludeTarget(target), path, source })
  }

  return result.flat()
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
