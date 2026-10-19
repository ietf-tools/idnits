/**
 * @typedef {Object} XmlSourceElement
 * @property {string} name Tag name, with its namespace prefix if any (e.g. xi:include)
 * @property {string} path Path of the element in the parsed tree, as used by findings,
 *                         e.g. rfc.middle.section[1].sourcecode
 * @property {Object} attributes Raw attribute values (entities not decoded), by name
 * @property {XmlSourceElement|null} parent Parent element
 * @property {XmlSourceElement[]} children Child elements, in document order
 * @property {number} start Offset of the < of the start tag
 * @property {number} contentStart Offset just after the start tag
 * @property {number} contentEnd Offset of the < of the end tag (contentStart for an empty element)
 * @property {number} end Offset just after the end tag (or the start tag of an empty element)
 */

/**
 * @typedef {Object} XmlSourceMarkup
 * @property {string} kind 'tag' (start or end tag), 'comment', 'cdata', 'pi' or 'doctype'
 * @property {number} start Offset of the <
 * @property {number} end Offset just after the closing >
 */

/**
 * @typedef {Object} XmlSource
 * @property {XmlSourceElement|null} root Root element
 * @property {XmlSourceElement[]} elements All elements, in document order
 * @property {XmlSourceMarkup[]} markup Tags, comments, CDATA sections, processing instructions
 *                                      and DOCTYPE, in document order
 * @property {function(number): { element: XmlSourceElement|null, markup: XmlSourceMarkup|null }} locate
 *           Innermost element containing an offset, and the markup the offset is in (null in text)
 * @property {function(number): { line: number, pos: number }} position Line (1-based) and
 *           column (1-based, as in other findings) of an offset
 */

const NAME_RGX = /^[^\s/>!?"'=<]+/
const ATTR_RGX = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g

/**
 * Find the end of a start tag, skipping quoted attribute values (which may contain > or tabs).
 * A quote only starts a value after =, so a stray quote elsewhere doesn't swallow the document.
 *
 * @param {string} text XML text
 * @param {number} from Offset just after the <
 * @returns {number} Offset of the closing >, or -1 if there is none
 */
function findTagEnd (text, from) {
  let idx = from
  while (idx < text.length) {
    const char = text[idx]
    if (char === '>') {
      return idx
    } else if (char === '=') {
      let next = idx + 1
      while (/\s/.test(text[next] ?? '')) {
        next++
      }
      const quote = text[next]
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, next + 1)
        if (close >= 0) {
          idx = close + 1
          continue
        }
      }
    }
    idx++
  }
  return -1
}

/**
 * Find the end of a DOCTYPE declaration, skipping its internal subset with the quoted
 * values, comments and processing instructions it may contain
 *
 * @param {string} text XML text
 * @param {number} from Offset just after <!
 * @returns {number} Offset just after the closing >
 */
function findDeclarationEnd (text, from) {
  let depth = 0
  let idx = from
  while (idx < text.length) {
    const char = text[idx]
    if (text.startsWith('<!--', idx)) {
      const close = text.indexOf('-->', idx + 4)
      idx = close < 0 ? text.length : close + 3
      continue
    } else if (text.startsWith('<?', idx)) {
      const close = text.indexOf('?>', idx + 2)
      idx = close < 0 ? text.length : close + 2
      continue
    } else if (char === '"' || char === "'") {
      const close = text.indexOf(char, idx + 1)
      idx = close < 0 ? text.length : close + 1
      continue
    } else if (char === '[') {
      depth++
    } else if (char === ']') {
      depth = Math.max(0, depth - 1)
    } else if (char === '>' && depth === 0) {
      return idx + 1
    }
    idx++
  }
  return text.length
}

/**
 * Parse the attributes of a start tag
 *
 * @param {string} text Start tag text after its name
 * @returns {Object} Raw attribute values by name
 */
