import { useState } from 'react'
import type { TV, TVDiagnostics } from '../types'
import { api } from '../services/api'
import { PLAYBACK_ERRORS, playbackSummary, latestRefresh, hasReceivedRefresh } from '../utils/playbackStatus'

function date(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Ainda não informado'
  return new Date(value).toLocaleString('pt-BR')
}

export function TVPlaybackDetails({ tv, requestedSync }: { tv: TV; requestedSync: string }) {
  const [refreshing, setRefreshing] = useState(false)
  const [localRefresh, setLocalRefresh] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const summary = playbackSummary(tv)
  const report = tv.reproducao
  const requested = latestRefresh(latestRefresh(requestedSync, tv.atualizacaoSolicitadaEm), localRefresh)
  const received = hasReceivedRefresh(report?.receivedSync, requested)
  async function refreshTV() {
    setRefreshing(true); setRefreshError('')
    try { const saved = await api.refreshTV(tv.id); setLocalRefresh(saved.atualizacaoSolicitadaEm || '') }
    catch (error) { setRefreshError(error instanceof Error ? error.message : 'Não foi possível atualizar esta TV.') }
    finally { setRefreshing(false) }
  }
  return (
    <div className="mt-3 grid gap-2 text-xs">
      <div className={`rounded border p-3 ${summary.problem ? 'border-amber-400/40 bg-amber-400/10 text-amber-100' : 'border-slate-700 bg-slate-950/50 text-slate-300'}`}>
        <p className="font-semibold">{summary.label}</p>
        <p className="mt-1 leading-relaxed">{summary.detail}</p>
        {report?.errorCode && report.state === 'error' && <p className="mt-1 font-mono">Código: {report.errorCode}</p>}
      </div>
      {requested && <p className={received ? 'text-cyan-200' : 'text-amber-200'}>Atualização: {received ? 'recebida pela TV' : 'aguardando confirmação da TV'}. {received ? 'Confira a reprodução acima.' : 'O comando será consultado quando o player se comunicar.'}</p>}
      <div><button type="button" aria-label={`Atualizar ${tv.nome} (${tv.id})`} disabled={refreshing} onClick={() => { void refreshTV() }} className="rounded border border-cyan-400/50 px-3 py-2 text-cyan-200 disabled:opacity-50">{refreshing ? 'Enviando…' : 'Atualizar esta TV'}</button></div>
      {localRefresh && <p role="status" className="text-slate-400">{received ? 'Esta TV recebeu a atualização.' : 'Pedido enviado apenas para esta TV. Normalmente será consultado em até 15 segundos quando online.'} Reaplica o conteúdo, sem alterar playlists, horários ou as outras TVs. Para carregar novas versões do player, reabra a página na TV.</p>}
      {refreshError && <p role="alert" className="text-red-300">{refreshError}</p>}
      {report?.mediaName && <p className="break-all text-slate-300">Última mídia informada: {report.mediaName}</p>}
      <p className="text-slate-500">Relatório: {date(report?.reportedAt)}<br />Último contato: {date(tv.ultimaConexao)}</p>
      <IndividualDiagnostic tv={tv} />
      {report?.lastError && <details className="rounded border border-slate-700 p-2 text-slate-300">
        <summary className="cursor-pointer">Última ocorrência registrada · {date(report.lastError.receivedAt)}</summary>
        <p className="mt-2">{PLAYBACK_ERRORS[report.lastError.code] || report.lastError.code}</p>
        <p className="mt-1 break-all">{report.lastError.mediaName || 'Player'} · {report.lastError.code}</p>
        <p className="mt-1 text-slate-500">Histórico: consulte o status acima para saber se há uma falha atual.</p>
      </details>}
    </div>
  )
}

