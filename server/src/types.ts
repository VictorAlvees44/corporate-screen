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
  // Identificador estável gerado pelo próprio navegador do player, salvo
  // antes de qualquer chamada de rede. Serve para reconhecer o mesmo
  // dispositivo mesmo quando o registro anterior falhou/expirou antes do
  // player conseguir salvar o `id` retornado pelo servidor — sem isso, cada
  // nova tentativa de cadastro sem tvId cria uma TV nova.
  deviceId?: string
  // Segredo exclusivo do navegador que reproduz esta TV. Nunca deve ser
  // devolvido pelas rotas administrativas ou pelo endpoint de conteúdo.
  playerToken?: string
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

export type UserRole = 'admin' | 'editor'

export interface AuthorizedUser {
  email: string
  role: UserRole
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

export interface LayoutComponent {
  id: string
  tipo: LayoutComponentType
  x: number
  y: number
  largura: number
  altura: number
  visivel: boolean
  conteudo: string
  // Campos usados apenas por dashboard/pagina-web/html (embeds externos).
  // Ficam opcionais para não afetar os demais tipos de componente.
  atualizarSegundos?: number
  permitirTelaCheia?: boolean
}

export interface Layout {
  id: string
  nome: string
  componentes: LayoutComponent[]
}
