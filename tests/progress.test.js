import { describe, expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import { checkNits, getAllValidations } from '../lib/index.mjs'

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-test-progress-00" ipr="trust200902" category="std" submissionType="IETF">
  <front>
    <title>Progress Test</title>
    <author fullname="Jane Doe" initials="J." surname="Doe"/>
    <date year="2025" month="1" day="1"/>
    <abstract><t>Abstract.</t></abstract>
  </front>
  <middle>
    <section><name>Introduction</name><t>Implementations MUST do this.</t></section>
  </middle>
</rfc>
`
const MALFORMED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rfc version="3" docName="draft-test-progress-00">
  <front><title>Progress Test</title>
</rfc>
`

/**
 * Run checkNits(), offline, keeping the progress events it gives
 *
 * @param {string} contents Document contents
 * @param {string} filename Filename of the document
 * @returns {Promise<{events: Object[], result: Array}>} Progress events and findings
 */
async function runWithProgress (contents, filename) {
  const events = []
  const result = await checkNits(Buffer.from(contents), filename, {
    offline: true,
    onProgress: (event) => {
      events.push(event)
    }
  })
  return { events, result }
}

/**
 * The events of one group, from the one that starts or skips it to the one before the next group's
 *
 * @param {Object[]} events Progress events
 * @param {string} group Key of the group
 * @returns {Object[]} Events of the group
 */
function groupEvents (events, group) {
  const first = events.findIndex(event => event.group === group)
  let last = first + 1
  while (last < events.length && events[last].group === group) {
    last++
  }
  return events.slice(first, last)
}

describe('Progress of checkNits()', () => {
  test('each group starts, then each of its tasks is done', async () => {
    const { events, result } = await runWithProgress(XML, 'draft-test-progress-00.xml')
    const validations = getAllValidations('xml')

    const groupStarts = events.filter(event => event.type === 'groupStarted')
    expect(groupStarts.map(event => event.group)).toEqual(validations.map(valGroup => valGroup.key))
    for (const valGroup of validations) {
      const ofGroup = groupEvents(events, valGroup.key)
      expect(ofGroup[0]).toEqual({ type: 'groupStarted', group: valGroup.key })
      const tasksDone = ofGroup.slice(1)
      expect(tasksDone.every(event => event.type === 'taskDone')).toBe(true)
      const keysDone = tasksDone.map(event => event.task)
      expect(keysDone.sort()).toEqual(valGroup.tasks.map(valTask => valTask.key).sort())
    }

    // -> The findings are the same with or without onProgress
    const withoutProgress = await checkNits(Buffer.from(XML), 'draft-test-progress-00.xml', { offline: true })
    expect(result.map(r => `${r.name} ${r.message}`)).toEqual(withoutProgress.map(r => `${r.name} ${r.message}`))
  })

  test('a group whose condition is not met is skipped', async () => {
    const draft = await readFile(new URL('./fixtures/draft-beep-boop.txt', import.meta.url), 'utf8')
    const rfc = draft.replace('Internet-Draft', 'Request for Comments: 9999')
    const { events } = await runWithProgress(rfc, 'rfc9999.txt')

    expect(groupEvents(events, 'txtdraft')).toEqual([{ type: 'groupSkipped', group: 'txtdraft' }])
    expect(groupEvents(events, 'lookups')[0]).toEqual({ type: 'groupStarted', group: 'lookups' })
  })

  test('a parsing failure is the last event, and stops the run', async () => {
    const events = []
    const run = checkNits(Buffer.from(MALFORMED_XML), 'draft-test-progress-00.xml', {
      offline: true,
      onProgress: (event) => {
        events.push(event)
      }
    })
    await expect(run).rejects.toThrow('Expected closing tag')

    const last = events[events.length - 1]
    expect(last.type).toBe('taskFailed')
    expect(last.group).toBe('parse')
    expect(last.task).toBe('parsexml')
    await expect(run).rejects.toBe(last.error)
    expect(events.filter(event => event.type === 'groupStarted').map(event => event.group)).toEqual(['preparsing', 'parse'])
  })
})
