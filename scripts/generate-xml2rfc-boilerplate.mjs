#!/usr/bin/env node
/**
 * Generate lib/config/xml2rfc-boilerplate.mjs, the boilerplate text that
 * xml2rfc's prep tool puts in <front><boilerplate> (lib/modules/xml.mjs checks
 * the boilerplate of prepped RFCs against it).
 *
 * The text is taken from an xml2rfc source tree: the RFC 7841 "Status of This
 * Memo" text (xml2rfc/boilerplate_rfc_7841.py), the Trust Legal Provisions
 * "Copyright Notice" text (xml2rfc/boilerplate_tlp.py) and the I-D "Status of
 * This Memo" text (xml2rfc/boilerplate_id_guidelines.py). The dates on which
 * each version of the TLP applies, and the date from which URLs use https, are
 * taken from the prep tool (xml2rfc/writers/preptool.py), so that a new version
 * of the TLP is picked up by running this script again once xml2rfc has it.
 *
 * Published RFCs keep the boilerplate of the xml2rfc release that prepped them,
 * and xml2rfc has changed some of its text over time (e.g. "Simplified BSD
 * License" to "Revised BSD License" in 3.11.0). So the RFC 7841 and TLP text of
 * earlier versions is taken from the git history of the checkout, back to the
 * first version written as <t> paragraphs (2.17.0, before the first prepped RFC),
 * with the date of the first release that replaced it.
 *
 * The Python source files are never run: a small reader below understands just
 * the constructs they use (literal strings, lists and dicts, assignments of
 * datetime.date() calls and the if/elif chain on the date of the prep tool),
 * and stops with an error on anything else it would have to interpret.
 * Whitespace in the text is collapsed, as the checker compares it after
 * collapsing whitespace anyway. The xml2rfc version and commit are recorded in
 * the generated file.
 *
 * Usage (the checkout needs its full history and tags, so no --depth):
 *   git clone https://github.com/ietf-tools/xml2rfc /path/to/xml2rfc
 *   node scripts/generate-xml2rfc-boilerplate.mjs /path/to/xml2rfc > lib/config/xml2rfc-boilerplate.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Release tags of xml2rfc (cli/2.x.y and cli/3.x.y before the move of the code to the root, v3.x.y after)
const RELEASE_TAG_RE = /^(?:cli\/|v)?[0-9]+\.[0-9]+\.[0-9]+$/

// Whitespace as Python's str.split() and str.strip() see it
const PY_WS = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const PY_WS_RUN_RE = new RegExp(`[${PY_WS}]+`, 'g')
const PY_WS_TRIM_RE = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, 'g')

class ReaderError extends Error {}

/**
 * Stop with an error message, as the script can't go on
 *
 * @param {string} message Error message
 */