function parseAttributes (text) {
  const attributes = {}
  for (const match of text.matchAll(ATTR_RGX)) {
    attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attributes
}

/**
 * Set the path of the children of an element, numbering an element only when its
 * parent has several children with the same name, as the XML parser makes an array of them
 *
 * @param {XmlSourceElement} element Element whose children to set the path of
 */
function setChildPaths (element) {
  const counts = new Map()
  for (const child of element.children) {
    counts.set(child.name, (counts.get(child.name) ?? 0) + 1)
  }
  const seen = new Map()
  for (const child of element.children) {
    const idx = seen.get(child.name) ?? 0
    seen.set(child.name, idx + 1)
    child.path = `${element.path}.${child.name}${counts.get(child.name) > 1 ? `[${idx}]` : ''}`
  }
}

/**
 * Find the last entry of a list sorted by start offset that starts at or before an offset
 *
 * @param {Array<{ start: number }>} list Sorted list
 * @param {number} offset Offset
 * @returns {Object|undefined} Entry
 */
function findLastStartingAt (list, offset) {
  let low = 0
  let high = list.length - 1
  let found
  while (low <= high) {
    const mid = (low + high) >> 1
    if (list[mid].start <= offset) {
      found = list[mid]
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

/**
 * Scan the raw text of an XML document for its elements and markup, keeping their offsets,
 * so that findings can point to the source line of an element. This is not a validating
 * parser: it is lenient with malformed documents (unclosed elements end where an ancestor
 * or the document ends, unmatched end tags are ignored) and doesn't expand entities.
 *
 * @param {string} text XML text
 * @returns {XmlSource} Elements and markup of the document
 */
export function scanXmlSource (text) {
  const elements = []
  const markup = []
  const topLevel = []
  const stack = []

  const closeElements = (fromIdx, contentEnd, end) => {
    while (stack.length > fromIdx) {
      const element = stack.pop()
      element.contentEnd = contentEnd
      element.end = stack.length === fromIdx ? end : contentEnd
    }
  }

  let idx = text.indexOf('<')
  while (idx >= 0 && idx < text.length) {
    let end
    if (text.startsWith('<!--', idx)) {
      const close = text.indexOf('-->', idx + 4)
      end = close < 0 ? text.length : close + 3
      markup.push({ kind: 'comment', start: idx, end })
    } else if (text.startsWith('<![CDATA[', idx)) {
      const close = text.indexOf(']]>', idx + 9)
      end = close < 0 ? text.length : close + 3
      markup.push({ kind: 'cdata', start: idx, end })
    } else if (text.startsWith('<?', idx)) {
      const close = text.indexOf('?>', idx + 2)
      end = close < 0 ? text.length : close + 2
      markup.push({ kind: 'pi', start: idx, end })
    } else if (text.startsWith('<!', idx)) {
      end = findDeclarationEnd(text, idx + 2)
      markup.push({ kind: 'doctype', start: idx, end })
    } else if (text[idx + 1] === '/') {
      const close = text.indexOf('>', idx + 2)
      end = close < 0 ? text.length : close + 1
      markup.push({ kind: 'tag', start: idx, end })
      const name = text.slice(idx + 2, close < 0 ? text.length : close).trim()
      const openIdx = stack.findLastIndex(element => element.name === name)
      if (openIdx >= 0) {
        // -> Elements left open inside it end where it does
        closeElements(openIdx, idx, end)
      }
    } else if (NAME_RGX.test(text.slice(idx + 1, idx + 2))) {
      const close = findTagEnd(text, idx + 1)
      end = close < 0 ? text.length : close + 1
      markup.push({ kind: 'tag', start: idx, end })
      const tagText = text.slice(idx + 1, close < 0 ? text.length : close)
      const name = tagText.match(NAME_RGX)[0]
      const isEmpty = tagText.endsWith('/')
      const parent = stack.at(-1) ?? null
      const element = {
        name,
        path: name,
        attributes: parseAttributes(tagText.slice(name.length, isEmpty ? -1 : undefined)),
        parent,
        children: [],
        start: idx,
        contentStart: end,
        contentEnd: end,
        end
      }
      elements.push(element)
      ;(parent ? parent.children : topLevel).push(element)
      if (!isEmpty) {
        stack.push(element)
      }
    } else {
      // -> A < that doesn't start markup is text in a malformed document
      end = idx + 1
    }
    idx = text.indexOf('<', end)
  }
  closeElements(0, text.length, text.length)

  for (const element of elements) {
    setChildPaths(element)
  }

  let lineStarts = null
  const position = (offset) => {
    if (!lineStarts) {
      lineStarts = [0]
      for (let pos = text.indexOf('\n'); pos >= 0; pos = text.indexOf('\n', pos + 1)) {
        lineStarts.push(pos + 1)
      }
    }
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (lineStarts[mid] <= offset) {
        low = mid
      } else {
        high = mid - 1
      }
    }
    return { line: low + 1, pos: offset - lineStarts[low] + 1 }
  }

  const locate = (offset) => {
    let element = null
    let candidates = topLevel
    for (;;) {
      const child = findLastStartingAt(candidates, offset)
      if (!child || offset >= child.end) {
        break
      }
      element = child
      candidates = child.children
    }
    const item = findLastStartingAt(markup, offset)
    return { element, markup: (item && offset < item.end) ? item : null }
  }

  return {
    root: topLevel[0] ?? null,
    elements,
    markup,
    locate,
    position
  }
}
