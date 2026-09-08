import { useEffect, useMemo, useState } from 'react'
import { FleetPlaybackPanel, TVPlaybackDetails } from '../../components/TVPlaybackStatus'
import BirthdaysManager from '../../components/BirthdaysManager'
import NewsSettingsManager from '../../components/NewsSettingsManager'
import PlaylistItemsEditor from '../../components/PlaylistItemsEditor'
import RankingManager from '../../components/RankingManager'
import SchedulesManager from '../../components/SchedulesManager'
import ServerMonitorArea from '../../components/ServerMonitorArea'
import UsersManager from '../../components/UsersManager'
import DesignerPage from '../Designer/DesignerPage'
import { ApiError, api, type AuthProviders } from '../../services/api'
import type {
  AuthUser,
  Layout,
  OperationMode,
  Playlist,
  PlaylistFormData,
  PlaylistItem,
  SystemSettings,
  TV,
  TVFormData,
  UploadedMediaFile,
} from '../../types'

type AdminArea = 'overview' | 'tvs' | 'playlists' | 'layouts' | 'files' | 'operation' | 'content' | 'users' | 'monitoring'

const EMPTY_TV_FORM: TVFormData = {
  nome: '',
  local: '',
  setor: '',
  unidade: '',
  observacoes: '',
  playlistAtual: '',
  layoutAtual: '',
  cepClima: '',
  exibirRelogio: true,
  exibirNoticias: true,
  exibirClima: true,
}

const EMPTY_PLAYLIST_FORM: PlaylistFormData = {
  nome: '',
  itens: [],
}

const DEFAULT_SETTINGS: SystemSettings = {
  tema: 'dark',
  empresa: 'Corporate Screen',
  logoPadrao: '/favicon.svg',
  modoOperacao: 'normal',
  limiteCadastroAtivo: true,
  atualizacaoPlayersEm: '',
  sincronizacaoImagensAtiva: false,
  cicloSincronizadoEm: '',
}

const NAV_GROUPS: { label?: string; items: { area: AdminArea; label: string; adminOnly?: boolean }[] }[] = [
  { items: [{ area: 'overview', label: 'Visão geral' }] },
  {
    label: 'Programação',
    items: [
      { area: 'tvs', label: 'Telas e TVs' },
      { area: 'playlists', label: 'Playlists' },
      { area: 'layouts', label: 'Layouts' },
    ],
  },
  {
    label: 'Biblioteca',
    items: [
      { area: 'files', label: 'Arquivos' },
      { area: 'content', label: 'Conteúdos' },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { area: 'operation', label: 'Operação', adminOnly: true },
      { area: 'users', label: 'Usuários e permissões', adminOnly: true },
      { area: 'monitoring', label: 'Monitoramento', adminOnly: true },
    ],
  },
]

