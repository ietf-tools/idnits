#!/usr/bin/env node

import { Chalk } from 'chalk'
import yargs from 'yargs/yargs'
import { hideBin } from 'yargs/helpers'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pad } from 'lodash-es'
import { readFile } from 'node:fs/promises'
import { satisfies } from 'semver'
import { Listr, ListrDefaultRendererLogLevels } from 'listr2'
import { checkNits, finalizeFindings, getAllValidations, getDocType } from './lib/index.mjs'
import { getModeByName } from './lib/config/modes.mjs'
import { ALLOWED_DOMAINS_DEFAULT } from './lib/config/externals.mjs'
import {
  DATATRACKER_URL_ENV,
  DEFAULT_DATATRACKER_URL,
  DEFAULT_REMOTE_TIMEOUT,
  DEFAULT_RFCEDITOR_URL,
  REMOTE_TIMEOUT_ENV,
  RFCEDITOR_URL_ENV,
  getDatatrackerUrl,
  getRemoteTimeout,
  getRfcEditorUrl,
  normalizeBaseUrl,
  normalizeTimeout,
  setRemoteTimeout,
  setRemoteUrls
} from './lib/config/remote.mjs'

// Get package version
const cliDir = path.dirname(fileURLToPath(import.meta.url))
const pkgInfo = JSON.parse(await readFile(path.join(cliDir, 'package.json'), 'utf8'))

// Check Node.js version against the engines field of package.json
if (!satisfies(process.version, pkgInfo.engines.node)) {
  console.error(`idnits3 requires Node.js ${pkgInfo.engines.node}.`)
  process.exit(1)
}

// A domain label: letters, digits and hyphens, not starting or ending with a hyphen, at most 63 characters
const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i
// xml and txt are document extensions, not top-level domains
const DOCUMENT_EXTENSION_RE = /^(?:xml|txt)$/i

/**
 * Whether a value is a domain name: labels joined by dots (a trailing dot allowed), at most 253 characters,
 * the last label not all digits (an IPv4 address isn't a domain) and not a document extension
 *
 * @param {string} value One element of an --allowed-domains list
 * @returns {boolean} Whether it is a domain name
 */
function isDomainName (value) {
  const name = value.replace(/\.$/, '')
  if (name.length === 0 || name.length > 253) {
    return false
  }
  const labels = name.split('.')
  if (!labels.every(label => DOMAIN_LABEL_RE.test(label))) {
    return false
  }
  const topLabel = labels[labels.length - 1]
  if (/^\d+$/.test(topLabel)) {
    return false
  }
  return !DOCUMENT_EXTENSION_RE.test(topLabel)
}

/**
 * Domains given with --allowed-domains: each occurrence is one argument, a comma-separated list.
 * The lists of every occurrence add up; an empty argument adds no domain.
 *
 * @param {string|string[]} values One argument per occurrence
 * @returns {string[]} Domains, lowercased, without a trailing dot
 */
function parseAllowedDomains (values) {
  const domains = []
  for (const value of [values].flat()) {
    const arg = String(value)
    if (arg === '') {
      continue
    }
    for (const element of arg.split(',')) {
      if (element === '') {
        throw new Error(`--allowed-domains: empty domain in "${arg}". Use --allowed-domains '' for no domain at all.`)
      }
      if (!isDomainName(element)) {
        throw new Error(`--allowed-domains: "${element}" (in "${arg}") is not a domain. Give one comma-separated list per --allowed-domains, e.g. --allowed-domains example.net,example.org`)
      }
      const domain = element.toLowerCase().replace(/\.$/, '')
      domains.push(domain)
    }
  }
  return domains
}

