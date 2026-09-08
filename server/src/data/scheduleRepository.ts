import { mutateJSON, readJSON } from './jsonStore'
import { getOperationalMoment, isScheduleActiveAt } from '../utils/operationalSchedule'
import type { Schedule } from '../types'

const FILE_NAME = 'schedules.json'

export async function listSchedules(): Promise<Schedule[]> {
  return readJSON<Schedule[]>(FILE_NAME, [])
}
export async function findScheduleById(id: string): Promise<Schedule | undefined> {
  const schedules = await listSchedules()
  return schedules.find((schedule) => schedule.id === id)
}

export async function upsertSchedule(schedule: Schedule): Promise<Schedule> {
  await mutateJSON<Schedule[]>(FILE_NAME, [], (current) => {
    const index = current.findIndex((item) => item.id === schedule.id)

    if (index >= 0) {
      const next = [...current]
      next[index] = schedule
      return next
    }

    return [...current, schedule]
  })

  return schedule
}

export async function deleteSchedule(id: string): Promise<boolean> {
  let removed = false

  await mutateJSON<Schedule[]>(FILE_NAME, [], (current) => {
    const next = current.filter((schedule) => schedule.id !== id)
    removed = next.length !== current.length
    return next
  })

  return removed
}

export async function deleteSchedulesForTV(tvId: string): Promise<number> {
  let removedCount = 0

  await mutateJSON<Schedule[]>(FILE_NAME, [], (current) => {
    const next = current.filter((schedule) => schedule.tvId !== tvId)
    removedCount = current.length - next.length
    return next
  })

  return removedCount
}

export async function findActiveScheduleForTV(tvId: string, date = new Date()): Promise<Schedule | null> {
  const schedules = await listSchedules()
  // Calculado sempre em America/Sao_Paulo (não no fuso implícito do processo
  // Node), para que o dia/hora do agendamento não dependam de onde o
  // servidor está hospedado.
  const moment = getOperationalMoment(date)

  return (
    schedules.find(
      (schedule) =>
        schedule.tvId === tvId &&
        isScheduleActiveAt(schedule.diasSemana, schedule.horaInicio, schedule.horaFim, moment),
    ) ?? null
  )
}

export async function generateNextScheduleId(): Promise<string> {
  const schedules = await listSchedules()

  const maxNumber = schedules.reduce((max, schedule) => {
    const match = schedule.id.match(/^sched-(\d+)$/)
    if (!match) return max
    return Math.max(max, Number(match[1]))
  }, 0)

  return `sched-${String(maxNumber + 1).padStart(3, '0')}`
}
