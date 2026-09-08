import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api } from '../../services/api'
import { cacheJSON, readCachedJSON } from '../../utils/offlineCache'
import { recomputeOfflineOperationalState } from '../../utils/operationalSchedule'
import type { PlayerDiagnostics } from '../../utils/playerDiagnostics'
import type {
  Birthday,
  Layout,
  LayoutComponent,
  NewsItem,
  PlayerContentResponse,
  Playlist,
  PlaylistItem,
  Ranking,
  TV,
  WeatherResponse,
} from '../../types'

const PLAYER_TV_ID_KEY = 'corporate-screen.playerTvId'
const PLAYER_TOKEN_KEY = 'corporate-screen.playerToken'
// Gerado uma única vez por navegador/dispositivo e persistido antes de
// qualquer chamada de rede. Serve para o servidor reconhecer o mesmo
// dispositivo mesmo quando uma tentativa de cadastro anterior falhou antes
// de o player conseguir salvar o `tvId` retornado — sem isso, cada nova
// tentativa sem tvId criava uma TV nova no painel.
const PLAYER_DEVICE_ID_KEY = 'corporate-screen.playerDeviceId'
const CONTENT_REFRESH_INTERVAL_MS = 15_000
const REGISTER_RETRY_INTERVAL_MS = 15_000
const PLAYER_CONTENT_CACHE_PREFIX = 'corporate-screen.playerContent.'

