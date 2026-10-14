import { isPlainObject } from 'lodash-es'

/**
 * Human-readable names of block elements that can appear in a section,
 * used to describe the position of a finding inside that section.
 */
const ELEMENT_LABELS = {
  artwork: 'artwork',
  aside: 'aside',
  blockquote: 'blockquote',
  dd: 'description',
  dl: 'definition list',
  dt: 'term',
  figure: 'figure',
  li: 'item',
  list: 'list',
  ol: 'list',
  sourcecode: 'source code',
  t: 'paragraph',
  table: 'table',
  texttable: 'table',
  ul: 'list'
}

/**
 * Elements that are only numbered when there is more than one of them in their parent
 */
const NUMBERED_IF_MULTIPLE = ['artwork', 'aside', 'blockquote', 'dl', 'list', 'ol', 'sourcecode', 'ul']

/**
 * Split a finding path into segments, e.g. `rfc.middle.section[1].t[0]` into
 * `[{ key: 'rfc' }, { key: 'middle' }, { key: 'section', index: 1 }, { key: 't', index: 0 }]`.
 * Selectors such as `section[name=Introduction]` produce a `name` instead of an `index`.
 * Dots inside brackets are not treated as separators.
 *
 * @param {string} path Finding path
 * @returns {Object[]} Path segments
 */
