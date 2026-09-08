import type { Env } from './env'
import { D1JsonStoreAdapter } from './d1JsonStoreAdapter'
import { configureJsonStoreAdapter } from '../../server/src/runtime/jsonStoreAdapter'
import { listTVs } from '../../server/src/data/tvRepository'
import { handleMediaApi, serveMedia } from './media'
import { routeApi } from './apiRouter'
import { handleMonitoring } from './monitoring'
import {
  rejectCrossSiteMutation,
  rejectOversizedRequest,
  secureJson,
  withApiSecurityHeaders,
} from './security'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    configureJsonStoreAdapter(new D1JsonStoreAdapter(env.DB))
    const url = new URL(request.url)

    try {
      if (url.pathname.startsWith('/api/')) {
        const rejectedOrigin = rejectCrossSiteMutation(request)
        if (rejectedOrigin) return rejectedOrigin
        const oversized = rejectOversizedRequest(request, url.pathname)
        if (oversized) return oversized
      }

      if (url.pathname === '/api/health') return withApiSecurityHeaders(await healthResponse())
      if (url.pathname === '/api/uploads/media' || url.pathname === '/api/uploads/media/batch') {
        return withApiSecurityHeaders(await handleMediaApi(request, env))
      }
      if (url.pathname.startsWith('/uploads/')) return withPublicMediaSecurityHeaders(await serveMedia(request, env))
      if (url.pathname.startsWith('/api/monitoring/')) return handleMonitoring(request, env, url.pathname)

      if (url.pathname.startsWith('/api/')) {
        return withApiSecurityHeaders(await routeApi(request, env))
      }

      if (url.pathname === '/player' || url.pathname === '/player/') {
        return Response.redirect(new URL('/', request.url), 308)
      }

      if (url.pathname === '/' && needsLegacyPlayer(request.headers.get('user-agent') ?? '')) {
        return Response.redirect(new URL('/player-legacy', request.url), 302)
      }

      const assetResponse = await env.ASSETS.fetch(request)
      return withStaticSecurityHeaders(assetResponse, url.pathname)
    } catch (error) {
      console.error('[worker] Falha ao atender requisição', error)
      return secureJson({ message: 'Erro interno do servidor' }, 500)
    }
  },
}

async function healthResponse(): Promise<Response> {
  const tvs = await listTVs()
  const incompatibleTVs = tvs.filter((tv) => tv.compatibilidade === 'incompativel').length
  const pendingTVs = tvs.filter((tv) => tv.approvalStatus === 'pendente').length
  const offlineTVs = tvs.filter((tv) => tv.status === 'offline').length
  const alerts: { code: string; count?: number; message: string }[] = []
  if (incompatibleTVs > 0) alerts.push({ code: 'INCOMPATIBLE_TVS', count: incompatibleTVs, message: `${incompatibleTVs} TV(s) com navegador incompatível` })
  if (pendingTVs > 0) alerts.push({ code: 'PENDING_TVS', count: pendingTVs, message: `${pendingTVs} TV(s) aguardando aprovação` })
  if (offlineTVs > 0) alerts.push({ code: 'OFFLINE_TVS', count: offlineTVs, message: `${offlineTVs} TV(s) offline` })
  return Response.json(
    { status: 'ok', timestamp: new Date().toISOString(), alerts },
    { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } },
  )
}

function withStaticSecurityHeaders(response: Response, pathName: string): Response {
  const headers = new Headers(response.headers)
  headers.set('x-content-type-options', 'nosniff')
  headers.set('x-frame-options', 'DENY')
  headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), screen-wake-lock=(self)')
  headers.set('strict-transport-security', 'max-age=15552000; includeSubDomains')
  const legacyPlayer = pathName === '/player-legacy' || pathName === '/player-legacy.html'
  const inlineScripts = pathName === '/' || legacyPlayer
  headers.set('content-security-policy', [
    "default-src 'self'",
    inlineScripts ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
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
  ].join('; '))
  if (legacyPlayer) headers.set('cache-control', 'no-store, max-age=0')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function withPublicMediaSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('cross-origin-resource-policy', 'same-site')
  headers.set('referrer-policy', 'no-referrer')
  headers.set('strict-transport-security', 'max-age=15552000; includeSubDomains')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function needsLegacyPlayer(userAgent: string): boolean {
  if (/smart-tv|smarttv|hbbtv|netcast|viera|aquos|tizen|web0s|webos|samsungbrowser|maple|inettvbrowser/i.test(userAgent)) {
    return true
  }
  if (/MSIE\s|Trident\//i.test(userAgent) || /Edge\/\d+/i.test(userAgent)) return true

  return isVersionOlderThan(userAgent, /(?:Chrome|CriOS)\/(\d+)/i, 80)
    || isVersionOlderThan(userAgent, /Firefox\/(\d+)/i, 78)
    || isVersionOlderThan(userAgent, /Version\/(\d+).+Safari\//i, 13)
    || isVersionOlderThan(userAgent, /(?:Opera|OPR)\/(\d+)/i, 67)
    || isVersionOlderThan(userAgent, /Android\s(\d+)/i, 8)
}

function isVersionOlderThan(userAgent: string, pattern: RegExp, minimum: number): boolean {
  const match = userAgent.match(pattern)
  return Boolean(match && Number(match[1]) < minimum)
}
