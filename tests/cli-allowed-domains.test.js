import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../cli.js', import.meta.url))
const DRAFT_XML = `<?xml version="1.0" encoding="utf-8"?>
<rfc docName="draft-test-allowed-domains-00" ipr="trust200902" category="info" submissionType="IETF" version="3">
<front><title>Allowed domains</title></front>
<middle><section><name>Domains</name><t>See www.ietf.org, datatracker.ietf.org, www.rfc-editor.org, acme.net and www.example.com.</t></section></middle>
</rfc>
`

let dir
let draft

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'idnits-allowed-domains-'))
  draft = path.join(dir, 'draft-test-allowed-domains-00.xml')
  await writeFile(draft, DRAFT_XML)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/**
 * Run the CLI in normal mode with --offline, from the fixture's directory, where no remote lookup
 * is made (the services point at a closed local port all the same)
 *
 * @param {string[]} args Arguments, the document included
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} Result
 */
function runCli (args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, '--offline', '-o', 'json', ...args], {
      cwd: dir,
      env: { ...process.env, IDNITS_DATATRACKER_URL: 'http://127.0.0.1:1', IDNITS_RFCEDITOR_URL: 'http://127.0.0.1:1' }
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }))
  })
}

/**
 * Arguments with the fixture's path in place of "DRAFT"
 *
 * @param {string[]} args Arguments
 * @returns {string[]} Arguments for runCli
 */
function withDraft (args) {
  return args.map(arg => {
    if (arg === 'DRAFT') {
      return draft
    }
    return arg
  })
}

/**
 * Domains reported by the domain checks
 *
 * @param {{code: number, stdout: string, stderr: string}} run
 * @returns {string[]} Domains, in document order
 */
function flagged ({ code, stdout, stderr }) {
  expect(stderr).toBe('')
  expect(code).toBe(0)
  return JSON.parse(stdout).nits.filter(n => ['INVALID_DOMAIN_TLD', 'POSSIBLE_INVALID_TLD'].includes(n.code)).map(n => n.text)
}

const ALL = ['www.ietf.org', 'datatracker.ietf.org', 'www.rfc-editor.org', 'acme.net']
const IETF_HOSTS = ['www.ietf.org', 'datatracker.ietf.org', 'www.rfc-editor.org']

