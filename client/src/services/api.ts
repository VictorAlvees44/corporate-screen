import type {
  AuthorizedUser,
  Birthday,
  BirthdayFormData,
  CurrentSessionResponse,
  HealthCheckResponse,
  Layout,
  LayoutFormData,
  MonitoringLogsResponse,
  MonitoringStatusResponse,
  NewsItem,
  NewsFeed,
  NewsFeedFormData,
  NewsSettings,
  SystemSettings,
  PlayerContentResponse,
  PlayerPlaybackStatus,
  PlayerRegistrationResponse,
  Playlist,
  PlaylistFormData,
  Ranking,
  RankingFormData,
  Schedule,
  ScheduleFormData,
  TV,
  TVFormData,
  UploadedMediaFile,
  UploadMediaResponse,
  WeatherResponse,
} from '../types'

// Camada central de comunicação com a API.
// Todas as chamadas HTTP do frontend devem passar por aqui — nunca usar fetch()
// diretamente dentro de componentes.

const BASE_URL = '/api'
const LEGACY_AUTH_TOKEN_KEY = 'corporate-screen.authToken'

export interface AuthProviders {
  google: boolean
}

export class ApiError extends Error {
  public readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers)

  const isFormData = options?.body instanceof FormData

  if (!headers.has('Content-Type') && options?.body && !isFormData) {
    headers.set('Content-Type', 'application/json')
  }

  const controller = path.startsWith('/player/') ? new AbortController() : null
  const timeout = controller ? window.setTimeout(() => controller.abort(), 12_000) : undefined
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    ...(controller ? { signal: controller.signal } : {}),
    headers,
    credentials: 'same-origin',
  }).finally(() => window.clearTimeout(timeout))

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/') && !path.startsWith('/player/')) {
      window.dispatchEvent(new Event('corporate-screen:session-expired'))
    }
    throw new ApiError(await readErrorMessage(response, path), response.status)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

function clearAuthToken(): void {
  // Limpa tokens das versões anteriores. A sessão atual vive somente em um
  // cookie HttpOnly, inacessível a JavaScript.
  window.localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY)
}

async function readErrorMessage(response: Response, path: string): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string }
    return data.message ?? `Erro na requisição para ${path}: ${response.status}`
  } catch {
    return `Erro na requisição para ${path}: ${response.status}`
  }
}

