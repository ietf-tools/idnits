import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../cli.js', import.meta.url))
// -> Copyright (c) 2023
const DRAFT_2023 = fileURLToPath(new URL('./fixtures/draft-ietf-idr-rt-derived-community-00.txt', import.meta.url))
const DRAFT_XML = `<?xml version="1.0" encoding="utf-8"?>
<rfc docName="draft-test-cli-options-00" ipr="trust200902" category="info" submissionType="IETF" version="3">
<front><title>CLI options</title></front>
<middle><section><name>Domains</name><t>See acme.net and example.org.</t></section></middle>
</rfc>
`

let dir
let draft

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'idnits-cli-options-'))
  draft = path.join(dir, 'draft-test-cli-options-00.xml')
  await writeFile(draft, DRAFT_XML)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/**
 * Run the CLI with --offline, from the fixture's directory, where no remote lookup is made
 * (the services point at a closed local port all the same)
 *
 * @param {string[]} args Arguments, the document included
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} Result
 */
function runCli (args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, '--offline', '--no-progress', '--no-color', ...args], {
      cwd: dir,
      env: { ...process.env, IDNITS_DATATRACKER_URL: 'http://127.0.0.1:1', IDNITS_RFCEDITOR_URL: 'http://127.0.0.1:1' }
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }))
  })
}

/**
 * Descriptions of the copyright year findings in JSON output
 *
 * @param {string} stdout JSON output
 * @returns {string[]} Descriptions
 */
function copyrightFindings (stdout) {
  const nits = JSON.parse(stdout).nits
  const found = nits.filter(nit => nit.code === 'COPYRIGHT_YEAR_MISMATCH')
  return found.map(nit => nit.desc)
}

/**
 * Domains of the domain findings in JSON output
 *
 * @param {string} stdout JSON output
 * @returns {string[]} Domains
 */
function domainFindings (stdout) {
  const nits = JSON.parse(stdout).nits
  const found = nits.filter(nit => ['INVALID_DOMAIN_TLD', 'POSSIBLE_INVALID_TLD'].includes(nit.code))
  return found.map(nit => nit.text)
}

// -> Each test starts the CLI as its own process, several times, so the tests run concurrently, and
//    so do the runs within a test
describe.concurrent('an option taking one value, given more than once', { timeout: 30000 }, () => {
  test('--output: the last one wins', async () => {
    const [json, count, single] = await Promise.all([
      runCli(['-o', 'simple', '-o', 'json', draft]),
      runCli(['-o', 'json', '--output', 'count', draft]),
      runCli(['-o', 'count', draft])
    ])
    expect(json.code).toBe(0)
    const output = JSON.parse(json.stdout)
    expect(output.file.path).toBe(draft)

    expect(count.code).toBe(0)
    expect(count.stdout.trim()).toMatch(/^[0-9]+$/)
    expect(count.stdout).toBe(single.stdout)
  })

  test('--mode: the last one wins', async () => {
    const [run, alias] = await Promise.all([
      runCli(['-o', 'simple', '-m', 'normal', '-m', 'submission', draft]),
      runCli(['-o', 'simple', '-m', 'submission', '-m', 'fc', draft])
    ])
    expect(run.stdout + run.stderr).toContain('(mode: submission)')
    expect(alias.stdout + alias.stderr).toContain('(mode: forgive-checklist)')
  })

  test('--fail-on: the last one wins', async () => {
    // (only the comments are kept, so the document has no errors left)
    const [onComments, onErrors] = await Promise.all([
      runCli(['-o', 'count', '-f', 'comments', '--fail-on', 'errors', '--fail-on', 'comments', draft]),
      runCli(['-o', 'count', '-f', 'comments', '--fail-on', 'comments', '--fail-on', 'errors', draft])
    ])
    expect(onComments.code).toBe(2)
    expect(onErrors.code).toBe(0)
  })

  test('--year / -y: the last one wins', async () => {
    const [mismatch, match] = await Promise.all([
      runCli(['-o', 'json', '-m', 'submission', '-y', '2023', '--year', '2025', DRAFT_2023]),
      runCli(['-o', 'json', '-m', 'submission', '-y', '2025', '-y', '2023', DRAFT_2023])
    ])
    expect(mismatch.code).toBe(0)
    expect(copyrightFindings(mismatch.stdout)).toEqual([
      'The copyright year in the IETF Trust and authors Copyright Line does not match the expected year (2025)'
    ])
    expect(match.code).toBe(0)
    expect(copyrightFindings(match.stdout)).toEqual([])
  })

  test('--remote-timeout and the service URLs: the last one wins', async () => {
    const run = await runCli(['-o', 'count', '--remote-timeout', '5', '--remote-timeout', '7',
      '--datatracker-url', 'http://127.0.0.1:1', '--datatracker-url', 'http://127.0.0.1:2',
      '--rfceditor-url', 'http://127.0.0.1:1', '--rfceditor-url', 'http://127.0.0.1:2', draft])
    expect(run.stderr).toBe('')
    expect(run.code).toBe(0)
  })

  test('an invalid earlier occurrence is still an error', async () => {
    const [output, mode, timeout, year] = await Promise.all([
      runCli(['-o', 'bogus', '-o', 'json', draft]),
      runCli(['-m', 'bogus', '-m', 'normal', draft]),
      runCli(['--remote-timeout', 'soon', '--remote-timeout', '5', draft]),
      runCli(['-y', '26', '-y', '2025', draft])
    ])
    expect(output.code).toBe(1)
    expect(output.stderr).toContain('--output: "bogus" is not one of')
    expect(mode.code).toBe(1)
    expect(mode.stderr).toContain('--mode: "bogus" is not one of')
    expect(timeout.code).toBe(1)
    expect(timeout.stderr).toContain('--remote-timeout')
    expect(year.code).toBe(1)
    expect(year.stderr).toContain('--year must be a 4-digit year, got "26"')
  })

  test('a single invalid value gets the usual message', async () => {
    const run = await runCli(['-o', 'bogus', draft])
    expect(run.code).toBe(1)
    expect(run.stderr).toContain('Invalid values:')
  })

  test('--filter still adds up', async () => {
    const nits = async (args) => {
      const run = await runCli(['-o', 'json', ...args, draft])
      return JSON.parse(run.stdout).nits
    }
    const [both, warnings, comments] = await Promise.all([
      nits(['-f', 'warnings', '-f', 'comments']),
      nits(['-f', 'warnings']),
      nits(['-f', 'comments'])
    ])
    expect(warnings.length).toBeGreaterThan(0)
    expect(comments.length).toBeGreaterThan(0)
    expect(both).toHaveLength(warnings.length + comments.length)
  })

  test('--allowed-domains still adds up', async () => {
    const [run, one] = await Promise.all([
      runCli(['-o', 'json', '--allowed-domains', 'acme.net', '--allowed-domains', 'example.org', draft]),
      runCli(['-o', 'json', '--allowed-domains', 'example.org', draft])
    ])
    expect(run.code).toBe(0)
    expect(domainFindings(run.stdout)).toEqual([])
    expect(domainFindings(one.stdout)).toEqual(['acme.net'])
  })
})