export default function PlayerPage() {
  const [diagnostics] = useState<PlayerDiagnostics>(() => window.CorporateScreenDiagnostics.create())
  const browserCompatibility = useMemo(() => detectBrowserCompatibility(), [])
  const [status, setStatus] = useState<'registering' | 'ready' | 'error'>('registering')
  const [tv, setTV] = useState<TV | null>(null)
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [message, setMessage] = useState('Registrando este dispositivo...')
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false)
  const [mediaErrorCounts, setMediaErrorCounts] = useState<Record<string, number>>({})
  const [mediaRetryNonce, setMediaRetryNonce] = useState(0)
  const [usingCachedContent, setUsingCachedContent] = useState(false)
  const [registrationAttempt, setRegistrationAttempt] = useState(0)
  const [imageSynchronization, setImageSynchronization] = useState({ active: false, cycleStartedAt: '', serverOffsetMs: 0 })
  const [synchronizedVideoOffsetSeconds, setSynchronizedVideoOffsetSeconds] = useState(0)
  const appliedContentSignatureRef = useRef('')
  const playlistItems = useMemo(
    () =>
      playlist?.itens
        .slice()
        .sort((firstItem, secondItem) => firstItem.ordem - secondItem.ordem)
        .filter((item) => (mediaErrorCounts[item.id] ?? 0) < 3) ?? [],
    [mediaErrorCounts, playlist],
  )
  const currentItem = playlistItems[currentIndex] ?? null
  const hasSuppressedMedia = Object.values(mediaErrorCounts).some((count) => count >= 3)
  const canSynchronizePlaylist = imageSynchronization.active && playlistItems.length > 0 && playlistItems.every((item) => item.tipo === 'imagem' || item.tipo === 'video')

  useEffect(() => {
    const keepAwake = status === 'ready' && (Boolean(playlist?.itens.length) || Boolean(layout))
    window.CorporateScreenPower?.setDesired(keepAwake)
    return () => window.CorporateScreenPower?.setDesired(false)
  }, [layout, playlist, status])

  const applyPlayerContent = useCallback((content: PlayerContentResponse, fromCache: boolean) => {
    // O conteúdo em cache guarda o `dentroHorarioOperacional` calculado na
    // última vez em que o player conseguiu falar com a API. Sem recalcular
    // isso com o relógio local, uma TV que fica offline durante o horário
    // comercial continuaria exibindo a playlist normalmente à noite ou no
    // fim de semana. Enquanto estiver offline, o horário local do próprio
    // navegador é a melhor fonte disponível.
    content = fromCache ? applyOfflineOperationalOverride(content) : content

    const signature = buildContentSignature(content)
    const contentChanged = signature !== appliedContentSignatureRef.current
    diagnostics.content(content, contentChanged, fromCache)
    appliedContentSignatureRef.current = signature
    setTV(content.tv)
    // O poll não deve recriar os itens idênticos e reiniciar o temporizador
    // de uma imagem de 20s a cada consulta de 15s.
    setPlaylist((current) => contentChanged ? content.playlist : current)
    setLayout((current) => contentChanged ? content.layout : current)
    const serverTimeMs = Date.parse(content.horarioServidor)
    setImageSynchronization({
      active: content.sincronizacaoImagensAtiva,
      cycleStartedAt: content.cicloSincronizadoEm,
      serverOffsetMs: Number.isFinite(serverTimeMs) ? serverTimeMs - Date.now() : 0,
    })
    if (contentChanged) {
      setCurrentIndex(0)
      setMediaErrorCounts({})
      setMediaRetryNonce((current) => current + 1)
    }
    setUsingCachedContent(fromCache)
    setStatus('ready')
    setMessage(buildPlayerMessage(content, fromCache))
  }, [diagnostics])

  const loadContent = useCallback(async (tvId: string, playerToken: string, active: boolean) => {
    const requestStarted = Date.now()
    try {
      const content = await api.getPlayerContent(tvId, playerToken, diagnostics.snapshot())
      diagnostics.requestSample(Date.now() - requestStarted, 200)

      if (!active) {
        return
      }

      cachePlayerContent(tvId, content)
      applyPlayerContent(content, false)
    } catch (error) {
      diagnostics.requestSample(Date.now() - requestStarted, error instanceof ApiError ? error.status : 0)
      diagnostics.network()
      if (!active) {
        return
      }

      if (error instanceof ApiError && error.status === 404) {
        clearCachedPlayerContent(tvId)
        window.localStorage.removeItem(PLAYER_TV_ID_KEY)
        window.localStorage.removeItem(PLAYER_TOKEN_KEY)
        setTV(null)
        setPlaylist(null)
        setLayout(null)
        setUsingCachedContent(false)
        setStatus('registering')
        setMessage('Cadastro anterior removido. Registrando este player novamente...')
        setRegistrationAttempt((attempt) => attempt + 1)
        return
      }

      if (error instanceof ApiError && error.status === 401) {
        clearCachedPlayerContent(tvId)
        diagnostics.fail('PLAYER_UNAUTHORIZED')
        setPlaylist(null); setLayout(null); setStatus('error')
        setMessage('Dispositivo não autorizado. O token desta TV foi recusado; consulte o administrador.')
        return
      }

      const cachedContent = readCachedPlayerContent(tvId)

      if (cachedContent) {
        applyPlayerContent(cachedContent, true)
        return
      }

      setStatus('error')
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível carregar o conteúdo')
    }
  }, [applyPlayerContent, diagnostics])

  useEffect(() => {
    const onRuntimeError = () => diagnostics.fail('PLAYER_RUNTIME')
    window.addEventListener('error', onRuntimeError)
    return () => window.removeEventListener('error', onRuntimeError)
  }, [diagnostics])

  useEffect(() => {
    let active = true
    let retryTimer: number | undefined

    async function register() {
      await requestFullscreen()

      const storedTVId = window.localStorage.getItem(PLAYER_TV_ID_KEY) ?? undefined
      let storedPlayerToken = window.localStorage.getItem(PLAYER_TOKEN_KEY) ?? undefined
      if (!storedPlayerToken && typeof crypto.randomUUID === 'function') {
        storedPlayerToken = crypto.randomUUID()
        window.localStorage.setItem(PLAYER_TOKEN_KEY, storedPlayerToken)
      }
      const deviceId = getOrCreateDeviceId()

      try {
        const registration = await api.registerPlayer(storedTVId, storedPlayerToken, deviceId)

        if (!active) {
          return
        }

        window.localStorage.setItem(PLAYER_TV_ID_KEY, registration.id)
        window.localStorage.setItem(PLAYER_TOKEN_KEY, registration.playerToken)
        await api.reportPlayerCompatibility(
          registration.id,
          registration.playerToken,
          browserCompatibility.compatible,
          browserCompatibility.browser,
          browserCompatibility.reason,
        )
        setTV({
          ...registration,
          compatibilidade: browserCompatibility.compatible ? 'compativel' : 'incompativel',
          navegador: browserCompatibility.browser,
          alertaCompatibilidade: browserCompatibility.compatible ? undefined : browserCompatibility.reason,
        })
        await loadContent(registration.id, registration.playerToken, active)
      } catch (error) {
        if (!active) {
          return
        }

        const cachedTVId = storedTVId
        const unauthorized = error instanceof ApiError && (error.status === 401 || error.status === 403)
        if (unauthorized && cachedTVId) window.localStorage.removeItem(`${PLAYER_CONTENT_CACHE_PREFIX}${cachedTVId}`)
        const cachedContent = cachedTVId && !unauthorized ? readCachedPlayerContent(cachedTVId) : null

        if (cachedContent) {
          applyPlayerContent(cachedContent, true)
        } else {
          setStatus('error')
          setMessage(error instanceof ApiError ? error.message : 'Não foi possível cadastrar a TV')
        }

        // Mesmo mostrando conteúdo em cache (ou a tela de erro), continua
        // tentando se cadastrar em segundo plano até a API responder. Sem
        // isso, uma única falha no primeiro carregamento (ex.: backend ainda
        // subindo) deixava o player travado no cache para sempre.
        retryTimer = window.setTimeout(() => {
          void register()
        }, REGISTER_RETRY_INTERVAL_MS)
      }
    }

    void register()

    return () => {
      active = false
      if (retryTimer) {
        window.clearTimeout(retryTimer)
      }
    }
  }, [applyPlayerContent, browserCompatibility, loadContent, registrationAttempt])

  useEffect(() => {
    if (!tv) {
      return undefined
    }

    let active = true
    const interval = window.setInterval(() => {
      const playerToken = window.localStorage.getItem(PLAYER_TOKEN_KEY)
      if (playerToken) {
        void loadContent(tv.id, playerToken, active).catch(() => undefined)
      }
    }, CONTENT_REFRESH_INTERVAL_MS)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [loadContent, tv])

  useEffect(() => {
    if (!canSynchronizePlaylist) {
      return undefined
    }

    const cycleStartMs = Date.parse(imageSynchronization.cycleStartedAt)
    if (!Number.isFinite(cycleStartMs)) {
      return undefined
    }

    const durationsMs = playlistItems.map((item) => Math.max(3, item.tempoExibicao) * 1000)
    const totalDurationMs = durationsMs.reduce((total, duration) => total + duration, 0)
    if (totalDurationMs <= 0) {
      return undefined
    }

    const nowMs = Date.now() + imageSynchronization.serverOffsetMs
    const elapsedMs = ((nowMs - cycleStartMs) % totalDurationMs + totalDurationMs) % totalDurationMs
    let accumulatedMs = 0
    let synchronizedIndex = 0
    let remainingMs = durationsMs[0]

    for (let index = 0; index < durationsMs.length; index += 1) {
      const endMs = accumulatedMs + durationsMs[index]
      if (elapsedMs < endMs) {
        synchronizedIndex = index
        remainingMs = endMs - elapsedMs
        setSynchronizedVideoOffsetSeconds((elapsedMs - accumulatedMs) / 1000)
        break
      }
      accumulatedMs = endMs
    }

    setCurrentIndex((index) => (index === synchronizedIndex ? index : synchronizedIndex))
    const timeout = window.setTimeout(() => {
      setImageSynchronization((current) => ({ ...current }))
    }, Math.max(100, remainingMs + 50))

    return () => window.clearTimeout(timeout)
  }, [canSynchronizePlaylist, imageSynchronization, playlistItems])

  useEffect(() => {
    if (playlistItems.length <= 1 || !currentItem) {
      return undefined
    }

    if (canSynchronizePlaylist) {
      return undefined
    }

    // Vídeos avançam pelo evento `ended`, para que a troca aconteça exatamente
    // ao término da mídia. O tempo configurado continua sendo usado por imagens
    // e conteúdos incorporados.
    if (currentItem.tipo === 'video') {
      return undefined
    }

    const timeout = window.setTimeout(() => {
      setCurrentIndex((index) => (index + 1) % playlistItems.length)
    }, currentItem.tempoExibicao * 1000)

    return () => window.clearTimeout(timeout)
  }, [canSynchronizePlaylist, currentItem, playlistItems.length])

  // Se o item removido por falha era o último da lista filtrada, o índice
  // atual pode ficar fora dos limites. Nesse caso, volta para o começo.
  useEffect(() => {
    if (playlistItems.length > 0 && currentIndex >= playlistItems.length) {
      setCurrentIndex(0)
    }
  }, [currentIndex, playlistItems.length])

  // Falha transitória não exclui o arquivo até alguém editar a playlist.
  // Reabre a tentativa em um minuto; um comando de atualização também limpa
  // as falhas imediatamente na próxima consulta de conteúdo.
  useEffect(() => {
    if (!hasSuppressedMedia) return undefined
    const timer = window.setTimeout(() => {
      setMediaErrorCounts({})
      setMediaRetryNonce((current) => current + 1)
    }, 60_000)
    return () => window.clearTimeout(timer)
  }, [hasSuppressedMedia])

  useEffect(() => {
    if (!playlist) {
      return
    }

    // Itens do YouTube não entram aqui: são um iframe apontando para um
    // domínio externo, sem como funcionar offline mesmo com cache (o vídeo
    // em si depende de streaming ao vivo do YouTube). Tentar cachear essa
    // URL só geraria uma requisição de rede inútil a cada troca de playlist.
    requestMediaCache([
      ...playlist.itens
        .filter((item) => item.tipo === 'imagem' || item.tipo === 'video')
        .map((item) => item.arquivo),
      ...(layout?.componentes
        .filter((component) => ['imagem', 'logo', 'video'].includes(component.tipo))
        .map((component) => component.conteudo) ?? []),
    ])
  }, [layout, playlist])

  async function requestFullscreen() {
    window.CorporateScreenPower?.request()
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) {
      return
    }

    try {
      await document.documentElement.requestFullscreen()
      setFullscreenBlocked(false)
    } catch {
      setFullscreenBlocked(true)
    }
  }

  function handleMediaError(item: PlaylistItem) {
    const nextCount = (mediaErrorCounts[item.id] ?? 0) + 1
    setMediaErrorCounts((current) => ({ ...current, [item.id]: (current[item.id] ?? 0) + 1 }))
    setMediaRetryNonce((current) => current + 1)

    // Uma oscilação de Wi-Fi não elimina a mídia imediatamente: ela volta a
    // ser tentada nas próximas voltas. Somente a terceira falha a remove
    // temporariamente para o player não ficar travado em um arquivo quebrado.
    setCurrentIndex((index) => {
      if (nextCount >= 3) return index
      return playlistItems.length > 1 ? (index + 1) % playlistItems.length : 0
    })
  }

  function advancePlaylist() {
    if (playlistItems.length <= 1) {
      return
    }

    setCurrentIndex((index) => (index + 1) % playlistItems.length)
  }

  function applyOfflineOperationalOverride(content: PlayerContentResponse): PlayerContentResponse {
    if (content.pendenteAprovacao) {
      // TV pendente de aprovação nunca reproduz conteúdo, com ou sem cache.
      return content
    }

    const offlineState = recomputeOfflineOperationalState(content.modoOperacao, content.schedule)

    if (!offlineState.dentroHorarioOperacional) {
      return {
        ...content,
        playlist: null,
        layout: null,
        schedule: null,
        dentroHorarioOperacional: false,
        standbyReason: offlineState.standbyReason,
      }
    }

    return {
      ...content,
      schedule: offlineState.schedule,
      dentroHorarioOperacional: true,
      standbyReason: null,
    }
  }

  if (!browserCompatibility.compatible) {
    return <IncompatibleBrowserWarning compatibility={browserCompatibility} tv={tv} />
  }

  if (status === 'ready' && currentItem) {
    return (
      <main
        className="h-screen w-screen overflow-hidden bg-black text-white"
        onClick={() => {
          void requestFullscreen()
        }}
      >
        <PlaylistMedia
          key={`${currentItem.id}:${mediaRetryNonce}`}
          item={currentItem}
          synchronized={canSynchronizePlaylist}
          synchronizedVideoOffsetSeconds={synchronizedVideoOffsetSeconds}
          onEnd={advancePlaylist}
          onError={() => handleMediaError(currentItem)}
          diagnostics={diagnostics}
        />
        {layout && <LayoutOverlay layout={layout} />}
        {tv && <StandardFooter tv={tv} />}
        {tv && <TVIdentity tv={tv} />}
        {fullscreenBlocked && <FullscreenHint />}
        {usingCachedContent && <CachedContentBadge />}
      </main>
    )
  }

  if (status === 'ready' && layout) {
    return (
      <main
        className="h-screen w-screen overflow-hidden bg-black text-white"
        onClick={() => {
          void requestFullscreen()
        }}
      >
        <LayoutOverlay layout={layout} />
        {tv && <StandardFooter tv={tv} />}
        {tv && <TVIdentity tv={tv} />}
        {fullscreenBlocked && <FullscreenHint />}
        {usingCachedContent && <CachedContentBadge />}
      </main>
    )
  }

  if (status === 'ready' && tv && !playlist && !layout) {
    return (
      <main
        className="h-screen w-screen overflow-hidden bg-black text-white"
        onClick={() => {
          void requestFullscreen()
        }}
      >
        <div className="flex h-full w-full items-center justify-center">
          <span className="text-sm text-slate-700">{message}</span>
        </div>
        <StandardFooter tv={tv} />
        <TVIdentity tv={tv} />
        {fullscreenBlocked && <FullscreenHint />}
        {usingCachedContent && <CachedContentBadge />}
      </main>
    )
  }

  return (
    <main
      className="flex h-screen w-screen items-center justify-center bg-black px-6 text-white"
      onClick={() => {
        void requestFullscreen()
      }}
    >
      <section className="w-full max-w-lg text-center">
        <p className="text-sm uppercase tracking-[0.24em] text-cyan-300">Corporate Screen</p>
        <h1 className="mt-4 text-3xl font-semibold">
          {status === 'ready' ? tv?.nome : 'Player'}
        </h1>

        <p className="mt-4 text-sm leading-6 text-slate-400">{status === 'ready' && playlist && playlistItems.length === 0 ? hasSuppressedMedia ? 'Falha ao carregar as mídias. Nova tentativa em até 1 minuto. Verifique os erros no painel ou use Atualizar esta TV.' : 'Nenhuma mídia disponível para reprodução. Verifique a playlist no painel administrativo.' : message}</p>

        {tv && (
          <div className="mt-8 grid gap-3 rounded border border-slate-800 bg-slate-950/80 p-5 text-left text-sm">
            <PlayerInfo label="ID" value={tv.id} />
            <PlayerInfo label="Nome" value={tv.nome} />
            <PlayerInfo label="Local" value={tv.local || 'Pendente no admin'} />
            <PlayerInfo label="Status" value={tv.status} />
          </div>
        )}

        {status === 'error' && (
          <p className="mt-6 rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            Verifique se a API está rodando e recarregue esta página.
          </p>
        )}

        {fullscreenBlocked && (
          <button
            className="mt-6 rounded bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950"
            type="button"
            onClick={() => {
              void requestFullscreen()
            }}
          >
            Entrar em tela cheia
          </button>
        )}
      </section>
    </main>
  )
}