function fail (message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Python reader: tokens
// ---------------------------------------------------------------------------

const STRING_START_RE = /^([rRuUbBfF]{0,2})('''|"""|'|")/
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*/
const NUMBER_RE = /^(?:0[xXoObB][0-9a-fA-F_]+|(?:[0-9][0-9_]*)?\.?[0-9][0-9_]*(?:[eE][+-]?[0-9]+)?[jJ]?)/
const OPERATORS = ['**=', '//=', '>>=', '<<=', '...', '->', ':=', '**', '//', '<<', '>>', '<=', '>=', '==', '!=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=',
  '(', ')', '[', ']', '{', '}', ',', ':', '.', ';', '@', '=', '+', '-', '*', '/', '%', '&', '|', '^', '~', '<', '>']

/**
 * Split Python source into tokens, as Python's tokenizer does
 *
 * Tokens are { type, value, line } with type NAME, NUMBER, STRING (value: the
 * raw literal, prefix and quotes included), OP, NEWLINE, INDENT or DEDENT.
 * Comments and blank lines are dropped, and newlines inside brackets or after
 * a backslash join lines.
 *
 * @param {string} source Python source
 * @param {string} where Name of the source, for errors
 * @returns {Object[]} Tokens
 */
function tokenize (source, where) {
  const src = source.replace(/\r\n?/g, '\n')
  const tokens = []
  const indents = [0]
  let depth = 0
  let pos = 0
  let line = 1
  let atLineStart = true
  const error = (message) => { throw new ReaderError(`${where}, line ${line}: ${message}`) }

  while (pos < src.length) {
    if (atLineStart && depth === 0) {
      // -> Indentation of a new logical line (blank and comment lines don't count)
      let col = 0
      let p = pos
      while (p < src.length && (src[p] === ' ' || src[p] === '\t' || src[p] === '\f')) {
        col = src[p] === '\t' ? (Math.floor(col / 8) + 1) * 8 : src[p] === '\f' ? 0 : col + 1
        p++
      }
      if (p >= src.length) { pos = p; break }
      if (src[p] === '\n' || src[p] === '#' || (src[p] === '\\' && src[p + 1] === '\n')) {
        if (src[p] === '#') {
          while (p < src.length && src[p] !== '\n') { p++ }
        }
        if (src[p] === '\\') { p++ }
        pos = p + 1
        line++
        continue
      }
      pos = p
      if (col > indents.at(-1)) {
        indents.push(col)
        tokens.push({ type: 'INDENT', line })
      } else {
        while (col < indents.at(-1)) {
          indents.pop()
          tokens.push({ type: 'DEDENT', line })
        }
        if (col !== indents.at(-1)) { error('inconsistent dedent') }
      }
      atLineStart = false
    }

    const c = src[pos]
    const rest = src.slice(pos, pos + 1024)
    if (c === '\n') {
      if (depth === 0) {
        tokens.push({ type: 'NEWLINE', line })
        atLineStart = true
      }
      pos++
      line++
    } else if (c === ' ' || c === '\t' || c === '\f') {
      pos++
    } else if (c === '#') {
      while (pos < src.length && src[pos] !== '\n') { pos++ }
    } else if (c === '\\' && src[pos + 1] === '\n') {
      pos += 2
      line++
    } else if (STRING_START_RE.test(rest) && (rest.match(STRING_START_RE)[1] === '' || /^[rRuUbBfF]{1,2}['"]/.test(rest))) {
      const [, prefix, quote] = rest.match(STRING_START_RE)
      if (!/^(?:[rRuUbBfF]|[rR][bBfF]|[bBfF][rR])?$/.test(prefix)) { error(`unexpected string prefix ${prefix}`) }
      const raw = /[rR]/.test(prefix)
      let p = pos + prefix.length + quote.length
      const startLine = line
      for (;;) {
        if (p >= src.length) { line = startLine; error('unterminated string') }
        if (src[p] === '\\') {
          if (src[p + 1] === '\n') { line++ }
          p += 2
          continue
        }
        if (src.startsWith(quote, p)) { p += quote.length; break }
        if (src[p] === '\n') {
          if (quote.length === 1) { error('unterminated string') }
          line++
        }
        p++
      }
      tokens.push({ type: 'STRING', value: src.slice(pos, p), prefix, quote, raw, line: startLine })
      pos = p
    } else if (NAME_RE.test(rest)) {
      const [name] = rest.match(NAME_RE)
      tokens.push({ type: 'NAME', value: name, line })
      pos += name.length
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[pos + 1]))) {
      const [number] = rest.match(NUMBER_RE)
      tokens.push({ type: 'NUMBER', value: number, line })
      pos += number.length
    } else {
      const op = OPERATORS.find(o => src.startsWith(o, pos))
      if (!op) { error(`unexpected character ${JSON.stringify(c)}`) }
      if ('([{'.includes(op)) { depth++ }
      if (')]}'.includes(op)) { depth-- }
      if (depth < 0) { error(`unbalanced ${op}`) }
      tokens.push({ type: 'OP', value: op, line })
      pos += op.length
    }
  }
  if (depth !== 0) { error('unbalanced brackets at end of file') }
  if (tokens.length && tokens.at(-1).type !== 'NEWLINE' && tokens.at(-1).type !== 'DEDENT') {
    tokens.push({ type: 'NEWLINE', line })
  }
  while (indents.length > 1) {
    indents.pop()
    tokens.push({ type: 'DEDENT', line })
  }
  return tokens
}

/**
 * Value of a Python string literal (unicode strings only, raw or not)
 *
 * @param {Object} token STRING token
 * @param {string} where Name of the source, for errors
 * @returns {string} Value
 */
function stringValue (token, where) {
  if (/[bBfF]/.test(token.prefix)) {
    throw new ReaderError(`${where}, line ${token.line}: unsupported ${token.prefix} string literal`)
  }
  const body = token.value.slice(token.prefix.length + token.quote.length, -token.quote.length)
  if (token.raw) {
    return body
  }
  const simple = { '\n': '', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }
  return body.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-7]{1,3}|N\{[^}]*\}|[\s\S])/g, (match, esc) => {
    if (Object.hasOwn(simple, esc)) { return simple[esc] }
    if (/^[xuU]/.test(esc) && esc.length > 1) { return String.fromCodePoint(parseInt(esc.slice(1), 16)) }
    if (/^[0-7]+$/.test(esc)) { return String.fromCodePoint(parseInt(esc, 8)) }
    if (esc.startsWith('N{')) {
      throw new ReaderError(`${where}, line ${token.line}: unsupported \\N{} escape`)
    }
    // -> Unknown escapes are kept as they are
    return match
  })
}

// ---------------------------------------------------------------------------
// Python reader: statements
// ---------------------------------------------------------------------------

const COMPOUND_KEYWORDS = new Set(['if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with', 'def', 'class', 'async'])

/**
 * Group tokens into statements
 *
 * A statement is { tokens } for a simple statement, or { keyword, header,
 * body } for a compound statement (header: the tokens between the keyword and
 * its colon, body: statements). Statements separated by semicolons are split.
 *
 * @param {Object[]} tokens Tokens, from tokenize()
 * @param {string} where Name of the source, for errors
 * @returns {Object[]} Statements
 */
function parseStatements (tokens, where) {
  let i = 0
  const error = (message) => { throw new ReaderError(`${where}, line ${tokens[Math.min(i, tokens.length - 1)]?.line}: ${message}`) }

  const simpleStatements = () => {
    // -> Simple statements up to the end of the line, split at semicolons
    const statements = []
    let current = []
    while (i < tokens.length && tokens[i].type !== 'NEWLINE') {
      if (tokens[i].type === 'OP' && tokens[i].value === ';') {
        if (current.length) { statements.push({ tokens: current }) }
        current = []
      } else {
        current.push(tokens[i])
      }
      i++
    }
    if (current.length) { statements.push({ tokens: current }) }
    i++ // -> NEWLINE
    return statements
  }

  const block = (topLevel) => {
    const statements = []
    while (i < tokens.length) {
      const token = tokens[i]
      if (token.type === 'DEDENT') {
        if (topLevel) { error('unexpected dedent') }
        i++
        return statements
      }
      if (token.type === 'INDENT') { error('unexpected indent') }
      if (token.type === 'OP' && token.value === '@') {
        // -> Decorator: skipped
        simpleStatements()
        continue
      }
      if (token.type === 'NAME' && COMPOUND_KEYWORDS.has(token.value)) {
        const keyword = token.value === 'async' ? tokens[++i]?.value : token.value
        i++
        // -> The header ends at the first colon outside brackets
        const header = []
        let depth = 0
        while (i < tokens.length && !(depth === 0 && tokens[i].type === 'OP' && tokens[i].value === ':')) {
          const t = tokens[i]
          if (t.type === 'NEWLINE') { error(`no colon after ${keyword}`) }
          if (t.type === 'NAME' && t.value === 'lambda' && depth === 0) { error(`unsupported lambda in a ${keyword} header`) }
          if (t.type === 'OP' && '([{'.includes(t.value)) { depth++ }
          if (t.type === 'OP' && ')]}'.includes(t.value)) { depth-- }
          header.push(t)
          i++
        }
        i++ // -> colon
        let body
        if (tokens[i]?.type === 'NEWLINE') {
          i++
          if (tokens[i]?.type !== 'INDENT') { error(`expected an indented block after ${keyword}`) }
          i++
          body = block(false)
        } else {
          body = simpleStatements()
        }
        const statement = { keyword, header, body, orelse: [], handlers: [], line: token.line }
        // -> elif, else, except and finally belong to the statement before, as in Python's ast
        const prev = statements.at(-1)
        if (keyword === 'elif' || keyword === 'else' || keyword === 'except' || keyword === 'finally') {
          const owner = prev?.chainTail ?? prev
          if (!owner?.keyword) { error(`unexpected ${keyword}`) }
          if (keyword === 'elif') {
            if (owner.keyword !== 'if') { error('unexpected elif') }
            statement.keyword = 'if'
            owner.orelse = [statement]
            prev.chainTail = statement
          } else if (keyword === 'else') {
            owner.orelse = body
            prev.chainTail = null
          } else {
            owner.handlers.push(statement)
          }
          continue
        }
        statements.push(statement)
        continue
      }
      statements.push(...simpleStatements())
    }
    if (!topLevel) { error('unexpected end of file') }
    return statements
  }

  return block(true)
}

/**
 * Split an assignment statement into its targets and value
 *
 * @param {Object} statement Simple statement
 * @returns {Object|null} { targets (token lists), value (tokens) }, or null if it isn't a plain assignment
 */
function assignment (statement) {
  if (!statement.tokens) { return null }
  const parts = [[]]
  let depth = 0
  for (const t of statement.tokens) {
    if (t.type === 'OP' && '([{'.includes(t.value)) { depth++ }
    if (t.type === 'OP' && ')]}'.includes(t.value)) { depth-- }
    if (depth === 0 && t.type === 'OP' && t.value === '=') {
      parts.push([])
    } else {
      parts.at(-1).push(t)
    }
  }
  if (parts.length < 2) { return null }
  // -> Annotated assignments (x: int = 1) are not plain assignments
  if (parts[0].some(t => t.type === 'OP' && t.value === ':')) { return null }
  return { targets: parts.slice(0, -1), value: parts.at(-1) }
}

const tokensText = (tokens) => tokens.map(t => t.value).join(' ')
const isName = (tokens, name) => tokens.length === 1 && tokens[0].type === 'NAME' && tokens[0].value === name

/**
 * Value of a Python literal: strings (adjacent ones concatenated), lists,
 * tuples and dicts of them, None, True and False
 *
 * Dicts are Maps, keeping the order of their keys (a repeated key keeps its
 * first position and takes its last value, as in Python).
 *
 * @param {Object[]} tokens Tokens of the expression
 * @param {string} where Name of the source, for errors
 * @returns {*} Value
 */
function literalValue (tokens, where) {
  let i = 0
  const error = (message) => { throw new ReaderError(`${where}, line ${tokens[Math.min(i, tokens.length - 1)]?.line}: ${message}`) }
  const isOp = (value) => tokens[i]?.type === 'OP' && tokens[i].value === value
  const expect = (value) => {
    if (!isOp(value)) { error(`expected ${value}, found ${tokens[i]?.value ?? 'end of expression'}`) }
    i++
  }
  const sequence = (close, item) => {
    const items = []
    while (!isOp(close)) {
      items.push(item())
      if (!isOp(close)) { expect(',') }
    }
    i++
    return items
  }
  const value = () => {
    const token = tokens[i]
    if (!token) { error('unexpected end of expression') }
    if (token.type === 'STRING') {
      let text = ''
      while (tokens[i]?.type === 'STRING') {
        text += stringValue(tokens[i], where)
        i++
      }
      return text
    }
    if (token.type === 'NAME' && ['None', 'True', 'False'].includes(token.value)) {
      i++
      return { None: null, True: true, False: false }[token.value]
    }
    if (isOp('[')) {
      i++
      return sequence(']', value)
    }
    if (isOp('(')) {
      i++
      const start = i
      const first = isOp(')') ? null : value()
      if (isOp(')') && start !== i) {
        // -> A parenthesized expression, not a tuple
        i++
        return first
      }
      i = start
      return sequence(')', value)
    }
    if (isOp('{')) {
      i++
      const map = new Map()
      sequence('}', () => {
        const key = value()
        if (typeof key !== 'string') { error('only string keys are supported in dicts') }
        expect(':')
        map.set(key, value())
      })
      return map
    }
    error(`unsupported expression ${token.value}`)
  }
  const result = value()
  if (i !== tokens.length) { error(`unexpected ${tokens[i].value}`) }
  return result
}

/**
 * Value assigned to a name at the top level of a module (the first assignment, as Python's ast finds it)
 *
 * @param {string} source Python source
 * @param {string} where Name of the source, for errors
 * @param {string} name Name assigned
 * @returns {*} Value
 */
function sourceValue (source, where, name) {
  for (const statement of parseStatements(tokenize(source, where), where)) {
    const assign = assignment(statement)
    if (assign && assign.targets.some(target => isName(target, name))) {
      return literalValue(assign.value, where)
    }
  }
  return fail(`${where}: no assignment to ${name}`)
}

function moduleValue (file, name) {
  return sourceValue(readFileSync(file, 'utf8'), file, name)
}

// ---------------------------------------------------------------------------
// Prep tool dates
// ---------------------------------------------------------------------------

/**
 * Statements of a block and of all the blocks nested in it, outer ones first (as ast.walk())
 *
 * @param {Object[]} statements Statements
 * @returns {Object[]} All statements
 */
function walk (statements) {
  const result = []
  let queue = statements
  while (queue.length) {
    result.push(...queue)
    queue = queue.flatMap(s => s.keyword ? [...s.body, ...s.orelse, ...s.handlers] : [])
  }
  return result
}

/**
 * ISO date of a datetime.date(year=..., month=..., day=...) call
 *
 * @param {Object[]} tokens Tokens of the call
 * @param {string} where Name of the source, for errors
 * @returns {string} Date
 */
function dateValue (tokens, where) {
  const text = tokensText(tokens)
  const m = text.match(/^(?:datetime \. )?date \( (.*) \)$/)
  if (!m) { return fail(`${where}: expected a datetime.date() call, found ${text}`) }
  const args = []
  const kwargs = {}
  for (const arg of m[1].split(' , ').filter(a => a && a !== ',')) {
    const kw = arg.match(/^(year|month|day) = ([0-9]+)$/)
    if (kw) {
      kwargs[kw[1]] = Number(kw[2])
    } else if (/^[0-9]+$/.test(arg) && Object.keys(kwargs).length === 0) {
      args.push(Number(arg))
    } else {
      return fail(`${where}: unsupported datetime.date() argument ${arg}`)
    }
  }
  const [year, month, day] = ['year', 'month', 'day'].map((k, idx) => idx < args.length ? args[idx] : kwargs[k])
  const date = new Date(Date.UTC(year, month - 1, day))
  if ([year, month, day].some(v => v === undefined) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return fail(`${where}: invalid date ${text}`)
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Function definition of a module, the outermost first (as ast.walk() finds it)
 *
 * @param {Object[]} statements Statements of the module
 * @param {string} name Function name
 * @param {string} where Name of the source, for errors
 * @returns {Object} Function statement
 */
function findFunction (statements, name, where) {
  const func = walk(statements).find(s => s.keyword === 'def' && s.header[0]?.value === name)
  return func ?? fail(`${where}: no function ${name}`)
}

/**
 * Constant assigned to a name in a block, or null if it is assigned something else
 *
 * @param {Object[]} body Statements of the block
 * @param {string} name Name assigned
 * @param {string} where Name of the source, for errors
 * @returns {string|null} Constant
 */
function assignedConstant (body, name, where) {
  for (const statement of body) {
    const assign = assignment(statement)
    if (assign && assign.targets.some(target => isName(target, name))) {
      const value = assign.value
      if (value.every(t => t.type === 'STRING')) {
        return literalValue(value, where)
      }
      if (isName(value, 'None')) {
        return null
      }
      if (value.length === 1 && (value[0].type === 'NUMBER' || isName(value, 'True') || isName(value, 'False'))) {
        return fail(`${where}: cannot use the constant ${value[0].value} assigned to ${name}`)
      }
      return null
    }
  }
  const first = body[0]
  return fail(`${where}: no assignment to ${name} in ${first?.tokens ? tokensText(first.tokens) : first?.keyword}`)
}

/**
 * The https cutover date and the TLP periods of the prep tool
 *
 * The periods come from the if/elif chain on self.date in
 * boilerplate_insert_copyright_notice(): each branch picks the TLP version
 * ('tlp') and either a fixed copyright text ('stream', e.g. 'n/a') or the
 * text by stream (null). The branch before the first start date stops the
 * prep tool (no copyright text before TLP 2.0).
 *
 * @param {string} file Path of preptool.py
 * @returns {Object} { httpsDate, periods }
 */
function preptoolDates (file) {
  const where = 'preptool.py'
  const statements = parseStatements(tokenize(readFileSync(file, 'utf8'), file), file)

  let httpsDate = null
  for (const statement of walk(findFunction(statements, '__init__', where).body)) {
    const assign = assignment(statement)
    if (assign && tokensText(assign.targets[0]) === 'self . boilerplate_https_date') {
      httpsDate = dateValue(assign.value, where)
    }
  }
  if (!httpsDate) { fail(`${where}: no self.boilerplate_https_date`) }

  const func = findFunction(statements, 'boilerplate_insert_copyright_notice', where)
  const startDates = {}
  for (const statement of walk(func.body)) {
    const assign = assignment(statement)
    const target = assign?.targets[0]
    if (target?.length === 1 && target[0].type === 'NAME' && /^tlp_\w+_start_date$/.test(target[0].value)) {
      startDates[target[0].value] = dateValue(assign.value, where)
    }
  }

  const isDateTest = (s) => s.keyword === 'if' && tokensText(s.header).startsWith('self . date <')
  let node = func.body.find(isDateTest)
  if (!node) { fail(`${where}: no if/elif chain on self.date in boilerplate_insert_copyright_notice`) }
  const periods = []
  let start = null
  for (;;) {
    const test = node.header
    if (!(test.length === 5 && tokensText(test.slice(0, 4)) === 'self . date <' && test[4].type === 'NAME' && Object.hasOwn(startDates, test[4].value))) {
      fail(`${where}: unexpected test ${tokensText(test)}`)
    }
    const end = startDates[test[4].value]
    if (start !== null) {
      periods.push({ from: start, tlp: assignedConstant(node.body, 'tlp', where), stream: assignedConstant(node.body, 'stream', where) })
    }
    start = end
    if (node.orelse.length === 1 && node.orelse[0].keyword === 'if') {
      node = node.orelse[0]
      continue
    }
    periods.push({ from: start, tlp: assignedConstant(node.orelse, 'tlp', where), stream: assignedConstant(node.orelse, 'stream', where) })
    break
  }
  return { httpsDate, periods }
}

// ---------------------------------------------------------------------------
// Boilerplate text
// ---------------------------------------------------------------------------

// Raised where Python would raise NotParagraphs or AttributeError: an older
// version of the boilerplate, not written as <t> paragraphs
class NotParagraphs extends Error {}

/**
 * Content of each <t> of a list of boilerplate paragraphs, whitespace collapsed
 *
 * @param {*} texts List of paragraphs
 * @returns {string[]} Paragraphs
 */
function paragraphs (texts) {
  // -> Iterating a str or a dict, as Python would, yields its characters or keys
  const items = typeof texts === 'string' ? [...texts] : texts instanceof Map ? [...texts.keys()] : texts
  if (!Array.isArray(items)) { throw new NotParagraphs(String(texts)) }
  return items.map(text => {
    if (typeof text !== 'string') { throw new NotParagraphs(String(text)) }
    const collapsed = text.split(PY_WS_RUN_RE).filter(Boolean).join(' ')
    const m = collapsed.match(/^<t>([^\n\r]*)<\/t>$/)
    if (!m) { throw new NotParagraphs(collapsed) }
    return m[1].replace(PY_WS_TRIM_RE, '')
  })
}

/**
 * Apply paragraphs() to the lists of a boilerplate dict, depth levels of keys down
 *
 * @param {*} data Boilerplate dict
 * @param {number} depth Levels of keys
 * @returns {*} Same structure, with paragraphs
 */
function normalize (data, depth) {
  if (depth === 0) { return paragraphs(data) }
  if (!(data instanceof Map)) { throw new NotParagraphs(String(data)) }
  return new Map([...data].map(([key, value]) => [key, normalize(value, depth - 1)]))
}

/**
 * Flatten nested Maps down to depth levels of keys
 *
 * @param {Map} data Normalized boilerplate dict
 * @param {number} depth Levels of keys
 * @param {string[]} [prefix] Keys so far
 * @returns {Map} Paragraphs by keys (joined with \0)
 */
function slots (data, depth, prefix = []) {
  if (depth === 0) { return new Map([[prefix.join('\0'), data]]) }
  const result = new Map()
  for (const [key, value] of data) {
    for (const [k, v] of slots(value, depth - 1, [...prefix, key])) { result.set(k, v) }
  }
  return result
}

const sameParagraphs = (a, b) => a !== undefined && b !== undefined && a.length === b.length && a.every((p, idx) => p === b[idx])
const sameSlots = (a, b) => a.size === b.size && [...a].every(([k, v]) => sameParagraphs(v, b.get(k)))

function git (repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
}

/**
 * Date of the first release that contains a commit
 *
 * @param {string} repo xml2rfc checkout
 * @param {string} commit Commit
 * @returns {string|null} Date
 */
function releaseDate (repo, commit) {
  for (const tag of git(repo, 'tag', '--contains', commit, '--sort=creatordate').split(/\s+/).filter(Boolean)) {
    if (RELEASE_TAG_RE.test(tag)) {
      return git(repo, 'log', '-1', '--format=%cs', tag).trim()
    }
  }
  return null
}

/**
 * The earlier versions of a boilerplate dict, newest first
 *
 * Each entry has the date of the release that replaced the version, the
 * commit that did, and the slots (paragraph lists, by keys) that differ in
 * that version from the one that replaced it (null for a slot it didn't have).
 * Versions not written as <t> paragraphs are left out, as is anything older.
 *
 * @param {string} repo xml2rfc checkout
 * @param {string} name File name
 * @param {string} variable Name of the dict
 * @param {number} depth Levels of keys of the dict
 * @returns {Object[]} History entries
 */
function history (repo, name, variable, depth) {
  const paths = [`xml2rfc/${name}`, `cli/xml2rfc/${name}`]
  const versions = []
  for (const commit of git(repo, 'log', '--format=%H', '--', ...paths).split(/\s+/).filter(Boolean)) {
    let source = null
    let file = null
    for (const p of paths) {
      try {
        source = git(repo, 'show', `${commit}:${p}`)
        file = p
        break
      } catch {
        continue
      }
    }
    if (source === null) {
      continue // -> the commit removed the file at one path (move)
    }
    let data
    try {
      data = slots(normalize(sourceValue(source, `${commit}:${file}`, variable), depth), depth)
    } catch (err) {
      if (err instanceof NotParagraphs) { break }
      throw err
    }
    if (versions.length && sameSlots(versions.at(-1).data, data)) {
      // -> Same text (e.g. a move): the version dates from the oldest commit
      versions[versions.length - 1] = { commit, data }
    } else {
      versions.push({ commit, data })
    }
  }

  const result = []
  for (let idx = 0; idx + 1 < versions.length; idx++) {
    const newer = versions[idx].data
    const older = versions[idx + 1].data
    const changed = []
    for (const [keys, paras] of newer) {
      if (!sameParagraphs(older.get(keys), paras)) {
        changed.push({ keys: keys.split('\0'), paragraphs: older.get(keys) ?? null })
      }
    }
    for (const [keys, paras] of older) {
      if (!newer.has(keys)) {
        changed.push({ keys: keys.split('\0'), paragraphs: paras })
      }
    }
    result.push({ until: releaseDate(repo, versions[idx].commit), commit: versions[idx].commit, slots: changed })
  }
  return result
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * Serialize a value as JavaScript in the style of the code base
 *
 * @param {*} value Value (strings, null, arrays, Maps and plain objects)
 * @param {number} [indent] Indentation level
 * @returns {string} JavaScript
 */
function js (value, indent = 0) {
  const pad = '  '.repeat(indent + 1)
  if (typeof value === 'string') {
    if (value.includes("'") && !value.includes('"')) {
      return `"${value.replaceAll('\\', '\\\\')}"`
    }
    return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
  }
  if (value === null || value === undefined) {
    return 'null'
  }
  if (Array.isArray(value)) {
    if (!value.length) { return '[]' }
    if (value.every(v => typeof v === 'string') && value.reduce((sum, v) => sum + [...v].length + 4, 0) < 60) {
      return `[${value.map(v => js(v)).join(', ')}]`
    }
    return `[\n${value.map(v => pad + js(v, indent + 1)).join(',\n')}\n${'  '.repeat(indent)}]`
  }
  const entries = value instanceof Map ? [...value] : Object.entries(value)
  const key = (k) => /^[A-Za-z_$][\w$]*$/.test(k) ? k : js(k)
  return `{\n${entries.map(([k, v]) => `${pad}${key(k)}: ${js(v, indent + 1)}`).join(',\n')}\n${'  '.repeat(indent)}}`
}

function main () {
  const args = process.argv.slice(2)
  if (args.length !== 1 || args[0].startsWith('-')) {
    fail('Usage: node scripts/generate-xml2rfc-boilerplate.mjs <path to a git checkout of xml2rfc, with its history and tags>')
  }
  const repo = args[0]
  let commit
  try {
    if (git(repo, 'rev-parse', '--is-shallow-repository').trim() !== 'false') {
      fail(`${repo} is a shallow clone: the history of the boilerplate is needed`)
    }
    commit = git(repo, 'rev-parse', 'HEAD').trim()
  } catch {
    fail(`${repo} is not a git checkout of xml2rfc`)
  }
  const pkg = path.join(repo, 'xml2rfc')
  const version = moduleValue(path.join(pkg, '__init__.py'), '__version__')

  let rfcStatus, tlp, draftStatus
  try {
    rfcStatus = normalize(moduleValue(path.join(pkg, 'boilerplate_rfc_7841.py'), 'boilerplate_rfc_status_of_memo'), 3)
    tlp = normalize(moduleValue(path.join(pkg, 'boilerplate_tlp.py'), 'boilerplate_tlp'), 2)
    draftStatus = paragraphs(moduleValue(path.join(pkg, 'boilerplate_id_guidelines.py'), 'boilerplate_draft_status_of_memo'))
  } catch (err) {
    if (err instanceof NotParagraphs) { fail(`Expected a <t> paragraph, found ${err.message}`) }
    throw err
  }
  const { httpsDate, periods } = preptoolDates(path.join(pkg, 'writers', 'preptool.py'))
  const rfcStatusHistory = history(repo, 'boilerplate_rfc_7841.py', 'boilerplate_rfc_status_of_memo', 3)
  const tlpHistory = history(repo, 'boilerplate_tlp.py', 'boilerplate_tlp', 2)
  for (const period of periods) {
    if (!tlp.has(period.tlp)) {
      fail(`preptool.py uses TLP ${period.tlp}, which boilerplate_tlp.py does not have`)
    }
  }

  const out = [
    '/**',
    ' * Boilerplate text that xml2rfc\'s prep tool puts in <front><boilerplate>.',
    ' *',
    ' * GENERATED FILE, do not edit: run scripts/generate-xml2rfc-boilerplate.mjs to regenerate it.',
    ` * From xml2rfc ${version} (commit ${commit}): xml2rfc/boilerplate_rfc_7841.py,`,
    ' * xml2rfc/boilerplate_tlp.py, xml2rfc/boilerplate_id_guidelines.py and the dates',
    ' * in xml2rfc/writers/preptool.py.',
    ' *',
    ' * Each paragraph is the content of a <t> element, whitespace collapsed, with the',
    ' * placeholders of the prep tool: {scheme}, {rfc_number}, {group_name}, {year} and',
    ' * {expiration_date}.',
    ' */',
    `export const XML2RFC_BOILERPLATE_SOURCE = ${js({ version, commit })}`,
    '',
    '// URLs in the boilerplate use https from this date of the document, http before',
    '// (self.boilerplate_https_date in preptool.py)',
    `export const BOILERPLATE_HTTPS_DATE = ${js(httpsDate)}`,
    '',
    '// TLP version of the copyright notice by date of the document, from the first date',
    '// it applies (boilerplate_insert_copyright_notice() in preptool.py). The stream is',
    '// the part of the TLP text used, or null for "IETF" in the IETF stream and "alt" in',
    '// the others. There is no copyright notice before the first date.',
    `export const TLP_PERIODS = ${js(periods)}`,
    '',
    '// RFC 7841 "Status of This Memo" paragraphs, by stream, category and consensus',
    `export const RFC_STATUS_OF_MEMO = ${js(rfcStatus)}`,
    '',
    '// "Copyright Notice" paragraphs, by TLP version and part (stream, "n/a" for all',
    '// streams, or the ipr variant: "noModification", "noDerivatives", "pre5378")',
    `export const TLP_COPYRIGHT_NOTICE = ${js(tlp)}`,
    '',
    '// Earlier versions of RFC_STATUS_OF_MEMO and TLP_COPYRIGHT_NOTICE, newest first:',
    '// the paragraphs (by keys, null where there were none) that xml2rfc generated',
    '// until the release of the given date, which replaced them in the given commit',
    `export const RFC_STATUS_OF_MEMO_HISTORY = ${js(rfcStatusHistory)}`,
    '',
    `export const TLP_COPYRIGHT_NOTICE_HISTORY = ${js(tlpHistory)}`,
    '',
    '// Internet-Draft "Status of This Memo" paragraphs',
    `export const DRAFT_STATUS_OF_MEMO = ${js(draftStatus)}`
  ]
  process.stdout.write(out.join('\n') + '\n')
}

try {
  main()
} catch (err) {
  if (err instanceof ReaderError) { fail(err.message) }
  throw err
}
