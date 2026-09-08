import type { NextFunction, Request, Response } from 'express'
import { findAuthenticatedAdmin } from '../utils/adminAccess'
import { clearSessionCookie, getSessionToken } from '../utils/authSession'

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getSessionToken(req)

  if (!token) {
    return res.status(401).json({ message: 'Não autenticado' })
  }

  // Revalida a autorização em toda requisição. Remover um usuário ou alterar
  // sua função passa a surtir efeito imediatamente, sem esperar até 30 dias.
  const authorizedUser = await findAuthenticatedAdmin(token)
  if (!authorizedUser) {
    clearSessionCookie(res)
    return res.status(401).json({ message: 'Acesso revogado' })
  }

  res.locals.authenticatedUser = authorizedUser.email
  res.locals.authenticatedRole = authorizedUser.role
  next()
}
