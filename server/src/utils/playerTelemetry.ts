import type { PlayerPlaybackStatus, TVDiagnostics } from '../types'

const STATES = new Set(['loading', 'playing', 'layout', 'external', 'empty', 'standby', 'pending', 'error'])
const ERRORS = new Set(['IMAGE_LOAD', 'VIDEO_NETWORK', 'VIDEO_DECODE', 'VIDEO_FORMAT', 'VIDEO_UNSUPPORTED', 'PLAYER_UNAUTHORIZED', 'MEDIA_ABORTED', 'MEDIA_LOAD', 'MEDIA_TIMEOUT', 'VIDEO_STALLED', 'AUTOPLAY_BLOCKED', 'FRAME_LOAD', 'PLAYER_RUNTIME', 'CONTENT_FETCH'])

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : ''
}

// Somente campos conhecidos; nunca armazenamos URL completa, credenciais,
// stack trace ou mensagens arbitrárias enviadas por um dispositivo.
export function normalizePlaybackReport(input: unknown, previous: PlayerPlaybackStatus | undefined, requestedSync: string, now: string, requestedDiagnostic = ''): PlayerPlaybackStatus | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const body = input as Record<string, unknown>
  if (typeof body.state !== 'string' || !STATES.has(body.state) || typeof body.version !== 'string') return undefined
  const code = (value: unknown) => typeof value === 'string' && ERRORS.has(value) ? value : ''
  const errorCode = code(body.errorCode)
  const error = body.lastError && typeof body.lastError === 'object' ? body.lastError as Record<string, unknown> : null
  const lastError = error && code(error.code) && text(error.id, 80)
    ? { id: text(error.id, 80), code: code(error.code), mediaName: text(error.mediaName, 160), receivedAt: previous?.lastError && previous.lastError.id === error.id ? previous.lastError.receivedAt : now }
    : previous?.lastError
  return {
    diagnostics: normalizeDiagnostics(body.diagnostics, requestedDiagnostic),
    version: text(body.version, 40),
    state: body.state === 'error' && !errorCode ? 'loading' : body.state as PlayerPlaybackStatus['state'],
    playlistId: text(body.playlistId, 80), itemId: text(body.itemId, 80), mediaName: text(body.mediaName, 160),
    // Confirma somente o comando que o servidor de fato emitiu.
    receivedSync: requestedSync && body.receivedSync === requestedSync ? requestedSync : previous?.receivedSync ?? '',
    offline: body.offline === true, errorCode, reportedAt: now, lastError,
  }
}

export function shouldPersistPlayback(previous: PlayerPlaybackStatus | undefined, next: PlayerPlaybackStatus, now: number): boolean {
  if (!previous) return true
  const elapsed = now - Date.parse(previous.reportedAt)
  // Trocas normais de imagem não gravam no banco a cada slide. Erros, estados
  // operacionais e confirmações têm prioridade, com proteção contra rajadas.
  if (elapsed < 5_000) return false
  return !Number.isFinite(elapsed) || elapsed >= 45_000
    || previous.state !== next.state || previous.errorCode !== next.errorCode
    || previous.receivedSync !== next.receivedSync || previous.offline !== next.offline
    || previous.lastError?.id !== next.lastError?.id
    || previous.diagnostics?.checkedRequest !== next.diagnostics?.checkedRequest
    || previous.diagnostics?.power.active !== next.diagnostics?.power.active
    || previous.diagnostics?.power.error !== next.diagnostics?.power.error
}

function normalizeDiagnostics(input: unknown, requested: string): TVDiagnostics | undefined {
  if (!input || typeof input !== 'object') return undefined
  const body = input as Partial<TVDiagnostics>
  const c = body.capabilities
  const n = body.network
  const m = body.media
  if (!c || !n || !m) return undefined
  const p = body.power
  const number = (v: unknown, max = 120000) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0
  const codec = (v: unknown) => v === 'probably' || v === 'maybe' ? v : 'no'
  return {
    checkedRequest: requested && body.checkedRequest === requested ? requested : '',
    capabilities: { video: c.video === true, mp4: codec(c.mp4), webm: codec(c.webm), storage: c.storage === 'local' ? 'local' : 'none', xhr: c.xhr === true, json: c.json === true },
    network: { samples: number(n.samples, 20), lastMs: number(n.lastMs), averageMs: number(n.averageMs), failures: number(n.failures, 20), networkFailures: number(n.networkFailures, 20), consecutiveFailures: number(n.consecutiveFailures, 999), lastHttpStatus: number(n.lastHttpStatus, 599) },
    media: { loadMs: m.loadMs === null ? null : number(m.loadMs), stalls: number(m.stalls, 9999) },
    power: normalizePower(p),
  }
}

function normalizePower(input: unknown): TVDiagnostics['power'] {
  if (!input || typeof input !== 'object') return { supported: false, active: false, method: 'none', error: '' }
  const body = input as Record<string, unknown>
  const method = body.method === 'screen-wake-lock' || body.method === 'tizen-screensaver' ? body.method : 'none'
  const error = body.error === 'NOT_ALLOWED' || body.error === 'REQUEST_FAILED' ? body.error : ''
  const supported = body.supported === true && method !== 'none'
  return { supported, active: supported && body.active === true, method, error }
}