export const api = {
  healthCheck: () => request<HealthCheckResponse>('/health'),
  getAuthProviders: () => request<AuthProviders>('/auth/providers'),
  beginGoogleLogin: () => window.location.assign(`${BASE_URL}/auth/google`),
  getCurrentSession: () => request<CurrentSessionResponse>('/auth/me'),
  logout: async () => {
    await request<void>('/auth/logout', { method: 'POST' })
    clearAuthToken()
  },
  clearAuthToken,
  listTVs: () => request<TV[]>('/tvs'),
  updateTV: (id: string, data: TVFormData) =>
    request<TV>(`/tvs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...data,
        playlistAtual: data.playlistAtual || null,
        layoutAtual: data.layoutAtual || null,
      }),
    }),
  deleteTV: (id: string) => request<void>(`/tvs/${id}`, { method: 'DELETE' }),
  approveTV: (id: string) => request<TV>(`/tvs/${id}/approve`, { method: 'PUT' }),
  diagnoseTV: (id: string) => request<TV>(`/tvs/${id}/diagnose`, { method: 'POST' }),
  refreshTV: (id: string) => request<TV>(`/tvs/${id}/refresh`, { method: 'POST' }),
  registerPlayer: (tvId?: string, playerToken?: string, deviceId?: string) =>
    request<PlayerRegistrationResponse>('/player/register', {
      method: 'POST',
      body: JSON.stringify({ tvId, playerToken, deviceId }),
    }),
  getPlayerContent: (tvId: string, playerToken: string, playback?: Omit<PlayerPlaybackStatus, 'reportedAt'>) =>
    request<PlayerContentResponse>(`/player/${tvId}/content`, {
      method: 'POST',
      headers: { 'X-Player-Token': playerToken },
      body: JSON.stringify({ playback }),
    }),
  reportPlayerCompatibility: (tvId: string, playerToken: string, compatible: boolean, browser: string, reason: string) =>
    request<void>(`/player/${tvId}/compatibility`, {
      method: 'POST',
      headers: { 'X-Player-Token': playerToken },
      body: JSON.stringify({ compatible, browser, reason }),
    }),
  getSettings: () => request<SystemSettings>('/settings'),
  updateSettings: (data: Partial<Pick<SystemSettings, 'modoOperacao' | 'limiteCadastroAtivo' | 'sincronizacaoImagensAtiva'>>) =>
    request<SystemSettings>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  refreshPlayers: () => request<Pick<SystemSettings, 'atualizacaoPlayersEm' | 'sincronizacaoImagensAtiva' | 'cicloSincronizadoEm'>>('/settings/refresh-players', { method: 'POST' }),
  listPlaylists: () => request<Playlist[]>('/playlists'),
  createPlaylist: (data: PlaylistFormData) =>
    request<Playlist>('/playlists', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updatePlaylist: (id: string, data: PlaylistFormData) =>
    request<Playlist>(`/playlists/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deletePlaylist: (id: string) => request<void>(`/playlists/${id}`, { method: 'DELETE' }),
  uploadMedia: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return request<UploadMediaResponse>('/uploads/media', {
      method: 'POST',
      body: formData,
    })
  },
  uploadMediaBatch: (files: File[]) => {
    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))
    return request<UploadMediaResponse[]>('/uploads/media/batch', {
      method: 'POST',
      body: formData,
    })
  },
  listUploadedMedia: () => request<UploadedMediaFile[]>('/uploads/media'),
  deleteUploadedMedia: (url: string) =>
    request<{ url: string; removedReferences: number }>(
      `/uploads/media?url=${encodeURIComponent(url)}`,
      { method: 'DELETE' },
    ),
  listSchedules: () => request<Schedule[]>('/schedules'),
  createSchedule: (data: ScheduleFormData) =>
    request<Schedule>('/schedules', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateSchedule: (id: string, data: ScheduleFormData) =>
    request<Schedule>(`/schedules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteSchedule: (id: string) => request<void>(`/schedules/${id}`, { method: 'DELETE' }),
  listLayouts: () => request<Layout[]>('/layouts'),
  createLayout: (data: LayoutFormData) =>
    request<Layout>('/layouts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateLayout: (id: string, data: LayoutFormData) =>
    request<Layout>(`/layouts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteLayout: (id: string) => request<void>(`/layouts/${id}`, { method: 'DELETE' }),

  // Widgets — endpoints públicos consumidos pelo /player (sem token).
  getWeather: (localizacao: string) => {
    const digitsOnly = localizacao.replace(/\D/g, '')
    const param = digitsOnly.length === 8 ? `cep=${digitsOnly}` : `cidade=${encodeURIComponent(localizacao)}`
    return request<WeatherResponse>(`/widgets/weather?${param}`)
  },
  getNewsFeed: () => request<NewsItem[]>('/widgets/news'),
  getTodayBirthdays: () => request<Birthday[]>('/widgets/birthdays/today'),
  getRankingById: (id: string) => request<Ranking>(`/widgets/ranking/${id}`),

  // Widgets — gestão administrativa (requer autenticação).
  listBirthdays: () => request<Birthday[]>('/birthdays'),
  createBirthday: (data: BirthdayFormData) =>
    request<Birthday>('/birthdays', { method: 'POST', body: JSON.stringify(data) }),
  updateBirthday: (id: string, data: BirthdayFormData) =>
    request<Birthday>(`/birthdays/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBirthday: (id: string) => request<void>(`/birthdays/${id}`, { method: 'DELETE' }),

  listRankings: () => request<Ranking[]>('/rankings'),
  createRanking: (data: RankingFormData) =>
    request<Ranking>('/rankings', { method: 'POST', body: JSON.stringify(data) }),
  updateRanking: (id: string, data: RankingFormData) =>
    request<Ranking>(`/rankings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRanking: (id: string) => request<void>(`/rankings/${id}`, { method: 'DELETE' }),
  importRanking: (id: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return request<Ranking>(`/rankings/${id}/import`, { method: 'POST', body: formData })
  },

  getNewsSettings: () => request<NewsSettings>('/news'),
  createNewsFeed: (data: NewsFeedFormData) =>
    request<NewsFeed>('/news', { method: 'POST', body: JSON.stringify(data) }),
  updateNewsFeed: (id: string, data: NewsFeedFormData) =>
    request<NewsFeed>(`/news/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNewsFeed: (id: string) => request<void>(`/news/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testNewsFeed: (id: string) =>
    request<{ feed: NewsFeed; quantidade: number }>(`/news/${encodeURIComponent(id)}/test`, { method: 'POST' }),
  refreshAllNewsFeeds: () => request<NewsSettings>('/news/refresh', { method: 'POST' }),
  testAllNewsFeeds: () => request<NewsSettings>('/news/test', { method: 'POST' }),
  listAuthorizedUsers: () => request<AuthorizedUser[]>('/users'),
  addAuthorizedUser: (email: string, role: AuthorizedUser['role']) =>
    request<AuthorizedUser[]>('/users', { method: 'POST', body: JSON.stringify({ email, role }) }),
  deleteAuthorizedUser: (email: string) =>
    request<void>(`/users/${encodeURIComponent(email)}`, { method: 'DELETE' }),

  getMonitoringStatus: () => request<MonitoringStatusResponse>('/monitoring/status'),
  getMonitoringLogs: () => request<MonitoringLogsResponse>('/monitoring/logs'),
}
