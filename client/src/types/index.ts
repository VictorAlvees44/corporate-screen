// Tipos centrais do domínio Corporate Screen.
// Serão expandidos nas próximas etapas (playlists, layouts, schedules, etc.)

export interface TV {
  id: string
  nome: string
  local: string
  setor: string
  unidade: string
  observacoes: string
  status: 'online' | 'offline'
  ultimaConexao: string
  playlistAtual: string | null
  layoutAtual: string | null
  cepClima?: string
  exibirRelogio?: boolean
  exibirNoticias?: boolean
  exibirClima?: boolean
  compatibilidade?: 'compativel' | 'incompativel'
  navegador?: string
  alertaCompatibilidade?: string
  approvalStatus?: 'pendente' | 'aprovada'
  reproducao?: PlayerPlaybackStatus
  diagnosticoSolicitadoEm?: string
  atualizacaoSolicitadaEm?: string
  deviceId?: string
}

export interface PlayerPlaybackStatus {
  diagnostics?: TVDiagnostics
  version: string
  state: 'loading' | 'playing' | 'layout' | 'external' | 'empty' | 'standby' | 'pending' | 'error'
  playlistId: string
  itemId: string
  mediaName: string
  receivedSync: string
  offline: boolean
  errorCode: string
  reportedAt: string
  lastError?: { id: string; code: string; mediaName: string; receivedAt: string }
}

export interface TVDiagnostics {
  checkedRequest: string
  capabilities: { video: boolean; mp4: string; webm: string; storage: string; xhr: boolean; json: boolean }
  network: { samples: number; lastMs: number; averageMs: number; failures: number; networkFailures: number; consecutiveFailures: number; lastHttpStatus: number }
  media: { loadMs: number | null; stalls: number }
  power: { supported: boolean; active: boolean; method: 'screen-wake-lock' | 'tizen-screensaver' | 'none'; error: string }
}

export interface TVFormData {
  nome: string
  local: string
  setor: string
  unidade: string
  observacoes: string
  playlistAtual: string
  layoutAtual: string
  cepClima: string
  exibirRelogio: boolean
  exibirNoticias: boolean
  exibirClima: boolean
}

export type PlaylistItemType = 'imagem' | 'video' | 'link'

export interface PlaylistItem {
  id: string
  tipo: PlaylistItemType
  arquivo: string
  tempoExibicao: number
  ordem: number
}

export interface Playlist {
  id: string
  nome: string
  itens: PlaylistItem[]
}

export interface PlaylistFormData {
  nome: string
  itens: PlaylistItem[]
}

export interface PlayerContentResponse {
  tv: TV
  playlist: Playlist | null
  layout: Layout | null
  schedule: Schedule | null
  modoOperacao: OperationMode
  dentroHorarioOperacional: boolean
  standbyReason: string | null
  pendenteAprovacao?: boolean
  atualizacaoPlayersEm: string
  sincronizacaoImagensAtiva: boolean
  cicloSincronizadoEm: string
  horarioServidor: string
}

export interface PlayerRegistrationResponse extends TV {
  playerToken: string
}

export interface UploadMediaResponse {
  tipo: PlaylistItemType
  url: string
  originalName: string
}

export interface UploadedMediaFile {
  url: string
  nome: string
  tipo: PlaylistItemType
  tamanhoBytes: number
  atualizadoEm: string
  referencias?: number
}

export type OperationMode = 'normal' | 'ferias' | 'feriado'

export interface SystemSettings {
  tema: string
  empresa: string
  logoPadrao: string
  modoOperacao: OperationMode
  limiteCadastroAtivo: boolean
  atualizacaoPlayersEm: string
  sincronizacaoImagensAtiva: boolean
  cicloSincronizadoEm: string
}

export type Weekday = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab'

export interface Schedule {
  id: string
  tvId: string
  playlistId: string
  horaInicio: string
  horaFim: string
  diasSemana: Weekday[]
}

export interface ScheduleFormData {
  tvId: string
  playlistId: string
  horaInicio: string
  horaFim: string
  diasSemana: Weekday[]
}

export type LayoutComponentType =
  | 'texto'
  | 'imagem'
  | 'video'
  | 'relogio'
  | 'logo'
  | 'dashboard'
  | 'pagina-web'
  | 'qrcode'
  | 'clima'
  | 'noticias'
  | 'aniversarios'
  | 'ranking'
  | 'indicadores'
  | 'calendario'
  | 'html'

export interface Birthday {
  id: string
  nome: string
  dia: number
  mes: number
  setor: string
}

export interface BirthdayFormData {
  nome: string
  dia: number
  mes: number
  setor: string
}

