import {
  completeGoogleLogin,
  getAuthProviders,
  getCurrentSession,
  rejectLegacyLogin,
  logout,
  startGoogleLogin,
} from '../../server/src/controllers/authController'
import {
  createBirthday,
  getBirthdayById,
  getBirthdays,
  getTodayBirthdays,
  removeBirthday,
  updateBirthday,
} from '../../server/src/controllers/birthdayController'
import { createLayout, getLayoutById, getLayouts, removeLayout, updateLayout } from '../../server/src/controllers/layoutController'
import {
  createNewsFeedHandler,
  deleteNewsFeedHandler,
  getNewsFeed,
  getNewsSettingsHandler,
  refreshAllNewsFeedsHandler,
  testNewsFeedHandler,
  updateNewsFeedHandler,
} from '../../server/src/controllers/newsController'
import { getPlayerContent, registerPlayer, reportPlayerCompatibility } from '../../server/src/controllers/playerController'
import { createPlaylist, getPlaylistById, getPlaylists, removePlaylist, updatePlaylist } from '../../server/src/controllers/playlistController'
import { createSchedule, getScheduleById, getSchedules, removeSchedule, updateSchedule } from '../../server/src/controllers/scheduleController'
import { getSettingsHandler, refreshPlayersHandler, updateSettingsHandler } from '../../server/src/controllers/settingsController'
import { approveTV, createTV, getTVById, getTVs, removeTV, updateTV, requestTVDiagnostic, refreshTVHandler } from '../../server/src/controllers/tvController'
import { createAuthorizedUser, deleteAuthorizedUser, getAuthorizedUsers } from '../../server/src/controllers/userController'
import { getWeather } from '../../server/src/controllers/weatherController'
import {
  deleteRanking,
  findRankingById,
  generateNextRankingId,
  listRankings,
  updateRankingItems,
  upsertRanking,
} from '../../server/src/data/rankingRepository'
import type { AuthorizedUser, Ranking, RankingItem } from '../../server/src/types'
import type { Env } from './env'
import { getAuthenticatedUser } from './media'
import { runController, type ExpressController } from './controllerAdapter'
import { consumeRateLimit, rateLimitResponse, secureJson } from './security'
import { readLimitedBody } from '../../server/src/utils/contentSecurity'
import { InputValidationError, PayloadTooLargeError } from '../../server/src/utils/publicError'

type AccessLevel = 'public' | 'authenticated' | 'admin'

interface Route {
  method: string
  pattern: RegExp
  parameterNames: string[]
  access: AccessLevel
  controller: ExpressController
}

const routes: Route[] = []

add('GET', '/api/auth/me', 'public', getCurrentSession)
add('GET', '/api/auth/providers', 'public', getAuthProviders)
add('GET', '/api/auth/google', 'public', startGoogleLogin)
add('GET', '/api/auth/google/callback', 'public', completeGoogleLogin)
add('POST', '/api/auth/login', 'public', rejectLegacyLogin)
add('POST', '/api/auth/logout', 'public', logout)

add('POST', '/api/player/register', 'public', registerPlayer)
add('GET', '/api/player/:tvId/content', 'public', getPlayerContent)
add('POST', '/api/player/:tvId/content', 'public', getPlayerContent)
add('POST', '/api/player/:tvId/compatibility', 'public', reportPlayerCompatibility)
add('GET', '/api/widgets/weather', 'public', getWeather)
add('GET', '/api/widgets/news', 'public', getNewsFeed)
add('GET', '/api/widgets/birthdays/today', 'public', getTodayBirthdays)

addCrud('/api/tvs', 'id', getTVs, getTVById, createTV, updateTV, removeTV)
add('PUT', '/api/tvs/:id/approve', 'authenticated', approveTV)
add('POST', '/api/tvs/:id/diagnose', 'admin', requestTVDiagnostic)
add('POST', '/api/tvs/:id/refresh', 'admin', refreshTVHandler)
addCrud('/api/playlists', 'id', getPlaylists, getPlaylistById, createPlaylist, updatePlaylist, removePlaylist)
addCrud('/api/layouts', 'id', getLayouts, getLayoutById, createLayout, updateLayout, removeLayout)
addCrud('/api/schedules', 'id', getSchedules, getScheduleById, createSchedule, updateSchedule, removeSchedule)
addCrud('/api/birthdays', 'id', getBirthdays, getBirthdayById, createBirthday, updateBirthday, removeBirthday)

add('GET', '/api/settings', 'admin', getSettingsHandler)
add('PUT', '/api/settings', 'admin', updateSettingsHandler)
add('POST', '/api/settings/refresh-players', 'admin', refreshPlayersHandler)

