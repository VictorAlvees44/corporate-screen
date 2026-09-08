import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBackupTime } from '../dist/services/backupScheduler.js'

test('valida o horário do backup interno', () => {
  assert.deepEqual(parseBackupTime('20:00'), { hours: 20, minutes: 0 })
  assert.deepEqual(parseBackupTime('7:05'), { hours: 7, minutes: 5 })
  assert.equal(parseBackupTime('24:00'), null)
  assert.equal(parseBackupTime('20:7'), null)
})