interface BrowserCompatibility {
  compatible: boolean
  browser: string
  reason: string
}

function detectBrowserCompatibility(): BrowserCompatibility {
  const userAgent = navigator.userAgent
  const missing = [
    typeof window.fetch !== 'function' && 'requisições de rede',
    !window.localStorage && 'armazenamento local',
  ].filter(Boolean) as string[]

  const match = userAgent.match(/(Edg|OPR|Chrome|CriOS|Firefox|FxiOS|Version)\/([\d.]+)/)
  const name = match?.[1] ?? 'Navegador desconhecido'
  const version = Number(match?.[2]?.split('.')[0] ?? 0)
  const browser = `${name} ${version || ''}`.trim()
  if (missing.length > 0) return { compatible: false, browser, reason: `Este navegador não possui: ${missing.join(', ')}.` }
  return { compatible: true, browser, reason: '' }
}

function IncompatibleBrowserWarning({ compatibility, tv }: { compatibility: BrowserCompatibility; tv: TV | null }) {
  return (
    <main className="flex h-screen w-screen items-center justify-center bg-slate-950 px-6 text-white">
      <section className="w-full max-w-xl rounded border-2 border-amber-400 bg-slate-900 p-7 text-center shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">Atenção</p>
        <h1 className="mt-3 text-3xl font-semibold">Navegador incompatível</h1>
        <p className="mt-4 text-base leading-7 text-slate-200">{compatibility.reason}</p>
        <p className="mt-3 text-sm text-slate-400">Detectado: {compatibility.browser}</p>
        <p className="mt-6 text-sm text-slate-300">Use Chrome, Microsoft Edge, Firefox ou Safari atualizado. O alerta também foi enviado ao painel administrativo.</p>
        {tv && <p className="mt-5 font-mono text-xs text-slate-500">TV: {tv.id}</p>}
      </section>
    </main>
  )
}