export interface RankingItem {
  posicao: number
  nome: string
  valor: string
}

export interface Ranking {
  id: string
  nome: string
  atualizadoEm: string
  itens: RankingItem[]
}

export interface RankingFormData {
  nome: string
}

export type NewsFeedStatus = 'success' | 'error' | 'pending'

export interface NewsFeed {
  id: string
  nome: string
  categoria: string
  url: string
  logoUrl?: string
  ativo: boolean
  prioridade: number
  atualizarMinutos: number
  limiteNoticias: number
  ultimaAtualizacaoEm?: string
  ultimaVerificacaoEm?: string
  ultimoStatus: NewsFeedStatus
  ultimoErro?: string
  ultimaQuantidade?: number
}

export interface NewsFeedFormData {
  nome: string
  categoria: string
  url: string
  logoUrl?: string
  ativo: boolean
  prioridade: number
  atualizarMinutos: number
  limiteNoticias: number
}

export interface NewsSettings {
  feeds: NewsFeed[]
}

export interface NewsItem {
  titulo: string
  link: string
  resumo?: string
  imagem?: string
  publicadoEm?: string
  fonte?: string
  fonteLogoUrl?: string
  fonteCategoria?: string
}

export interface WeatherForecastDay {
  data: string
  codigo: number
  temperaturaMinima: number
  temperaturaMaxima: number
}

export interface WeatherResponse {
  cidade: string
  temperatura: number
  descricao: string
  codigo: number
  previsaoSemanal: WeatherForecastDay[]
}

export interface LayoutComponent {
  id: string
  tipo: LayoutComponentType
  x: number
  y: number
  largura: number
  altura: number
  visivel: boolean
  conteudo: string
  // Usados apenas por dashboard/pagina-web/html.
  atualizarSegundos?: number
  permitirTelaCheia?: boolean
}

export interface Layout {
  id: string
  nome: string
  componentes: LayoutComponent[]
}

export interface LayoutFormData {
  nome: string
  componentes: LayoutComponent[]
}

export interface HealthCheckResponse {
  status: 'ok'
  timestamp: string
}

export interface AuthUser {
  email: string
  role: 'admin' | 'editor'
}

export interface AuthorizedUser extends AuthUser {}

export interface AuthSessionResponse {
  user: AuthUser
}

export interface CurrentSessionResponse {
  user: AuthUser
}

export interface ServerStatusSnapshot {
  ok: boolean
  warnings: string[]
  hosting?: 'windows' | 'cloudflare'
  server: {
    uptimeSeconds: number
    nodeVersion: string
    environment: string
    port: string
    cloudflareTunnelRunning: boolean
  }
  machine: {
    hostname: string
    platform: string
    distro: string
    release: string
    arch: string
    uptimeSeconds: number
  }
  cpu: {
    loadPercent: number
    cores: number
  }
  memory: {
    totalBytes: number
    usedBytes: number
    freeBytes: number
    usedPercent: number
  }
  disk: {
    mount: string
    totalBytes: number
    usedBytes: number
    freeBytes: number
    usedPercent: number
  } | null
}

export interface NetworkUsageSnapshot {
  instant: {
    rxBytesPerSec: number
    txBytesPerSec: number
    sampledAt: string
  } | null
  currentMonth: {
    label: string
    rxBytes: number
    txBytes: number
    totalBytes: number
  }
}

export interface MonitoringStatusResponse {
  status: ServerStatusSnapshot
  network: NetworkUsageSnapshot
  cloud?: CloudMonitoringSnapshot
}

export interface CloudMonitoringSnapshot {
  checkedAt: string
  worker: {
    status: 'operational' | 'error'
    name: string
    route: string
  }
  d1: {
    status: 'operational' | 'error'
    databaseName: string
  }
  r2: {
    status: 'operational' | 'error'
    bucketName: string
    objectCount: number
    totalBytes: number
    freeTierBytes: number
    usedPercent: number
  }
  content: {
    tvsTotal: number
    tvsOnline: number
    tvsOffline: number
    tvsPending: number
    tvsIncompatible: number
    playlists: number
    layouts: number
    schedules: number
    rankings: number
    rssFeeds: number
  }
  security: {
    googleOAuthConfigured: boolean
    workspaceOnly: boolean
    adminOnly: boolean
    passwordLoginDisabled: boolean
    hashedSessions: boolean
    persistentRateLimiting: boolean
    crossSiteProtection: boolean
  }
  compatibility: {
    modernPlayer: boolean
    legacyPlayer: boolean
    baseline: string
  }
}

export interface MonitoringLogsResponse {
  audit: string[]
  startup: string[]
}
