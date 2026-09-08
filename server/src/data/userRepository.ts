import { mutateJSON, readJSON } from './jsonStore'
import type { AuthorizedUser, UserRole } from '../types'

const FILE_NAME = 'users.json'

export async function listAuthorizedUsers(): Promise<AuthorizedUser[]> {
  const users = await readJSON<Array<string | AuthorizedUser>>(FILE_NAME, [])
  return users.map(normalizeUser).filter((user): user is AuthorizedUser => user !== null)
}

export async function findAuthorizedUser(email: string): Promise<AuthorizedUser | undefined> {
  const normalizedEmail = normalizeEmail(email)
  return (await listAuthorizedUsers()).find((user) => user.email === normalizedEmail)
}

export async function findAuthorizedAdmin(email: string): Promise<AuthorizedUser | undefined> {
  const user = await findAuthorizedUser(email)
  return user?.role === 'admin' ? user : undefined
}

export async function addAuthorizedUser(email: string, role: UserRole = 'editor'): Promise<AuthorizedUser> {
  const normalizedEmail = normalizeEmail(email)
  const user: AuthorizedUser = { email: normalizedEmail, role }
  await mutateJSON<Array<string | AuthorizedUser>>(FILE_NAME, [], (current) => {
    const users = current.map(normalizeUser).filter((item): item is AuthorizedUser => item !== null)
    return users.some((item) => item.email === normalizedEmail)
      ? users.map((item) => item.email === normalizedEmail ? user : item)
      : [...users, user].sort((first, second) => first.email.localeCompare(second.email))
  })
  return user
}

export async function removeAuthorizedUser(email: string): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email)
  let removed = false
  await mutateJSON<Array<string | AuthorizedUser>>(FILE_NAME, [], (current) => {
    const users = current.map(normalizeUser).filter((user): user is AuthorizedUser => user !== null)
    const next = users.filter((user) => user.email !== normalizedEmail)
    removed = next.length !== users.length
    return next
  })
  return removed
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeUser(value: string | AuthorizedUser): AuthorizedUser | null {
  if (typeof value === 'string') {
    const email = normalizeEmail(value)
    // A legacy entry is not an explicit admin grant.
    return email ? { email, role: 'editor' } : null
  }

  const email = normalizeEmail(value.email ?? '')
  const role: UserRole = value.role === 'admin' ? 'admin' : 'editor'
  return email ? { email, role } : null
}
