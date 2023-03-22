#!/usr/bin/env node

import chalk from 'chalk'
import yargs from 'yargs/yargs'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { DateTime } from 'luxon'
import { checkNits } from './lib/index.mjs'

// Define CLI arguments config

const argv = yargs(process.argv.slice(2))
  .scriptName('idnits')
  .usage('$0 [args] <file>')
  .example(`$0 --year ${DateTime.now().year} rfc1234.txt`, '')
  .option('nitcount', {
    describe: 'Show a count of nits',
    type: 'boolean'
  })
  .option('verbose', {
    describe: 'Show more information about offending lines',
    type: 'boolean'
  })
  .option('year', {
    alias: 'y',
    describe: 'Expect the given year in the boilerplate',
    type: 'number'
  })
  .command('* <file>', 'parse and validate file', (y) => {
    y.positional('file', {
      type: 'string',
      describe: 'File to parse',
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
console.log(chalk.yellowBright.bold(`${'='.repeat(64)}\nidnits | ${pkgInfo.version}\n${'='.repeat(64)}\n`))

// Read document
const docPath = path.resolve(process.cwd(), argv.file)
const docPathObj = path.parse(docPath)
let docRaw = ''
try {
  docRaw = await readFile(docPath, 'utf8')
} catch (err) {
  console.error(chalk.redBright(`Failed to read document: ${err.message}`))
  process.exit(1)
}

// Validate document
try {
  await checkNits(docRaw, docPathObj.base, {})
} catch (err) {
  console.error(chalk.redBright(`Validation failed:\n- ${err.message}`))
  if (err.refUrl) {
    console.error(chalk.redBright(`  For more info, see ${err.refUrl}`))
  }
  process.exit(1)
}
