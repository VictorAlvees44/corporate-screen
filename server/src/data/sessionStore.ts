import { createHash, randomUUID } from 'crypto'
import { mutateJSON, readJSON } from './jsonStore'

export interface AuthSession {
  token: string
  email: string
  role: 'admin'
  createdAt: string
}

interface StoredAuthSession {
  tokenHash: string
  email: string
  role: 'admin'
  authMethod: string
  createdAt: string
}

const FILE_NAME = 'sessions.json'
const AUTH_METHOD = 'google-workspace-admin-v1'

// O navegador recebe o token bruto uma única vez. A persistência guarda
// somente SHA-256; assim uma leitura indevida do JSON/D1 não entrega cookies
// de sessão reutilizáveis.
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 horas; nova validação Workspace a cada expediente

// Called only after a verified Google identity and an explicit admin grant.
export async function createWorkspaceAdminSession(email: string): Promise<AuthSession> {
  const session: AuthSession = {
    token: randomUUID(),
    email: email.trim().toLowerCase(),
    role: 'admin',
    createdAt: new Date().toISOString(),
  }

  const storedSession: StoredAuthSession = {
    tokenHash: hashToken(session.token),
    email: session.email,
    role: session.role,
    authMethod: AUTH_METHOD,
    createdAt: session.createdAt,
  }

  await mutateJSON<StoredAuthSession[]>(FILE_NAME, [], (sessions) => [
    ...sessions.filter(isCurrentSession),
    storedSession,
  ])
  return session
}

export async function findSession(token: string): Promise<AuthSession | undefined> {
  const sessions = await readJSON<StoredAuthSession[]>(FILE_NAME, [])
  const tokenHash = hashToken(token)
  const session = sessions.find((item) => item.tokenHash === tokenHash)

  if (!session) {
    return undefined
  }

  if (!isCurrentSession(session)) {
    await deleteSession(token)
    return undefined
  }

  return { token, email: session.email, role: session.role, createdAt: session.createdAt }
}

export async function deleteSession(token: string): Promise<void> {
  const tokenHash = hashToken(token)
  await mutateJSON<StoredAuthSession[]>(FILE_NAME, [], (sessions) =>
    sessions.filter((session) => session.tokenHash !== tokenHash),
  )
}

function isExpired(session: Pick<StoredAuthSession, 'createdAt'>): boolean {
  const createdAt = Date.parse(session.createdAt)
  return Number.isNaN(createdAt) || Date.now() - createdAt > SESSION_TTL_MS
}

function isCurrentSession(session: StoredAuthSession): boolean {
  // Old/password sessions have no marker and are invalid after this rollout.
  return session.authMethod === AUTH_METHOD && session.role === 'admin' && !isExpired(session)
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
