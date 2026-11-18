#!/usr/bin/env node
/**
 * Time a whole run of the checks (checkNits) on large generated documents, one text and one XML
 * (tests/generators/large-doc-txt.js and large-doc-xml.js), to compare the run time of the checks
 * before and after a change.
 *
 * The runs are offline, so nothing is looked up. Any attempt to fetch is refused and reported, so a
 * timing never reaches a remote service. Each document is checked --runs times after one warm-up run,
 * and the median time is printed, with the size of the document and the number of findings.
 *
 * Usage: node scripts/time-large-docs.mjs [--sections 4000] [--references 4000] [--runs 3] [--mode normal]
 */
import { parseArgs } from 'node:util'
import { checkNits } from '../lib/index.mjs'
import { getModeByName } from '../lib/config/modes.mjs'
import { largeTxtDoc } from '../tests/generators/large-doc-txt.js'
import { largeXmlDoc } from '../tests/generators/large-doc-xml.js'

const { values } = parseArgs({
  options: {
    sections: { type: 'string', default: '4000' },
    references: { type: 'string', default: '4000' },
    runs: { type: 'string', default: '3' },
    mode: { type: 'string', default: 'normal' }
  }
})

const size = { sections: Number(values.sections), references: Number(values.references) }
const runs = Number(values.runs)
const { mode, name: modeName } = getModeByName(values.mode)

let fetchAttempts = 0
globalThis.fetch = async () => {
  fetchAttempts++
  throw new Error('No fetch while timing')
}

/**
 * Time the runs of the checks on a document
 *
 * @param {string} text Text of the document
 * @param {string} filename Filename of the document
 * @returns {Promise<{ median: number, findings: number }>} Median time of a run, in milliseconds, and number of findings
 */
async function timeRuns (text, filename) {
  const raw = Buffer.from(text, 'utf8')
  let findings = await checkNits(raw, filename, { mode, offline: true })
  const times = []
  for (let run = 0; run < runs; run++) {
    const start = performance.now()
    findings = await checkNits(raw, filename, { mode, offline: true })
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  return { median: times[Math.floor(times.length / 2)], findings: findings.length }
}

console.log(`${size.sections} sections, ${size.references} references, ${modeName} mode, median of ${runs} runs`)
const docs = [
  { format: 'txt', text: largeTxtDoc(size) },
  { format: 'xml', text: largeXmlDoc(size) }
]
for (const { format, text } of docs) {
  const { median, findings } = await timeRuns(text, `draft-ietf-beep-boop-01.${format}`)
  const lines = text.split('\n').length
  console.log(`${format}: ${lines} lines, ${(median / 1000).toFixed(2)} s, ${findings} findings`)
}
if (fetchAttempts > 0) {
  console.log(`${fetchAttempts} fetches were attempted and refused`)
  process.exitCode = 1
}
