#!/usr/bin/env node

import chalk from 'chalk'
import yargs from 'yargs/yargs'
import path from 'node:path'
import { pad } from 'lodash-es'
import { readFile } from 'node:fs/promises'
import { DateTime } from 'luxon'
import { gte } from 'semver'
import ora from 'ora'
import { checkNits } from './lib/index.mjs'
import { getModeByName } from './lib/config/modes.mjs'

// Check Node.js version
if (!gte(process.version, '18.0.0')) {
  console.error('idnits3 requires Node.js v18 or later.')
  process.exit(1)
}

// Define CLI arguments config
const argv = yargs(process.argv.slice(2))
  .scriptName('idnits')
  .usage('$0 [args] <file-path>')
  .example([
    ['$0 draft-ietf-abcd-01.xml', ''],
    [`$0 -m submission -y ${DateTime.now().year} draft-ietf-abcd-01.xml`, '']
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
  .option('output', {
    alias: 'o',
    describe: 'Output format',
    choices: ['pretty', 'json', 'count'],
    default: 'pretty',
    type: 'string'
  })
  .option('year', {
    alias: 'y',
    describe: 'Expect the given year in the boilerplate',
    type: 'number'
  })
  .command('* <file>', 'parse and validate document', (y) => {
    y.positional('file', {
      type: 'string',
      describe: 'Path of the document to validate',
      normalize: true
    })
  })
  .strict()
  .alias({ h: 'help' })
  .help()
  .version()
  .argv

// Get package version
const pkgInfo = JSON.parse(await readFile('./package.json', 'utf8'))
if (argv.output === 'pretty') {
  console.log(chalk.bgGray.white('▄'.repeat(64)))
  console.log(chalk.bgWhite.black(`${pad('idnits ▶ ' + pkgInfo.version, 64)}`))
  console.log(chalk.bgGray.white('▀'.repeat(64)))
  console.log()
}

// Read document
const docPath = path.resolve(process.cwd(), argv.file)
const docPathObj = path.parse(docPath)
if (argv.output === 'pretty') {
  console.log(chalk.bgWhite.black(' Path ') + ` ${docPath}`)
}
let docRaw = ''
try {
  docRaw = await readFile(docPath)
} catch (err) {
  console.error(chalk.redBright(`Failed to read document: ${err.message}`))
  process.exit(1)
}

// Get Mode
const mode = getModeByName(argv.mode).mode
if (argv.output === 'pretty') {
  console.log(chalk.bgWhite.black(' Mode ') + ` ${argv.mode} ` + chalk.grey(`[${mode}]`))
  console.log()
}

// Initialize progress reporter
const spinner = ora({
  text: 'Loading...',
  isSilent: argv.output !== 'pretty' || !argv.progress
}).start()

// Validate document
try {
  let result = await checkNits(docRaw, docPathObj.base, {
    mode,
    progressClb: (msg) => { spinner.text = msg }
  })

  spinner.stop()

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
          size: 0
        },
        nits: result.map(r => ({
          code: r.name,
          desc: r.message,
          ...r.refUrl && { ref: r.refUrl },
          ...r.lines && { line: r.lines }
        }))
      }))
      break
    }
    // PRETTY | Human-readable result view
    case 'pretty': {
      if (result.length === 0) {
        console.log(chalk.bgGreen.whiteBright(' PASS ') + chalk.greenBright(' Document is VALID. 🎉\n'))
      } else {
        console.error(chalk.bgRed.whiteBright(' FAIL ') + chalk.redBright(' Document is INVALID. ❌\n'))
        // Format errors
        let entryIdx = 1
        for (const entry of result) {
          switch (entry.constructor.name) {
            case 'ValidationError': {
              console.log(chalk.bgRed.whiteBright(` ${entryIdx} `) + chalk.redBright(' Error'))
              console.log(chalk.grey(' └- ') + chalk.white('Code') + chalk.grey(' - ') + chalk.redBright(entry.name))
              break
            }
            case 'ValidationWarning': {
              console.log(chalk.bgYellow.whiteBright(` ${entryIdx} `) + chalk.yellowBright(' Warning'))
              console.log(chalk.grey(' └- ') + chalk.white('Code') + chalk.grey(' - ') + chalk.yellowBright(entry.name))
              break
            }
            case 'ValidationComment': {
              console.log(chalk.bgCyan.whiteBright(` ${entryIdx} `) + ' Comment')
              console.log(chalk.grey(' └- ') + chalk.white('Code') + chalk.grey(' - ') + chalk.cyanBright(entry.name))
              break
            }
            default: {
              console.log(chalk.bgRed.whiteBright(` ${entryIdx} `) + ' Unexpected Error')
            }
          }
          console.log(chalk.grey(' └- ') + chalk.white('Desc') + chalk.grey(' - ') + chalk.whiteBright(entry.message))
          if (entry.refUrl) {
            console.log(chalk.grey(' └- ') + chalk.white('Ref ') + chalk.grey(' - ') + chalk.cyan(entry.refUrl))
          }
          if (entry.path) {
            console.log(chalk.grey(' └- ') + chalk.white('Path') + chalk.grey(' - ') + chalk.white(entry.path))
          }
          if (entry.lines) {
            const lines = []
            for (const line of entry.lines) {
              lines.push(`Ln ${line.line} Col ${line.pos}`)
            }
            console.log(chalk.grey(' └- ') + chalk.white('Line') + chalk.grey(' - ') + chalk.white(lines.join(', ')))
          }
          console.log() // Empty line between entries
          entryIdx++
        }
      }
      break
    }
    default: {
      throw new Error('Invalid Output Mode')
    }
  }
} catch (err) {
  spinner.stop()
  console.debug(err)
  console.error(chalk.redBright(`Validation failed:\n- ${err.message}`))
  process.exit(1)
}
