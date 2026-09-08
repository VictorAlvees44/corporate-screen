import type { Request, Response } from 'express'
import { SESSION_TTL_MS } from '../data/sessionStore'

export const AUTH_COOKIE_NAME = 'corporate-screen.session'

export function getSessionToken(req: Request): string | null {
  return getRequestCookie(req, AUTH_COOKIE_NAME)
}

export function getRequestCookie(req: Request, cookieName: string): string | null {
  const cookieHeader = req.header('cookie')
  if (!cookieHeader) return null

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const name = part.slice(0, separator).trim()
    if (name !== cookieName) continue

    try {
      return decodeURIComponent(part.slice(separator + 1).trim()) || null
    } catch {
      return null
    }
  }

  return null
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'lax',
    path: '/',
  })
}

export function shouldUseSecureCookie(): boolean {
  if (process.env.COOKIE_SECURE === 'true') return true
  if (process.env.COOKIE_SECURE === 'false') return false
  return process.env.NODE_ENV === 'production'
}