export function parsePath (path) {
  const parts = []
  let current = ''
  let depth = 0
  for (const char of path) {
    if (char === '[') {
      depth++
    } else if (char === ']') {
      depth = Math.max(0, depth - 1)
    } else if (char === '.' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)

  return parts.map(part => {
    const match = part.match(/^([^[]*)(?:\[(.*)\])?$/s)
    if (!match) {
      return { key: part }
    }
    const [, key, selector] = match
    if (selector === undefined) {
      return { key }
    } else if (/^\d+$/.test(selector)) {
      return { key, index: Number(selector) }
    } else if (selector.startsWith('name=')) {
      return { key, name: selector.slice(5) }
    } else {
      return { key, invalid: true }
    }
  })
}

/**
 * Get the plain text of an element (string, number or object with a #text property).
 * Text of inline markup (e.g. <tt>) is only used when there is no other text, as the
 * parser doesn't keep track of where it was in the surrounding text.
 *
 * @param {*} value Element value
 * @returns {string} Text content, with whitespace collapsed
 */
function getText (value) {
  let text = ''
  if (typeof value === 'string' || typeof value === 'number') {
    text = String(value)
  } else if (isPlainObject(value)) {
    if (value['#text'] !== undefined) {
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
 * Get the title of a section-like element, from its <name> child or v2 title attribute
 *
 * @param {Object} el Section or references element
 * @returns {string} Title or empty string
 */
function getTitle (el) {
  if (!isPlainObject(el)) {
    return ''
  }
  return getText(el.name) || getText(el._attr?.title)
}

/**
 * Whether a section is numbered
 *
 * @param {Object} el Section element
 * @returns {boolean} False if the section has numbered="false"
 */
function isNumbered (el) {
  const numbered = isPlainObject(el) ? el._attr?.numbered : undefined
  return !(numbered === 'false' || numbered === 'no')
}

/**
 * Resolve a path segment against a parent element
 *
 * @param {Object} parent Parent element
 * @param {Object} segment Path segment
 * @returns {Object|null} { value, siblings, position } or null if it can't be resolved
 */
function resolveSegment (parent, segment) {
  if (!isPlainObject(parent) || segment.invalid || !Object.hasOwn(parent, segment.key)) {
    return null
  }
  const child = parent[segment.key]
  const siblings = Array.isArray(child) ? child : [child]
  let position
  if (segment.index !== undefined) {
    position = segment.index
  } else if (segment.name !== undefined) {
    position = siblings.findIndex(s => getText(s?.name) === segment.name.replace(/\s+/g, ' ').trim())
  } else if (siblings.length === 1) {
    position = 0
  } else {
    // -> Path refers to all elements of that type at once
    return null
  }
  if (position < 0 || position >= siblings.length) {
    return null
  }
  return { value: siblings[position], siblings, position }
}

/**
 * Convert a number to an appendix letter (1 = A, 26 = Z, 27 = AA)
 *
 * @param {number} num Number (1-based)
 * @returns {string} Letter(s)
 */
function toAppendixLetter (num) {
  let result = ''
  while (num > 0) {
    const rem = (num - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    num = Math.floor((num - 1) / 26)
  }
  return result
}

/**
 * Format a section label from its number and title
 *
 * @param {string} prefix "Section" or "Appendix"
 * @param {string[]|null} numbers Section numbers, or null if unnumbered
 * @param {string} title Section title
 * @returns {string} Label
 */
function formatSection (prefix, numbers, title) {
  if (!numbers) {
    return title || `Unnumbered ${prefix.toLowerCase()}`
  }
  return `${prefix} ${numbers.join('.')}${title ? ` (${title})` : ''}`
}

/**
 * Describe block elements (paragraphs, figures, lists...) at the end of a path
 *
 * @param {Object} node Element in which to start
 * @param {Object[]} segments Remaining path segments
 * @returns {string[]} Labels of each resolved element
 */
function describeBlocks (node, segments) {
  const labels = []
  let parentKey = null
  for (const segment of segments) {
    // -> In v2 lists, each <t> child of <list> is a list item
    const name = (parentKey === 'list' && segment.key === 't') ? 'item' : ELEMENT_LABELS[segment.key]
    if (!name) {
      break
    }
    const resolved = resolveSegment(node, segment)
    if (!resolved) {
      break
    }
    if (NUMBERED_IF_MULTIPLE.includes(segment.key) && resolved.siblings.length === 1) {
      labels.push(name)
    } else {
      labels.push(`${name} ${resolved.position + 1}`)
    }
    node = resolved.value
    parentKey = segment.key
  }
  // -> "list, item 3" reads better as "list item 3"
  return labels.reduce((acc, label) => {
    if (acc.length > 0 && /^(list|definition list)$/.test(acc[acc.length - 1]) && /^(item|term|description) \d+$/.test(label)) {
      acc[acc.length - 1] = `${acc[acc.length - 1]} ${label}`
    } else {
      acc.push(label)
    }
    return acc
  }, [])
}

/**
 * Walk nested <section> elements and build their label
 *
 * @param {Object} parent Element containing the first section
 * @param {Object[]} segments Path segments, starting at the first section
 * @param {string} prefix "Section" or "Appendix"
 * @returns {string[]} Label parts
 */
function describeSections (parent, segments, prefix) {
  let node = parent
  let numbers = []
  let title = ''
  let idx = 0
  while (idx < segments.length && segments[idx].key === 'section') {
    const resolved = resolveSegment(node, segments[idx])
    if (!resolved) {
      break
    }
    if (numbers && isNumbered(resolved.value)) {
      const num = resolved.siblings.slice(0, resolved.position + 1).filter(isNumbered).length
      numbers = [...numbers, (prefix === 'Appendix' && numbers.length === 0) ? toAppendixLetter(num) : String(num)]
    } else {
      numbers = null
    }
    title = getTitle(resolved.value)
    node = resolved.value
    idx++
  }
  if (idx === 0) {
    return []
  }
  return [formatSection(prefix, numbers, title), ...describeBlocks(node, segments.slice(idx))]
}

/**
 * Walk nested <references> elements and build their label
 *
 * @param {Object} parent Element containing the first references
 * @param {Object[]} segments Path segments, starting at the first references
 * @returns {string[]} Label parts
 */
function describeReferences (parent, segments) {
  let node = parent
  let title = ''
  let idx = 0
  while (idx < segments.length && segments[idx].key === 'references') {
    const resolved = resolveSegment(node, segments[idx])
    if (!resolved) {
      break
    }
    title = getTitle(resolved.value) || title
    node = resolved.value
    idx++
  }
  if (idx === 0) {
    return []
  }
  const parts = [title || 'References']
  const next = segments[idx]
  if (next && (next.key === 'reference' || next.key === 'referencegroup')) {
    const resolved = resolveSegment(node, next)
    const anchor = resolved?.value?._attr?.anchor
    if (anchor) {
      parts.push(`${next.key === 'reference' ? 'reference' : 'reference group'} [${anchor}]`)
    }
  }
  return parts
}

/**
 * Build a human-readable location label for a finding path in a parsed XML document,
 * e.g. `rfc.middle.section[2].section[1].t[0]` gives `Section 3.2 (Security Considerations), paragraph 1`.
 * Labels end at the deepest part of the path that could be resolved.
 *
 * @param {Object} data Parsed XML tree (doc.data)
 * @param {string} path Finding path, starting with `rfc.`
 * @returns {string|null} Label, or null if no meaningful label can be built
 */
export function getXmlLocationLabel (data, path) {
  if (typeof path !== 'string' || !isPlainObject(data?.rfc)) {
    return null
  }
  const segments = parsePath(path)
  if (segments[0]?.key !== 'rfc') {
    return null
  }
  // -> Some paths repeat the root element (rfc.rfc.middle...)
  let start = 1
  while (segments[start]?.key === 'rfc' && segments[start].index === undefined) {
    start++
  }
  const root = data.rfc
  const area = segments[start]
  const rest = segments.slice(start + 1)
  if (!area || area.index !== undefined || area.name !== undefined || !isPlainObject(root[area.key])) {
    return null
  }
  const node = root[area.key]

  let parts = []
  switch (area.key) {
    case 'front': {
      const child = rest[0]
      const resolved = child ? resolveSegment(node, child) : null
      switch (child?.key) {
        case 'title':
          parts = ['Title']
          break
        case 'date':
          parts = ['Date']
          break
        case 'abstract':
          parts = ['Abstract', ...(resolved ? describeBlocks(resolved.value, rest.slice(1)) : [])]
          break
        case 'note':
          if (resolved) {
            parts = [getTitle(resolved.value) || `Note ${resolved.position + 1}`, ...describeBlocks(resolved.value, rest.slice(1))]
          } else {
            parts = ['Note']
          }
          break
        case 'author': {
          if (resolved) {
            const fullname = getText(resolved.value?._attr?.fullname)
            parts = [`Author ${resolved.position + 1}${fullname ? ` (${fullname})` : ''}`]
          } else {
            parts = ['Authors']
          }
          break
        }
        default:
          parts = ['Front matter']
      }
      break
    }
    case 'middle':
      parts = describeSections(node, rest, 'Section')
      break
    case 'back':
      if (rest[0]?.key === 'section') {
        parts = describeSections(node, rest, 'Appendix')
      } else if (rest[0]?.key === 'references') {
        parts = describeReferences(node, rest)
      }
      break
  }

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Add a human-readable `label` to every finding that has an XML path.
 * Findings that already have a label, or whose path can't be resolved, are left untouched.
 *
 * @param {Object[]} findings Validation results
 * @param {Object} doc Parsed document (only XML documents are labelled)
 * @returns {Object[]} The same findings array
 */
export function labelFindings (findings, doc) {
  if (doc?.type !== 'xml' || !Array.isArray(findings)) {
    return findings
  }
  for (const finding of findings) {
    if (finding?.path && !finding.label) {
      const label = getXmlLocationLabel(doc.data, finding.path)
      if (label) {
        finding.label = label
      }
    }
  }
  return findings
}
