#!/usr/bin/env node

import chalk from 'chalk'
import yargs from 'yargs/yargs'
import { readFile } from 'node:fs/promises'
import { DateTime } from 'luxon'

// Define CLI arguments config

const argv = yargs(process.argv.slice(2))
  .scriptName('idnits')
  .usage('$0 [args] <file>')
  .example(`$0 --year ${DateTime.now().year} rfc1234.txt`)
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
console.log(chalk.yellowBright.bold(`idnits ${pkgInfo.version}`))

console.info(argv)