add('GET', '/api/news', 'authenticated', getNewsSettingsHandler)
add('POST', '/api/news', 'authenticated', createNewsFeedHandler)
add('POST', '/api/news/refresh', 'authenticated', refreshAllNewsFeedsHandler)
add('POST', '/api/news/test', 'authenticated', refreshAllNewsFeedsHandler)
add('PUT', '/api/news/:id', 'authenticated', updateNewsFeedHandler)
add('DELETE', '/api/news/:id', 'authenticated', deleteNewsFeedHandler)
add('POST', '/api/news/:id/test', 'authenticated', testNewsFeedHandler)

add('GET', '/api/users', 'admin', getAuthorizedUsers)
add('POST', '/api/users', 'admin', createAuthorizedUser)
add('DELETE', '/api/users/:email', 'admin', deleteAuthorizedUser)

export async function routeApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname.startsWith('/api/rankings') || url.pathname.startsWith('/api/widgets/ranking/')) {
    return handleRankingRoute(request)
  }

  for (const route of routes) {
    if (route.method !== request.method) continue
    const match = url.pathname.match(route.pattern)
    if (!match) continue

    const params = Object.fromEntries(route.parameterNames.map((name, index) => [
      name,
      decodeURIComponent(match[index + 1]),
    ]))
    const authorization = await authorize(request, route.access)
    if (authorization instanceof Response) return authorization

    let body: unknown
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('content-type')?.includes('application/json')) {
      const parsed = await readJsonBody(request, /^\/api\/player\/[^/]+\/content$/.test(url.pathname) ? 4096 : undefined)
      if (parsed.response) return parsed.response
      body = parsed.body
    }

    if (url.pathname === '/api/auth/google' && request.method === 'GET') {
      const decision = await consumeRateLimit(env, request, 'google-login', 'ip', 30, 15 * 60_000, 15 * 60_000)
      if (!decision.allowed) return rateLimitResponse(decision)
    }
    if (url.pathname === '/api/player/register' && request.method === 'POST') {
      const decision = await consumeRateLimit(env, request, 'player-register', 'ip', 30, 15 * 60_000, 15 * 60_000)
      if (!decision.allowed) return rateLimitResponse(decision)
    }

    try {
      const response = await runController(route.controller, request, params, body, authorization ? {
        authenticatedUser: authorization.email,
        authenticatedRole: authorization.role,
      } : {})
      return response
    } catch (error) {
      if (!(error instanceof InputValidationError)) console.error('[api] Falha no controlador', error)
      return json({ message: error instanceof InputValidationError ? error.message : 'Erro interno do servidor' }, error instanceof InputValidationError ? 400 : 500)
    }
  }

  return json({ message: 'Rota não encontrada' }, 404)
}

async function readJsonBody(request: Request, limit = 1024 * 1024): Promise<{ body?: unknown; response?: Response }> {
  let text: string
  try {
    text = new TextDecoder().decode(await readLimitedBody(request, limit))
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return { response: secureJson({ message: 'JSON acima do limite permitido' }, 413) }
    return { response: secureJson({ message: 'Não foi possível ler a requisição' }, 400) }
  }

  if (new TextEncoder().encode(text).byteLength > limit) {
    return { response: secureJson({ message: 'JSON acima do limite permitido' }, 413) }
  }

  try {
    const body: unknown = text ? JSON.parse(text) : {}
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { response: secureJson({ message: 'Informe um objeto JSON' }, 400) }
    return { body }
  } catch {
    return { response: secureJson({ message: 'JSON inválido' }, 400) }
  }
}

