import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getFixedOperationalWindowState,
  isScheduleActiveAt,
  parseTimeToMinutes,
} from '../dist/utils/operationalSchedule.js'

test('converte e rejeita horários inválidos', () => {
  assert.equal(parseTimeToMinutes('07:30'), 450)
  assert.equal(parseTimeToMinutes('23:59'), 1439)
  assert.equal(parseTimeToMinutes('24:00'), null)
  assert.equal(parseTimeToMinutes('8:7'), null)
})

test('aplica a janela operacional fixa e modos de pausa', () => {
  assert.deepEqual(
    getFixedOperationalWindowState('normal', { weekday: 'seg', minutesOfDay: 450 }),
    { dentroHorarioOperacional: true, standbyReason: null },
  )
  assert.equal(
    getFixedOperationalWindowState('normal', { weekday: 'sab', minutesOfDay: 600 }).dentroHorarioOperacional,
    false,
  )
  assert.equal(
    getFixedOperationalWindowState('ferias', { weekday: 'seg', minutesOfDay: 600 }).dentroHorarioOperacional,
    false,
  )
})

test('mantém agendamento ativo depois da meia-noite no dia seguinte', () => {
  assert.equal(
    isScheduleActiveAt(['seg'], '22:00', '02:00', { weekday: 'seg', minutesOfDay: 1380 }),
    true,
  )
  assert.equal(
    isScheduleActiveAt(['seg'], '22:00', '02:00', { weekday: 'ter', minutesOfDay: 60 }),
    true,
  )
  assert.equal(
    isScheduleActiveAt(['seg'], '22:00', '02:00', { weekday: 'ter', minutesOfDay: 180 }),
    false,
  )
})