/**
 * For an option that takes one value: when it is given more than once, the last occurrence wins,
 * as for yargs' boolean flags and most command-line tools (so a wrapper's defaults can be overridden).
 * Every occurrence is still checked, by the option's own coerce and against its choices (yargs
 * checks only the value this returns, the last one).
 *
 * @param {Object} [opts]
 * @param {string} [opts.name] Option name, for the error message
 * @param {string[]} [opts.choices] Accepted values
 * @param {Function} [opts.coerce] The option's coerce, applied to each occurrence
 * @returns {Function} Coerce function returning the last occurrence's value
 */
function lastOccurrence ({ name, choices, coerce = val => val } = {}) {
  return (values) => {
    const occurrences = [values].flat()
    const lastIndex = occurrences.length - 1
    let coerced
    for (const [idx, val] of occurrences.entries()) {
      coerced = coerce(val)
      // (yargs checks the last one against the choices, with its usual message)
      if (choices && idx < lastIndex && !choices.includes(coerced)) {
        const accepted = choices.map(choice => `"${choice}"`).join(', ')
        throw new Error(`--${name}: "${val}" is not one of ${accepted}`)
      }
    }
    return coerced
  }
}

// Define CLI arguments config
const argv = yargs(hideBin(process.argv))
  .scriptName('idnits')
  .usage('$0 [args] [--] <file-path|http-url>\n\nParse and validate the document at a path or URL. Words after "--" are never options, so a path starting with "-" can follow it.')
  .example([
    ['$0 draft-ietf-abcd-01.xml', ''],
    [`$0 -m submission -y ${new Date().getFullYear()} draft-ietf-abcd-01.xml`, ''],
    ['$0 https://www.rfc-editor.org/rfc/rfc2549', ''],
    ['$0 --allowed-domains example.net,example.org draft-ietf-abcd-01.xml', '']
  ])
  .option('allowed-domains', {
    describe: `Comma-separated domains that, with their subdomains, get no domain finding. Replaces the default list (${ALLOWED_DOMAINS_DEFAULT.join(',')}); '' means none, so every domain is checked. May be repeated: the lists add up.`,
    coerce: parseAllowedDomains,
    requiresArg: true,
    type: 'string'
  })
  .option('datatracker-url', {
    describe: `Base URL of the Datatracker used for remote lookups (overrides ${DATATRACKER_URL_ENV}, default ${DEFAULT_DATATRACKER_URL})`,
    coerce: lastOccurrence({ coerce: val => normalizeBaseUrl(val, '--datatracker-url') }),
    type: 'string'
  })
  .option('fail-on', {
    describe: 'Exit with code 2 if there is at least one nit of the given severity or higher (errors > warnings > comments).',
    choices: ['errors', 'warnings', 'comments'],
    coerce: lastOccurrence({ name: 'fail-on', choices: ['errors', 'warnings', 'comments'] }),
    type: 'string'
  })
  .option('filter', {
    alias: 'f',
    describe: 'Filter output to only certain severity types. Can be declared multiple times to filter multiple severity types.',
    choices: ['errors', 'warnings', 'comments'],
    default: [],
    nargs: 1,
    type: 'array'
  })
  .option('mode', {
    alias: 'm',
    describe: 'Validation mode to use',
    coerce: lastOccurrence({
      name: 'mode',
      choices: ['normal', 'forgive-checklist', 'submission'],
      coerce: val => {
        try {
          const mode = getModeByName(val)
          return mode.name
        } catch (err) {
          return val
        }
      }
    }),
    choices: ['normal', 'forgive-checklist', 'submission'],
    default: 'normal',
    type: 'string'
  })
  .option('progress', {
    default: true,
    type: 'boolean',
    hidden: true
  })
  .option('no-progress', {
    describe: 'Disable progress messages / animations in pretty output',
    type: 'boolean'
  })
  .option('offline', {
    default: false,
    describe: 'No network access: skip every remote lookup (the document\'s own and those of its references) and the checks that need them',
    type: 'boolean'
  })
  .option('output', {
    alias: 'o',
    describe: 'Output format',
    choices: ['pretty', 'simple', 'json', 'count'],
    coerce: lastOccurrence({ name: 'output', choices: ['pretty', 'simple', 'json', 'count'] }),
    default: 'pretty',
    type: 'string'
  })
  .option('remote-timeout', {
    describe: `Seconds allowed for each remote lookup before it fails (overrides ${REMOTE_TIMEOUT_ENV}, default ${DEFAULT_REMOTE_TIMEOUT})`,
    coerce: lastOccurrence({ coerce: val => normalizeTimeout(val, '--remote-timeout') }),
    type: 'string'
  })
  .option('rfceditor-url', {
    describe: `Base URL of the RFC Editor site used for remote lookups (overrides ${RFCEDITOR_URL_ENV}, default ${DEFAULT_RFCEDITOR_URL})`,
    coerce: lastOccurrence({ coerce: val => normalizeBaseUrl(val, '--rfceditor-url') }),
    type: 'string'
  })
  .option('solarized', {
    default: false,
    describe: 'Use alternate colors for a solarized light themed terminal',
    type: 'boolean'
  })
  .option('color', {
    default: true,
    type: 'boolean',
    hidden: true
  })
  .option('no-color', {
    describe: 'Disable color in pretty output',
    type: 'boolean'
  })
  .option('year', {
    alias: 'y',
    describe: 'Expect the given year in the boilerplate (default: the current year)',
    coerce: lastOccurrence({
      coerce: val => {
        const year = String(val).trim()
        if (!/^[0-9]{4}$/.test(year)) {
          throw new Error(`--year must be a 4-digit year, got "${val}"`)
        }
        return Number(year)
      }
    }),
    type: 'string'
  })
  // The document is the one non-option argument. A default command with a <file> positional
  // would be filled before yargs adds back the words after "--", so "idnits -- -draft.xml"
  // failed; demandCommand counts them, and the words after "--" are never options.
  .demandCommand(1, 1)
  .parserConfiguration({ 'parse-positional-numbers': false })
  .strict()
  .alias({ h: 'help' })
  .help()
  .version(pkgInfo.version)
  .parse()