function buildPlayerMessage(content: PlayerContentResponse, fromCache: boolean): string {
  const suffix = fromCache ? ' (cache offline)' : ''

  if (content.dentroHorarioOperacional === false) {
    return `${content.standbyReason ?? 'Stand by'}${suffix}`
  }

  if (content.pendenteAprovacao) {
    return 'Dispositivo cadastrado. Aguardando aprovação no painel administrativo.'
  }

  if (!content.playlist) {
    return content.layout
      ? `Reproduzindo layout ${content.layout.nome}.${suffix}`
      : `Dispositivo cadastrado e aguardando playlist.${suffix}`
  }

  if (content.schedule) {
    return `Reproduzindo ${content.playlist.nome} pelo agendamento ${content.schedule.id}${suffix}`
  }

  return `Reproduzindo ${content.playlist.nome}${suffix}`
}

function getOrCreateDeviceId(): string {
  const existing = window.localStorage.getItem(PLAYER_DEVICE_ID_KEY)
  if (existing) {
    return existing
  }

  const generated = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`

  window.localStorage.setItem(PLAYER_DEVICE_ID_KEY, generated)
  return generated
}

function cachePlayerContent(tvId: string, content: PlayerContentResponse): void {
  try { window.localStorage.setItem(`${PLAYER_CONTENT_CACHE_PREFIX}${tvId}`, JSON.stringify(content)) } catch { /* Cache cheio não deve impedir a reprodução online. */ }
}

function clearCachedPlayerContent(tvId: string): void {
  window.localStorage.removeItem(`${PLAYER_CONTENT_CACHE_PREFIX}${tvId}`)
}

function readCachedPlayerContent(tvId: string): PlayerContentResponse | null {
  const raw = window.localStorage.getItem(`${PLAYER_CONTENT_CACHE_PREFIX}${tvId}`)

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as PlayerContentResponse
  } catch {
    return null
  }
}

function requestMediaCache(urls: string[]): void {
  if (!navigator.serviceWorker?.controller) {
    return
  }

  navigator.serviceWorker.controller.postMessage({
    type: 'CACHE_MEDIA',
    urls,
  })
}

function buildContentSignature(content: PlayerContentResponse): string {
  return JSON.stringify({
    playlist: content.playlist,
    layout: content.layout,
    modoOperacao: content.modoOperacao,
    dentroHorarioOperacional: content.dentroHorarioOperacional,
    standbyReason: content.standbyReason,
    pendenteAprovacao: content.pendenteAprovacao,
    atualizacaoPlayersEm: content.atualizacaoPlayersEm || '',
    sincronizacaoImagensAtiva: content.sincronizacaoImagensAtiva,
    cicloSincronizadoEm: content.cicloSincronizadoEm || '',
  })
}

interface PlaylistMediaProps {
  diagnostics: PlayerDiagnostics
  item: PlaylistItem
  synchronized: boolean
  synchronizedVideoOffsetSeconds: number
  onEnd: () => void
  onError: () => void
}

function PlaylistMedia({ item, synchronized, synchronizedVideoOffsetSeconds, onEnd, onError, diagnostics }: PlaylistMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const element = videoRef.current ?? imageRef.current ?? frameRef.current
    if (element) return diagnostics.watch(element, { id: item.id, arquivo: item.arquivo, tipo: item.tipo, ordem: 0, tempoExibicao: item.tempoExibicao })
  }, [diagnostics, item.id, item.arquivo, item.tipo, item.tempoExibicao])

  useEffect(() => {
    if (item.tipo !== 'video' || !synchronized) return undefined

    const video = videoRef.current
    if (!video) return undefined
    const positionVideo = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const offset = synchronizedVideoOffsetSeconds % video.duration
        if (Math.abs(video.currentTime - offset) > 0.5) video.currentTime = offset
      }
    }

    positionVideo()
    video.addEventListener('loadedmetadata', positionVideo)
    return () => video.removeEventListener('loadedmetadata', positionVideo)
  }, [item, synchronized, synchronizedVideoOffsetSeconds])

  if (item.tipo === 'video') {
    return (
      <video
        className="h-full w-full object-contain"
        ref={videoRef}
        src={item.arquivo}
        autoPlay
        muted
        playsInline
        loop={synchronized}
        onEnded={synchronized ? undefined : onEnd}
        onError={onError}
      />
    )
  }

  if (item.tipo === 'link') {
    return (
      <iframe
        ref={frameRef}
        className="h-full w-full"
        src={item.arquivo}
        title="Conteúdo incorporado"
        sandbox="allow-scripts allow-presentation"
        allow="autoplay; encrypted-media; fullscreen"
        allowFullScreen
        onError={onError}
      />
    )
  }

  return <img ref={imageRef} className="h-full w-full object-contain" src={item.arquivo} alt="" onError={onError} />
}

interface LayoutOverlayProps {
  layout: Layout
}

function LayoutOverlay({ layout }: LayoutOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {layout.componentes
        // Relógio, notícias e clima pertencem ao rodapé fixo por TV. Layouts
        // antigos continuam úteis para logos, textos e elementos extras, mas
        // não podem duplicar ou cobrir o rodapé padrão.
        .filter((component) => component.visivel && !['relogio', 'noticias', 'clima'].includes(component.tipo))
        .map((component) => (
          <LayoutComponentView component={component} key={component.id} />
        ))}
    </div>
  )
}

function StandardFooter({ tv }: { tv: TV }) {
  const blocks = [
    tv.exibirRelogio !== false && { id: 'clock', weight: 10, content: <ClockWidget scale={1} compact /> },
    tv.exibirNoticias !== false && { id: 'news', weight: 70, content: <NewsWidget scale={1} compact /> },
    tv.exibirClima !== false && { id: 'weather', weight: 20, content: <WeatherWidget cidade={tv.cepClima?.trim() || ''} scale={1} compact /> },
  ].filter(Boolean) as { id: string; weight: number; content: React.ReactNode }[]

  if (blocks.length === 0) return null

  return (
    <section aria-label="Rodapé informativo" className="absolute inset-x-0 bottom-0 z-20 flex h-[13vh] min-h-[112px] max-h-[160px] overflow-hidden border-t border-white/10 bg-[#060b10]/95 shadow-[0_-10px_28px_rgba(0,0,0,0.32)]">
      {blocks.map((block, index) => (
        <div className={index > 0 ? 'min-w-0 border-l border-white/10' : 'min-w-0'} key={block.id} style={{ flex: `${block.weight} 1 0%` }}>
          {block.content}
        </div>
      ))}
    </section>
  )
}

interface LayoutComponentViewProps {
  component: LayoutComponent
}

function LayoutComponentView({ component }: LayoutComponentViewProps) {
  const scale = getWidgetScale(component)
  return (
    <div className="absolute overflow-hidden" style={getLayoutComponentStyle(component)}>
      {renderLayoutComponent(component, scale)}
    </div>
  )
}

function renderLayoutComponent(component: LayoutComponent, scale: number) {
  const isFooter = component.altura <= 180
  if (component.tipo === 'imagem' || component.tipo === 'logo') {
    return <img className="h-full w-full object-contain" src={component.conteudo} alt="" />
  }

  if (component.tipo === 'video') {
    return (
      <video
        className="h-full w-full object-contain"
        src={component.conteudo}
        autoPlay
        muted
        loop
        playsInline
      />
    )
  }

  if (component.tipo === 'dashboard' || component.tipo === 'pagina-web') {
    return <EmbedFrame component={component} />
  }

  if (component.tipo === 'html') {
    return <HTMLEmbed component={component} />
  }

  if (component.tipo === 'relogio') {
    return <ClockWidget scale={scale} compact={isFooter} />
  }

  if (component.tipo === 'clima') {
    return <WeatherWidget cidade={component.conteudo} scale={scale} compact={isFooter} />
  }

  if (component.tipo === 'noticias') {
    return <NewsWidget scale={scale} compact={isFooter} />
  }

  if (component.tipo === 'aniversarios') {
    return <BirthdaysWidget />
  }

  if (component.tipo === 'ranking') {
    return <RankingWidget rankingId={component.conteudo} />
  }

  if (component.tipo === 'indicadores') {
    return <IndicatorsWidget content={component.conteudo} />
  }

  if (component.tipo === 'calendario') {
    return <CalendarWidget />
  }

  if (component.tipo === 'qrcode') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white p-4 text-center text-sm font-semibold text-slate-950">
        {component.conteudo}
      </div>
    )
  }

  return (
    <div className="flex h-full w-full items-center rounded bg-black/45 px-[6%] font-semibold leading-tight text-white" style={{ fontSize: `${Math.round(30 * scale)}px` }}>
      {component.conteudo}
    </div>
  )
}

interface EmbedFrameProps {
  component: LayoutComponent
}

// Dashboard / Página web (Etapa 10): iframe genérico para Power BI, Looker,
// Grafana, Metabase, sistemas internos etc. "Atualizar automaticamente"
// simplesmente remonta o iframe (troca de `key`), já que não há como forçar
// um reload de conteúdo cross-origin de outra forma.
function EmbedFrame({ component }: EmbedFrameProps) {
  const reloadCount = useAutoRefresh(component.atualizarSegundos)

  if (!component.conteudo.trim()) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black/40 text-sm text-slate-400">
        Nenhuma URL configurada
      </div>
    )
  }

  return (
    <iframe
      key={reloadCount}
      className="h-full w-full border-0 bg-white"
      src={component.conteudo}
      title={component.id}
      sandbox="allow-scripts allow-presentation"
      allow={component.permitirTelaCheia ? 'fullscreen' : undefined}
      allowFullScreen={component.permitirTelaCheia}
    />
  )
}

interface HTMLEmbedProps {
  component: LayoutComponent
}

// HTML customizado (Etapa 10): renderizado num iframe com `srcDoc` (em vez
// de injetar direto no DOM da página) para isolar estilos/scripts do
// restante do player.
function HTMLEmbed({ component }: HTMLEmbedProps) {
  const reloadCount = useAutoRefresh(component.atualizarSegundos)

  return (
    <iframe
      key={reloadCount}
      className="h-full w-full border-0 bg-transparent"
      srcDoc={component.conteudo}
      title={component.id}
      sandbox="allow-scripts"
    />
  )
}

// Incrementa um contador a cada N segundos (ou nunca, se `seconds` for
// undefined/0). Usado como `key` para forçar o remount de um iframe.
function useAutoRefresh(seconds: number | undefined): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!seconds || seconds <= 0) {
      return undefined
    }

    const interval = window.setInterval(() => setCount((current) => current + 1), seconds * 1000)
    return () => window.clearInterval(interval)
  }, [seconds])

  return count
}

function ClockWidget({ scale, compact }: { scale: number; compact: boolean }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#060b10]/95 px-[4%] text-center text-white">
      <div className="min-w-0">
          <p className="font-mono font-bold leading-none" style={{ fontSize: `${compact ? Math.max(30, Math.round(54 * scale)) : Math.round(56 * scale)}px` }}>
            {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="mt-2 whitespace-nowrap text-slate-300" style={{ fontSize: `${compact ? Math.max(10, Math.round(14 * scale)) : Math.round(16 * scale)}px` }}>
            {compact ? `${now.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase()} • ${now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : now.toLocaleDateString('pt-BR')}
          </p>
      </div>
    </div>
  )
}

