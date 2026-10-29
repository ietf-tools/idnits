import { describe, expect, test, vi } from 'vitest'
import { MODES } from '../lib/config/modes.mjs'
import { ValidationError } from '../lib/helpers/error.mjs'
import { checkNits, finalizeFindings, getAllValidations, getDocType } from '../lib/index.mjs'

// -> Checks that throw on demand
const failing = vi.hoisted(() => ({ prepTool: false, labels: false }))

vi.mock('../lib/modules/xml.mjs', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    detectPrepToolOutput: async (...args) => {
      if (failing.prepTool) {
        throw new TypeError('something is not iterable')
      }
      return original.detectPrepToolOutput(...args)
    }
  }
})

vi.mock('../lib/helpers/location.mjs', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    labelFindings: (...args) => {
      if (failing.labels) {
        throw new TypeError('no label')
      }
      return original.labelFindings(...args)
    }
  }
})

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-test-check-failed-00" ipr="trust200902" category="std" submissionType="IETF">
  <front>
    <title>Check Failed Test</title>
    <author fullname="Jane Doe" initials="J." surname="Doe"/>
    <date year="2025" month="1" day="1"/>
    <abstract><t>Abstract.</t></abstract>
  </front>
  <middle>
    <section><name>Introduction</name>
      <t>Implementations MUST do this.</t>
      <toString a="1"><t>x</t></toString>
      <hasOwnProperty valueOf="1"><t>y</t></hasOwnProperty>
    </section>
  </middle>
</rfc>
`
const FILENAME = 'draft-test-check-failed-00.xml'

async function run (mode, { prepTool = false, labels = false } = {}) {
  failing.prepTool = prepTool
  failing.labels = labels
  try {
    return await checkNits(Buffer.from(XML), FILENAME, { mode, offline: true })
  } finally {
    failing.prepTool = false
    failing.labels = false
  }
}

describe('A check that throws', () => {
  test('elements named toString and hasOwnProperty are checked like any others', async () => {
    const result = await run(MODES.NORMAL)
    expect(result.map(r => r.name)).not.toContain('CHECK_FAILED')
    expect(result.find(r => r.name === 'INVALID_INTRODUCTION_SECTION_CHILD')?.label).toEqual('Section 1 (Introduction)')
    const text = result.map(r => `${r.message} ${r.label ?? ''}`).join('\n')
    expect(text).not.toContain('[native code]')
  })

  test('gives a CHECK_FAILED Error naming the check, and the other checks still report', async () => {
    const expected = (await run(MODES.NORMAL)).map(r => r.name)
    const result = await run(MODES.NORMAL, { prepTool: true })
    const failed = result.filter(r => r.name === 'CHECK_FAILED')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toBeInstanceOf(ValidationError)
    expect(failed[0].constructor).toBe(ValidationError)
    expect(failed[0].message).toBe('The "Prep tool output" check failed, so its findings, if any, are missing: something is not iterable. Please report this at https://github.com/ietf-tools/idnits/issues with the document.')
    expect(result.filter(r => r.name !== 'CHECK_FAILED').map(r => r.name)).toEqual(expected)
    expect(expected).toContain('MISSING_BCP14_TAGS')
  })

  test('is an Error in submission mode too, as the submission check didn\'t complete', async () => {
    const result = await run(MODES.SUBMISSION, { prepTool: true })
    const failed = result.filter(r => r.name === 'CHECK_FAILED')
    expect(failed).toHaveLength(1)
    expect(failed[0].constructor).toBe(ValidationError)
  })

  test('is reported by a custom task runner too', async () => {
    failing.prepTool = true
    try {
      const ctx = { raw: Buffer.from(XML), filename: FILENAME, options: { mode: MODES.FORGIVE_CHECKLIST, offline: true } }
      const result = []
      for (const valGroup of getAllValidations(getDocType(FILENAME))) {
        for (const valTask of valGroup.tasks) {
          const taskResult = await valTask.task(ctx)
          if (!valTask.isVoid) {
            result.push(...taskResult)
          }
        }
      }
      const failed = result.filter(r => r.name === 'CHECK_FAILED')
      expect(failed).toHaveLength(1)
      expect(failed[0].constructor).toBe(ValidationError)
    } finally {
      failing.prepTool = false
    }
  })

  test('labelling the findings that fails keeps the findings', async () => {
    const expected = (await run(MODES.NORMAL)).map(r => r.name)
    const result = await run(MODES.NORMAL, { labels: true })
    expect(result.slice(0, -1).map(r => r.name)).toEqual(expected)
    expect(result.at(-1).name).toBe('CHECK_FAILED')
    expect(result.at(-1).message).toContain('"Locations of the findings" check failed')
  })

  test('parsing still stops the run', async () => {
    await expect(checkNits(Buffer.from('<rfc><front>'), FILENAME, { offline: true })).rejects.toThrow()
  })

  test.each(['constructor', '__proto__'])('an element named %s still stops the run as a parsing failure', async (tag) => {
    const xml = XML.replace('<toString a="1"><t>x</t></toString>', `<${tag} a="1"><t>x</t></${tag}>`)
    await expect(checkNits(Buffer.from(xml), FILENAME, { offline: true })).rejects.toMatchObject({ name: 'XML_PARSING_FAILED' })
  })

  test('finalizeFindings() reports a failure as an Error', () => {
    failing.labels = true
    try {
      const findings = finalizeFindings([], { type: 'xml', data: {} })
      expect(findings).toHaveLength(1)
      expect(findings[0].constructor).toBe(ValidationError)
    } finally {
      failing.labels = false
    }
  })
})