const chalk = (argv.color === false) ? new Chalk({ level: 0 }) : new Chalk()

// Set the base URLs and timeout of remote lookups, checking those from the environment too
try {
  setRemoteUrls({ datatracker: argv.datatrackerUrl, rfcEditor: argv.rfceditorUrl })
  setRemoteTimeout(argv.remoteTimeout)
  getDatatrackerUrl()
  getRfcEditorUrl()
  getRemoteTimeout()
} catch (err) {
  console.error(chalk.redBright(err.message))
  process.exit(1)
}

if (argv.output === 'pretty') {
  console.log(chalk.bgGray.white('▄'.repeat(64)))
  console.log(chalk.bgWhite.black(`${pad('idnits ▶ ' + pkgInfo.version, 64)}`))
  console.log(chalk.bgGray.white('▀'.repeat(64)))
  console.log()
}

// Read document
const docArg = String(argv._[0])
let docRaw = ''
let docPath = ''
let docPathObj = null
if (docArg.startsWith('http://') || docArg.startsWith('https://')) {
  // -> Remote: --offline means no network access, the document included
  if (argv.offline) {
    console.error(chalk.redBright(`--offline: can't fetch ${docArg.trim()} without network access. Save it locally and check the file instead.`))
    process.exit(1)
  }
  docPath = docArg.trim()
  const docPathUrl = new URL(docPath)
  docPathObj = path.parse(docPathUrl.pathname)
  if (argv.output === 'pretty') {
    console.log(chalk.bgWhite.black(' Url ') + ` ${docPath}`)
  }
  try {
    const resp = await fetch(docPath)
    if (!resp.ok) {
      throw new Error(resp.statusText)
    }
    docRaw = Buffer.from(await resp.arrayBuffer())
    if (docRaw.length < 5) {
      throw new Error('Document is empty!')
    }
  } catch (err) {
    console.error(chalk.redBright(`Failed to fetch remote document: ${err.message}`))
    process.exit(1)
  }
} else {
  // -> Local
  docPath = path.resolve(process.cwd(), docArg)
  docPathObj = path.parse(docPath)
  if (argv.output === 'pretty') {
    console.log(chalk.bgWhite.black(' Path ') + ` ${docPath}`)
  }
  try {
    docRaw = await readFile(docPath)
    if (docRaw.length < 5) {
      throw new Error('Document is empty!')
    }
  } catch (err) {
    console.error(chalk.redBright(`Failed to read document: ${err.message}`))
    process.exit(1)
  }
}

