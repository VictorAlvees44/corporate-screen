import type { NextFunction, Request, Response } from 'express'

/**
 * Cabeçalhos que reduzem exposição do painel sem bloquear os iframes, mídias
 * e scripts necessários ao player legado das TVs. A política CSP é
 * propositalmente enxuta: widgets podem carregar conteúdo externo autorizado
 * pelo administrador, mas o Corporate Screen não pode ser incorporado por
 * outro site.
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), screen-wake-lock=(self)')
  const playerNeedsInlineScripts = req.path === '/' || req.path === '/player-legacy' || req.path === '/player-legacy.html'
  const scriptPolicy = playerNeedsInlineScripts ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'"
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      scriptPolicy,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https: http:",
      "media-src 'self' blob: https: http:",
      "connect-src 'self' https: http:",
      "frame-src 'self' https: http: data: blob:",
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  )

  // Respostas que contêm sessão, estado do player ou dados do painel nunca
  // devem ser reaproveitadas por cache intermediário ou navegador.
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store')
  }

  // HSTS só tem valor sob HTTPS; no modo HTTP de contingência não o enviamos
  // para não deixar clientes presos em HTTPS quando o certificado não existe.
  if (req.secure || req.protocol === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  }

  next()
}
