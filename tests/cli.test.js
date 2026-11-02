import { describe, expect, test } from 'vitest'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../cli.js', import.meta.url))
// -> Copyright (c) 2023
const DRAFT = fileURLToPath(new URL('./fixtures/draft-ietf-idr-rt-derived-community-00.txt', import.meta.url))

/**
 * Run the CLI on the fixture in submission mode with --offline, where no remote lookup is made
 * (the services point at a closed local port all the same)
 *
 * @param {string[]} args Extra arguments
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} Result
 */
function runCli (args) {
  const cliArgs = [CLI, '--offline', '-m', 'submission', '-o', 'json', ...args, DRAFT]
  const env = { ...process.env, IDNITS_DATATRACKER_URL: 'http://127.0.0.1:1', IDNITS_RFCEDITOR_URL: 'http://127.0.0.1:1' }
  return new Promise((resolve) => {
    execFile(process.execPath, cliArgs, { env }, (err, stdout, stderr) => {
      let code = 0
      if (err) {
        code = err.code
      }
      resolve({ code, stdout, stderr })
    })
  })
}

const copyrightFindings = stdout => JSON.parse(stdout).nits.filter(n => n.code === 'COPYRIGHT_YEAR_MISMATCH')

// -> Each test starts the CLI as its own process on a whole draft, so the tests run concurrently, and
//    so do the runs within a test, with room for a loaded machine
describe.concurrent('--year / -y', { timeout: 30000 }, () => {
  test.each([['--year'], ['-y']])('%s sets the year the copyright check expects', async (flag) => {
    const [match, mismatch] = await Promise.all([
      runCli([flag, '2023']),
      runCli([flag, '2025'])
    ])
    expect(match.code).toBe(0)
    expect(copyrightFindings(match.stdout)).toEqual([])

    expect(mismatch.code).toBe(0)
    expect(copyrightFindings(mismatch.stdout).map(n => n.desc)).toEqual([
      'The copyright year in the IETF Trust and authors Copyright Line does not match the expected year (2025)'
    ])
  })

  test('defaults to the current year', async () => {
    const { code, stdout } = await runCli([])
    expect(code).toBe(0)
    expect(copyrightFindings(stdout).map(n => n.desc)).toEqual([
      'The copyright year in the IETF Trust and authors Copyright Line does not match the current year'
    ])
  })

  test.each(['26', '20260', 'next', '2026.5'])('rejects %s', async (value) => {
    const { code, stderr } = await runCli(['--year', value])
    expect(code).toBe(1)
    expect(stderr).toContain(`--year must be a 4-digit year, got "${value}"`)
  })
})