async function handleRankingRoute(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const widgetMatch = url.pathname.match(/^\/api\/widgets\/ranking\/([^/]+)$/)
  if (widgetMatch && request.method === 'GET') {
    const ranking = await findRankingById(decodeURIComponent(widgetMatch[1]))
    return ranking ? json(ranking) : json({ message: 'Ranking não encontrado' }, 404)
  }

  const user = await getAuthenticatedUser(request)
  if (!user) return json({ message: 'Não autenticado' }, 401)

  if (url.pathname === '/api/rankings' && request.method === 'GET') return json(await listRankings())

  const itemMatch = url.pathname.match(/^\/api\/rankings\/([^/]+)$/)
  const importMatch = url.pathname.match(/^\/api\/rankings\/([^/]+)\/import$/)

  try {
    if (url.pathname === '/api/rankings' && request.method === 'POST') {
      const parsed = await readJsonBody(request)
      if (parsed.response) return parsed.response
      const ranking = normalizeRanking(parsed.body as RankingBody, await generateNextRankingId())
      await upsertRanking(ranking)
      return json(ranking, 201)
    }

    if (itemMatch && request.method === 'GET') {
      const ranking = await findRankingById(decodeURIComponent(itemMatch[1]))
      return ranking ? json(ranking) : json({ message: 'Ranking não encontrado' }, 404)
    }

    if (itemMatch && request.method === 'PUT') {
      const id = decodeURIComponent(itemMatch[1])
      if (!await findRankingById(id)) return json({ message: 'Ranking não encontrado' }, 404)
      const parsed = await readJsonBody(request)
      if (parsed.response) return parsed.response
      const ranking = normalizeRanking(parsed.body as RankingBody, id)
      await upsertRanking(ranking)
      return json(ranking)
    }

    if (itemMatch && request.method === 'DELETE') {
      return await deleteRanking(decodeURIComponent(itemMatch[1]))
        ? new Response(null, { status: 204 })
        : json({ message: 'Ranking não encontrado' }, 404)
    }

    if (importMatch && request.method === 'POST') {
      const form = await request.formData()
      const value = form.get('file')
      if (typeof value === 'string' || !value || typeof value.arrayBuffer !== 'function') {
        return json({ message: 'Arquivo CSV não enviado' }, 400)
      }
      if (value.size > 5 * 1024 * 1024) return json({ message: 'Arquivo CSV acima de 5 MB' }, 413)
      const items = parseRankingCSV(new TextDecoder().decode(await value.arrayBuffer()))
      if (items.length === 0) return json({ message: 'Não foi possível ler linhas válidas do CSV' }, 400)
      const ranking = await updateRankingItems(decodeURIComponent(importMatch[1]), (current) => ({
        ...current,
        itens: items,
        atualizadoEm: new Date().toISOString(),
      }))
      return ranking ? json(ranking) : json({ message: 'Ranking não encontrado' }, 404)
    }
  } catch (error) {
    if (!(error instanceof InputValidationError)) console.error('[ranking] Falha ao atender requisição', error)
    return json({ message: error instanceof InputValidationError ? error.message : 'Erro interno do servidor' }, error instanceof InputValidationError ? 400 : 500)
  }

  return json({ message: 'Rota não encontrada' }, 404)
}

async function authorize(request: Request, access: AccessLevel): Promise<AuthorizedUser | null | Response> {
  if (access === 'public') return null
  const user = await getAuthenticatedUser(request)
  if (!user) return json({ message: 'Não autenticado' }, 401)
  if (access === 'admin' && user.role !== 'admin') {
    return json({ message: 'Esta ação exige perfil de administrador' }, 403)
  }
  return user
}

function add(
  method: string,
  path: string,
  access: AccessLevel,
  controller: ExpressController,
): void {
  const parameterNames: string[] = []
  const source = path
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        parameterNames.push(part.slice(1))
        return '([^/]+)'
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  routes.push({ method, pattern: new RegExp(`^${source}$`), parameterNames, access, controller })
}

function addCrud(
  base: string,
  parameterName: string,
  list: ExpressController,
  get: ExpressController,
  create: ExpressController,
  update: ExpressController,
  remove: ExpressController,
): void {
  add('GET', base, 'authenticated', list)
  add('GET', `${base}/:${parameterName}`, 'authenticated', get)
  add('POST', base, 'authenticated', create)
  add('PUT', `${base}/:${parameterName}`, 'authenticated', update)
  add('DELETE', `${base}/:${parameterName}`, 'authenticated', remove)
}

interface RankingBody {
  nome?: string
  itens?: Partial<RankingItem>[]
}

function normalizeRanking(body: RankingBody | undefined, id: string): Ranking {
  const nome = body?.nome?.trim()
  if (!nome) throw new InputValidationError('Informe o nome do ranking')
  const itens = (body?.itens ?? []).flatMap((item, index) => {
    const itemName = item.nome?.trim()
    if (!itemName) return []
    return [{
      posicao: Number.isFinite(item.posicao) ? Number(item.posicao) : index + 1,
      nome: itemName,
      valor: item.valor?.trim() ?? '',
    }]
  })
  return { id, nome, itens, atualizadoEm: new Date().toISOString() }
}

function parseRankingCSV(content: string): RankingItem[] {
  const items: RankingItem[] = []
  content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line, index) => {
    const columns = line.split(/[,;]/).map((column) => column.trim())
    if (index === 0 && Number.isNaN(Number(columns[0]))) return
    if (columns.length < 2 || !columns[1]) return
    const position = Number(columns[0])
    items.push({
      posicao: Number.isFinite(position) ? position : items.length + 1,
      nome: columns[1],
      valor: columns[2] ?? '',
    })
  })
  return items.sort((first, second) => first.posicao - second.posicao)
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })
}
