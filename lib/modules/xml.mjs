import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { XML_SCHEMA } from '../config/schema.mjs'
import { castArray, get, has, isEqual, isPlainObject, upperFirst } from 'lodash-es'
import { findAllDescendantsWith } from '../helpers/traversal.mjs'
import { scanXmlSource } from '../helpers/xml-source.mjs'
import { DEFAULT_SUBMISSION_TYPE, fetchDatatrackerStream, streamDisplayName, streamFromDraftName, submissionTypeToStream } from '../helpers/stream.mjs'
import { BOILERPLATE_PHRASES } from '../config/boilerplate-phrases.mjs'
import { BOILERPLATE_HTTPS_DATE, RFC_STATUS_OF_MEMO, RFC_STATUS_OF_MEMO_HISTORY, TLP_COPYRIGHT_NOTICE, TLP_COPYRIGHT_NOTICE_HISTORY, TLP_PERIODS } from '../config/xml2rfc-boilerplate.mjs'
import { XMLParser } from 'fast-xml-parser'

// -> Bare numbers in brackets ([1]) are mostly array indices, ASN.1 tags, JSONPath or footnote marks
//    rather than citations, so only the [RFCn] form is matched
const TEXT_RFC_REFS_RE = /\[RFC([0-9]+)\]/gi
// -> Elements whose text is code, quoted or cited rather than the author's prose (SVG is inside <artwork>)
const VERBATIM_TAGS = new Set(['artwork', 'blockquote', 'sourcecode', 'tt', 'reference', 'referencegroup'])
// -> <CODE BEGINS> starting a line of code (<artwork>, <sourcecode>), e.g. after an RFC 8792 folding header
const CODE_BEGINS_LINE_RE = /^\s*<CODE BEGINS>/im
// -> In prose, the marker standing on a line of its own, optionally with a file name, as opposed to
//    prose about the markers (which may wrap so that a line starts with the marker)
const CODE_BEGINS_OWN_LINE_RE = /^\s*<CODE BEGINS>(?:\s+file\s+(?:"[^"\n]*"|\S+))?\s*$/im
// -> Elements whose text is code, where the marker may start any line
const CODE_TAGS = new Set(['artwork', 'sourcecode'])
const LINE_PI_RE = /<\?line [0-9]+\?>/i
// -> xml2rfc's v2-to-v3 conversion turns an <artwork> whose text starts with <CODE BEGINS> into <sourcecode>,
//    keeping the text between the markers (and the file name) only
const CODE_BEGINS_RE = /^\s*(?:<!\[CDATA\[)?\s*(?:<|&lt;)CODE BEGINS(?:>|&gt;)(?:\s+file\s+(?:"|&quot;).*?(?:"|&quot;))?/
const CODE_ENDS_RE = /(?:<|&lt;)CODE ENDS(?:>|&gt;)/
// -> Number of tab positions listed in a finding
const MAX_TAB_LINES = 20

/**
 * Call a function for the text of every element of a parsed tree
 *
 * An element's text is its content when that is a string, or the text runs
 * the parser keeps in #text when the element also has attributes or child
 * elements. Attributes are skipped. The path is that of the element, with the
 * index of repeated sibling elements (e.g. rfc.middle.section[1].t[0]).
 *
 * @param {Object} node Parsed node to walk
 * @param {function(string, string, string, Object)} func Called with the text, the element name, its path
 *   and { mixed, ancestors }: whether the element has child elements, and the elements from the root down
 *   to and including this one ({ tag, attrs })
 * @param {string} [path] Path of the node
 * @param {Object[]} [ancestors] Elements above the node ({ tag, attrs })
 */
function walkElementStrings (node, func, path = '', ancestors = []) {
  for (const [key, value] of Object.entries(node)) {
    if (key === '_attr' || key === '#text') { continue }
    const keyPath = path ? `${path}.${key}` : key
    const entries = Array.isArray(value) ? value.map((entry, idx) => [entry, `${keyPath}[${idx}]`]) : [[value, keyPath]]
    for (const [entry, entryPath] of entries) {
      if (typeof entry === 'string') {
        func(entry, key, entryPath, { mixed: false, ancestors: [...ancestors, { tag: key, attrs: {} }] })
      } else if (isPlainObject(entry)) {
        const chain = [...ancestors, { tag: key, attrs: entry._attr ?? {} }]
        if (typeof entry['#text'] === 'string') {
          const mixed = Object.keys(entry).some(k => k !== '_attr' && k !== '#text')
          func(entry['#text'], key, entryPath, { mixed, ancestors: chain })
        }
        walkElementStrings(entry, func, entryPath, chain)
      }
    }
  }
}

/**
 * Ensure that the document doesn't contain deprecated elements
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function detectDeprecatedElements (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const deprecatedElements = Object.keys(XML_SCHEMA._deprecated)

  // Ignore attributes (e.g. <xref format="...">), only elements can be deprecated
  const entriesFound = findAllDescendantsWith(doc.data.rfc, (v, k) => { return deprecatedElements.includes(k) })
    .filter(entry => !entry.path.includes('_attr'))

  if (entriesFound.length > 0) {
    for (const entry of entriesFound) {
      const schemaElement = XML_SCHEMA._deprecated[entry.key]
      result.push(new ValidationWarning('DEPRECATED_ELEMENT', `The <${entry.key}> element is deprecated. ${schemaElement.suggestion}`, {
        ref: schemaElement.ref,
        path: `rfc.${entry.path.join('.')}`
      }))
    }
  }

  return result
}

// Deprecated attributes that xml2rfc's prep tool adds to prepped XML
const PREP_ADDED_ATTRIBUTES = {
  seriesInfo: ['stream', 'status'],
  figure: ['align', 'suppress-title']
}

/**
 * Ensure that the document doesn't use deprecated attributes
 *
 * Unlike detectDeprecatedElements, this looks into the attributes (_attr) of
 * every element. Each deprecated attribute is reported once per document, with
 * the number of times it is used and the path of its first use: documents in
 * the v2 vocabulary (including kramdown-rfc output, which xml2rfc converts)
 * would otherwise get the same warning for every section, figure or reference.
 *
 * In prepped XML (with a prepTime attribute), the attributes that xml2rfc's
 * prep tool writes itself are not reported, as the author can't act on them:
 * the stream and status of <seriesInfo> (check_series_and_submission_type) and
 * the default align and suppress-title of <figure> (insert_attribute_defaults).
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function detectDeprecatedAttributes (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const isPrepped = Boolean(get(doc, 'data.rfc._attr.prepTime'))
  const found = new Map()

  const walk = (element, tag, path) => {
    if (Array.isArray(element)) {
      element.forEach((entry, idx) => walk(entry, tag, `${path}[${idx}]`))
      return
    }
    if (!isPlainObject(element)) {
      return
    }
    const deprecatedAttrs = Object.hasOwn(XML_SCHEMA._deprecatedAttributes, tag) ? XML_SCHEMA._deprecatedAttributes[tag] : {}
    for (const [attr, value] of Object.entries(element._attr ?? {})) {
      if (Object.hasOwn(deprecatedAttrs, attr) && !(isPrepped && PREP_ADDED_ATTRIBUTES[tag]?.includes(attr))) {
        const key = `${tag} ${attr}`
        if (found.has(key)) {
          found.get(key).count++
        } else {
          found.set(key, { tag, attr, value, path: `${path}._attr.${attr}`, count: 1 })
        }
      }
    }
    for (const [key, child] of Object.entries(element)) {
      if (key === '_attr' || key === '#text') { continue }
      walk(child, key, `${path}.${key}`)
    }
  }

  walk(get(doc, 'data.rfc'), 'rfc', 'rfc')

  for (const { tag, attr, value, path, count } of found.values()) {
    const schemaAttr = XML_SCHEMA._deprecatedAttributes[tag][attr]
    const usage = count > 1 ? ` and is used ${count} times (first: ${attr}="${value}")` : ` (${attr}="${value}")`
    result.push(new ValidationWarning('DEPRECATED_ATTRIBUTE', `The ${attr} attribute of <${tag}> is deprecated${usage}. ${schemaAttr.suggestion}`, {
      ref: schemaAttr.ref,
      path
    }))
  }

  return result
}

// ipr values whose TLP notice (Section 6.c) withholds the right to produce derivative works
const RESTRICTED_IPR_VALUES = ['noModificationTrust200902', 'noDerivativesTrust200902']

/**
 * Get the stream that decides whether a restricted ipr value is allowed
 *
 * This differs from getDocumentStream on purpose: what matters here is the
 * stream Datatracker has, or will give the draft when it is submitted, as
 * Datatracker is to refuse IETF stream documents with these values
 * (ietf-tools/datatracker#4854). So the Datatracker stream comes first, even
 * over a declared non-IETF submissionType (the disagreement itself is reported
 * by validateSubmissionType), then the stream Datatracker gives a draft by its
 * name (draft-ietf-, draft-iab-, draft-irtf-), then a declared non-IETF
 * submissionType. A declared or defaulted IETF says nothing on its own (rfcxml
 * has no way to say "no stream").
 *
 * @param {Object} doc Parsed XML document
 * @param {Object} opts Options
 * @param {boolean} opts.offline Don't ask Datatracker
 * @returns {Promise<Object>} { stream, reason } where stream is the Datatracker stream slug (null if unknown)
 *   and reason the part of the message saying how it was told
 */
async function getIprStream (doc, { offline }) {
  const attrs = get(doc, 'data.rfc._attr', {})
  const rfcNumber = String(attrs.number ?? '').trim()
  const name = doc.docKind === 'rfc'
    ? (/^[0-9]+$/.test(rfcNumber) ? `rfc${Number(rfcNumber)}` : null)
    : attrs.docName
  const docType = doc.docKind === 'rfc' ? 'RFC' : 'draft'

  const existing = (!offline && name) ? await fetchDatatrackerStream(name, { doc, check: 'ipr' }) : null
  if (existing?.stream) {
    return { stream: existing.stream, reason: `Datatracker has this ${docType} in the ${streamDisplayName(existing.stream)} stream` }
  }
  const nameStream = doc.docKind === 'rfc' ? null : streamFromDraftName(name, { ietf: true })
  if (nameStream) {
    return { stream: nameStream, reason: `Datatracker puts a draft named draft-${nameStream}-... in the ${streamDisplayName(nameStream)} stream` }
  }
  const declaredStream = submissionTypeToStream(attrs.submissionType)
  if (declaredStream && declaredStream !== 'ietf') {
    return { stream: declaredStream, reason: `the rfc tag declares the ${streamDisplayName(declaredStream)} stream` }
  }

  const declared = attrs.submissionType
    ? `The rfc tag declares submissionType="${attrs.submissionType}"`
    : `The rfc tag has no submissionType attribute, so the ${docType} is treated as submissionType="${DEFAULT_SUBMISSION_TYPE}"`
  let lookup
  if (offline) {
    lookup = 'its stream was not looked up on Datatracker (offline)'
  } else if (existing) {
    lookup = `Datatracker has no stream for this ${docType} yet`
  } else if (existing === undefined && name) {
    lookup = 'its stream could not be looked up on Datatracker'
  } else {
    lookup = `Datatracker doesn't have this ${docType} yet`
  }
  return { stream: null, reason: `${declared}, and ${lookup}` }
}

/**
 * Validate a document ipr attribute
 *
 * The ipr attribute must be present and have a value xml2rfc knows.
 *
 * noModificationTrust200902 and noDerivativesTrust200902 give the TLP notices
 * withholding the right to produce derivative works (TLP Section 6.c), which
 * an IETF working group needs to work on a document (RFC 5378, Section 3.3).
 * They are fine in the other streams. For the IETF stream (see getIprStream):
 *
 * | Stream                               | normal  | forgive-checklist | submission |
 * |--------------------------------------|---------|-------------------|------------|
 * | IETF (Datatracker or draft-ietf-)    | Error   | Warning           | Error      |
 * | unknown (IETF declared or defaulted) | Warning | Warning           | Warning    |
 * | IAB, IRTF, Independent, Editorial    | -       | -                 | -          |
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {boolean} [opts.offline=false] Don't ask Datatracker for the stream
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateIprAttribute (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []
  const allowedValues = [
    'trust200902',
    'pre5378Trust200902',
    'noModificationTrust200902',
    'noDerivativesTrust200902'
  ]

  const refOpts = {
    ref: 'https://authors.ietf.org/en/required-content#copyright-notice',
    path: 'rfc._attr.ipr'
  }

  const ipr = get(doc, 'data.rfc._attr.ipr')
  if (ipr === undefined) {
    result.push(new ValidationError('MISSING_IPR_ATTRIBUTE', 'The ipr attribute is missing from the <rfc> element.', refOpts))
  } else if (!allowedValues.includes(ipr)) {
    result.push(new ValidationWarning('INVALID_IPR_VALUE', `The ipr attribute "${ipr}" is not a valid value. It should be one of ${allowedValues.join(', ')}.`, refOpts))
  } else if (RESTRICTED_IPR_VALUES.includes(ipr)) {
    const { stream, reason } = await getIprStream(doc, { offline })
    const notice = `The ipr attribute "${ipr}" gives the Trust Legal Provisions notice (Section 6.c) that withholds the right to produce derivative works, and an IETF working group can only work on a document that grants that right (RFC 5378, Section 3.3).`
    const findingOpts = { ref: 'https://www.rfc-editor.org/rfc/rfc5378.html#section-3.3', path: 'rfc._attr.ipr' }
    if (stream === 'ietf') {
      const message = `${notice} ${upperFirst(reason)}, so the notice can't be used. Use ipr="trust200902" (or "pre5378Trust200902").`
      result.push(mode === MODES.FORGIVE_CHECKLIST
        ? new ValidationWarning('FORBIDDEN_IPR_VALUE_FOR_STREAM', message, findingOpts)
        : new ValidationError('FORBIDDEN_IPR_VALUE_FOR_STREAM', message, findingOpts))
    } else if (!stream) {
      const message = `${notice} ${reason}. If the ${doc.docKind === 'rfc' ? 'RFC' : 'draft'} is meant for the IETF stream, use ipr="trust200902" (or "pre5378Trust200902"); if not, declare its stream with the submissionType attribute.`
      result.push(new ValidationWarning('FORBIDDEN_IPR_VALUE_FOR_STREAM', message, findingOpts))
    }
  }

  return result
}

/**
 * Validate a document preptime attribute
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validatePreptimeAttribute (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (has(doc, 'data.rfc._attr.prepTime')) {
    if (mode === MODES.SUBMISSION) {
      result.push(new ValidationError('RFC_PREPTIME_ATTRIBUTE', 'The prepTime attribute should not be present on the <rfc> element.'))
    } else {
      result.push(new ValidationComment('RFC_PREPTIME_ATTRIBUTE', `This document has been prepped by xml2rfc (prepTime="${doc.data.rfc._attr.prepTime}").`, {
        path: 'rfc._attr.prepTime'
      }))
    }
  }

  return result
}

// Attributes that xml2rfc's prep tool (preptool.py) adds, by element ('*' for any element)
const PREP_TOOL_ATTRIBUTES = {
  rfc: ['expiresDate', 'scripts'],
  name: ['slugifiedName'],
  li: ['derivedCounter'],
  xref: ['derivedContent', 'derivedLink'],
  '*': ['pn']
}

// Kinds of prep tool output, in the order they are listed in the finding
const PREP_TOOL_KINDS = [
  'expiresDate attribute on <rfc>',
  'scripts attribute on <rfc>',
  '<link rel="alternate"> element',
  '<boilerplate> element',
  '<toc> element',
  'pn attribute',
  'slugifiedName attribute on <name>',
  'derivedCounter attribute on <li>',
  'derivedContent attribute on <xref>',
  'derivedLink attribute on <xref>',
  'generated Authors\' Addresses section',
  'generated index section'
]

/**
 * Detect output of xml2rfc's prep tool in a document that wasn't prepped
 *
 * A document without a prepTime attribute can still contain what the prep
 * tool adds (pn attributes, <boilerplate>, <toc>, derived attributes, the
 * generated Authors' Addresses and index sections...), most often because it
 * was started from the XML of a published RFC instead of the unprepped XML.
 * All of it is reported in a single finding, with the number of each kind and
 * the path of the first one. Prepped documents (with prepTime) are expected to
 * contain all this and are handled by validatePreptimeAttribute. Attributes
 * that only hold default values (indent, sortRefs, tocDepth...) and
 * originalSrc (which the prep tool removes) are not reported, nor is anything
 * inside a <reference>, as entries copied from a published RFC's references
 * carry derived attributes that the prep tool regenerates.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function detectPrepToolOutput (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const rfc = get(doc, 'data.rfc')

  if (!isPlainObject(rfc) || has(rfc, '_attr.prepTime')) {
    return result
  }

  const counts = new Map()
  let firstPath = null
  const found = (kind, path) => {
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
    firstPath = firstPath ?? path
  }

  const walk = (element, tag, path, parentPath) => {
    if (Array.isArray(element)) {
      element.forEach((entry, idx) => walk(entry, tag, `${path}[${idx}]`, parentPath))
      return
    }
    if (parentPath === 'rfc.front' && ['boilerplate', 'toc'].includes(tag)) {
      found(`<${tag}> element`, path)
    } else if (parentPath === 'rfc' && tag === 'link' && element?._attr?.rel === 'alternate') {
      found('<link rel="alternate"> element', path)
    } else if (parentPath === 'rfc.back' && tag === 'section') {
      const anchor = element?._attr?.anchor ?? ''
      if (anchor === 'authors-addresses') {
        found('generated Authors\' Addresses section', path)
      } else if (anchor.startsWith('rfc.index')) {
        found('generated index section', path)
      }
    }
    if (!isPlainObject(element) || tag === 'reference') {
      return
    }
    const prepAttrs = [...(PREP_TOOL_ATTRIBUTES[tag] ?? []), ...PREP_TOOL_ATTRIBUTES['*']]
    for (const attr of Object.keys(element._attr ?? {})) {
      if (prepAttrs.includes(attr)) {
        found(attr === 'pn' ? 'pn attribute' : `${attr} attribute on <${tag}>`, `${path}._attr.${attr}`)
      }
    }
    for (const [key, child] of Object.entries(element)) {
      if (key === '_attr' || key === '#text') { continue }
      walk(child, key, `${path}.${key}`, path)
    }
  }

  walk(rfc, 'rfc', 'rfc', null)

  if (counts.size > 0) {
    const kinds = PREP_TOOL_KINDS.filter(kind => counts.has(kind)).map(kind => `${kind} (${counts.get(kind)})`)
    const ErrorClass = mode === MODES.SUBMISSION ? ValidationWarning : ValidationComment
    result.push(new ErrorClass('PREP_TOOL_OUTPUT_PRESENT', `This document has no prepTime attribute but contains output of the xml2rfc prep tool: ${kinds.join(', ')}. If it was started from the XML of a published RFC, ask the RFC Editor for the unprepped XML instead, or remove these.`, {
      path: firstPath
    }))
  }

  return result
}

/**
 * Detect <?line 123?> processing instructions
 *
 * kramdown-rfc adds these to every document so that xml2rfc can map its
 * errors back to the source lines, and xml2rfc's prep tool removes them, so
 * they are not reported for a submission.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateLinePI (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  if (LINE_PI_RE.test(doc.body ?? '')) {
    result.push(new ValidationComment('LINE_PI', 'Document contains <?line 123?> processing instruction tags.'))
  }

  return result
}

/**
 * Validate a document code blocks
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateCodeBlocks (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  // -> xml2rfc's v2-to-v3 conversion (element_artwork() in writers/v2v3.py) turns an <artwork> whose
  //    text starts with <CODE BEGINS> into <sourcecode markers="true"> itself
  const version = get(doc, 'data.rfc._attr.version') ?? ''
  const isV2 = String(version) !== '3'

  walkElementStrings(doc.data, (value, tag, path) => {
    // -> Inline markup (e.g. <tt>) around the marker is a mention of it
    if (INLINE_ELEMENTS.has(tag)) { return }
    // -> Artwork that the conversion makes <sourcecode>
    if (isV2 && tag === 'artwork' && /^\s*<CODE BEGINS>/.test(value)) { return }
    if ((CODE_TAGS.has(tag) ? CODE_BEGINS_LINE_RE : CODE_BEGINS_OWN_LINE_RE).test(value)) {
      if (tag === 'sourcecode') {
        result.push(new ValidationWarning('UNNECESSARY_CODE_BEGINS', 'The text inside a <sourcecode> tag contains the string <CODE BEGINS>. This is unnecessary and may duplicate what a presentation format converter will produce.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#sourcecode',
          path
        }))
      } else {
        result.push(new ValidationWarning('MISSING_SOURCECODE_TAG', 'Consider using the <sourcecode> tag instead of <CODE BEGINS> for code blocks.', {
          ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#sourcecode',
          path
        }))
      }
    }
  })

  return result
}

/**
 * Find the text of an element in which xml2rfc expands tabs
 *
 * xml2rfc's prep tool (normalize_whitespace() in writers/preptool.py) warns about tabs and
 * expands them to 8-column tab stops only in <sourcecode> and <artwork type="ascii-art">.
 * The type of <artwork> has no default value (the schema default is empty), so an <artwork>
 * without a type is not one of them. In a document that isn't version 3, the v2-to-v3
 * conversion (element_artwork() in writers/v2v3.py) first turns an <artwork> whose text
 * starts with <CODE BEGINS> into <sourcecode>, keeping the text between the markers, and one
 * with both text and a src attribute into <artwork type="ascii-art">.
 *
 * Only the text before the first child (e.g. a comment) is processed, CDATA sections being
 * part of that text.
 *
 * @param {Object} element Element from scanXmlSource()
 * @param {string} body XML text
 * @param {boolean} isV2 Whether xml2rfc converts the document from v2 first
 * @returns {{ description: string, start: number, end: number }|null} Description of the
 *          element and offsets of its text, or null if xml2rfc doesn't expand tabs in it
 */
function findTabExpandingText (element, body, isV2) {
  let start = element.contentStart
  let end = element.contentEnd
  for (let idx = start; ;) {
    const next = body.indexOf('<', idx)
    if (next < 0 || next >= element.contentEnd) {
      break
    } else if (!body.startsWith('<![CDATA[', next)) {
      end = next
      break
    }
    const close = body.indexOf(']]>', next)
    idx = close < 0 ? element.contentEnd : close + 3
  }
  const text = body.slice(start, end)

  let description
  if (element.name === 'sourcecode') {
    description = '<sourcecode>'
  } else if (element.name !== 'artwork') {
    return null
  } else if (element.attributes.type === 'ascii-art') {
    description = '<artwork type="ascii-art">'
  } else if (!isV2) {
    return null
  } else if (CODE_BEGINS_RE.test(text)) {
    description = '<artwork> (converted to <sourcecode> by xml2rfc as it starts with <CODE BEGINS>)'
    const codeStart = text.match(CODE_BEGINS_RE)[0].length
    const codeEnd = text.slice(codeStart).search(CODE_ENDS_RE)
    if (codeEnd >= 0) {
      end = start + codeStart + codeEnd
    }
    start += codeStart
  } else if (element.attributes.src && text.replace(/<!\[CDATA\[|\]\]>/g, '').trim()) {
    description = '<artwork> (converted to <artwork type="ascii-art"> by xml2rfc as it has both text and a src attribute)'
  } else {
    return null
  }
  return { description, start, end }
}

/**
 * Whether xml2rfc expands a tab of the text of an element. It strips trailing whitespace
 * from each line before looking for tabs, so a tab with nothing but whitespace after it
 * on its line is removed without a warning.
 *
 * @param {string} body XML text
 * @param {number} offset Offset of the tab
 * @param {number} textEnd Offset of the end of the text in which xml2rfc expands tabs
 * @returns {boolean} True if text follows the tab on its line
 */
function isFollowedByText (body, offset, textEnd) {
  let idx = offset + 1
  while (idx < textEnd && body[idx] !== '\n') {
    if (body.startsWith(']]>', idx)) {
      idx += 3
    } else if (body.startsWith('<![CDATA[', idx)) {
      idx += 9
    } else if (/\s/.test(body[idx])) {
      idx++
    } else {
      return true
    }
  }
  return false
}

/**
 * Validate the tabs of an XML document
 *
 * Tabs in the text of <sourcecode> and <artwork type="ascii-art"> are reported once per
 * element, as xml2rfc expands them to 8-column tab stops, which may not be the layout
 * intended. Tabs anywhere else (text, attribute values, between attributes, comments...),
 * and at the end of a line in those elements, are whitespace like any other, and are
 * reported once for the whole document.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateTabs (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const body = doc.body ?? ''

  if (!body.includes('\t')) {
    return result
  }

  const source = scanXmlSource(body)
  const isV2 = source.root?.attributes.version !== '3'
  const inElements = new Map()
  const elsewhere = []
  for (let offset = body.indexOf('\t'); offset >= 0; offset = body.indexOf('\t', offset + 1)) {
    const { element, markup } = source.locate(offset)
    if (element && (!markup || markup.kind === 'cdata')) {
      if (!inElements.has(element)) {
        inElements.set(element, { text: findTabExpandingText(element, body, isV2), tabs: [] })
      }
      const entry = inElements.get(element)
      if (entry.text && offset >= entry.text.start && offset < entry.text.end && isFollowedByText(body, offset, entry.text.end)) {
        entry.tabs.push(source.position(offset))
        continue
      }
    }
    elsewhere.push(source.position(offset))
  }

  for (const [element, { text, tabs }] of inElements) {
    if (tabs.length === 0) {
      continue
    }
    const count = tabs.length > 1 ? `${tabs.length} tabs, first on line ${tabs[0].line}` : `a tab on line ${tabs[0].line}`
    result.push(new ValidationWarning('TABS_IN_CODE', `${text.description} contains ${count}. xml2rfc expands tabs in it to 8-column tab stops, which may not be the intended layout. Replace them with spaces.`, {
      path: element.path,
      lines: tabs.slice(0, MAX_TAB_LINES)
    }))
  }

  if (elsewhere.length > 0) {
    const count = elsewhere.length > 1 ? `${elsewhere.length} tabs that xml2rfc treats as whitespace, first on line ${elsewhere[0].line}` : `a tab that xml2rfc treats as whitespace, on line ${elsewhere[0].line}`
    result.push(new ValidationComment('TABS_AS_WHITESPACE', `Document contains ${count}. xml2rfc only expands tabs, and warns about them, when other text follows them on a line of <sourcecode> or <artwork type="ascii-art">.`, {
      lines: elsewhere.slice(0, MAX_TAB_LINES)
    }))
  }

  return result
}

/**
 * Validate a document for text-like refs
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateTextLikeRefs (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  if (mode === MODES.SUBMISSION) {
    return result
  }

  // -> An RFC citing itself (e.g. [RFC8782] in RFC 8782's IANA tables) isn't a reference to cite with <xref>
  const selfNumber = doc.docKind === 'rfc' ? String(get(doc, 'data.rfc._attr.number', '')).replace(/^0+/, '') : ''

  walkElementStrings(doc.data, (value, tag, path, { ancestors }) => {
    if (ancestors.some(({ tag, attrs }) => VERBATIM_TAGS.has(tag) || (tag === 'spanx' && attrs.style === 'verb'))) {
      return
    }
    const matches = [...value.matchAll(TEXT_RFC_REFS_RE)]
    const found = matches.some(m => {
      const num = m[0].match(/^\[RFC0*([0-9]+)\]$/i)?.[1]
      return !(num && selfNumber && num === selfNumber)
    })
    if (found) {
      result.push(new ValidationWarning('TEXT_DOC_REF', 'Text looks like a typed citation ([RFC1234]). Cite the reference with an <xref> to its anchor instead.', {
        ref: 'https://authors.ietf.org/en/references-in-rfcxml',
        path
      }))
    }
  })

  return result
}

/**
 * Validate a document submission type
 *
 * The declared stream (submissionType, IETF when missing) is checked against
 * the docName prefix and, when online, against the stream Datatracker has for
 * the draft. How serious a Datatracker disagreement is depends on the mode:
 *
 * | Datatracker stream | normal | forgive-checklist | submission |
 * |--------------------|--------|-------------------|------------|
 * | none yet           | Error  | Warning           | Comment    |
 * | different          | Error  | Warning           | Error      |
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @param {boolean} [opts.offline=false] Skip the Datatracker comparison
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateSubmissionType (doc, { mode = MODES.NORMAL, offline = false } = {}) {
  const result = []
  const refOpts = {
    ref: 'https://www.rfc-editor.org/rfc/rfc7841.html',
    path: 'rfc.submissionType'
  }

  const declaredType = get(doc, 'data.rfc._attr.submissionType')
  const submissionType = declaredType ?? DEFAULT_SUBMISSION_TYPE
  const docName = get(doc, 'data.rfc._attr.docName')

  // -> Missing submissionType: xml2rfc defaults to IETF
  if (!declaredType) {
    result.push(new ValidationComment('SUBMISSION_TYPE_MISSING', `The rfc tag has no submissionType attribute, so the document is treated as submissionType="${DEFAULT_SUBMISSION_TYPE}" (the xml2rfc default).`, refOpts))
  }

  // -> Check submissionType value
  const declaredStream = submissionTypeToStream(submissionType)
  if (!declaredStream) {
    result.push(new ValidationError('SUBMISSION_TYPE_INVALID', 'The document stream specified in the rfc tag is invalid. Should be either IETF, IAB, IRTF, independent or editorial.', refOpts))
    return result
  }

  // -> Check docName stream prefix (draft-iab-..., draft-irtf-...) === submissionType
  const nameStream = streamFromDraftName(docName)
  if (nameStream && nameStream !== declaredStream) {
    result.push(new ValidationError('SUBMISSION_TYPE_MISMATCH', `The document stream specified in the rfc tag (submissionType="${submissionType}") doesn't match the ${streamDisplayName(nameStream)} stream implied by the document name ${docName}.`, refOpts))
  }

  // -> Check against the existing doc stream on Datatracker
  if (!offline && docName) {
    const existing = await fetchDatatrackerStream(docName, { doc, check: 'submission type' })
    const declared = declaredType
      ? `The rfc tag declares the ${streamDisplayName(declaredStream)} stream (submissionType="${declaredType}")`
      : `The document is treated as the ${streamDisplayName(declaredStream)} stream`

    // -> Existing version on Datatracker has no stream yet
    if (existing && !existing.stream) {
      const message = `${declared}, but Datatracker has no stream for this draft yet.`
      if (mode === MODES.SUBMISSION) {
        result.push(new ValidationComment('SUBMISSION_TYPE_UNEXPECTED', message, refOpts))
      } else if (mode === MODES.FORGIVE_CHECKLIST) {
        result.push(new ValidationWarning('SUBMISSION_TYPE_UNEXPECTED', message, refOpts))
      } else {
        result.push(new ValidationError('SUBMISSION_TYPE_UNEXPECTED', message, refOpts))
      }
    // -> Existing stream doesn't match submission type
    } else if (existing && existing.stream !== declaredStream) {
      const message = `${declared}, but Datatracker has this draft in the ${streamDisplayName(existing.stream)} stream.`
      if (mode === MODES.FORGIVE_CHECKLIST) {
        result.push(new ValidationWarning('SUBMISSION_TYPE_UNEXPECTED', message, refOpts))
      } else {
        result.push(new ValidationError('SUBMISSION_TYPE_UNEXPECTED', message, refOpts))
      }
    }
  }

  return result
}

// Elements that flow within a paragraph, so a phrase can run across them
const INLINE_ELEMENTS = new Set(['bcp14', 'br', 'cref', 'em', 'eref', 'iref', 'relref', 'spanx', 'strong', 'sub', 'sup', 'tt', 'u', 'vspace', 'xref'])

// Parser keeping the order of text and elements, with the main parser's
// handling of text (CDATA kept as text, comments and PIs dropped, whitespace
// kept), plus decoding of character references such as &#8217; and no
// conversion of numeric text to numbers. Attributes are kept without prefix.
const orderedParser = new XMLParser({
  attributeNamePrefix: '',
  htmlEntities: true,
  ignoreAttributes: false,
  ignorePiTags: true,
  parseTagValue: false,
  preserveOrder: true,
  trimValues: false
})

const INTERNAL_SUBSET_RE = /<!DOCTYPE[^[>]*\[[\s\S]*?\]\s*>/
const COMMENT_RE = /<!--[\s\S]*?-->/g
const PI_RE = /<\?(?!xml\s)[\s\S]*?\?>/g
const CDATA_RE = /(<!\[CDATA\[[\s\S]*?\]\]>)/

/**
 * Convert an entry of the ordered parser output to a node ({ tag, attrs, children }) or a string
 *
 * @param {Object} entry Entry of the ordered parser output
 * @returns {Object|string} Node, or text
 */
function toOrderedNode (entry) {
  if (Object.hasOwn(entry, '#text')) {
    return entry['#text']
  }
  const tag = Object.keys(entry).find(key => key !== ':@')
  return { tag, attrs: entry[':@'] ?? {}, children: entry[tag].map(toOrderedNode) }
}

/**
 * Parse a document again into a tree that keeps the order of text and elements
 *
 * The raw XML is cleaned up as the main parser does (lib/parsers/xml.mjs):
 * comments are removed from the DTD internal subset, external entities
 * (which fast-xml-parser rejects) and their references are removed, and so
 * are processing instructions outside CDATA sections.
 *
 * @param {Object} doc Parsed document, with its raw XML text
 * @returns {Object[]} Root nodes ({ tag, attrs, children }, children being nodes or strings)
 */
function parseOrdered (doc) {
  let body = (doc.body ?? '').replace(INTERNAL_SUBSET_RE, dtd => dtd.replaceAll(COMMENT_RE, ''))
  for (const entity of doc.externalEntities ?? []) {
    body = body.replace(entity.original, '')
  }
  body = body.split(CDATA_RE).map((part, idx) => {
    if (idx % 2 === 1) { return part }
    for (const entity of doc.externalEntities ?? []) {
      part = part.replaceAll(`&${entity.name};`, '')
    }
    return part.replaceAll(PI_RE, '')
  }).join('')

  try {
    return orderedParser.parse(body).map(toOrderedNode)
  } catch {
    return []
  }
}

/**
 * Normalize text for comparison with boilerplate text
 *
 * Whitespace is collapsed and trimmed, quotes and hyphens are straightened.
 * Paragraph breaks (\0, which can't appear in XML) are kept.
 *
 * @param {string} text Text to normalize
 * @returns {string} Normalized text
 */
function normalizeText (text) {
  return text
    .replace(/[\u2018\u2019\u201a\u201b]/g, '\'')
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2010\u2011]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normalize text for comparison with the boilerplate phrases
 *
 * As normalizeText(), ignoring case.
 *
 * @param {string} text Text to normalize
 * @returns {string} Normalized text
 */
export function normalizeBoilerplateText (text) {
  return normalizeText(text).toLowerCase()
}

const NORMALIZED_BOILERPLATE_PHRASES = BOILERPLATE_PHRASES.map(phrase => [phrase, normalizeBoilerplateText(phrase)])

/**
 * Find elements whose text contains phrases of the generated boilerplate
 *
 * The parsed tree doesn't keep the order of text and inline elements, so this
 * works on the tree from parseOrdered(), which does. The text of each
 * element is flattened with that of its inline elements (<xref>, <eref>,
 * <em>...), so that a phrase split by markup still matches, while other child
 * elements are checked on their own. <front><boilerplate> and <reference>
 * elements are skipped.
 *
 * @param {Object[]} roots Root nodes of the document, from parseOrdered()
 * @returns {Object[]} Element name, path and matched phrases of each element, in document order
 */
function findBoilerplateText (roots) {
  const found = []
  const flatten = (node, path) => {
    const counts = {}
    for (const child of node.children) {
      if (typeof child !== 'string') {
        counts[child.tag] = (counts[child.tag] ?? 0) + 1
      }
    }
    const seen = {}
    let text = ''
    for (const child of node.children) {
      if (typeof child === 'string') {
        text += child
        continue
      }
      const idx = seen[child.tag] = (seen[child.tag] ?? -1) + 1
      const childPath = `${path}.${child.tag}${counts[child.tag] > 1 ? `[${idx}]` : ''}`
      if (child.tag === 'reference' || childPath === 'rfc.front.boilerplate') {
        text += '\0'
      } else if (INLINE_ELEMENTS.has(child.tag)) {
        text += flatten(child, childPath)
      } else {
        check(child, childPath)
        text += '\0'
      }
    }
    return text
  }
  const check = (node, path) => {
    const entry = { tag: node.tag, path, phrases: [] }
    found.push(entry)
    const text = normalizeBoilerplateText(flatten(node, path))
    entry.phrases = NORMALIZED_BOILERPLATE_PHRASES.filter(([, normalized]) => text.includes(normalized)).map(([phrase]) => phrase)
  }

  const rfc = roots.find(node => node.tag === 'rfc')
  if (rfc) {
    check(rfc, 'rfc')
  }

  return found.filter(entry => entry.phrases.length > 0)
}

// Length of the excerpts of differing boilerplate paragraphs, in characters
const BOILERPLATE_EXCERPT_LENGTH = 160

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/**
 * Flatten the text of a paragraph of the boilerplate
 *
 * Inline markup is dropped, keeping its text. An <eref> without text is
 * rendered as its target, so that the URLs of the boilerplate are compared.
 *
 * @param {Object} node Node from parseOrdered()
 * @returns {string} Text of the paragraph
 */
function flattenParagraph (node) {
  return node.children.map(child => {
    if (typeof child === 'string') {
      return child
    }
    if (child.tag === 'eref' && child.children.every(c => typeof c === 'string' && !c.trim())) {
      return child.attrs.target ?? ''
    }
    return flattenParagraph(child)
  }).join('')
}

/**
 * Child elements of a node, with their path
 *
 * The path has the index of repeated sibling elements, as in the paths of the
 * parsed tree (e.g. rfc.front.boilerplate.section[1].t[0]).
 *
 * @param {Object} node Node from parseOrdered()
 * @param {string} path Path of the node
 * @returns {Object[]} Child nodes, each with its path
 */
function childElements (node, path) {
  const elements = node.children.filter(child => typeof child !== 'string')
  const counts = {}
  for (const element of elements) {
    counts[element.tag] = (counts[element.tag] ?? 0) + 1
  }
  const seen = {}
  return elements.map(element => {
    const idx = seen[element.tag] = (seen[element.tag] ?? -1) + 1
    return { node: element, path: `${path}.${element.tag}${counts[element.tag] > 1 ? `[${idx}]` : ''}` }
  })
}

/**
 * Text of the paragraphs xml2rfc generates from boilerplate templates
 *
 * Placeholders ({scheme}, {rfc_number}...) are filled in as the prep tool
 * does (str.format()). A missing value makes the prep tool stop, so there is
 * no expected text then.
 *
 * @param {string[]} templates Content of each <t>, from lib/config/xml2rfc-boilerplate.mjs
 * @param {Object} values Values of the placeholders
 * @returns {string[]|null} Normalized text of each paragraph, or null
 */
function expandBoilerplate (templates, values) {
  const paragraphs = []
  for (const template of templates) {
    let missing = false
    const xml = template.replace(/\{(\w+)\}/g, (match, key) => {
      if (!values[key]) {
        missing = true
      }
      return values[key]
    })
    if (missing) {
      return null
    }
    const [t] = orderedParser.parse(`<t>${xml}</t>`).map(toOrderedNode)
    paragraphs.push(normalizeText(flattenParagraph(t)))
  }
  return paragraphs
}

/**
 * Boilerplate templates that xml2rfc generated on a date
 *
 * Published RFCs keep the boilerplate of the xml2rfc release that prepped
 * them, so the text of earlier releases (from the history in
 * lib/config/xml2rfc-boilerplate.mjs) is used for RFCs prepped before the
 * release that changed it.
 *
 * @param {Object} current Current templates (RFC_STATUS_OF_MEMO or TLP_COPYRIGHT_NOTICE)
 * @param {Object[]} history Earlier versions, newest first
 * @param {string[]} keys Keys of the templates (e.g. stream, category and consensus)
 * @param {Object} prep When the document was prepped
 * @param {string} prep.day Date (YYYY-MM-DD) the document was prepped
 * @param {boolean} prep.beforeRelease Whether a release on that day came after the document was prepped
 * @returns {Object|null} Templates and the date of the release that replaced them, if any ({ templates, until }), or null if xml2rfc had none
 */
function boilerplateAt (current, history, keys, { day, beforeRelease }) {
  let templates = get(current, keys)
  let until = null
  for (const entry of history) {
    const slot = (entry.until > day || (beforeRelease && entry.until === day)) && entry.slots.find(s => isEqual(s.keys, keys))
    if (slot) {
      templates = slot.paragraphs
      until = entry.until
    }
  }
  return templates ? { templates, until } : null
}

/**
 * Date of the document, as xml2rfc's prep tool takes it (front_insert_date())
 *
 * The day defaults to the 1st; without a year or month, the prep tool uses
 * today's date.
 *
 * @param {Object} rfc Parsed <rfc> element
 * @returns {string|null} ISO date (YYYY-MM-DD), or null if it isn't a valid date
 */
function prepDate (rfc) {
  const attrs = castArray(get(rfc, 'front.date', []))[0]?._attr ?? {}
  const today = new Date()
  let year = String(attrs.year ?? '').trim()
  let month = String(attrs.month ?? '').trim()
  let day = String(attrs.day ?? '').trim()
  if (month && !/^[0-9]+$/.test(month)) {
    const idx = MONTH_NAMES.findIndex(name => month.length >= 3 && name.startsWith(month.toLowerCase()))
    month = idx >= 0 ? String(idx + 1) : month
  }
  if (!year) {
    year = String(today.getFullYear())
  }
  if (!month) {
    month = String(today.getMonth() + 1)
    day = String(today.getDate())
  }
  if (![year, month, day || '1'].every(v => /^[0-9]+$/.test(v))) {
    return null
  }
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${(day || '1').padStart(2, '0')}`
}

/**
 * Paragraphs of the "Status of This Memo" that xml2rfc's prep tool generates for an RFC
 *
 * The RFC 7841 text is selected by stream, category and consensus as the prep
 * tool does: check_attribute_values() resolves the consensus (yes/no as
 * true/false, "n/a" for the IRTF stream without a <workgroup> and the
 * independent and editorial streams, else the schema default "false" or the
 * only value the stream and category allow), and
 * boilerplate_insert_status_of_memo() picks the text, filling in the RFC
 * number and the <workgroup> as research group name. Combinations that make
 * the prep tool stop have no expected text.
 *
 * @param {Object} rfc Parsed <rfc> element
 * @param {Object} frontNode <front> node from parseOrdered()
 * @param {Object} prep When the document was prepped (see boilerplateAt())
 * @param {Object} values Placeholder values (scheme)
 * @returns {Object|null} Expected paragraphs and the selection ({ paragraphs, description }), or null
 */
function expectedStatusOfMemo (rfc, frontNode, prep, values) {
  const attr = (name) => {
    const value = rfc._attr?.[name]
    if (value === undefined || value === null) { return undefined }
    const trimmed = String(value).trim()
    return trimmed === 'yes' ? 'true' : trimmed === 'no' ? 'false' : trimmed
  }
  // -> insert_attribute_defaults() sets the schema default of submissionType ("IETF")
  const stream = attr('submissionType') ?? 'IETF'
  const category = attr('category')
  const workgroupNode = frontNode?.children.find(child => typeof child !== 'string' && child.tag === 'workgroup')
  if (!Object.hasOwn(RFC_STATUS_OF_MEMO, stream) || !Object.hasOwn(RFC_STATUS_OF_MEMO[stream], category)) {
    return null
  }
  const consensusValues = Object.keys(RFC_STATUS_OF_MEMO[stream][category])
  let consensus = attr('consensus')
  if ((stream === 'IRTF' && !workgroupNode) || stream === 'independent' || stream === 'editorial') {
    consensus = 'n/a'
  } else if (consensus === undefined) {
    consensus = consensusValues.length > 1 ? 'false' : consensusValues[0]
  }
  if (!consensusValues.includes(consensus)) {
    if (!consensusValues.includes('false')) {
      return null
    }
    consensus = 'false'
  }
  // -> workgroup.text: the text before any child element, normalized as by normalize_text_items()
  const group = typeof workgroupNode?.children[0] === 'string' ? workgroupNode.children[0].replace(/\s+/g, ' ').trim() : ''
  const boilerplate = boilerplateAt(RFC_STATUS_OF_MEMO, RFC_STATUS_OF_MEMO_HISTORY, [stream, category, consensus], prep)
  const paragraphs = boilerplate && expandBoilerplate(boilerplate.templates, {
    ...values,
    rfc_number: String(rfc._attr?.number ?? '').trim(),
    group_name: group
  })
  return paragraphs && {
    paragraphs,
    description: `RFC 7841 text${boilerplate.until ? ` of xml2rfc releases before ${boilerplate.until}` : ''} for submissionType="${stream}", category="${category}"${consensus === 'n/a' ? '' : `, consensus="${consensus}"`}`
  }
}

/**
 * Paragraphs of the "Copyright Notice" that xml2rfc's prep tool generates
 *
 * As boilerplate_insert_copyright_notice(): the TLP version is the one in
 * effect on the date of the document (TLP_PERIODS), its text is the one for
 * the IETF stream or the alternative one for the others, followed by the text
 * for a restricted or pre-5378 ipr, and the year is that of the document.
 * Without a TLP in effect or with an ipr other than *trust200902, the prep
 * tool stops, so there is no expected text.
 *
 * @param {Object} rfc Parsed <rfc> element
 * @param {string} date Date of the document
 * @param {Object} prep When the document was prepped (see boilerplateAt())
 * @param {Object} values Placeholder values (scheme)
 * @returns {Object|null} Expected paragraphs and the selection ({ paragraphs, description }), or null
 */
function expectedCopyrightNotice (rfc, date, prep, values) {
  const ipr = String(rfc._attr?.ipr ?? '').trim().toLowerCase()
  const period = TLP_PERIODS.findLast(p => p.from <= date)
  if (!ipr.endsWith('trust200902') || !period) {
    return null
  }
  const stream = String(rfc._attr?.submissionType ?? 'IETF').trim()
  const parts = [period.stream ?? (stream === 'IETF' ? 'IETF' : 'alt')]
  if (ipr.startsWith('nomodification')) {
    parts.push('noModification')
  } else if (ipr.startsWith('noderivatives')) {
    parts.push('noDerivatives')
  } else if (ipr.startsWith('pre5378')) {
    parts.push('pre5378')
  }
  const templates = []
  let until = null
  for (const part of parts) {
    const boilerplate = boilerplateAt(TLP_COPYRIGHT_NOTICE, TLP_COPYRIGHT_NOTICE_HISTORY, [period.tlp, part], prep)
    if (!boilerplate) {
      return null
    }
    templates.push(...boilerplate.templates)
    until = boilerplate.until ?? until
  }
  const paragraphs = expandBoilerplate(templates, { ...values, year: date.slice(0, 4) })
  return paragraphs && {
    paragraphs,
    description: `TLP ${period.tlp} text${until ? ` of xml2rfc releases before ${until}` : ''} for ipr="${rfc._attr.ipr}", submissionType="${stream}" and a document dated ${date}`
  }
}

/**
 * Excerpt of a paragraph around a position
 *
 * @param {string} text Paragraph text
 * @param {number} start Position to start at
 * @returns {string} Excerpt, with ellipses where it was cut
 */
function excerpt (text, start) {
  const end = start + BOILERPLATE_EXCERPT_LENGTH
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`
}

/**
 * Compare the paragraphs of a boilerplate section with the expected ones
 *
 * Paragraphs are compared in order after normalization; a paragraph that is
 * missing or extra is told apart from one that differs by looking one
 * paragraph ahead.
 *
 * @param {Object[]} actual Paragraphs of the section ({ text, path })
 * @param {string[]} expected Expected paragraphs
 * @returns {Object[]} Differences ({ kind: 'differs'|'missing'|'extra', expected, actual, path, index })
 */
function compareParagraphs (actual, expected) {
  const diffs = []
  let i = 0
  let j = 0
  while (i < actual.length || j < expected.length) {
    if (i < actual.length && j < expected.length && actual[i].text === expected[j]) {
      i++
      j++
    } else if (j < expected.length && (i >= actual.length || actual[i].text === expected[j + 1])) {
      diffs.push({ kind: 'missing', expected: expected[j], index: j })
      j++
    } else if (i < actual.length && (j >= expected.length || actual[i + 1]?.text === expected[j])) {
      diffs.push({ kind: 'extra', actual: actual[i].text, path: actual[i].path, index: i })
      i++
    } else {
      diffs.push({ kind: 'differs', expected: expected[j], actual: actual[i].text, path: actual[i].path, index: i })
      i++
      j++
    }
  }
  return diffs
}

// Boilerplate sections of <front><boilerplate>, as found by the prep tool (by name) or by their anchor
const RFC_BOILERPLATE_SECTIONS = [
  {
    code: 'RFC_STATUS_BOILERPLATE_MISMATCH',
    anchor: 'status-of-memo',
    name: 'Status of This Memo',
    ref: 'https://www.rfc-editor.org/rfc/rfc7841.html',
    expected: ({ rfc, frontNode, prep, values }) => expectedStatusOfMemo(rfc, frontNode, prep, values)
  },
  {
    code: 'RFC_COPYRIGHT_BOILERPLATE_MISMATCH',
    anchor: 'copyright',
    name: 'Copyright Notice',
    ref: 'https://trustee.ietf.org/documents/trust-legal-provisions/',
    expected: ({ rfc, date, prep, values }) => date && expectedCopyrightNotice(rfc, date, prep, values)
  }
]

/**
 * Check the <front><boilerplate> of an RFC against the boilerplate xml2rfc generates
 *
 * @param {Object} doc Parsed RFC
 * @param {Object[]} roots Root nodes of the document, from parseOrdered()
 * @param {number} mode Validation mode
 * @returns {Array} List of errors/warnings
 */
function checkRfcBoilerplate (doc, roots, mode) {
  const result = []
  const rfc = doc.data?.rfc
  // -> RFCs are not submitted, and with ipr="none" the prep tool adds no boilerplate
  if (mode === MODES.SUBMISSION || !isPlainObject(rfc) || String(rfc._attr?.ipr ?? '').trim() === 'none') {
    return result
  }
  const Finding = mode === MODES.FORGIVE_CHECKLIST ? ValidationWarning : ValidationError

  const rfcNode = roots.find(node => node.tag === 'rfc')
  const front = rfcNode && childElements(rfcNode, 'rfc').find(child => child.node.tag === 'front')
  const boilerplate = front && childElements(front.node, front.path).find(child => child.node.tag === 'boilerplate')
  if (!boilerplate) {
    if (has(rfc, '_attr.prepTime')) {
      result.push(new Finding('RFC_BOILERPLATE_MISSING', 'This RFC has been prepped by xml2rfc (prepTime attribute), but has no <boilerplate> element in <front>. The "Status of This Memo" and "Copyright Notice" sections are missing.', {
        ref: 'https://www.rfc-editor.org/rfc/rfc7998.html#section-5.4.2',
        path: 'rfc.front'
      }))
    }
    return result
  }

  const date = prepDate(rfc)
  const values = { scheme: date && date < BOILERPLATE_HTTPS_DATE ? 'http' : 'https' }
  // -> The boilerplate of a document not prepped yet will be that of the current xml2rfc
  const prepTime = String(rfc._attr?.prepTime ?? '')
  const prepDay = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(prepTime) ? prepTime.slice(0, 10) : new Date().toISOString().slice(0, 10)
  const sections = childElements(boilerplate.node, boilerplate.path).filter(child => child.node.tag === 'section')
  for (const def of RFC_BOILERPLATE_SECTIONS) {
    // -> The prep time has no time zone, so on the day of an xml2rfc release
    //    the text of the release before is accepted too
    const candidates = [false, true].map(beforeRelease => def.expected({ rfc, frontNode: front.node, date, prep: { day: prepDay, beforeRelease }, values })).filter(Boolean)
    if (candidates.length === 0) {
      continue
    }
    const expected = candidates[0]
    const section = sections.find(({ node }) => {
      const name = childElements(node, '').find(child => child.node.tag === 'name')
      return node.attrs.anchor === def.anchor || normalizeText(name ? flattenParagraph(name.node) : '') === def.name
    })
    if (!section) {
      result.push(new Finding(def.code, `The <boilerplate> element has no "${def.name}" section. Expected the ${expected.description}.`, {
        ref: def.ref,
        path: boilerplate.path
      }))
      continue
    }
    const paragraphs = childElements(section.node, section.path)
      .filter(child => child.node.tag !== 'name')
      .map(child => ({ text: normalizeText(flattenParagraph(child.node)), path: child.path }))
    if (candidates.some(candidate => compareParagraphs(paragraphs, candidate.paragraphs).length === 0)) {
      continue
    }
    for (const diff of compareParagraphs(paragraphs, expected.paragraphs)) {
      let message
      if (diff.kind === 'missing') {
        message = `The "${def.name}" section is missing paragraph ${diff.index + 1} of the ${expected.description}: "${excerpt(diff.expected, 0)}".`
      } else if (diff.kind === 'extra') {
        message = `Paragraph ${diff.index + 1} of the "${def.name}" section is not part of the ${expected.description}: "${excerpt(diff.actual, 0)}".`
      } else {
        // -> Start the excerpts a little before the first difference, at a word boundary
        let at = 0
        while (at < diff.expected.length && diff.expected[at] === diff.actual[at]) { at++ }
        let start = Math.max(0, at - 40)
        if (start > 0) {
          const space = diff.expected.lastIndexOf(' ', start)
          start = space >= 0 ? space + 1 : 0
        }
        message = `Paragraph ${diff.index + 1} of the "${def.name}" section differs from the ${expected.description}. Expected "${excerpt(diff.expected, start)}", found "${excerpt(diff.actual, start)}".`
      }
      result.push(new Finding(def.code, message, {
        ref: def.ref,
        path: diff.path ?? section.path
      }))
    }
  }

  return result
}

/**
 * Validate a document boilerplate
 *
 * This looks for boilerplate that xml2rfc generates
 * (I-D and RFC 7841 status text, TLP copyright text) pasted into the text of
 * the document, most often when it was converted from a text document. It is
 * reported as a Warning, once per element, as a document may quote it on
 * purpose (e.g. one about the boilerplate itself). The ipr attribute is
 * checked by validateIprAttribute.
 *
 * In an RFC with a <front><boilerplate> (prepped RFC XML), the "Status of
 * This Memo" and "Copyright Notice" sections are compared, paragraph by
 * paragraph, with the text xml2rfc's prep tool generates for the document
 * (checkRfcBoilerplate()). A prepped RFC without <boilerplate> is reported too.
 * These are Errors, Warnings in forgive-checklist mode, and not reported in
 * submission mode, as RFCs are not submitted.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateXMLBoilerplate (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const roots = parseOrdered(doc)

  // Check for boilerplate text pasted into the document
  for (const { tag, path, phrases } of findBoilerplateText(roots)) {
    result.push(new ValidationWarning('UNNECESSARY_BOILERPLATE_TEXT', `The text of the <${tag}> element contains boilerplate that xml2rfc generates ("${phrases.join('", "')}"). Unless it is quoted on purpose, consider removing it.`, {
      ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#ipr',
      path
    }))
  }

  // A <boilerplate> element in a draft is reported by detectPrepToolOutput
  if (doc.docKind !== 'rfc') {
    return result
  }

  result.push(...checkRfcBoilerplate(doc, roots, mode))

  return result
}

// -> Width of a line and length of a page of xml2rfc's text output (MAX_WIDTH, and the 48 lines
//    after which paginate() in writers/text.py breaks pages)
const TEXT_LINE_WIDTH = 72
const TEXT_PAGE_LENGTH = 48
// -> Line boundaries of Python's str.splitlines(), used by xml2rfc to split artwork into lines
const SPLITLINES_RE = /\r\n|[\n\r\v\f\x85\u2028\u2029]/
// -> The <CODE BEGINS> artwork that xml2rfc's v2-to-v3 conversion turns into <sourcecode>
//    (element_artwork() in writers/v2v3.py), in parsed text
const PARSED_CODE_BEGINS_RE = /^\s*<CODE BEGINS>(?:\s+file\s+"[^"]*")?([\s\S]*?)(?:<CODE ENDS>[\s\S]*)?$/

/**
 * Joiner of xml2rfc's text writer: the indentation it gives a child element, and whether it
 * reduces that indentation when the element doesn't fit (do_outdent, only set for <artwork>)
 *
 * @param {number} indent Indentation
 * @param {boolean} [outdent=false] Whether the indentation is reduced to fit
 * @returns {{ indent: number, outdent: boolean }} Joiner
 */
function joiner (indent, outdent = false) {
  return { indent, outdent }
}

// -> base_joiners in writers/text.py, used by render_middle() and as the base of set_joiners()
const BASE_JOINERS = { '': joiner(0) }

/**
 * Number of characters of the widest number of an <ol> of n items (num_width() in util/num.py)
 *
 * @param {string} fchar Format character (1, d, a, A, c, C, i, I, o, O, x, X)
 * @param {number} n Number of items
 * @returns {number} Width
 */
function numberWidth (fchar, n) {
  if (/[iI]/.test(fchar)) {
    const roman = (num) => [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
      .reduce((str, [value, letters]) => { while (num >= value) { str += letters; num -= value } return str }, '')
    let width = 0
    for (let i = 1; i <= n; i++) { width = Math.max(width, roman(i).length) }
    return width
  }
  const base = /[aAcC]/.test(fchar) ? 26 : (/[oO]/.test(fchar) ? 8 : (/[xX]/.test(fchar) ? 16 : 10))
  return Math.floor(Math.log(n) / Math.log(base)) + 1
}

/**
 * Indentation xml2rfc gives the content of a list item (render_ol() and render_ul() in
 * writers/text.py): the indent attribute, which the prep tool sets to "adaptive" for <ol> and
 * 3 for <ul> by default (insert_attribute_defaults() in writers/preptool.py), "adaptive"
 * fitting the widest number of the list plus 2
 *
 * @param {Object} node <ol> or <ul> node from parseOrdered()
 * @param {Object} attrs Attributes of the list (after the v2-to-v3 conversion)
 * @returns {number} Indentation
 */
function listIndent (node, attrs) {
  const indent = String(attrs.indent ?? (node.tag === 'ol' ? 'adaptive' : '3')).trim()
  if (/^\d+$/.test(indent)) {
    return parseInt(indent, 10)
  }
  const type = String(attrs.type || '1')
  const spec = type.length > 1 ? type.match(/%([cCdiIoOxX])/) : null
  const fchar = type.length > 1 ? (spec ? spec[1] : 'd') : type
  const format = type.length > 1 ? (spec ? type.replace(spec[0], '%s') : '%s') : '%s.'
  const count = Math.max(1, node.children.filter(child => typeof child !== 'string').length)
  return format.length - 2 + numberWidth(fchar, count) + 2
}

/**
 * Whether a <figure> has art that xml2rfc's v2-to-v3 conversion can put in its place
 * (element_figure() in writers/v2v3.py): an <artwork> anywhere in it, or a <sourcecode>
 *
 * @param {Object} node <figure> node from parseOrdered()
 * @returns {boolean} True if it has
 */
function hasArtwork (node) {
  const hasDescendant = (parent) => parent.children.some(child => typeof child !== 'string' && (child.tag === 'artwork' || hasDescendant(child)))
  return hasDescendant(node) || node.children.some(child => typeof child !== 'string' && child.tag === 'sourcecode')
}

/**
 * Element as xml2rfc's v2-to-v3 conversion (writers/v2v3.py) turns it, for what matters to
 * the indentation of artwork: element_list() turns a <list> into a <ul>, <ol> or <dl> (with
 * the indent of its hangIndent attribute) depending on its style or that of the nearest list
 * it is in, and its <t> into <li> or <dd>; element_figure() removes a <figure> with neither
 * anchor nor title (or with suppress-title="true"), its <artwork> taking its place.
 * The <t> around a block is split (promote()), so the block is no longer in it.
 *
 * @param {Object} node Node from parseOrdered()
 * @param {Object} parent Converted parent ({ tag, style })
 * @returns {{ tag: string, attrs: Object, style?: string }} Converted element, tag "" for an
 *          element that is no longer there
 */
function convertedFromV2 (node, parent) {
  if (node.tag === 'list') {
    const style = String(node.attrs.style ?? '').trim() || parent.style || 'empty'
    if (style === 'hanging') {
      return { tag: 'dl', attrs: { indent: node.attrs.hangIndent }, style }
    } else if (['numbers', 'letters'].includes(style) || style.startsWith('format')) {
      return { tag: 'ol', attrs: { type: style === 'numbers' ? '1' : (style === 'letters' ? 'a' : style.slice('format '.length)) }, style }
    }
    return { tag: 'ul', attrs: {}, style }
  } else if (node.tag === 't' && (parent.tag === 'ul' || parent.tag === 'ol')) {
    return { tag: 'li', attrs: node.attrs, style: parent.style }
  } else if (node.tag === 't' && parent.tag === 'dl') {
    return { tag: 'dd', attrs: node.attrs, style: parent.style }
  } else if (node.tag === 'figure' && ((!node.attrs.anchor && !node.attrs.title) || node.attrs['suppress-title'] === 'true') &&
    hasArtwork(node)) {
    return { tag: '', attrs: node.attrs, style: parent.style }
  }
  return { tag: node.tag, attrs: node.attrs, style: parent.style }
}

/**
 * Find the <artwork> and <sourcecode> that xml2rfc renders in its text output, with the
 * indentation it gives them
 *
 * The indentation follows the joiners of xml2rfc's text writer (writers/text.py): each element
 * is indented by the joiner its parent has for its tag (or the default one), and some elements
 * set the joiners of their content:
 * - render_section(): 3 by default, 3 for <artwork> and <sourcecode>, 0 for <artset>
 * - render_figure(): 0 for <artwork>, <sourcecode> and <artset>
 * - render_ul() and render_ol(): the indentation of the list items by default (see
 *   listIndent()), other joiners (so those of <artwork> and <sourcecode>) being kept
 * - render_dl(): all joiners reset to 0 (set_joiners()), <dd> indented by the indent attribute
 *   of the list (3)
 * - quote_renderer() for <blockquote>: all joiners reset, 3 for <artwork> and <sourcecode>,
 *   and every line prefixed with "|  "
 * - render_aside(): every line prefixed with "   |  "
 * Only <artwork> has joiners that reduce its indentation when it doesn't fit (ljoin()), down
 * to the prefixes of <blockquote> and <aside>: the reduction carries over to the elements it
 * is in. Tables are laid out by column, so art in them gets no indentation here.
 *
 * @param {Object[]} roots Root nodes from parseOrdered()
 * @param {boolean} isV2 Whether xml2rfc converts the document from v2 first
 * @returns {Object[]} Elements: { node, tag, path, text, indent, minIndent }, tag being the tag
 *          that xml2rfc renders (sourcecode for <artwork> converted from <CODE BEGINS>), and
 *          the indentations null in tables
 */
function findRenderedArtwork (roots, isV2) {
  const found = []
  const visit = (node, path, state, parent) => {
    const converted = isV2 ? convertedFromV2(node, parent) : { tag: node.tag, attrs: node.attrs }
    const tag = converted.tag
    if (tag === '' || tag === 't') {
      // -> A removed <figure>, or a <t> out of which xml2rfc moves the blocks (or isn't a block)
      visitChildren(node, path, state, converted.tag === '' ? parent : { ...parent, tag: 't' })
      return
    }
    const j = state.joiners[tag] ?? state.joiners['']
    if (tag === 'artwork' || tag === 'sourcecode') {
      const element = artworkText(node, isV2)
      if (element) {
        const renderedJoiner = state.joiners[element.tag] ?? state.joiners['']
        const indent = state.inTable ? null : state.removable + renderedJoiner.indent + state.fixed
        const minIndent = state.inTable ? null : (element.tag === 'artwork' && renderedJoiner.outdent ? state.fixed : indent)
        found.push({ ...element, path, indent, minIndent })
      }
      return
    }
    const next = { ...state, removable: state.removable + j.indent }
    switch (tag) {
      case 'rfc':
      case 'middle':
      case 'back':
        next.joiners = BASE_JOINERS
        next.removable = 0
        break
      case 'section':
        next.joiners = { ...state.joiners, '': joiner(3), t: joiner(3), section: joiner(0), artset: joiner(0), artwork: joiner(3, true), sourcecode: joiner(3) }
        break
      case 'figure':
        next.joiners = { ...state.joiners, artset: joiner(0), artwork: joiner(0, true), sourcecode: joiner(0) }
        break
      case 'ul':
      case 'ol': {
        const indent = listIndent({ ...node, tag }, converted.attrs)
        next.joiners = { ...state.joiners, '': joiner(indent), li: joiner(0), t: joiner(indent) }
        break
      }
      case 'dl': {
        const indent = String(converted.attrs.indent ?? '').trim()
        next.joiners = { ...BASE_JOINERS, dt: joiner(0), dd: joiner(/^\d+$/.test(indent) ? parseInt(indent, 10) : 3) }
        break
      }
      case 'blockquote':
        next.joiners = { ...BASE_JOINERS, t: joiner(0), artset: joiner(0), artwork: joiner(3, true), sourcecode: joiner(3) }
        next.fixed += 3
        break
      case 'aside':
        next.joiners = { ...state.joiners, t: joiner(0) }
        next.fixed += 6
        break
      case 'table':
      case 'texttable':
        next.inTable = true
        break
      case 'artset': {
        // -> render_artset() only renders the first <artwork type="ascii-art">
        const ascii = childElements(node, path).find(child => child.node.tag === 'artwork' && child.node.attrs.type === 'ascii-art')
        if (ascii) {
          visit(ascii.node, ascii.path, next, { tag: 'artset', style: parent.style })
        }
        return
      }
    }
    visitChildren(node, path, next, { tag, style: converted.style })
  }
  const visitChildren = (node, path, state, parent) => {
    for (const child of childElements(node, path)) {
      visit(child.node, child.path, state, parent)
    }
  }
  const root = roots.find(node => typeof node !== 'string' && node.tag === 'rfc')
  if (root) {
    visit(root, 'rfc', { joiners: BASE_JOINERS, removable: 0, fixed: 0, inTable: false }, { tag: '' })
  }
  return found
}

/**
 * Text of an <artwork> or <sourcecode> as xml2rfc renders it: none for art from a file (src),
 * SVG art or art with other elements (such as XInclude), the code between the markers for an
 * <artwork> that the v2-to-v3 conversion turns into <sourcecode>
 *
 * @param {Object} node <artwork> or <sourcecode> node from parseOrdered()
 * @param {boolean} isV2 Whether xml2rfc converts the document from v2 first
 * @returns {{ node: Object, tag: string, text: string }|null} Rendered tag and text, or null
 */
function artworkText (node, isV2) {
  if (node.attrs.src || node.attrs.type === 'svg' || node.children.some(child => typeof child !== 'string')) {
    return null
  }
  let text = node.children.join('')
  let tag = node.tag
  if (isV2 && tag === 'artwork' && /^\s*<CODE BEGINS>/.test(text)) {
    tag = 'sourcecode'
    text = text.match(PARSED_CODE_BEGINS_RE)[1]
  }
  // -> render_artwork(): leading and trailing newlines are removed, empty art is replaced by a note
  text = text.replace(/^\n+|\n+$/g, '')
  if (!text.trim()) {
    return null
  }
  return { node, tag, text }
}

/**
 * Lines of artwork as xml2rfc renders them (render_artwork() in writers/text.py): tabs
 * expanded to 8-column tab stops and trailing whitespace removed (including no-break spaces,
 * which the prep tool removes from <sourcecode> and <artwork type="ascii-art">, and the text
 * writer turns into spaces)
 *
 * @param {string} text Text of the artwork
 * @returns {string[]} Lines
 */
function renderedArtworkLines (text) {
  return text.split(SPLITLINES_RE).map(line => {
    let expanded = ''
    for (const char of line) {
      expanded += char === '\t' ? ' '.repeat(8 - ([...expanded].length % 8)) : char
    }
    return expanded.trimEnd()
  })
}

/**
 * Validate the size of the <artwork> and <sourcecode> of a document
 *
 * xml2rfc's text output has lines of 72 characters, so the lines of art and code, plus the
 * indentation xml2rfc gives them, should fit within that (see findRenderedArtwork()). Lines
 * are measured as for text documents: in Unicode code points, without trailing whitespace,
 * tabs expanded as xml2rfc does. The lines that don't fit are reported once per element. Art
 * longer than a page of the paginated text output (48 lines) is split across pages.
 * Art in SVG or from a file (src) isn't in the text output, so it isn't checked.
 *
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateArtworkSize (doc, { mode = MODES.NORMAL } = {}) {
  const result = []
  const isV2 = String(get(doc, 'data.rfc._attr.version') ?? '') !== '3'

  for (const { node, tag, text, path, indent, minIndent } of findRenderedArtwork(parseOrdered(doc), isV2)) {
    const lines = renderedArtworkLines(text)
    const name = `<${node.tag}>`
    const ref = `https://authors.ietf.org/en/rfcxml-vocabulary#${node.tag}`

    if (minIndent !== null) {
      let count = 0
      let widest = null
      lines.forEach((line, idx) => {
        const width = [...line].length
        if (width + minIndent > TEXT_LINE_WIDTH) {
          count++
          if (!widest || width > widest.width) {
            widest = { width, line: idx + 1 }
          }
        }
      })
      if (count > 0) {
        const where = minIndent === 0
          ? ''
          : (minIndent < indent
              ? `, and xml2rfc can't reduce its indentation below ${minIndent} column${minIndent === 1 ? '' : 's'} there`
              : `, and xml2rfc indents it by ${indent} column${indent === 1 ? '' : 's'} there`)
        const message = `${name} has ${count} line${count === 1 ? '' : 's'} too wide for the ${TEXT_LINE_WIDTH} columns of xml2rfc's text output. The widest, line ${widest.line} of the ${node.tag}, is ${widest.width} characters long${where}.`
        const Finding = mode === MODES.NORMAL ? ValidationError : ValidationWarning
        result.push(new Finding('ARTWORK_TOO_WIDE', message, { ref, path }))
      }
    }

    if (tag === 'artwork' && lines.length > TEXT_PAGE_LENGTH) {
      result.push(new ValidationComment('ARTWORK_TOO_TALL', `${name} has ${lines.length} lines, more than the ${TEXT_PAGE_LENGTH} lines of a page of xml2rfc's paginated text output, so it will be split across pages. Consider splitting it into smaller figures.`, {
        ref,
        path
      }))
    }
  }

  return result
}