const WIDGET_CACHE_PREFIX = 'corporate-screen.widgetCache.'

function OfflineTag() {
  return (
    <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
      Offline
    </span>
  )
}

function todayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

const WEATHER_REFRESH_INTERVAL_MS = 15 * 60_000

interface WeatherWidgetProps {
  cidade: string
  scale: number
  compact: boolean
}

function WeatherWidget({ cidade, scale, compact }: WeatherWidgetProps) {
  const [weather, setWeather] = useState<WeatherResponse | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const cacheKey = `${WIDGET_CACHE_PREFIX}weather.${cidade.trim().toLowerCase()}`

  useEffect(() => {
    if (!cidade.trim()) {
      return undefined
    }

    let active = true

    async function load() {
      try {
        const result = await api.getWeather(cidade)
        if (!active) return
        setWeather(result)
        setIsOffline(false)
        cacheJSON(cacheKey, result)
      } catch {
        // Sem conexão: tenta reaproveitar a última previsão salva localmente.
        if (!active) return
        const cached = readCachedJSON<WeatherResponse>(cacheKey)
        if (cached) {
          setWeather(cached.data)
          setIsOffline(true)
        }
      }
    }

    void load()
    const interval = window.setInterval(() => void load(), WEATHER_REFRESH_INTERVAL_MS)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [cidade, cacheKey])

  if (!cidade.trim()) {
    return <div className="flex h-full w-full items-center justify-center bg-[#060b10]/95 px-4 text-center text-slate-400" style={{ fontSize: `${Math.max(10, Math.round(13 * scale))}px` }}>Configure o CEP desta TV</div>
  }

  return (
    <div className="flex h-full w-full flex-col justify-between bg-[#060b10]/95 p-[5%] text-white">
      {weather ? (
        <>
          {compact ? (
            <div className="grid h-full grid-rows-[minmax(0,1fr)_auto]">
              <div className="flex min-h-0 items-center justify-center">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span aria-label={weather.descricao} style={{ fontSize: `${Math.max(30, Math.round(46 * scale))}px`, lineHeight: 1 }}>{weatherEmoji(weather.codigo)}</span>
                  <div className="min-w-0 text-center"><p className="font-bold leading-none" style={{ fontSize: `${Math.max(27, Math.round(40 * scale))}px` }}>{Math.round(weather.temperatura)}°</p><p className="mt-0.5 truncate text-slate-400" style={{ fontSize: `${Math.max(8, Math.round(10 * scale))}px` }}>{weather.cidade}</p></div>
                </div>
                {isOffline && <OfflineTag />}
              </div>
              <div className="mt-1 grid shrink-0 grid-cols-3 gap-1 border-t border-white/10 pt-1">
                {weather.previsaoSemanal.slice(1, 4).map((day) => (
                  <div className="min-w-0 text-center" key={day.data}>
                    <p className="truncate text-slate-400" style={{ fontSize: `${Math.max(8, Math.round(10 * scale))}px` }}>{weekdayLabel(day.data)}</p>
                    <p style={{ fontSize: `${Math.max(13, Math.round(18 * scale))}px`, lineHeight: 1 }}>{weatherEmoji(day.codigo)}</p>
                    <p className="whitespace-nowrap text-slate-200" style={{ fontSize: `${Math.max(8, Math.round(10 * scale))}px` }}>{Math.round(day.temperaturaMaxima)}°</p>
                  </div>
                ))}
              </div>
            </div>
          ) : <>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-cyan-100" style={{ fontSize: `${Math.max(11, Math.round(15 * scale))}px` }}>{weather.cidade}</p>
                <p className="mt-1 truncate text-slate-300" style={{ fontSize: `${Math.max(10, Math.round(13 * scale))}px` }}>{weather.descricao}</p>
              </div>
              <span aria-label={weather.descricao} style={{ fontSize: `${Math.round(44 * scale)}px`, lineHeight: 1 }}>{weatherEmoji(weather.codigo)}</span>
            </div>
            <div className="mt-2 flex items-end gap-2">
              <span className="font-semibold leading-none" style={{ fontSize: `${Math.round(48 * scale)}px` }}>{Math.round(weather.temperatura)}°</span>
              <span className="pb-1 text-slate-400" style={{ fontSize: `${Math.max(10, Math.round(13 * scale))}px` }}>agora</span>
              {isOffline && <OfflineTag />}
            </div>
            {weather.previsaoSemanal.length > 0 && (
              <div className="mt-3 grid grid-cols-7 gap-1 border-t border-white/10 pt-2">
              {weather.previsaoSemanal.map((day) => (
                <div className="min-w-0 text-center" key={day.data}>
                  <p className="truncate text-slate-400" style={{ fontSize: `${Math.max(8, Math.round(10 * scale))}px` }}>{weekdayLabel(day.data)}</p>
                  <p style={{ fontSize: `${Math.max(12, Math.round(18 * scale))}px` }}>{weatherEmoji(day.codigo)}</p>
                  <p className="whitespace-nowrap text-slate-200" style={{ fontSize: `${Math.max(8, Math.round(10 * scale))}px` }}>{Math.round(day.temperaturaMaxima)}°</p>
                  <p className="whitespace-nowrap text-slate-500" style={{ fontSize: `${Math.max(7, Math.round(9 * scale))}px` }}>{Math.round(day.temperaturaMinima)}°</p>
                </div>
              ))}
              </div>
            )}
          </>}
        </>
      ) : (
        <span className="m-auto text-slate-400" style={{ fontSize: `${Math.max(11, Math.round(14 * scale))}px` }}>Carregando clima...</span>
      )}
    </div>
  )
}

const NEWS_REFRESH_INTERVAL_MS = 5 * 60_000
const NEWS_ROTATE_INTERVAL_MS = 15_000
const NEWS_FADE_DURATION_MS = 400
const NEWS_CACHE_KEY = `${WIDGET_CACHE_PREFIX}news`

function NewsWidget({ scale, compact }: { scale: number; compact: boolean }) {
  const [items, setItems] = useState<NewsItem[]>([])
  const [index, setIndex] = useState(0)
  const [isOffline, setIsOffline] = useState(false)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const result = await api.getNewsFeed()
        if (!active) return
        setItems(result)
        setIsOffline(false)
        if (result.length > 0) cacheJSON(NEWS_CACHE_KEY, result)
      } catch {
        // Sem conexão ou feed indisponível: usa o último feed salvo localmente.
        if (!active) return
        const cached = readCachedJSON<NewsItem[]>(NEWS_CACHE_KEY)
        if (cached) {
          setItems(cached.data)
          setIsOffline(true)
        }
      }
    }

    void load()
    const interval = window.setInterval(() => void load(), NEWS_REFRESH_INTERVAL_MS)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (items.length <= 1) {
      return undefined
    }

    let fadeTimer: number | undefined
    const timeout = window.setTimeout(() => {
      setIsVisible(false)
      fadeTimer = window.setTimeout(() => {
        setIndex((current) => (current + 1) % items.length)
        setIsVisible(true)
      }, NEWS_FADE_DURATION_MS)
    }, NEWS_ROTATE_INTERVAL_MS)

    return () => {
      window.clearTimeout(timeout)
      if (fadeTimer !== undefined) window.clearTimeout(fadeTimer)
    }
  }, [items.length])

  if (items.length === 0) {
    return null
  }

  const item = items[index % items.length]

  return (
    <div className={`flex h-full w-full gap-[3%] bg-[#060b10]/95 px-[3%] ${compact ? 'py-[1.8%]' : 'py-[3%]'} text-white transition-opacity duration-[400ms] ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      {item.imagem && <img className={compact ? 'h-full w-[16%] max-w-[112px] shrink-0 rounded object-cover' : 'h-full w-[32%] shrink-0 rounded object-cover'} src={item.imagem} alt="" />}
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 font-bold tracking-wide text-cyan-400" style={{ fontSize: `${compact ? Math.max(11, Math.round(14 * scale)) : Math.max(8, Math.round(10 * scale))}px` }}><span aria-hidden>▣</span>{item.fonteLogoUrl && <img className="h-[1.3em] w-[1.3em] rounded-sm object-cover" src={item.fonteLogoUrl} alt="" />}{item.fonte ?? 'Notícias'}</span>
          {item.fonteCategoria && <span className="truncate text-slate-500" style={{ fontSize: `${compact ? Math.max(10, Math.round(12 * scale)) : Math.max(8, Math.round(10 * scale))}px` }}>• {item.fonteCategoria}</span>}
          {isOffline && <OfflineTag />}
        </div>
        <h3 className="mt-1 truncate font-semibold leading-tight text-white" style={{ fontSize: `${compact ? Math.max(21, Math.round(30 * scale)) : Math.max(18, Math.round(24 * scale))}px` }}>{item.titulo}</h3>
        {item.resumo && <p className="mt-1 line-clamp-2 leading-snug text-slate-300" style={{ fontSize: `${compact ? Math.max(13, Math.round(17 * scale)) : Math.max(10, Math.round(13 * scale))}px` }}>{cleanNewsSummary(item.resumo)}</p>}
        {!compact && <p className="mt-1 truncate text-slate-500" style={{ fontSize: `${Math.max(9, Math.round(11 * scale))}px` }}>{formatNewsDate(item.publicadoEm) || 'Atualização automática a cada 5 minutos'}</p>}
      </div>
    </div>
  )
}

function weatherEmoji(code: number): string {
  if (code === 0 || code === 1) return '☀️'
  if (code === 2 || code === 3) return '⛅'
  if (code === 45 || code === 48) return '🌫️'
  if (code >= 51 && code <= 67) return '🌧️'
  if (code >= 71 && code <= 77) return '❄️'
  if (code >= 80 && code <= 82) return '🌦️'
  if (code >= 95) return '⛈️'
  return '🌤️'
}

function weekdayLabel(dateValue: string): string {
  const date = new Date(`${dateValue}T12:00:00`)
  return date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
}

function cleanNewsSummary(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function formatNewsDate(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

const BIRTHDAYS_CACHE_KEY = `${WIDGET_CACHE_PREFIX}birthdays`

interface CachedBirthdays {
  dia: string
  itens: Birthday[]
}

function BirthdaysWidget() {
  const [birthdays, setBirthdays] = useState<Birthday[]>([])
  const [isOffline, setIsOffline] = useState(false)
  // Sem conexão E sem cache do próprio dia: evita mostrar aniversariantes de
  // um dia errado, já que essa é uma informação sensível à data.
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let active = true

    async function load() {
      const today = todayKey()

      try {
        const result = await api.getTodayBirthdays()
        if (!active) return
        setBirthdays(result)
        setIsOffline(false)
        setUnavailable(false)
        cacheJSON<CachedBirthdays>(BIRTHDAYS_CACHE_KEY, { dia: today, itens: result })
      } catch {
        if (!active) return

        const cached = readCachedJSON<CachedBirthdays>(BIRTHDAYS_CACHE_KEY)

        if (cached && cached.data.dia === today) {
          setBirthdays(cached.data.itens)
          setIsOffline(true)
          setUnavailable(false)
        } else {
          // O cache existe, mas é de outro dia (ou não existe) — não dá pra
          // confiar que a lista de hoje seria a mesma.
          setUnavailable(true)
        }
      }
    }

    void load()
    const interval = window.setInterval(() => void load(), 60 * 60_000)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden rounded bg-black/55 p-4 text-white">
      <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-cyan-300">
        Aniversariantes de hoje
        {isOffline && <OfflineTag />}
      </span>

      {unavailable && (
        <span className="text-sm text-slate-400">
          Sem conexão — não é possível confirmar os aniversariantes de hoje.
        </span>
      )}

      {!unavailable && birthdays.length === 0 && (
        <span className="text-sm text-slate-400">Nenhum aniversariante hoje.</span>
      )}

      <ul className="flex flex-col gap-1 overflow-hidden text-sm">
        {birthdays.map((birthday) => (
          <li key={birthday.id} className="truncate">
            🎉 {birthday.nome}
            {birthday.setor && <span className="text-slate-400"> — {birthday.setor}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

const RANKING_REFRESH_INTERVAL_MS = 5 * 60_000

interface RankingWidgetProps {
  rankingId: string
}

function RankingWidget({ rankingId }: RankingWidgetProps) {
  const [ranking, setRanking] = useState<Ranking | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const cacheKey = `${WIDGET_CACHE_PREFIX}ranking.${rankingId.trim()}`

  useEffect(() => {
    if (!rankingId.trim()) {
      return undefined
    }

    let active = true

    async function load() {
      try {
        const result = await api.getRankingById(rankingId)
        if (!active) return
        setRanking(result)
        setIsOffline(false)
        cacheJSON(cacheKey, result)
      } catch {
        // Ranking ainda não importado ou API indisponível: tenta o cache local.
        if (!active) return
        const cached = readCachedJSON<Ranking>(cacheKey)
        if (cached) {
          setRanking(cached.data)
          setIsOffline(true)
        }
      }
    }

    void load()
    const interval = window.setInterval(() => void load(), RANKING_REFRESH_INTERVAL_MS)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [rankingId, cacheKey])

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden rounded bg-black/55 p-4 text-white">
      <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-cyan-300">
        {ranking?.nome ?? 'Ranking comercial'}
        {isOffline && <OfflineTag />}
      </span>

      {!ranking || ranking.itens.length === 0 ? (
        <span className="text-sm text-slate-400">Sem dados importados ainda.</span>
      ) : (
        <ol className="flex flex-col gap-1 overflow-hidden text-sm">
          {ranking.itens.map((item) => (
            <li key={`${item.posicao}-${item.nome}`} className="flex justify-between gap-3">
              <span className="truncate">
                {item.posicao}º {item.nome}
              </span>
              <span className="text-slate-300">{item.valor}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function IndicatorsWidget({ content }: { content: string }) {
  const indicators = content
    .split('\n')
    .map((line) => line.split('|').map((value) => value.trim()))
    .filter(([label, value]) => label && value)

  return (
    <div className="grid h-full w-full grid-cols-2 gap-3 rounded bg-black/55 p-4 text-white">
      {indicators.length > 0 ? indicators.map(([label, value], index) => (
        <div className="flex min-w-0 flex-col justify-center rounded border border-cyan-300/20 bg-cyan-300/5 px-3" key={`${label}-${index}`}>
          <span className="truncate text-xs uppercase tracking-wide text-slate-400">{label}</span>
          <span className="mt-1 truncate text-2xl font-semibold text-cyan-100">{value}</span>
        </div>
      )) : <span className="col-span-2 self-center text-center text-sm text-slate-400">Configure um indicador por linha: Título|Valor</span>}
    </div>
  )
}

function CalendarWidget() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded bg-black/55 p-4 text-white">
      <span className="text-sm capitalize tracking-wide text-cyan-200">{now.toLocaleDateString('pt-BR', { weekday: 'long' })}</span>
      <span className="my-1 text-7xl font-semibold leading-none">{now.getDate()}</span>
      <span className="text-lg capitalize text-slate-200">{now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
    </div>
  )
}

function getLayoutComponentStyle(component: LayoutComponent): React.CSSProperties {
  return {
    left: `${(component.x / 1920) * 100}%`,
    top: `${(component.y / 1080) * 100}%`,
    width: `${(component.largura / 1920) * 100}%`,
    height: `${(component.altura / 1080) * 100}%`,
  }
}

// O Designer trabalha em 1920×1080. Usamos a menor dimensão relativa para
// ampliar tipografia e espaçamentos junto com o quadro, preservando a
// proporção visual quando o operador aumenta um widget.
function getWidgetScale(component: LayoutComponent): number {
  const widthScale = component.largura / 560
  const heightScale = component.altura / 240
  return Math.min(3.2, Math.max(0.45, Math.min(widthScale, heightScale)))
}

function FullscreenHint() {
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 -translate-x-1/2 rounded bg-slate-950/80 px-4 py-2 text-sm text-slate-300">
      Toque na tela para ativar tela cheia
    </div>
  )
}

function TVIdentity({ tv }: { tv: TV }) {
  const details = [tv.id, tv.local, tv.setor, tv.unidade].filter(Boolean).join(' | ')

  return (
    <div className="pointer-events-none fixed bottom-3 left-4 z-20 max-w-[70vw] truncate rounded bg-black/35 px-2 py-1 text-[10px] text-white/45">
      {details || tv.id}
    </div>
  )
}

function CachedContentBadge() {
  return (
    <div className="pointer-events-none fixed right-5 top-5 rounded bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
      Conteúdo offline
    </div>
  )
}

interface PlayerInfoProps {
  label: string
  value: string
}

function PlayerInfo({ label, value }: PlayerInfoProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-100">{value}</span>
    </div>
  )
}
