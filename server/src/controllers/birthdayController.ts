import type { Request, Response } from 'express'
import { InputValidationError } from '../utils/publicError'
import {
  deleteBirthday,
  findBirthdayById,
  generateNextBirthdayId,
  listBirthdays,
  upsertBirthday,
} from '../data/birthdayRepository'
import type { Birthday } from '../types'

interface BirthdayBody {
  nome?: string
  dia?: number
  mes?: number
  setor?: string
}

export async function getBirthdays(_req: Request, res: Response) {
  res.json(await listBirthdays())
}

export async function getBirthdayById(req: Request, res: Response) {
  const birthday = await findBirthdayById(req.params.id)

  if (!birthday) {
    return res.status(404).json({ message: 'Aniversariante não encontrado' })
  }

  res.json(birthday)
}

export async function createBirthday(req: Request, res: Response) {
  const id = await generateNextBirthdayId()
  const birthday = normalizeBirthday(id, req.body as BirthdayBody)

  await upsertBirthday(birthday)
  res.status(201).json(birthday)
}

export async function updateBirthday(req: Request, res: Response) {
  const existing = await findBirthdayById(req.params.id)

  if (!existing) {
    return res.status(404).json({ message: 'Aniversariante não encontrado' })
  }

  const birthday = normalizeBirthday(existing.id, req.body as BirthdayBody)
  await upsertBirthday(birthday)
  res.json(birthday)
}

export async function removeBirthday(req: Request, res: Response) {
  const removed = await deleteBirthday(req.params.id)

  if (!removed) {
    return res.status(404).json({ message: 'Aniversariante não encontrado' })
  }

  res.status(204).send()
}

// Usado pela rota pública do player/widget: retorna apenas quem faz
// aniversário hoje, já ordenado, sem exigir autenticação.
export async function getTodayBirthdays(_req: Request, res: Response) {
  const birthdays = await listBirthdays()
  const now = new Date()
  const today = birthdays.filter(
    (birthday) => birthday.dia === now.getDate() && birthday.mes === now.getMonth() + 1,
  )

  res.json(today)
}

function normalizeBirthday(id: string, body: BirthdayBody): Birthday {
  const nome = body.nome?.trim()

  if (!nome) {
    throw new InputValidationError('Informe o nome do aniversariante')
  }

  const dia = Number(body.dia)
  const mes = Number(body.mes)

  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    throw new InputValidationError('Informe um dia válido (1 a 31)')
  }

  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new InputValidationError('Informe um mês válido (1 a 12)')
  }

  return {
    id,
    nome,
    dia,
    mes,
    setor: body.setor?.trim() ?? '',
  }
}
