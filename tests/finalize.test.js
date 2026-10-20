import { describe, expect, test } from 'vitest'
import { ValidationWarning, checkNits, finalizeFindings, getAllValidations, getDocType } from '../lib/index.mjs'
import { parse } from '../lib/parsers/xml.mjs'

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-test-finalize-00" ipr="trust200902" category="std" submissionType="IETF">
  <front>
    <title>Finalize Test</title>
    <author fullname="Jane Doe" initials="J." surname="Doe"/>
    <date year="2025" month="1" day="1"/>
    <abstract><t>Abstract.</t></abstract>
  </front>
  <middle>
    <section><name>Introduction</name>
      <t>Intro.</t>
      <t>Implementations MUST do this.</t>
    </section>
  </middle>
</rfc>
`

/**
 * Run the validations the way a custom task runner (such as the CLI's) does
 */
async function runValidations (raw, filename) {
  const result = []
  const ctx = { raw, filename, options: { offline: true } }
  for (const valGroup of getAllValidations(getDocType(filename))) {
    if (valGroup.condition && !valGroup.condition(ctx)) {
      continue
    }
    for (const valTask of valGroup.tasks) {
      const taskResult = await valTask.task(ctx)
      if (!valTask.isVoid && Array.isArray(taskResult)) {
        result.push(...taskResult)
      }
    }
  }
  return { result, ctx }
}

const summarize = (findings) => findings.map(f => ({ name: f.name, path: f.path, label: f.label, lines: f.lines }))

describe('finalizeFindings()', () => {
  test('should add the label and source line to XML findings with a path', async () => {
    const { doc } = await parse(SAMPLE_XML, 'draft-test-finalize-00.xml')
    const findings = [
      new ValidationWarning('A', 'a', { path: 'rfc.middle.section[0].t[1]' }),
      new ValidationWarning('B', 'b')
    ]
    expect(finalizeFindings(findings, doc)).toBe(findings)
    expect(findings[0].label).toEqual('Section 1 (Introduction), paragraph 2')
    expect(findings[0].lines).toEqual([{ line: 12, pos: 7 }])
    expect(findings[1].label).toBeUndefined()
    expect(findings[1].lines).toBeUndefined()
  })

  test('should give a custom task runner the same findings as checkNits()', async () => {
    const raw = Buffer.from(SAMPLE_XML)
    const filename = 'draft-test-finalize-00.xml'
    const { result, ctx } = await runValidations(raw, filename)
    finalizeFindings(result, ctx.doc)
    const expected = await checkNits(raw, filename, { offline: true })
    const finding = result.find(r => r.name === 'MISSING_BCP14_TAGS')
    expect(finding?.lines).toEqual([{ line: 12, pos: 7 }])
    expect(summarize(result)).toEqual(summarize(expected))
  })
})
