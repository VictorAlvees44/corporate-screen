import type { Env } from './env'

interface RateLimitRow {
  attempts: number
  window_started_at: number
  blocked_until: number
}

export interface RateLimitDecision {
  allowed: boolean
  retryAfterSeconds: number
  key: string
}

export function rejectCrossSiteMutation(request: Request): Response | null {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return null

  const requestOrigin = new URL(request.url).origin
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  if ((origin && origin !== requestOrigin) || fetchSite === 'cross-site') {
    return secureJson({ message: 'Origem da requisição não autorizada' }, 403)
  }

  return null
}

export function rejectOversizedRequest(request: Request, pathName: string): Response | null {
  const declaredBytes = Number(request.headers.get('content-length') ?? 0)
  if (!Number.isFinite(declaredBytes) || declaredBytes <= 0) return null

  const maximumBytes = pathName.startsWith('/api/uploads/media')
    ? 95 * 1024 * 1024
    : pathName.match(/^\/api\/rankings\/[^/]+\/import$/)
      ? 5 * 1024 * 1024
      : 1024 * 1024

  return declaredBytes > maximumBytes
    ? secureJson({ message: `Requisição acima do limite de ${formatLimit(maximumBytes)}` }, 413)
    : null
}

export async function consumeRateLimit(
  env: Env,
  request: Request,
  scope: string,
  subject: string,
  limit: number,
  windowMs: number,
  blockMs: number,
): Promise<RateLimitDecision> {
  const now = Date.now()
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const key = await sha256(`${scope}:${address}:${subject.trim().toLowerCase()}`)
  const row = await env.DB.prepare(
    'SELECT attempts, window_started_at, blocked_until FROM security_rate_limits WHERE key = ?1',
  ).bind(key).first<RateLimitRow>()

  if (row && row.blocked_until > now) {
    return { allowed: false, retryAfterSeconds: secondsUntil(row.blocked_until, now), key }
  }

  const windowStartedAt = row && now - row.window_started_at < windowMs
    ? row.window_started_at
    : now
  const attempts = row && windowStartedAt === row.window_started_at ? row.attempts + 1 : 1
  const blockedUntil = attempts > limit ? now + blockMs : 0

  await env.DB.prepare(`
    INSERT INTO security_rate_limits (key, attempts, window_started_at, blocked_until, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(key) DO UPDATE SET
      attempts = excluded.attempts,
      window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until,
      updated_at = excluded.updated_at
  `).bind(key, attempts, windowStartedAt, blockedUntil, now).run()

  return {
    allowed: attempts <= limit,
    retryAfterSeconds: attempts <= limit ? 0 : secondsUntil(blockedUntil, now),
    key,
  }
}

export async function clearRateLimit(env: Env, key: string): Promise<void> {
  await env.DB.prepare('DELETE FROM security_rate_limits WHERE key = ?1').bind(key).run()
}

export function rateLimitResponse(decision: RateLimitDecision): Response {
  const response = secureJson({ message: 'Muitas tentativas. Aguarde antes de tentar novamente.' }, 429)
  response.headers.set('retry-after', String(decision.retryAfterSeconds))
  return response
}

export function withApiSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'no-store')
  headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  headers.set('referrer-policy', 'no-referrer')
  headers.set('strict-transport-security', 'max-age=15552000; includeSubDomains')
  headers.set('x-content-type-options', 'nosniff')
  headers.set('x-frame-options', 'DENY')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export function secureJson(value: unknown, status = 200): Response {
  return withApiSecurityHeaders(Response.json(value, { status }))
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function secondsUntil(target: number, now: number): number {
  return Math.max(1, Math.ceil((target - now) / 1000))
}

function formatLimit(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${bytes} bytes`
}
