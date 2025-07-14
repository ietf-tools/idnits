#!/usr/bin/env node

import { Chalk } from 'chalk'
import yargs from 'yargs/yargs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pad } from 'lodash-es'
import { readFile } from 'node:fs/promises'
import { DateTime } from 'luxon'
import { gte } from 'semver'
import { Listr, ListrDefaultRendererLogLevels } from 'listr2'
import { checkNits, getAllValidations } from './lib/index.mjs'
import { getModeByName } from './lib/config/modes.mjs'

// Check Node.js version
if (!gte(process.version, '18.0.0')) {
  console.error('idnits3 requires Node.js v18 or later.')
  process.exit(1)
}

// Get package version
const cliDir = path.dirname(fileURLToPath(import.meta.url))
const pkgInfo = JSON.parse(await readFile(path.join(cliDir, 'package.json'), 'utf8'))

// Define CLI arguments config
const argv = yargs(process.argv.slice(2))
  .scriptName('idnits')
  .usage('$0 [args] <file-path|http-url>')
  .example([
    ['$0 draft-ietf-abcd-01.xml', ''],
    [`$0 -m submission -y ${DateTime.now().year} draft-ietf-abcd-01.xml`, ''],
    ['$0 https://www.rfc-editor.org/rfc/rfc2549', '']
  ])
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
    coerce: val => {
      try {
        const mode = getModeByName(val)
        return mode.name
      } catch (err) {
        return val
      }
    },
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
    describe: 'Disable validations that require an internet connection',
    type: 'boolean'
  })
  .option('output', {
    alias: 'o',
    describe: 'Output format',
    choices: ['pretty', 'simple', 'json', 'count'],
    default: 'pretty',
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
  .command('* <file>', 'parse and validate document', (y) => {
    y.positional('file', {
      type: 'string',
      describe: 'Path / URL of the document to validate'
    })
  })
  .strict()
  .alias({ h: 'help' })
  .help()
  .version(pkgInfo.version)
  .argv

const chalk = (argv.color === false) ? new Chalk({ level: 0 }) : new Chalk()

if (argv.output === 'pretty') {
  console.log(chalk.bgGray.white('▄'.repeat(64)))
  console.log(chalk.bgWhite.black(`${pad('idnits ▶ ' + pkgInfo.version, 64)}`))
  console.log(chalk.bgGray.white('▀'.repeat(64)))
  console.log()
}

// Read document
let docRaw = ''
let docPath = ''
let docPathObj = null
if (argv.file.startsWith('http://') || argv.file.startsWith('https://')) {
  // -> Remote
  docPath = argv.file.trim()
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
  docPath = path.resolve(process.cwd(), argv.file)
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
    const validations = getAllValidations(docPathObj.base.endsWith('.xml') ? 'xml' : 'txt')
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
            mode,
            offline: argv.offline
          }
        },
        collectErrors: true,
        exitOnError: true,
        rendererOptions: {
          collapseErrors: false,
          collapseSubtasks: true,
          icon: {
            [ListrDefaultRendererLogLevels.COMPLETED]: '☑️',
            [ListrDefaultRendererLogLevels.FAILED]: '❌'
          }
        }
      }
    )
    await tasks.run()
    console.info('')
  } else {
    result = await checkNits(docRaw, docPathObj.base, {
      mode,
      offline: argv.offline
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
        result: result.length > 0 ? 'fail' : 'pass',
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
          console.log(`[${entryIdx}] ${validationSeverity[entry.constructor.name]} | ${entry.name} | ${entry.message}`)
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
} catch (err) {
  console.debug(err)
  console.error(chalk.redBright(`Validation did not complete. Error:\n- ${err.message}`))
  process.exit(1)
}