function IndividualDiagnostic({ tv }: { tv: TV }) {
  const [busy, setBusy] = useState(false)
  const [requested, setRequested] = useState('')
  const [error, setError] = useState('')
  const diagnostic = tv.reproducao?.diagnostics
  // Outro administrador também pode emitir um pedido; acompanhe o mais novo.
  const request = requested > (tv.diagnosticoSolicitadoEm || '') ? requested : tv.diagnosticoSolicitadoEm
  const waiting = Boolean(request && diagnostic?.checkedRequest !== request)
  const fresh = Date.now() - Date.parse(tv.ultimaConexao) < 120000
    && Date.now() - Date.parse(tv.reproducao?.reportedAt || '') < 120000
  const network = diagnostic?.network
  const codec = (value: string) => ({ probably: 'provável', maybe: 'possível', no: 'não declarado' }[value] || 'desconhecido')
  async function refresh() {
    setBusy(true); setError('')
    try { const updated = await api.diagnoseTV(tv.id); setRequested(updated.diagnosticoSolicitadoEm || '') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível solicitar o diagnóstico.') }
    finally { setBusy(false) }
  }
  return <details className="rounded border border-slate-700 p-3 text-slate-300">
    <summary className="cursor-pointer font-semibold">Diagnóstico individual da TV</summary>
    <p className="mt-2 break-words">Navegador: {tv.navegador || 'Ainda não informado'}</p>
    {tv.alertaCompatibilidade && <p className="mt-2 text-amber-200">{tv.alertaCompatibilidade}</p>}
    {!diagnostic ? <p className="mt-2 text-amber-200">Aguardando uma versão atualizada do player. Após publicar a atualização, reabra o endereço na TV.</p> : <>
      {!fresh && <p className="mt-2 text-amber-200">Dados antigos: não confirmam o estado atual. Verifique energia, navegador e conexão da TV.</p>}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <dt>Vídeo HTML5</dt><dd>{diagnostic.capabilities.video ? 'Disponível' : 'Não disponível — use imagens'}</dd>
        <dt>MP4 / WebM</dt><dd>{codec(diagnostic.capabilities.mp4)} / {codec(diagnostic.capabilities.webm)}</dd>
        <dt>Armazenamento local</dt><dd>{diagnostic.capabilities.storage === 'local' ? 'Disponível' : 'Indisponível ou bloqueado'}</dd>
        <dt>Comunicação / JSON</dt><dd>{diagnostic.capabilities.xhr ? 'Disponível' : 'Não declarada'} / {diagnostic.capabilities.json ? 'Disponível' : 'Não disponível'}</dd>
        <dt>Resposta média da API</dt><dd>{network && network.samples > network.failures ? `${network.averageMs} ms` : 'Sem amostra bem-sucedida'}</dd>
        <dt>Última consulta</dt><dd>{network?.samples ? `${network.lastMs} ms · ${network.lastHttpStatus ? `HTTP ${network.lastHttpStatus}` : 'sem resposta HTTP'}` : 'Sem amostra'}</dd>
        <dt>Falhas recentes</dt><dd>{network?.failures || 0} / {network?.samples || 0} consultas ({network?.networkFailures || 0} sem resposta HTTP)</dd>
        <dt>Carregamento da mídia</dt><dd>{diagnostic.media.loadMs === null ? 'Ainda não confirmado' : `${diagnostic.media.loadMs} ms`}</dd>
        <dt>Eventos de espera em vídeo</dt><dd>{diagnostic.media.stalls} desde a abertura do player</dd>
        <dt>Manter tela ativa</dt><dd>{powerStatus(diagnostic.power, tv.reproducao?.version)}</dd>
      </dl>
      <p className="mt-3 leading-relaxed text-slate-400">A latência inclui rede e servidor; não é teste de velocidade da internet. Formatos são declarados pelo navegador, não garantidos. Confira também a reprodução e os erros acima. Conteúdo externo e componentes de layout não têm confirmação visual.</p>
    </>}
    <button type="button" onClick={() => { void refresh() }} disabled={busy || waiting} className="mt-3 rounded border border-cyan-400/50 px-3 py-2 text-cyan-200 disabled:opacity-50">{busy ? 'Solicitando…' : waiting ? 'Aguardando a TV…' : 'Atualizar diagnóstico'}</button>
    {waiting && <p className="mt-2 text-amber-200" role="status">Solicitação registrada. Normalmente chega em 15–45 segundos se a TV estiver online e atualizada. Não reinicia a reprodução.</p>}
    {request && !waiting && <p className="mt-2 text-cyan-200" role="status">Diagnóstico solicitado confirmado pela TV.</p>}
    {error && <p className="mt-2 text-red-300" role="alert">{error}</p>}
  </details>
}

function powerStatus(power: TVDiagnostics['power'] | undefined, playerVersion?: string) {
  if (playerVersion !== '2026-09-04.3') return 'Aguardando recarregar o player desta TV'
  if (power?.active) return power.method === 'tizen-screensaver' ? 'Ativo pelo sistema da TV' : 'Ativo pelo navegador'
  if (power?.supported) return 'Disponível, mas não ativado — confira economia de energia da TV'
  return 'Não suportado — desative protetor de tela e desligamento automático na TV'
}

export function FleetPlaybackPanel({ tvs, requestedSync, detailed = false }: { tvs: TV[]; requestedSync: string; detailed?: boolean }) {
  const received = tvs.filter((tv) => hasReceivedRefresh(tv.reproducao?.receivedSync, requestedSync)).length
  const problems = tvs.filter((tv) => playbackSummary(tv).problem)
  return <section className="rounded border border-slate-800 bg-slate-900/60 p-4" aria-label="Reprodução e sincronização das TVs">
    <h3 className="font-semibold text-slate-100">Reprodução e sincronização</h3>
    <p className="mt-2 text-sm text-slate-300">{tvs.length === 0 ? 'Nenhuma TV cadastrada.' : `${problems.length} de ${tvs.length} TV(s) precisam de atenção.`}</p>
    {requestedSync && <p className="mt-1 text-sm text-cyan-200">Último comando: {received}/{tvs.length} receberam · {tvs.length - received} aguardando confirmação.</p>}
    <p className="mt-2 text-xs leading-relaxed text-slate-400">Receber o comando não garante reprodução. O player consulta a programação a cada 15 segundos; a última mídia é amostrada em até 45 segundos. Este painel não é uma captura ao vivo da tela.</p>
    {detailed && <div className="mt-4 grid gap-3 lg:grid-cols-2">{tvs.map((tv) => <article key={tv.id} className="rounded border border-slate-800 p-3">
      <h4 className="text-sm font-semibold text-slate-200">{tv.nome} · {tv.id}</h4>
      <TVPlaybackDetails tv={tv} requestedSync={requestedSync} />
    </article>)}</div>}
    {!detailed && problems.length > 0 && <ul className="mt-3 grid gap-1 text-xs text-amber-200">{problems.map((tv) => <li key={tv.id}>{tv.nome} ({tv.id}): {playbackSummary(tv).label}</li>)}</ul>}
  </section>
}
