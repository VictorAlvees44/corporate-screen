import { mutateJSON, readJSON } from './jsonStore'
import type { Birthday } from '../types'

const FILE_NAME = 'birthdays.json'

export async function listBirthdays(): Promise<Birthday[]> {
  return readJSON<Birthday[]>(FILE_NAME, [])
}

export async function findBirthdayById(id: string): Promise<Birthday | undefined> {
  const birthdays = await listBirthdays()
  return birthdays.find((birthday) => birthday.id === id)
}

export async function upsertBirthday(birthday: Birthday): Promise<Birthday> {
  await mutateJSON<Birthday[]>(FILE_NAME, [], (current) => {
    const index = current.findIndex((item) => item.id === birthday.id)

    if (index >= 0) {
      const next = [...current]
      next[index] = birthday
      return next
    }

    return [...current, birthday]
  })

  return birthday
}

export async function deleteBirthday(id: string): Promise<boolean> {
  let removed = false

  await mutateJSON<Birthday[]>(FILE_NAME, [], (current) => {
    const next = current.filter((birthday) => birthday.id !== id)
    removed = next.length !== current.length
    return next
  })

  return removed
}

export async function generateNextBirthdayId(): Promise<string> {
  const birthdays = await listBirthdays()

  const maxNumber = birthdays.reduce((max, birthday) => {
    const match = birthday.id.match(/^birthday-(\d+)$/)
    if (!match) return max
    return Math.max(max, Number(match[1]))
  }, 0)

  return `birthday-${String(maxNumber + 1).padStart(3, '0')}`
}