// Get Mode
const mode = getModeByName(argv.mode).mode
if (argv.output === 'pretty') {
  console.log(chalk.bgWhite.black(' Mode ') + ` ${argv.mode} ` + chalk.grey(`[${mode}]`))
  console.log()
}

// Solarized-adapted chalk
function chalkAdapted (color) {
  switch (color) {
    case 'whiteBright':
      return argv.solarized ? chalk.blackBright : chalk.whiteBright
    case 'white':
      return argv.solarized ? chalk.black : chalk.white
  }
}

// Validate document
try {
  let result = []
  const docSizeBytes = Buffer.byteLength(docRaw)

  // Validate document using task processor
  if (argv.output === 'pretty' && argv.progress) {
    const validations = getAllValidations(getDocType(docPathObj.base))
    const tasks = new Listr(
      validations.map(valGroup => ({
        title: valGroup.title,
        task: () => new Listr(
          valGroup.tasks.map(valTask => ({
            title: valTask.title,
            task: async (ctx) => {
              if (valTask.isVoid) {
                return valTask.task(ctx)
              } else {
                result.push(...(await valTask.task(ctx)))
              }
            }
          })),
          {
            concurrent: valGroup.concurrent
          }
        ),
        skip: valGroup.condition ? (ctx) => !valGroup.condition(ctx) : undefined
      })),
      {
        ctx: {
          raw: docRaw,
          filename: docPathObj.base,
          options: {
            allowedDomains: argv.allowedDomains,
            mode,
            offline: argv.offline,
            year: argv.year
          }
        },
        collectErrors: 'minimal',
        exitOnError: true,
        rendererOptions: {
          collapseErrors: false,
          collapseSubtasks: true,
          showErrorMessage: false,
          icon: {
            [ListrDefaultRendererLogLevels.COMPLETED]: '☑️',
            [ListrDefaultRendererLogLevels.FAILED]: '❌'
          }
        }
      }
    )
    const ctx = await tasks.run()
    finalizeFindings(result, ctx.doc)
    console.info('')
  } else {
    result = await checkNits(docRaw, docPathObj.base, {
      allowedDomains: argv.allowedDomains,
      mode,
      offline: argv.offline,
      year: argv.year
    })
  }

  // Filter severity types
  if (argv.filter && argv.filter.length > 0) {
    result = result.filter(entry => {
      switch (entry.constructor.name) {
        case 'ValidationError': {
          return argv.filter.includes('errors')
        }
        case 'ValidationWarning': {
          return argv.filter.includes('warnings')
        }
        case 'ValidationComment': {
          return argv.filter.includes('comments')
        }
        default: {
          return true
        }
      }
    })
  }

  // Stats by severity
  const nitsBySeverity = {
    error: 0,
    warning: 0,
    comment: 0
  }
  for (const res of result) {
    switch (res.constructor.name) {
      case 'ValidationError': {
        nitsBySeverity.error++
        break
      }
      case 'ValidationWarning': {
        nitsBySeverity.warning++
        break
      }
      case 'ValidationComment': {
        nitsBySeverity.comment++
        break
      }
    }
  }

  // Output results
  switch (argv.output) {
    // COUNT | Only return number of nits
    case 'count': {
      console.log(result.length)
      break
    }
    // JSON | Return results as a stringified JSON object
    case 'json': {
      console.log(JSON.stringify({
        result: nitsBySeverity.error > 0 ? 'fail' : 'pass',
        file: {
          path: docPath,
          size: docSizeBytes
        },
        nitsBySeverity,
        nits: result.map(r => ({
          severity: r.constructor.name,
          code: r.name,
          desc: r.message,
          ...r.text && { text: r.text },
          ...r.refUrl && { ref: r.refUrl },
          ...r.path && { path: r.path },
          ...r.label && { label: r.label },
          ...r.lines && { line: r.lines }
        }))
      }, null, 2))
      break
    }
    // SIMPLE | Results as a simple list
    case 'simple': {
      if (result.length === 0) {
        console.log(`PASS - Document ${docPath} is nit-free. (mode: ${argv.mode})\n`)
      } else {
        console.error(`FAIL - Document ${docPath} has nits. (mode: ${argv.mode})\n`)
        let entryIdx = 1
        const validationSeverity = {
          ValidationError: 'Error',
          ValidationWarning: 'Warning',
          ValidationComment: 'Comment'
        }
        for (const entry of result) {
          const location = (entry.label ? ` | ${entry.label} (${entry.path})` : '') +
            (entry.lines ? ` | ${entry.lines.map(line => `Ln ${line.line} Col ${line.pos}`).join(', ')}` : '')
          console.log(`[${entryIdx}] ${validationSeverity[entry.constructor.name]} | ${entry.name} | ${entry.message}${location}`)
          entryIdx++
        }
      }
      break
    }
    // PRETTY | Human-readable result view
    case 'pretty': {
      if (result.length === 0) {
        console.log(chalk.bgGreen.whiteBright(' PASS ') + chalk.greenBright(' No nit found for this document. 🎉\n'))
      } else {
        let resultIcon = ''
        const resultSeverities = []
        if (nitsBySeverity.comment > 0) {
          resultIcon = 'ℹ️'
          resultSeverities.push(nitsBySeverity.comment + (nitsBySeverity.comment > 1 ? chalk.cyanBright(' comments') : chalk.cyanBright(' comment')))
        }
        if (nitsBySeverity.warning > 0) {
          resultIcon = '⚠️'
          resultSeverities.unshift(nitsBySeverity.warning + (nitsBySeverity.warning > 1 ? chalk.yellowBright(' warnings') : chalk.yellowBright(' warning')))
        }
        if (nitsBySeverity.error > 0) {
          resultIcon = '❌'
          resultSeverities.unshift(nitsBySeverity.error + (nitsBySeverity.error > 1 ? chalk.redBright(' errors') : chalk.redBright(' error')))
        }
        console.log(resultIcon + ' Review the ' + resultSeverities.join(', ') + ' listed below.\n')

        // Format errors
        let entryIdx = 1
        for (const sev of ['ValidationError', 'ValidationWarning', 'ValidationComment']) {
          switch (sev) {
            case 'ValidationError': {
              if (nitsBySeverity.error > 0) {
                console.log(chalk.red('█'.repeat(7) + '▀'.repeat(57)))
                console.log(chalk.bgRed.whiteBright(' ERROR ') + ` ${nitsBySeverity.error} nit${nitsBySeverity.error > 1 ? 's' : ''} of ⛔ error severity`)
                console.log(chalk.red('█'.repeat(7) + '▄'.repeat(57)) + '\n')
              }
              break
            }
            case 'ValidationWarning': {
              if (nitsBySeverity.warning > 0) {
                console.log(chalk.yellow('█'.repeat(9) + '▀'.repeat(55)))
                console.log(chalk.bgYellow.whiteBright(' WARNING ') + ` ${nitsBySeverity.warning} nit${nitsBySeverity.warning > 1 ? 's' : ''} of ⚠️ warning severity`)
                console.log(chalk.yellow('█'.repeat(9) + '▄'.repeat(55)) + '\n')
              }
              break
            }
            case 'ValidationComment': {
              if (nitsBySeverity.comment > 0) {
                console.log(chalk.cyan('█'.repeat(9) + '▀'.repeat(55)))
                console.log(chalk.bgCyan.whiteBright(' COMMENT ') + ` ${nitsBySeverity.comment} nit${nitsBySeverity.comment > 1 ? 's' : ''} of ℹ️ comment severity`)
                console.log(chalk.cyan('█'.repeat(9) + '▄'.repeat(55)) + '\n')
              }
              break
            }
          }
          for (const entry of result.filter(r => r.constructor.name === sev)) {
            switch (entry.constructor.name) {
              case 'ValidationError': {
                console.log(chalk.bgRed.whiteBright(` ${entryIdx} `) + ' ' + chalk.redBright(entry.name))
                // console.log(chalk.grey(' └- ') + chalkAdapted('white')('Code') + chalk.grey(' - ') + chalk.redBright(entry.name))
                break
              }
              case 'ValidationWarning': {
                console.log(chalk.bgYellow.whiteBright(` ${entryIdx} `) + ' ' + chalk.yellowBright(entry.name))
                // console.log(chalk.grey(' └- ') + chalkAdapted('white')('Code') + chalk.grey(' - ') + chalk.yellowBright(entry.name))
                break
              }
              case 'ValidationComment': {
                console.log(chalk.bgCyan.whiteBright(` ${entryIdx} `) + ' ' + chalk.cyanBright(entry.name))
                // console.log(chalk.grey(' └- ') + chalkAdapted('white')('Code') + chalk.grey(' - ') + chalk.cyanBright(entry.name))
                break
              }
              default: {
                console.log(chalk.bgRed.whiteBright(` ${entryIdx} `) + ' Unexpected Error')
              }
            }
            console.log(chalk.grey(' └- ') + chalkAdapted('white')('Desc') + chalk.grey(' - ') + chalkAdapted('whiteBright')(entry.message))
            if (entry.text) {
              console.log(chalk.grey(' └- ') + chalkAdapted('white')('Text') + chalk.grey(' - ') + chalkAdapted('white')(entry.text))
            }
            if (entry.refUrl) {
              console.log(chalk.grey(' └- ') + chalkAdapted('white')('Ref ') + chalk.grey(' - ') + chalk.cyan(entry.refUrl))
            }
            if (entry.label) {
              console.log(chalk.grey(' └- ') + chalkAdapted('white')('Loc ') + chalk.grey(' - ') + chalkAdapted('whiteBright')(entry.label))
            }
            if (entry.path) {
              console.log(chalk.grey(' └- ') + chalkAdapted('white')('Path') + chalk.grey(' - ') + chalkAdapted('white')(entry.path))
            }
            if (entry.lines) {
              const lines = []
              for (const line of entry.lines) {
                lines.push(`Ln ${line.line} Col ${line.pos}`)
              }
              console.log(chalk.grey(' └- ') + chalkAdapted('white')('Line') + chalk.grey(' - ') + chalkAdapted('white')(lines.join(', ')))
            }
            console.log() // Empty line between entries
            entryIdx++
          }
        }

        if (result.length >= 5) {
          console.log('-'.repeat(64) + '\n')
          console.log(resultIcon + ' Review the ' + resultSeverities.join(', ') + ' listed above.\n')
        }
      }
      break
    }
    default: {
      throw new Error('Invalid Output Mode')
    }
  }

  // Exit with code 2 if nits at or above the --fail-on severity were found
  if (
    (argv.failOn === 'errors' && nitsBySeverity.error > 0) ||
    (argv.failOn === 'warnings' && nitsBySeverity.error + nitsBySeverity.warning > 0) ||
    (argv.failOn === 'comments' && result.length > 0)
  ) {
    process.exitCode = 2
  }
} catch (err) {
  console.debug(err)
  console.error(chalk.redBright(`Validation did not complete. Error:\n- ${err.message}`))
  process.exit(1)
}
