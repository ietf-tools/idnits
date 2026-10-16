import { ValidationComment, ValidationError, ValidationWarning } from '../helpers/error.mjs'
import { MODES } from '../config/modes.mjs'
import { XML_SCHEMA } from '../config/schema.mjs'
import { get, has, isPlainObject, upperFirst } from 'lodash-es'
import { findAllDescendantsWith } from '../helpers/traversal.mjs'
import { scanXmlSource } from '../helpers/xml-source.mjs'
import { DEFAULT_SUBMISSION_TYPE, fetchDatatrackerStream, streamDisplayName, streamFromDraftName, submissionTypeToStream } from '../helpers/stream.mjs'
import { BOILERPLATE_PHRASES } from '../config/boilerplate-phrases.mjs'
import { XMLParser } from 'fast-xml-parser'

const TEXT_REFS_RE = /\[(?:RFC)?[0-9]+\]/gi
const LINE_PI_RE = /<\?line [0-9]+\?>/i
// -> xml2rfc's v2-to-v3 conversion turns an <artwork> whose text starts with <CODE BEGINS> into <sourcecode>,
//    keeping the text between the markers (and the file name) only
const CODE_BEGINS_RE = /^\s*(?:<!\[CDATA\[)?\s*(?:<|&lt;)CODE BEGINS(?:>|&gt;)(?:\s+file\s+(?:"|&quot;).*?(?:"|&quot;))?/
const CODE_ENDS_RE = /(?:<|&lt;)CODE ENDS(?:>|&gt;)/
// -> Number of tab positions listed in a finding
const MAX_TAB_LINES = 20

/**
 * Call a function for every element of a parsed tree whose content is a string
 *
 * Text runs of mixed-content elements (#text) and attributes are skipped. The
 * path is that of the element, with the index of repeated sibling elements
 * (e.g. rfc.middle.section[1].t[0]).
 *
 * @param {Object} node Parsed node to walk
 * @param {function(string, string, string)} func Called with the string, the element name and its path
 * @param {string} [path] Path of the node
 */
function walkElementStrings (node, func, path = '') {
  for (const [key, value] of Object.entries(node)) {
    if (key === '_attr' || key === '#text') { continue }
    const keyPath = path ? `${path}.${key}` : key
    const entries = Array.isArray(value) ? value.map((entry, idx) => [entry, `${keyPath}[${idx}]`]) : [[value, keyPath]]
    for (const [entry, entryPath] of entries) {
      if (typeof entry === 'string') {
        func(entry, key, entryPath)
      } else if (isPlainObject(entry)) {
        walkElementStrings(entry, func, entryPath)
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

  const existing = (!offline && name) ? await fetchDatatrackerStream(name) : null
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

  walkElementStrings(doc.data, (value, tag, path) => {
    if (value.toLowerCase().includes('<code begins>')) {
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

  walkElementStrings(doc.data, (value, tag, path) => {
    if (value.match(TEXT_REFS_RE)) {
      result.push(new ValidationWarning('TEXT_DOC_REF', 'Text occurs that looks like a text-document reference (e.g. [1] or [RFC...]). A reference should instead use an <eref> tag.', {
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
    const existing = await fetchDatatrackerStream(docName)
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
// conversion of numeric text to numbers
const orderedParser = new XMLParser({
  htmlEntities: true,
  ignoreAttributes: true,
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
 * Parse a document again into a tree that keeps the order of text and elements
 *
 * The raw XML is cleaned up as the main parser does (lib/parsers/xml.mjs):
 * comments are removed from the DTD internal subset, external entities
 * (which fast-xml-parser rejects) and their references are removed, and so
 * are processing instructions outside CDATA sections.
 *
 * @param {Object} doc Parsed document, with its raw XML text
 * @returns {Object[]} Root nodes ({ tag, children }, children being nodes or strings)
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

  const toNode = (entry) => {
    if (Object.hasOwn(entry, '#text')) {
      return entry['#text']
    }
    const tag = Object.keys(entry).find(key => key !== ':@')
    return { tag, children: entry[tag].map(toNode) }
  }
  try {
    return orderedParser.parse(body).map(toNode)
  } catch {
    return []
  }
}

/**
 * Normalize text for comparison with the boilerplate phrases
 *
 * Whitespace is collapsed, quotes and hyphens are straightened and case is
 * ignored. Paragraph breaks (\0, which can't appear in XML) are kept.
 *
 * @param {string} text Text to normalize
 * @returns {string} Normalized text
 */
function normalizeBoilerplateText (text) {
  return text
    .replace(/[\u2018\u2019\u201a\u201b]/g, '\'')
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2010\u2011]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

const NORMALIZED_BOILERPLATE_PHRASES = BOILERPLATE_PHRASES.map(phrase => [phrase, normalizeBoilerplateText(phrase)])

/**
 * Find elements whose text contains phrases of the generated boilerplate
 *
 * The parsed tree doesn't keep the order of text and inline elements, so the
 * raw XML is parsed again into a tree that does. The text of each
 * element is flattened with that of its inline elements (<xref>, <eref>,
 * <em>...), so that a phrase split by markup still matches, while other child
 * elements are checked on their own. <front><boilerplate> and <reference>
 * elements are skipped.
 *
 * @param {Object} doc Parsed document, with its raw XML text
 * @returns {Object[]} Element name, path and matched phrases of each element, in document order
 */
function findBoilerplateText (doc) {
  const roots = parseOrdered(doc)

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
 * @param {Object} doc Document to validate
 * @param {Object} [opts] Additional options
 * @param {number} [opts.mode=0] Validation mode to use
 * @returns {Array} List of errors/warnings/comments or empty if fully valid
 */
export async function validateXMLBoilerplate (doc, { mode = MODES.NORMAL } = {}) {
  const result = []

  // Check for boilerplate text pasted into the document
  for (const { tag, path, phrases } of findBoilerplateText(doc)) {
    result.push(new ValidationWarning('UNNECESSARY_BOILERPLATE_TEXT', `The text of the <${tag}> element contains boilerplate that xml2rfc generates ("${phrases.join('", "')}"). Unless it is quoted on purpose, consider removing it.`, {
      ref: 'https://authors.ietf.org/en/rfcxml-vocabulary#ipr',
      path
    }))
  }

  // A <boilerplate> element in a draft is reported by detectPrepToolOutput
  if (doc.docKind !== 'rfc') {
    return result
  }

  // RFC prep checks only going forward

  if (has(doc, 'data.rfc.front.boilerplate')) {
    for (const section of (doc.data.rfc.front.boilerplate.section ?? [])) {
      if (section._attr?.anchor === 'status-of-memo' || section.name?.['#text']?.toLowerCase() === 'status of this memo') {
        // TODO:
      } else if (section._attr?.anchor === 'copyright' || section.name?.['#text']?.toLowerCase() === 'copyright notice') {
        // TODO:
      }
    }
    // console.info(doc.data.rfc.front.boilerplate.section[1].t)
  }

  return result
}
