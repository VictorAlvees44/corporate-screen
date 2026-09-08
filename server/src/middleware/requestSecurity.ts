import type { NextFunction, Request, Response } from 'express'

export function rejectCrossSiteMutation(allowedOrigins: Set<string>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
    const origin = req.get('origin')
    if ((origin && !allowedOrigins.has(origin)) || req.get('sec-fetch-site') === 'cross-site') {
      return res.status(403).json({ message: 'Origem da requisição não autorizada' })
    }
    return next()
  }
}

// Contingência Node: não confia em X-Forwarded-For informado pelo visitante.
const loginAttempts = new Map<string, { start: number; count: number }>()
export function googleLoginLimiter(req: Request, res: Response, next: NextFunction) {
  const now = Date.now()
  for (const [key, entry] of loginAttempts) if (now - entry.start >= 900000) loginAttempts.delete(key)
  const key = req.ip || req.socket.remoteAddress || 'unknown'
  const entry = loginAttempts.get(key) || { start: now, count: 0 }
  if (entry.count >= 30 || (!loginAttempts.has(key) && loginAttempts.size >= 10000)) {
    res.setHeader('Retry-After', '900')
    return res.status(429).json({ message: 'Muitas tentativas de acesso. Aguarde 15 minutos.' })
  }
  entry.count += 1; loginAttempts.set(key, entry)
  return next()
}