export default function AdminPage() {
  const [activeArea, setActiveArea] = useState<AdminArea>('overview')
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'anonymous'>('checking')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loginStatus, setLoginStatus] = useState<'idle' | 'submitting'>('idle')
  const [loginMessage, setLoginMessage] = useState<string | null>(null)
  const [authProviders, setAuthProviders] = useState<AuthProviders>({ google: false })

  const [tvs, setTVs] = useState<TV[]>([])
  const [tvRefreshFailed, setTVRefreshFailed] = useState(false)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [layouts, setLayouts] = useState<Layout[]>([])
  const [mediaFiles, setMediaFiles] = useState<UploadedMediaFile[]>([])
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS)

  const [tvForm, setTVForm] = useState<TVFormData>(EMPTY_TV_FORM)
  const [editingTVId, setEditingTVId] = useState<string | null>(null)
  const [playlistForm, setPlaylistForm] = useState<PlaylistFormData>(EMPTY_PLAYLIST_FORM)
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null)

  const [status, setStatus] = useState<'idle' | 'loading' | 'saving'>('loading')
  const [message, setMessage] = useState<string | null>(null)

  const tvMonitoring = useMemo(
    () => ({
      total: tvs.length,
      online: tvs.filter((tv) => tv.status === 'online').length,
      offline: tvs.filter((tv) => tv.status === 'offline').length,
      pending: tvs.filter((tv) => tv.approvalStatus === 'pendente').length,
      incompatible: tvs.filter((tv) => tv.compatibilidade === 'incompativel').length,
    }),
    [tvs],
  )

  useEffect(() => {
    api
      .healthCheck()
      .then(() => setApiStatus('online'))
      .catch(() => setApiStatus('offline'))

    api.getAuthProviders().then(setAuthProviders).catch(() => undefined)

    api
      .getCurrentSession()
      .then((session) => {
        if (session.user.role !== 'admin') throw new ApiError('Acesso permitido somente a administradores.', 403)
        setUser(session.user)
        setAuthStatus('authenticated')
        void loadAdminData()
      })
      .catch(() => {
        api.clearAuthToken()
        setAuthStatus('anonymous')
        setStatus('idle')
      })
  }, [])

  useEffect(() => {
    const onSessionExpired = () => {
      setUser(null)
      setAuthStatus('anonymous')
      setTVs([])
      setPlaylists([])
      setLayouts([])
      setMediaFiles([])
      setSettings(DEFAULT_SETTINGS)
      setTVForm(EMPTY_TV_FORM)
      setPlaylistForm(EMPTY_PLAYLIST_FORM)
      setLoginStatus('idle')
      setStatus('idle')
      setLoginMessage('Sessão encerrada ou acesso revogado. Entre novamente com uma conta Administrador autorizada.')
    }
    window.addEventListener('corporate-screen:session-expired', onSessionExpired)
    return () => window.removeEventListener('corporate-screen:session-expired', onSessionExpired)
  }, [])

  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined

    const interval = window.setInterval(() => {
      if (!document.hidden) void loadTVs()
    }, 15_000)

    return () => window.clearInterval(interval)
  }, [authStatus])

  async function loadAdminData() {
    setStatus('loading')
    setMessage(null)

    try {
      const [loadedTVs, loadedPlaylists, loadedLayouts, loadedMedia, loadedSettings] =
        await Promise.all([
          api.listTVs(),
          api.listPlaylists(),
          api.listLayouts(),
          api.listUploadedMedia(),
          api.getSettings(),
        ])

      setTVs(loadedTVs)
      setTVRefreshFailed(false)
      setPlaylists(loadedPlaylists)
      setLayouts(loadedLayouts)
      setMediaFiles(loadedMedia)
      setSettings(loadedSettings)
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível carregar os dados')
    } finally {
      setStatus('idle')
    }
  }

  async function loadTVs() {
    try {
      const [nextTVs, nextSettings] = await Promise.all([api.listTVs(), api.getSettings()])
      setTVs(nextTVs)
      setSettings(nextSettings)
      setTVRefreshFailed(false)
    } catch {
      setTVRefreshFailed(true)
    }
  }

  async function loadMediaFiles() {
    try {
      setMediaFiles(await api.listUploadedMedia())
    } catch {
      // A biblioteca é auxiliar; uma falha pontual não deve interromper a edição.
    }
  }

  function handleGoogleLogin() {
    setLoginStatus('submitting')
    setLoginMessage('Abrindo o Google Workspace nesta mesma aba...')
    api.beginGoogleLogin()
  }

  async function handleLogout() {
    await api.logout()
    setUser(null)
    setAuthStatus('anonymous')
    setTVs([])
    setPlaylists([])
    setLayouts([])
    setMediaFiles([])
    resetTVForm()
    resetPlaylistForm()
  }

  async function handleSaveTV(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingTVId) return
    setStatus('saving')
    setMessage(null)

    try {
      const savedTV = await api.updateTV(editingTVId, tvForm)
      setTVs((current) =>
        current.some((tv) => tv.id === savedTV.id)
          ? current.map((tv) => (tv.id === savedTV.id ? savedTV : tv))
          : [...current, savedTV],
      )
      resetTVForm()
      setMessage('TV atualizada com sucesso.')
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível salvar a TV')
    } finally {
      setStatus('idle')
    }
  }

  function editTV(tv: TV) {
    setEditingTVId(tv.id)
    setTVForm({
      nome: tv.nome,
      local: tv.local,
      setor: tv.setor,
      unidade: tv.unidade,
      observacoes: tv.observacoes,
      playlistAtual: tv.playlistAtual ?? '',
      layoutAtual: tv.layoutAtual ?? '',
      cepClima: tv.cepClima ?? '',
      exibirRelogio: tv.exibirRelogio !== false,
      exibirNoticias: tv.exibirNoticias !== false,
      exibirClima: tv.exibirClima !== false,
    })
    setActiveArea('tvs')
    setMessage(null)
  }

  async function deleteTV(tv: TV) {
    if (!window.confirm(`Remover ${tv.nome || tv.id}?`)) return

    setStatus('saving')
    try {
      await api.deleteTV(tv.id)
      setTVs((current) => current.filter((item) => item.id !== tv.id))
      if (editingTVId === tv.id) resetTVForm()
      setMessage('TV removida com sucesso.')
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível remover a TV')
    } finally {
      setStatus('idle')
    }
  }

  async function approveTV(tv: TV) {
    setStatus('saving')
    try {
      const approved = await api.approveTV(tv.id)
      setTVs((current) => current.map((item) => item.id === approved.id ? approved : item))
      setMessage(`${approved.nome || approved.id} aprovada para reprodução.`)
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível aprovar a TV')
    } finally {
      setStatus('idle')
    }
  }

  function resetTVForm() {
    setEditingTVId(null)
    setTVForm(EMPTY_TV_FORM)
  }

  async function handleSavePlaylist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('saving')
    setMessage(null)

    try {
      const savedPlaylist = editingPlaylistId
        ? await api.updatePlaylist(editingPlaylistId, playlistForm)
        : await api.createPlaylist(playlistForm)

      setPlaylists((current) =>
        current.some((playlist) => playlist.id === savedPlaylist.id)
          ? current.map((playlist) => (playlist.id === savedPlaylist.id ? savedPlaylist : playlist))
          : [...current, savedPlaylist],
      )
      resetPlaylistForm()
      setMessage(editingPlaylistId ? 'Playlist atualizada com sucesso.' : 'Playlist cadastrada com sucesso.')
      setMediaFiles(await api.listUploadedMedia())
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível salvar a playlist')
    } finally {
      setStatus('idle')
    }
  }

  function editPlaylist(playlist: Playlist) {
    setEditingPlaylistId(playlist.id)
    setPlaylistForm({ nome: playlist.nome, itens: playlist.itens })
    setActiveArea('playlists')
    setMessage(null)
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('#playlist-configuration-form input')
      input?.focus({ preventScroll: true })
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  async function deletePlaylist(playlist: Playlist) {
    if (!window.confirm(`Remover ${playlist.nome}?`)) return

    setStatus('saving')
    try {
      await api.deletePlaylist(playlist.id)
      setPlaylists((current) => current.filter((item) => item.id !== playlist.id))
      if (editingPlaylistId === playlist.id) resetPlaylistForm()
      setMessage('Playlist removida com sucesso.')
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível remover a playlist')
    } finally {
      setStatus('idle')
    }
  }

  function resetPlaylistForm() {
    setEditingPlaylistId(null)
    setPlaylistForm(EMPTY_PLAYLIST_FORM)
  }

  async function updateOperationMode(modoOperacao: OperationMode) {
    setStatus('saving')
    setMessage(null)

    try {
      const saved = await api.updateSettings({ modoOperacao })
      setSettings(saved)
      setMessage('Modo operacional atualizado.')
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível atualizar a operação')
    } finally {
      setStatus('idle')
    }
  }

  async function updateRegistrationLimit(limiteCadastroAtivo: boolean) {
    setStatus('saving')
    setMessage(null)
    try {
      const saved = await api.updateSettings({ limiteCadastroAtivo })
      setSettings(saved)
      setMessage(limiteCadastroAtivo ? 'Limite de cadastro ativado.' : 'Cadastro de dispositivos liberado sem limite.')
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível atualizar o cadastro em massa')
    } finally {
      setStatus('idle')
    }
  }

  async function refreshPlayers() {
    setStatus('saving')
    setMessage(null)
    try {
      const result = await api.refreshPlayers()
      setSettings((current) => ({ ...current, ...result }))
      await loadTVs()
      setMessage('Comando enviado. Acompanhe a confirmação de cada TV em Reprodução e sincronização. Sincronizar não associa playlists; conteúdos externos não têm sincronização garantida.')
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível solicitar a atualização das TVs')
    } finally {
      setStatus('idle')
    }
  }

  async function disableImageSynchronization() {
    setStatus('saving')
    setMessage(null)
    try {
      const saved = await api.updateSettings({ sincronizacaoImagensAtiva: false })
      setSettings(saved)
      setMessage('Sincronização de reprodução desativada.')
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível desativar a sincronização')
    } finally {
      setStatus('idle')
    }
  }

  async function deleteMediaFile(file: UploadedMediaFile) {
    if (
      !window.confirm(
        file.referencias
          ? `Remover ${file.nome}? Ele está em uso por ${file.referencias} item(ns) de playlist/layout. Esses itens também serão removidos.`
          : `Remover ${file.nome}? Esta ação não pode ser desfeita.`,
      )
    ) {
      return
    }

    setStatus('saving')
    setMessage(null)

    try {
      const result = await api.deleteUploadedMedia(file.url)
      const [loadedPlaylists, loadedLayouts, loadedMedia] = await Promise.all([
        api.listPlaylists(),
        api.listLayouts(),
        api.listUploadedMedia(),
      ])
      setPlaylists(loadedPlaylists)
      setLayouts(loadedLayouts)
      setMediaFiles(loadedMedia)
      setMessage(
        result.removedReferences > 0
          ? `Arquivo removido. ${result.removedReferences} referência(s) foram limpas.`
          : 'Arquivo removido.',
      )
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível remover o arquivo')
    } finally {
      setStatus('idle')
    }
  }

  if (authStatus === 'checking') {
    return <LoadingScreen label="Verificando acesso..." />
  }

  if (authStatus === 'anonymous') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
        <section className="w-full max-w-sm rounded border border-slate-800 bg-slate-900/70 p-6">
          <p className="text-sm uppercase tracking-[0.2em] text-cyan-300">Corporate Screen</p>
          <h1 className="mt-3 text-3xl font-semibold">Acesso administrativo</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">Acesso exclusivo pelo Google Workspace, somente para contas autorizadas como Administrador.</p>

          {authProviders.google && (
            <button className="mt-6 h-11 w-full rounded bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-wait disabled:opacity-70" type="button" disabled={loginStatus === 'submitting'} onClick={handleGoogleLogin}>
              {loginStatus === 'submitting' ? 'Abrindo Google Workspace...' : 'Entrar com Google Workspace'}
            </button>
          )}

          {loginMessage && <p className="mt-4 text-sm text-slate-300" role="status">{loginMessage}</p>}

          {!authProviders.google && (
            <p className="mt-6 rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">O login corporativo ainda está sendo configurado neste servidor.</p>
          )}
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-cyan-300">Corporate Screen</p>
            <h1 className="mt-2 text-2xl font-semibold">Painel Administrativo</h1>
            <p className="mt-1 text-sm text-slate-400">{user?.email}</p>
          </div>

          <div className="flex items-center gap-3">
            <StatusPill apiStatus={apiStatus} />
            <button className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" type="button" onClick={() => void loadAdminData()}>
              Atualizar
            </button>
            <button className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" type="button" onClick={() => void handleLogout()}>
              Sair
            </button>
          </div>
        </header>

        <div className="grid flex-1 gap-6 py-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="h-fit rounded border border-slate-800 bg-slate-900/60 p-3">
            <nav className="grid gap-4">
              {NAV_GROUPS.map((group, groupIndex) => {
                const items = group.items.filter((item) => !item.adminOnly || user?.role === 'admin')
                if (items.length === 0) return null
                return (
                  <div className="grid gap-1" key={group.label ?? `group-${groupIndex}`}>
                    {group.label && <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{group.label}</p>}
                    {items.map((item) => (
                      <button
                        key={item.area}
                        type="button"
                        className={`rounded px-3 py-2 text-left text-sm transition ${
                          activeArea === item.area
                            ? 'bg-cyan-400 text-slate-950'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                        onClick={() => setActiveArea(item.area)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )
              })}
            </nav>
          </aside>

          <section className="min-w-0">
            {message && <Message>{message}</Message>}
            {tvRefreshFailed && <Message tone="danger">Não foi possível atualizar o status das TVs. Os dados abaixo podem estar desatualizados; tentando novamente automaticamente.</Message>}
            {status === 'loading' ? (
              <LoadingPanel />
            ) : (
              <>
                {activeArea === 'overview' && (
                  <OverviewArea
                    tvMonitoring={tvMonitoring}
                    settings={settings}
                    mediaCount={mediaFiles.length}
                    playlists={playlists}
                  />
                )}
                {activeArea === 'overview' && <FleetPlaybackPanel tvs={tvs} requestedSync={settings.atualizacaoPlayersEm} />}
                {activeArea === 'tvs' && (
                  <TVArea
                    tvs={tvs}
                    requestedSync={settings.atualizacaoPlayersEm}
                    playlists={playlists}
                    layouts={layouts}
                    tvForm={tvForm}
                    editingTVId={editingTVId}
                    onFormChange={(patch) => setTVForm((current) => ({ ...current, ...patch }))}
                    onSubmit={(event) => void handleSaveTV(event)}
                    onCancel={resetTVForm}
                    onEdit={editTV}
                    onDelete={(tv) => void deleteTV(tv)}
                    onApprove={(tv) => void approveTV(tv)}
                    onSync={() => void refreshPlayers()}
                    saving={status === 'saving'}
                  />
                )}
                {activeArea === 'playlists' && (
                  <PlaylistArea
                    playlists={playlists}
                    mediaFiles={mediaFiles}
                    playlistForm={playlistForm}
                    editingPlaylistId={editingPlaylistId}
                    onNameChange={(nome) => setPlaylistForm((current) => ({ ...current, nome }))}
                    onItemsChange={(itens) => setPlaylistForm((current) => ({ ...current, itens }))}
                    onSubmit={(event) => void handleSavePlaylist(event)}
                    onCancel={resetPlaylistForm}
                    onEdit={editPlaylist}
                    onDelete={(playlist) => void deletePlaylist(playlist)}
                    onMediaUploaded={() => void loadMediaFiles()}
                    saving={status === 'saving'}
                  />
                )}
                {activeArea === 'files' && (
                  <FilesArea files={mediaFiles} onDelete={(file) => void deleteMediaFile(file)} />
                )}
                {activeArea === 'operation' && (
                  <OperationArea
                    mode={settings.modoOperacao}
                    onChange={(mode) => void updateOperationMode(mode)}
                    registrationLimitEnabled={settings.limiteCadastroAtivo}
                    onRegistrationLimitChange={(enabled) => void updateRegistrationLimit(enabled)}
                    onRefreshPlayers={() => void refreshPlayers()}
                    imageSynchronizationEnabled={settings.sincronizacaoImagensAtiva}
                    onDisableImageSynchronization={() => void disableImageSynchronization()}
                    saving={status === 'saving'}
                  />
                )}
                {activeArea === 'layouts' && <DesignerPage embedded />}
                {activeArea === 'content' && <ContentArea />}
                {activeArea === 'users' && user?.role === 'admin' && (
                  <div className="grid gap-5">
                    <PageTitle title="Usuários e permissões" description="Controle quem pode entrar e quais ações cada pessoa pode executar." />
                    <UsersManager currentUserEmail={user.email} />
                  </div>
                )}
                {activeArea === 'monitoring' && <div className="grid gap-5"><FleetPlaybackPanel tvs={tvs} requestedSync={settings.atualizacaoPlayersEm} detailed /><ServerMonitorArea /></div>}
              </>
            )}
          </section>
        </div>

        <footer className="border-t border-slate-800 pt-4 text-center text-xs text-slate-500">
          Corporate Screen
        </footer>
      </div>
    </main>
  )
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
      <span className="text-sm text-slate-400">{label}</span>
    </main>
  )
}

function LoadingPanel() {
  return <div className="rounded border border-slate-800 bg-slate-900/60 p-8 text-sm text-slate-400">Carregando...</div>
}

function Message({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'danger' }) {
  return (
    <p className={`mb-4 rounded border px-3 py-2 text-sm ${tone === 'danger' ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>
      {children}
    </p>
  )
}

function StatusPill({ apiStatus }: { apiStatus: 'checking' | 'online' | 'offline' }) {
  const style = apiStatus === 'online' ? 'bg-emerald-500/15 text-emerald-300' : apiStatus === 'offline' ? 'bg-red-500/15 text-red-300' : 'bg-slate-500/15 text-slate-300'
  return <span className={`rounded-full px-3 py-1 text-sm ${style}`}>API: {apiStatus}</span>
}

function OverviewArea({
  tvMonitoring,
  settings,
  mediaCount,
  playlists,
}: {
  tvMonitoring: { total: number; online: number; offline: number; pending: number; incompatible: number }
  settings: SystemSettings
  mediaCount: number
  playlists: Playlist[]
}) {
  return (
    <div className="grid gap-5">
      <PageTitle title="Visão geral" description="Resumo operacional do Corporate Screen." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="TVs" value={tvMonitoring.total} />
        <MetricCard label="Online" value={tvMonitoring.online} tone="online" />
        <MetricCard label="Pendentes" value={tvMonitoring.pending} tone="pending" />
        <MetricCard label="Arquivos" value={mediaCount} />
      </div>
      {tvMonitoring.incompatible > 0 && (
        <InfoCard title="Alerta de compatibilidade">
          <p className="text-amber-200">Há {tvMonitoring.incompatible} TV(s) com navegador incompatível. Abra a área TVs para identificar o dispositivo e atualizar o navegador.</p>
        </InfoCard>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <InfoCard title="Operação">
          <p>Modo atual: <strong>{formatOperationMode(settings.modoOperacao)}</strong></p>
          <p>Horário fixo: segunda a sexta, das 07:30 às 18:00.</p>
        </InfoCard>
        <InfoCard title="Playlists">
          <p>{playlists.length} playlist(s) cadastrada(s).</p>
          <p>Use arquivos enviados ou URLs incorporadas.</p>
        </InfoCard>
      </div>
    </div>
  )
}

function TVArea(props: {
  tvs: TV[]
  requestedSync: string
  playlists: Playlist[]
  layouts: Layout[]
  tvForm: TVFormData
  editingTVId: string | null
  saving: boolean
  onFormChange: (patch: Partial<TVFormData>) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  onEdit: (tv: TV) => void
  onDelete: (tv: TV) => void
  onApprove: (tv: TV) => void
  onSync: () => void
}) {
  function selectPlaylist(tv: TV) {
    props.onEdit(tv)
    window.requestAnimationFrame(() => {
      const select = document.querySelector<HTMLSelectElement>('#tv-configuration-form select')
      select?.focus()
      select?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-3"><PageTitle title="TVs" description="Cadastro, identificação, playlist e rodapé padrão de cada tela." /><button className="rounded bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60" type="button" disabled={props.saving} onClick={props.onSync}>Sincronizar TVs</button></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><FleetPlaybackPanel tvs={props.tvs} requestedSync={props.requestedSync} /></div>
          {props.tvs.map((tv) => (
            <article className="rounded border border-slate-800 bg-slate-900/60 p-4" key={tv.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><h3 className="truncate font-semibold text-slate-100">{tv.nome}</h3><p className="mt-1 font-mono text-xs text-slate-400">{tv.id}</p></div>
                <StatusBadge value={tv.status} />
              </div>
              {tv.compatibilidade === 'incompativel' && <p className="mt-3 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-xs text-amber-200">Navegador incompatível: {tv.alertaCompatibilidade || tv.navegador || 'verifique o dispositivo'}</p>}
              {tv.approvalStatus === 'pendente' && <p className="mt-3 rounded border border-cyan-400/40 bg-cyan-400/10 px-2 py-1 text-xs text-cyan-100">Aguardando aprovação para começar a reproduzir.</p>}
              {(!tv.playlistAtual || !props.playlists.find((playlist) => playlist.id === tv.playlistAtual)?.itens.length) && !tv.layoutAtual && <div className="mt-3 rounded border border-amber-400/40 p-3 text-xs text-amber-100"><p>Sem playlist padrão com arquivos. Se não houver agendamento ativo, esta TV ficará sem conteúdo.</p><button type="button" className="mt-2 rounded bg-amber-300 px-3 py-2 font-semibold text-slate-950" onClick={() => selectPlaylist(tv)}>Selecionar playlist</button></div>}
              <TVPlaybackDetails tv={tv} requestedSync={props.requestedSync} />
              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm"><InfoLine label="Local" value={tv.local || '-'} /><InfoLine label="Setor" value={tv.setor || '-'} /><InfoLine label="CEP do clima" value={tv.cepClima || 'Não informado'} /><InfoLine label="Playlist" value={findPlaylistName(props.playlists, tv.playlistAtual)} /></dl>
              <div className="mt-4 flex flex-wrap gap-2">{tv.approvalStatus === 'pendente' && <ActionButton onClick={() => props.onApprove(tv)}>Aprovar</ActionButton>}<ActionButton onClick={() => props.onEdit(tv)}>Editar</ActionButton><ActionButton tone="danger" onClick={() => props.onDelete(tv)}>Remover</ActionButton></div>
            </article>
          ))}
        </div>
      </section>

      <SidePanel title={props.editingTVId ? `Editar ${props.editingTVId}` : 'Cadastrar TV'}>
        {!props.editingTVId ? <p className="text-sm leading-relaxed text-slate-300">Abra o endereço principal deste sistema no navegador da TV. Ela aparecerá aqui aguardando aprovação. Confira o identificador exibido no aparelho, depois edite e aprove o cadastro. Isso vincula a TV ao seu token exclusivo, sem cadastro manual desvinculado.</p> : <form id="tv-configuration-form" className="grid gap-3" onSubmit={props.onSubmit}>
          <TextInput label="Nome" value={props.tvForm.nome} onChange={(nome) => props.onFormChange({ nome })} required />
          <TextInput label="Local" value={props.tvForm.local} onChange={(local) => props.onFormChange({ local })} />
          <TextInput label="Setor" value={props.tvForm.setor} onChange={(setor) => props.onFormChange({ setor })} />
          <TextInput label="Unidade" value={props.tvForm.unidade} onChange={(unidade) => props.onFormChange({ unidade })} />
          <SelectInput label="Playlist" value={props.tvForm.playlistAtual} onChange={(playlistAtual) => props.onFormChange({ playlistAtual })} options={[{ value: '', label: 'Sem playlist' }, ...props.playlists.map((playlist) => ({ value: playlist.id, label: playlist.nome }))]} />
          <TextInput label="CEP do clima" value={props.tvForm.cepClima} onChange={(cepClima) => props.onFormChange({ cepClima })} placeholder="Ex.: 01234-000" />
          <fieldset className="rounded border border-slate-800 bg-slate-950/50 p-3"><legend className="px-1 text-sm font-medium text-slate-200">Rodapé padrão</legend><p className="mb-3 text-xs text-slate-400">Aparece sobre a playlist. Desmarque apenas o bloco que não quiser nesta TV.</p><div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-200"><label className="flex items-center gap-2"><input checked={props.tvForm.exibirRelogio} type="checkbox" onChange={(event) => props.onFormChange({ exibirRelogio: event.target.checked })} /> Relógio</label><label className="flex items-center gap-2"><input checked={props.tvForm.exibirNoticias} type="checkbox" onChange={(event) => props.onFormChange({ exibirNoticias: event.target.checked })} /> Notícias RSS</label><label className="flex items-center gap-2"><input checked={props.tvForm.exibirClima} type="checkbox" onChange={(event) => props.onFormChange({ exibirClima: event.target.checked })} /> Previsão do tempo</label></div></fieldset>
          <SelectInput label="Layout avançado (opcional)" value={props.tvForm.layoutAtual} onChange={(layoutAtual) => props.onFormChange({ layoutAtual })} options={[{ value: '', label: 'Sem elementos extras' }, ...props.layouts.map((layout) => ({ value: layout.id, label: layout.nome }))]} />
          <TextArea label="Observações" value={props.tvForm.observacoes} onChange={(observacoes) => props.onFormChange({ observacoes })} />
          <FormActions saving={props.saving} editing={Boolean(props.editingTVId)} onCancel={props.onCancel} />
        </form>}
      </SidePanel>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="truncate text-slate-300">{value}</dd></div>
}

function PlaylistArea(props: {
  playlists: Playlist[]
  mediaFiles: UploadedMediaFile[]
  playlistForm: PlaylistFormData
  editingPlaylistId: string | null
  saving: boolean
  onNameChange: (value: string) => void
  onItemsChange: (items: PlaylistItem[]) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  onEdit: (playlist: Playlist) => void
  onDelete: (playlist: Playlist) => void
  onMediaUploaded: () => void
}) {
  return (
    <div className="grid min-w-0 gap-5">
      <section className="min-w-0">
        <PageTitle title="Playlists" description="Conteúdos que rodam nas TVs durante o horário operacional." />
        <div className="grid gap-3">
          {props.playlists.map((playlist) => (
            <article className="min-w-0 rounded border border-slate-800 bg-slate-900/60 p-4" key={playlist.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-100">{playlist.nome}</h3>
                  <p className="mt-1 font-mono text-xs text-slate-500">{playlist.id}</p>
                </div>
                <div className="flex gap-2">
                  <ActionButton onClick={() => props.onEdit(playlist)}>Editar</ActionButton>
                  <ActionButton tone="danger" onClick={() => props.onDelete(playlist)}>Remover</ActionButton>
                </div>
              </div>
              <div className="mt-4 grid gap-2">
                {playlist.itens
                  .slice()
                  .sort((first, second) => first.ordem - second.ordem)
                  .map((item) => (
                    <div className="grid gap-2 rounded bg-slate-950 px-3 py-2 text-sm text-slate-300 md:grid-cols-[80px_minmax(0,1fr)_80px]" key={item.id}>
                      <span className="capitalize text-slate-400">{item.tipo}</span>
                      <span className="truncate">{item.arquivo}</span>
                      <span>{item.tempoExibicao}s</span>
                    </div>
                  ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <SidePanel title={props.editingPlaylistId ? `Editar ${props.editingPlaylistId}` : 'Cadastrar playlist'}>
        <form id="playlist-configuration-form" className="grid min-w-0 gap-4" onSubmit={props.onSubmit}>
          <TextInput label="Nome" value={props.playlistForm.nome} onChange={props.onNameChange} required />
          <PlaylistItemsEditor
            items={props.playlistForm.itens}
            mediaFiles={props.mediaFiles}
            onChange={props.onItemsChange}
            onMediaUploaded={props.onMediaUploaded}
          />
          <FormActions saving={props.saving} editing={Boolean(props.editingPlaylistId)} onCancel={props.onCancel} />
        </form>
      </SidePanel>
    </div>
  )
}

function FilesArea({ files, onDelete }: { files: UploadedMediaFile[]; onDelete: (file: UploadedMediaFile) => void }) {
  return (
    <div className="grid gap-5">
      <PageTitle title="Arquivos enviados" description="Biblioteca local de arquivos usados nas playlists e layouts." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {files.map((file) => (
          <article className="overflow-hidden rounded border border-slate-800 bg-slate-900/60" key={file.url}>
            <div className="flex aspect-video items-center justify-center bg-slate-950">
              {file.tipo === 'imagem' && <img className="h-full w-full object-contain" src={file.url} alt="" />}
              {file.tipo === 'video' && <video className="h-full w-full object-contain" src={file.url} muted preload="metadata" />}
              {file.tipo === 'link' && <span className="text-sm text-slate-400">Documento</span>}
            </div>
            <div className="grid gap-2 p-4">
              <h3 className="truncate text-sm font-semibold text-slate-100">{file.nome}</h3>
              <p className="truncate text-xs text-slate-500">{file.url}</p>
              <p className="text-xs text-slate-400">{formatFileSize(file.tamanhoBytes)} · {formatLastConnection(file.atualizadoEm)}</p>
              {Boolean(file.referencias) && <p className="text-xs font-medium text-amber-300">Em uso por {file.referencias} item(ns) de playlist/layout</p>}
              <ActionButton tone="danger" onClick={() => onDelete(file)}>Remover arquivo</ActionButton>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function OperationArea({ mode, onChange, registrationLimitEnabled, onRegistrationLimitChange, onRefreshPlayers, imageSynchronizationEnabled, onDisableImageSynchronization, saving }: { mode: OperationMode; onChange: (mode: OperationMode) => void; registrationLimitEnabled: boolean; onRegistrationLimitChange: (enabled: boolean) => void; onRefreshPlayers: () => void; imageSynchronizationEnabled: boolean; onDisableImageSynchronization: () => void; saving: boolean }) {
  const options: { value: OperationMode; title: string; description: string }[] = [
    { value: 'normal', title: 'Normal', description: 'Players exibem conteúdo de segunda a sexta, das 07:30 às 18:00.' },
    { value: 'ferias', title: 'Férias', description: 'Players ficam em stand by até voltar para o modo normal.' },
    { value: 'feriado', title: 'Feriado', description: 'Players ficam em stand by durante o feriado.' },
  ]

  return (
    <div className="grid gap-5">
      <PageTitle title="Operação" description="Controle global do funcionamento dos players." />
      <div className="grid gap-3 lg:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={saving}
            className={`rounded border p-4 text-left transition ${mode === option.value ? 'border-cyan-400 bg-cyan-400/10 text-cyan-100' : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-600'}`}
            onClick={() => onChange(option.value)}
          >
            <span className="block text-base font-semibold">{option.title}</span>
            <span className="mt-2 block text-sm leading-6 text-slate-400">{option.description}</span>
          </button>
        ))}
      </div>
      <section className="rounded border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-base font-semibold text-slate-100">Cadastro de TVs</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">O cadastro sem limite está ativo permanentemente. Novas TVs continuam pendentes até aprovação manual no Admin.</p>
        <p className="mt-2 text-sm text-cyan-200">{registrationLimitEnabled ? 'Proteção de limite ativa: 3 cadastros por origem a cada 15 minutos.' : 'Sem limite de novos dispositivos.'}</p>
        <div className="mt-4 flex flex-wrap gap-2"><button className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-60" type="button" disabled={saving} onClick={() => onRegistrationLimitChange(!registrationLimitEnabled)}>{registrationLimitEnabled ? 'Desativar limite' : 'Ativar limite'}</button></div>
      </section>
      <section className="rounded border border-cyan-500/30 bg-cyan-500/5 p-4">
        <h3 className="text-base font-semibold text-slate-100">Atualização de TVs</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">Use após publicar um aviso urgente ou alterar uma playlist. Em playlists com imagens e vídeos, todas as TVs passam a seguir o mesmo ponto da programação.</p>
        <p className="mt-2 text-sm text-cyan-200">{imageSynchronizationEnabled ? 'Sincronização de reprodução ativa.' : 'Sincronização de reprodução desativada.'}</p>
        <div className="mt-4 flex flex-wrap gap-2"><button className="rounded bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60" type="button" disabled={saving} onClick={onRefreshPlayers}>Sincronizar TVs</button>{imageSynchronizationEnabled && <button className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-60" type="button" disabled={saving} onClick={onDisableImageSynchronization}>Desativar sincronização</button>}</div>
      </section>
    </div>
  )
}

function ContentArea() {
  const [tab, setTab] = useState<'birthdays' | 'ranking' | 'news' | 'schedules'>('birthdays')

  return (
    <div className="grid gap-5">
      <PageTitle title="Conteúdos" description="Cadastros auxiliares; peças visuais devem ser enviadas como arquivos nas playlists." />
      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === 'birthdays'} onClick={() => setTab('birthdays')}>Aniversários</TabButton>
        <TabButton active={tab === 'ranking'} onClick={() => setTab('ranking')}>Ranking</TabButton>
        <TabButton active={tab === 'news'} onClick={() => setTab('news')}>Gerenciador de Notícias</TabButton>
        <TabButton active={tab === 'schedules'} onClick={() => setTab('schedules')}>Agendamentos</TabButton>
      </div>
      {tab === 'birthdays' && <BirthdaysManager />}
      {tab === 'ranking' && <RankingManager />}
      {tab === 'news' && <NewsSettingsManager />}
      {tab === 'schedules' && <SchedulesManager />}
    </div>
  )
}

function PageTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
    </div>
  )
}

function MetricCard({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'online' | 'pending' }) {
  const style = tone === 'online' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : tone === 'pending' ? 'border-amber-500/20 bg-amber-500/10 text-amber-200' : 'border-slate-800 bg-slate-900/60 text-slate-100'
  return (
    <div className={`rounded border px-4 py-3 ${style}`}>
      <p className="text-xs uppercase tracking-[0.16em] opacity-70">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-slate-800 bg-slate-900/60 p-4 text-sm leading-6 text-slate-400">
      <h3 className="mb-2 text-base font-semibold text-slate-100">{title}</h3>
      {children}
    </section>
  )
}

function SidePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <aside className="h-fit min-w-0 max-w-full rounded border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="mb-5 text-lg font-semibold">{title}</h2>
      {children}
    </aside>
  )
}

function TextInput({ label, value, onChange, required = false, placeholder }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; placeholder?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-sm text-slate-300">
      {label}
      <input className="h-10 min-w-0 w-full rounded border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none transition focus:border-cyan-400" type="text" placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    </label>
  )
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-2 text-sm text-slate-300">
      {label}
      <textarea className="min-h-24 resize-y rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition focus:border-cyan-400" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function SelectInput({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-2 text-sm text-slate-300">
      {label}
      <select className="h-10 rounded border border-slate-700 bg-slate-950 px-3 text-slate-100 outline-none transition focus:border-cyan-400" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function FormActions({ saving, editing, onCancel }: { saving: boolean; editing: boolean; onCancel: () => void }) {
  return (
    <div className="flex gap-3">
      <button className="h-10 flex-1 rounded bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60" type="submit" disabled={saving}>
        {saving ? 'Salvando...' : editing ? 'Salvar' : 'Cadastrar'}
      </button>
      {editing && <button className="h-10 rounded border border-slate-700 px-4 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" type="button" onClick={onCancel}>Cancelar</button>}
    </div>
  )
}

function ActionButton({ children, onClick, tone = 'default' }: { children: React.ReactNode; onClick: () => void; tone?: 'default' | 'danger' }) {
  return (
    <button className={`rounded border px-3 py-1.5 text-xs transition ${tone === 'danger' ? 'border-red-500/40 text-red-200 hover:border-red-400' : 'border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-200'}`} type="button" onClick={onClick}>
      {children}
    </button>
  )
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button className={`rounded border px-3 py-2 text-sm transition ${active ? 'border-cyan-400 bg-cyan-400/10 text-cyan-100' : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600'}`} type="button" onClick={onClick}>
      {children}
    </button>
  )
}

function StatusBadge({ value }: { value: TV['status'] }) {
  return <span className={`rounded-full px-2 py-1 text-xs ${value === 'online' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-300'}`}>{value}</span>
}

function findPlaylistName(playlists: Playlist[], playlistId: string | null): string {
  if (!playlistId) return '-'
  return playlists.find((playlist) => playlist.id === playlistId)?.nome ?? playlistId
}

function formatOperationMode(mode: OperationMode): string {
  if (mode === 'ferias') return 'Férias'
  if (mode === 'feriado') return 'Feriado'
  return 'Normal'
}

function formatLastConnection(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sem registro'
  return date.toLocaleString('pt-BR')
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toLocaleString('pt-BR', { maximumFractionDigits: unitIndex === 0 ? 0 : 1 })} ${units[unitIndex]}`
}
