import type { Request, Response } from 'express'
import { InputValidationError } from '../utils/publicError'
import {
  deleteSchedule,
  findScheduleById,
  generateNextScheduleId,
  listSchedules,
  upsertSchedule,
} from '../data/scheduleRepository'
import type { Schedule, Weekday } from '../types'

const WEEKDAYS = new Set<Weekday>(['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'])

interface ScheduleBody {
  tvId?: string
  playlistId?: string
  horaInicio?: string
  horaFim?: string
  diasSemana?: Weekday[]
}

export async function getSchedules(_req: Request, res: Response) {
  res.json(await listSchedules())
}

export async function getScheduleById(req: Request, res: Response) {
  const schedule = await findScheduleById(req.params.id)

  if (!schedule) {
    return res.status(404).json({ message: 'Agendamento não encontrado' })
  }

  res.json(schedule)
}

export async function createSchedule(req: Request, res: Response) {
  const id = await generateNextScheduleId()
  const schedule = normalizeSchedule(id, req.body as ScheduleBody)

  await upsertSchedule(schedule)
  res.status(201).json(schedule)
}

export async function updateSchedule(req: Request, res: Response) {
  const existing = await findScheduleById(req.params.id)

  if (!existing) {
    return res.status(404).json({ message: 'Agendamento não encontrado' })
  }

  const schedule = normalizeSchedule(existing.id, req.body as ScheduleBody)
  await upsertSchedule(schedule)
  res.json(schedule)
}

export async function removeSchedule(req: Request, res: Response) {
  const removed = await deleteSchedule(req.params.id)

  if (!removed) {
    return res.status(404).json({ message: 'Agendamento não encontrado' })
  }

  res.status(204).send()
}

function normalizeSchedule(id: string, body: ScheduleBody): Schedule {
  if (!body.tvId) {
    throw new InputValidationError('Informe a TV do agendamento')
  }

  if (!body.playlistId) {
    throw new InputValidationError('Informe a playlist do agendamento')
  }

  if (!isTime(body.horaInicio)) {
    throw new InputValidationError('Informe a hora inicial no formato HH:mm')
  }

  if (!isTime(body.horaFim)) {
    throw new InputValidationError('Informe a hora final no formato HH:mm')
  }

  const diasSemana = (body.diasSemana ?? []).filter((day) => WEEKDAYS.has(day))

  if (diasSemana.length === 0) {
    throw new InputValidationError('Selecione ao menos um dia da semana')
  }

  return {
    id,
    tvId: body.tvId,
    playlistId: body.playlistId,
    horaInicio: body.horaInicio,
    horaFim: body.horaFim,
    diasSemana,
  }
}

function isTime(value: string | undefined): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}
