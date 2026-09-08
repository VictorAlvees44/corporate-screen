import type { Request, Response } from 'express'
import { addAuthorizedUser, listAuthorizedUsers, removeAuthorizedUser } from '../data/userRepository'
import type { UserRole } from '../types'

export async function getAuthorizedUsers(_req: Request, res: Response) {
  res.json(await listAuthorizedUsers())
}

export async function createAuthorizedUser(req: Request, res: Response) {
  const body = req.body as { email?: string; role?: UserRole }
  const email = String(body.email ?? '').trim().toLowerCase()
  const currentUser = String(res.locals.authenticatedUser ?? '').toLowerCase()
  const requestedRole = body.role ?? 'editor'
  if (!isValidEmail(email)) return res.status(400).json({ message: 'Informe um e-mail válido' })
  const domain = process.env.GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase()
  if (!domain) return res.status(503).json({ message: 'Domínio Google Workspace não configurado' })
  if (!email.endsWith(`@${domain}`)) return res.status(400).json({ message: `Use um e-mail do Google Workspace @${domain}` })
  if (!['admin', 'editor'].includes(requestedRole)) return res.status(400).json({ message: 'Perfil inválido' })
  if (email === currentUser && requestedRole === 'editor') {
    return res.status(400).json({ message: 'Você não pode retirar a própria permissão de administrador' })
  }
  await addAuthorizedUser(email, requestedRole)
  res.status(201).json(await listAuthorizedUsers())
}

export async function deleteAuthorizedUser(req: Request, res: Response) {
  const email = decodeURIComponent(req.params.email).trim().toLowerCase()
  const currentUser = String(res.locals.authenticatedUser ?? '').toLowerCase()
  if (email === currentUser) return res.status(400).json({ message: 'Você não pode remover o próprio acesso' })

  const removed = await removeAuthorizedUser(email)
  if (!removed) return res.status(404).json({ message: 'Usuário não encontrado' })
  res.status(204).send()
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