// -> Each test starts the CLI as its own process, so the tests run concurrently, and so do the runs
//    within a test
describe.concurrent('--allowed-domains', () => {
  test('by default, ietf.org and rfc-editor.org hosts are not flagged', async () => {
    expect(flagged(await runCli([draft]))).toEqual(['acme.net'])
  })

  test('replaces the default list', async () => {
    const [acme, example] = await Promise.all([
      runCli(['--allowed-domains', 'acme.net', draft]),
      runCli(['--allowed-domains', 'example.com', draft])
    ])
    expect(flagged(acme)).toEqual(IETF_HOSTS)
    expect(flagged(example)).toEqual(ALL)
  })

  test('takes a comma-separated list, given before or after the document', async () => {
    const [before, after] = await Promise.all([
      runCli(['--allowed-domains', 'acme.net,ietf.org', draft]),
      runCli([draft, '--allowed-domains', 'acme.net,ietf.org'])
    ])
    expect(flagged(before)).toEqual(['www.rfc-editor.org'])
    expect(flagged(after)).toEqual(['www.rfc-editor.org'])
  })

  test('takes the --allowed-domains=<list> form', async () => {
    const [one, two] = await Promise.all([
      runCli(['--allowed-domains=acme.net', draft]),
      runCli(['--allowed-domains=acme.net,ietf.org', draft])
    ])
    expect(flagged(one)).toEqual(IETF_HOSTS)
    expect(flagged(two)).toEqual(['www.rfc-editor.org'])
  })

  test('repeated occurrences add up, whatever their spelling', async () => {
    const [separate, mixed, emptyFirst, three] = await Promise.all([
      runCli(['--allowed-domains', 'acme.net', '--allowed-domains', 'ietf.org', draft]),
      runCli(['--allowed-domains=acme.net', draft, '--allowed-domains', 'ietf.org']),
      runCli(['--allowed-domains', '', '--allowed-domains=acme.net', draft]),
      runCli(['--allowed-domains', 'acme.net,ietf.org', draft, '--allowed-domains=rfc-editor.org'])
    ])
    expect(flagged(separate)).toEqual(['www.rfc-editor.org'])
    expect(flagged(mixed)).toEqual(['www.rfc-editor.org'])
    expect(flagged(emptyFirst)).toEqual(IETF_HOSTS)
    expect(flagged(three)).toEqual([])
  })

  test('matches domains whatever their case, and with a trailing dot', async () => {
    expect(flagged(await runCli(['--allowed-domains', 'ACME.Net.', draft]))).toEqual(IETF_HOSTS)
  })

  test.each([
    [['--allowed-domains', '', 'DRAFT']],
    [['DRAFT', '--allowed-domains', '']],
    [['--allowed-domains=', 'DRAFT']]
  ])('an empty argument (%j) means no domain: every domain is checked', async (args) => {
    const run = await runCli(withDraft(args))
    expect(flagged(run)).toEqual(ALL)
  })

  test.each([
    ['a value with a space', 'acme.net ietf.org', '--allowed-domains: "acme.net ietf.org" (in "acme.net ietf.org") is not a domain.'],
    ['a value with a slash', 'acme.net/x', '--allowed-domains: "acme.net/x" (in "acme.net/x") is not a domain.'],
    ['a document name', 'draft.xml', '--allowed-domains: "draft.xml" (in "draft.xml") is not a domain.'],
    ['a text document name', 'acme.net,draft.txt', '--allowed-domains: "draft.txt" (in "acme.net,draft.txt") is not a domain.'],
    ['an underscore', 'my_host.acme.net', '--allowed-domains: "my_host.acme.net" (in "my_host.acme.net") is not a domain.'],
    ['a label starting with a hyphen', 'www.-acme.net', '--allowed-domains: "www.-acme.net" (in "www.-acme.net") is not a domain.'],
    ['a label ending with a hyphen', 'acme-.net', '--allowed-domains: "acme-.net" (in "acme-.net") is not a domain.'],
    ['a label over 63 characters', `${'a'.repeat(64)}.net`, `--allowed-domains: "${'a'.repeat(64)}.net" (in "${'a'.repeat(64)}.net") is not a domain.`],
    ['an IPv4 address', '192.0.2.1', '--allowed-domains: "192.0.2.1" (in "192.0.2.1") is not a domain.'],
    ['a lone dot', '.', '--allowed-domains: "." (in ".") is not a domain.'],
    ['an empty element', 'acme.net,,ietf.org', '--allowed-domains: empty domain in "acme.net,,ietf.org".'],
    ['a trailing comma', 'acme.net,', '--allowed-domains: empty domain in "acme.net,".']
  ])('rejects %s', async (_, value, message) => {
    const runs = await Promise.all([
      runCli(['--allowed-domains', value, draft]),
      runCli([draft, `--allowed-domains=${value}`])
    ])
    for (const { code, stdout, stderr } of runs) {
      expect(code).toBe(1)
      expect(stderr).toContain(message)
      expect(stdout).toBe('')
    }
  })

  test('a document right after the option is its value, never the document', async () => {
    // (the value is checked before yargs counts the documents)
    const [alone, withDocument] = await Promise.all([
      runCli(['--allowed-domains', 'draft-test-allowed-domains-00.xml']),
      runCli(['--allowed-domains', 'draft-test-allowed-domains-00.xml', draft])
    ])
    expect(alone.code).toBe(1)
    expect(alone.stdout).toBe('')
    expect(alone.stderr).toContain('--allowed-domains: "draft-test-allowed-domains-00.xml" (in "draft-test-allowed-domains-00.xml") is not a domain.')

    expect(withDocument.code).toBe(1)
    expect(withDocument.stdout).toBe('')
    expect(withDocument.stderr).toContain('--allowed-domains: "draft-test-allowed-domains-00.xml" (in "draft-test-allowed-domains-00.xml") is not a domain.')
  })

  test.each([
    ['at the end', ['DRAFT', '--allowed-domains']],
    ['before another option', ['--allowed-domains', '-m', 'normal', 'DRAFT']],
    ['before "--allowed-domains=x"', ['--allowed-domains', '--allowed-domains=acme.net', 'DRAFT']]
  ])('needs a value: none %s is an error', async (_, args) => {
    const { code, stdout, stderr } = await runCli(withDraft(args))
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('Not enough arguments following: allowed-domains')
  })

  test('the pretty output, through the task list, gets the list too', async () => {
    const run = await new Promise((resolve) => {
      execFile(process.execPath, [CLI, '--offline', '--no-color', '--allowed-domains', 'acme.net', draft], {
        cwd: dir,
        env: { ...process.env, IDNITS_DATATRACKER_URL: 'http://127.0.0.1:1', IDNITS_RFCEDITOR_URL: 'http://127.0.0.1:1' }
      }, (err, stdout) => resolve({ code: err ? err.code : 0, stdout }))
    })
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('Domain "datatracker.ietf.org" is not an allowed reserved domain')
    expect(run.stdout).not.toContain('Domain "acme.net"')
  })
})
