import { deleteSession, findSession } from '../data/sessionStore'
import { findAuthorizedAdmin } from '../data/userRepository'
import type { AuthorizedUser } from '../types'

// Shared by Express, Worker APIs, uploads, rankings and monitoring.
// Recheck current grants, not the role recorded when the user signed in.
export async function findAuthenticatedAdmin(token: string): Promise<AuthorizedUser | null> {
  const session = await findSession(token)
  if (!session) return null
  const domain = process.env.GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase()
  const admin = domain && session.email.endsWith(`@${domain}`)
    ? await findAuthorizedAdmin(session.email)
    : undefined
  if (!admin) {
    await deleteSession(token)
    return null
  }
  return admin
}
