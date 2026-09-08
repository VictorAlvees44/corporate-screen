import type { NextFunction, Request, Response } from 'express'

export function requireAdmin(_req: Request, res: Response, next: NextFunction) {
  if (res.locals.authenticatedRole !== 'admin') {
    return res.status(403).json({ message: 'Esta ação exige perfil de administrador' })
  }
  next()
}
