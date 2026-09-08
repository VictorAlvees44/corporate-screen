import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../services/api'
import type { CloudMonitoringSnapshot, MonitoringLogsResponse, MonitoringStatusResponse } from '../types'

const STATUS_REFRESH_MS = 10_000
const LOGS_REFRESH_MS = 30_000

export default function ServerMonitorArea() {
  const [data, setData] = useState<MonitoringStatusResponse | null>(null)
  const [logs, setLogs] = useState<MonitoringLogsResponse | null>(null)
  const [logTab, setLogTab] = useState<'audit' | 'startup'>('audit')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const loadStatus = useCallback(async () => {
    try {
      const response = await api.getMonitoringStatus()
      if (mountedRef.current) {
        setData(response)
        setError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof ApiError ? err.message : 'Não foi possível carregar os dados do servidor')
      }
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  const loadLogs = useCallback(async () => {
    try {
      const response = await api.getMonitoringLogs()
      if (mountedRef.current) setLogs(response)
    } catch {
      // Falha ao buscar log não deve derrubar o resto da aba de monitoramento.
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void loadStatus()
    void loadLogs()

    const statusInterval = window.setInterval(() => void loadStatus(), STATUS_REFRESH_MS)
    const logsInterval = window.setInterval(() => void loadLogs(), LOGS_REFRESH_MS)

    return () => {
      mountedRef.current = false
      window.clearInterval(statusInterval)
      window.clearInterval(logsInterval)
    }
  }, [loadStatus, loadLogs])

  if (loading) {
    return <p className="text-sm text-slate-400">Carregando dados do servidor...</p>
  }

  if (error && !data) {
    return <p className="text-sm text-rose-300">{error}</p>
  }

  if (!data) return null

  const { status, network, cloud } = data
  const isCloudflare = status.hosting === 'cloudflare'
  const secureAccess = Boolean(cloud?.security.googleOAuthConfigured && cloud.security.workspaceOnly
    && cloud.security.adminOnly && cloud.security.passwordLoginDisabled && cloud.security.hashedSessions
    && cloud.security.persistentRateLimiting && cloud.security.crossSiteProtection)

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Monitoramento</h2>
          <p className="mt-1 text-sm text-slate-400">{isCloudflare ? 'Diagnóstico real do Worker, banco D1, biblioteca R2, segurança e TVs.' : 'Saúde da máquina que hospeda o Corporate Screen, consumo de internet e logs recentes.'}</p>
          {cloud && <p className="mt-1 text-xs text-slate-500">Verificado em {formatDateTime(cloud.checkedAt)}</p>}
        </div>
        <button
          className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:border-cyan-300"
          type="button"
          onClick={() => void loadStatus()}
        >
          Atualizar diagnóstico
        </button>
      </div>

      <OverallStatusBanner ok={status.ok} warnings={status.warnings} />

      {isCloudflare && cloud ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricBox label="Worker" value={cloud.worker.status === 'operational' ? 'Online' : 'Falha'} detail={cloud.worker.route} tone={cloud.worker.status === 'operational' ? 'default' : 'danger'} />
          <MetricBox label="TVs online" value={`${cloud.content.tvsOnline}/${cloud.content.tvsTotal}`} detail={`${cloud.content.tvsPending} pendente(s) • ${cloud.content.tvsOffline} offline`} tone={cloud.content.tvsOffline > 0 || cloud.content.tvsPending > 0 ? 'warning' : 'default'} />
          <MetricBox label="Armazenamento R2" value={formatBytes(cloud.r2.totalBytes)} detail={`${cloud.r2.objectCount} arquivo(s) • ${cloud.r2.usedPercent.toFixed(2)}% de 10 GB`} tone={toneForPercent(cloud.r2.usedPercent)} />
          <MetricBox label="Controle de acesso" value={secureAccess ? 'Ativo' : 'Atenção'} detail="Workspace exclusivo • somente Admin" tone={secureAccess ? 'default' : 'danger'} />
        </div>
      ) : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricBox label="CPU" value={`${status.cpu.loadPercent}%`} detail={`${status.cpu.cores} núcleo(s)`} tone={toneForPercent(status.cpu.loadPercent)} />
        <MetricBox
          label="Memória"
          value={`${status.memory.usedPercent}%`}
          detail={`${formatBytes(status.memory.usedBytes)} de ${formatBytes(status.memory.totalBytes)}`}
          tone={toneForPercent(status.memory.usedPercent)}
        />
        <MetricBox
          label="Disco"
          value={status.disk ? `${status.disk.usedPercent}%` : '—'}
          detail={status.disk ? `${formatBytes(status.disk.usedBytes)} de ${formatBytes(status.disk.totalBytes)} (${status.disk.mount})` : 'Não disponível'}
          tone={status.disk ? toneForPercent(status.disk.usedPercent) : 'default'}
        />
        <MetricBox label="Servidor no ar" value={formatUptime(status.server.uptimeSeconds)} detail={`Máquina: ${formatUptime(status.machine.uptimeSeconds)}`} tone="default" />
      </div>}

      {isCloudflare && cloud ? <CloudDetails cloud={cloud} /> : (
        <div className="grid gap-4 rounded border border-slate-800 bg-slate-900/60 p-4 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Máquina</h3>
            <dl className="mt-3 grid gap-1.5 text-sm text-slate-400">
              <Row label="Host" value={status.machine.hostname} />
              <Row label="Sistema" value={`${status.machine.distro} ${status.machine.release} (${status.machine.arch})`} />
              <Row label="Node.js" value={status.server.nodeVersion} />
              <Row label="Ambiente" value={status.server.environment} />
              <Row label="Porta" value={status.server.port} />
              <Row label="Acesso externo" value={status.server.cloudflareTunnelRunning ? 'Túnel Cloudflare ativo' : 'Túnel Cloudflare não localizado'} />
            </dl>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-200">Internet</h3>
            <dl className="mt-3 grid gap-1.5 text-sm text-slate-400">
              <Row label="Download agora" value={network.instant ? `${formatBytes(network.instant.rxBytesPerSec)}/s` : 'medindo...'} />
              <Row label="Upload agora" value={network.instant ? `${formatBytes(network.instant.txBytesPerSec)}/s` : 'medindo...'} />
              <Row label={`Total em ${network.currentMonth.label}`} value={formatBytes(network.currentMonth.totalBytes)} />
              <Row label="Recebido no mês" value={formatBytes(network.currentMonth.rxBytes)} />
              <Row label="Enviado no mês" value={formatBytes(network.currentMonth.txBytes)} />
            </dl>
          </div>
        </div>
      )}

      <div className="rounded border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-200">Log</h3>
          <div className="flex gap-2">
            <LogTabButton active={logTab === 'audit'} onClick={() => setLogTab('audit')}>{isCloudflare ? 'Segurança' : 'Ações administrativas'}</LogTabButton>
            <LogTabButton active={logTab === 'startup'} onClick={() => setLogTab('startup')}>{isCloudflare ? 'Arquitetura' : 'Inicialização do servidor'}</LogTabButton>
            <button
              className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
              type="button"
              onClick={() => void loadLogs()}
            >
              Atualizar
            </button>
          </div>
        </div>

        <pre className="mt-3 max-h-80 overflow-auto rounded border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed text-slate-300">
          {renderLogLines(logTab === 'audit' ? logs?.audit : logs?.startup)}
        </pre>
      </div>
    </div>
  )
}

function renderLogLines(lines: string[] | undefined): string {
  if (!lines) return 'Carregando...'
  if (lines.length === 0) return 'Nenhum registro encontrado ainda.'
  return lines.slice().reverse().join('\n')
}

function CloudDetails({ cloud }: { cloud: CloudMonitoringSnapshot }) {
  const r2Percent = Math.min(100, Math.max(0, cloud.r2.usedPercent))
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="rounded border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Serviços Cloudflare</h3>
        <dl className="mt-3 grid gap-2 text-sm">
          <StatusRow label={`Worker ${cloud.worker.name}`} status={cloud.worker.status} detail={cloud.worker.route} />
          <StatusRow label={`D1 ${cloud.d1.databaseName}`} status={cloud.d1.status} detail="Programação, TVs, usuários e sessões" />
          <StatusRow label={`R2 ${cloud.r2.bucketName}`} status={cloud.r2.status} detail="Imagens, vídeos e documentos" />
        </dl>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-slate-400">
            <span>Franquia de armazenamento R2</span>
            <span>{cloud.r2.usedPercent.toFixed(2)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-slate-800">
            <div className={`h-full rounded ${r2Percent >= 90 ? 'bg-rose-400' : r2Percent >= 75 ? 'bg-amber-400' : 'bg-cyan-400'}`} style={{ width: `${r2Percent}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500">{formatBytes(cloud.r2.totalBytes)} de {formatBytes(cloud.r2.freeTierBytes)} • {cloud.r2.objectCount} objeto(s)</p>
        </div>
      </div>

      <div className="rounded border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Conteúdo e dispositivos</h3>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-slate-400">
          <Row label="TVs" value={`${cloud.content.tvsTotal}`} />
          <Row label="Online" value={`${cloud.content.tvsOnline}`} />
          <Row label="Pendentes" value={`${cloud.content.tvsPending}`} />
          <Row label="Incompatíveis" value={`${cloud.content.tvsIncompatible}`} />
          <Row label="Playlists" value={`${cloud.content.playlists}`} />
          <Row label="Programações" value={`${cloud.content.schedules}`} />
          <Row label="Layouts" value={`${cloud.content.layouts}`} />
          <Row label="Rankings" value={`${cloud.content.rankings}`} />
          <Row label="Fontes RSS" value={`${cloud.content.rssFeeds}`} />
        </dl>
      </div>

      <div className="rounded border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Proteções ativas</h3>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <ProtectionBadge enabled={cloud.security.passwordLoginDisabled}>Login por senha desativado</ProtectionBadge>
          <ProtectionBadge enabled={cloud.security.adminOnly}>Somente administradores</ProtectionBadge>
          <ProtectionBadge enabled={cloud.security.hashedSessions}>Sessões com hash</ProtectionBadge>
          <ProtectionBadge enabled={cloud.security.persistentRateLimiting}>Limite de tentativas</ProtectionBadge>
          <ProtectionBadge enabled={cloud.security.crossSiteProtection}>Proteção cross-site</ProtectionBadge>
          <ProtectionBadge enabled={cloud.security.googleOAuthConfigured && cloud.security.workspaceOnly}>Google Workspace exclusivo</ProtectionBadge>
        </div>
      </div>

      <div className="rounded border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-semibold text-slate-200">Compatibilidade do player</h3>
        <p className="mt-3 text-sm text-slate-300">Player moderno e fallback legado ativos.</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">{cloud.compatibility.baseline}</p>
      </div>
    </div>
  )
}

function StatusRow({ label, status, detail }: { label: string; status: 'operational' | 'error'; detail: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-800/80 pb-2 last:border-0">
      <div><dt className="text-slate-200">{label}</dt><dd className="text-xs text-slate-500">{detail}</dd></div>
      <span className={`rounded-full border px-2 py-0.5 text-xs ${status === 'operational' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>{status === 'operational' ? 'Online' : 'Falha'}</span>
    </div>
  )
}

function ProtectionBadge({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <span className={`rounded-full border px-2.5 py-1 ${enabled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>{enabled ? '✓' : '•'} {children}</span>
}

function OverallStatusBanner({ ok, warnings }: { ok: boolean; warnings: string[] }) {
  if (ok && warnings.length === 0) {
    return (
      <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
        A infraestrutura está operacional. Confira também a reprodução das TVs acima; isso não é uma certificação de segurança nem de reprodução.
      </div>
    )
  }

  return (
    <div className={`rounded border px-4 py-3 text-sm ${ok ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
      <p className="font-medium">{ok ? 'Serviços operacionais com avisos:' : 'Falha de infraestrutura:'}</p>
      <ul className="mt-1 list-inside list-disc">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  )
}

function MetricBox({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'default' | 'warning' | 'danger' }) {
  const toneClass =
    tone === 'danger'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
      : tone === 'warning'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
        : 'border-slate-800 bg-slate-900/60 text-slate-100'

  return (
    <div className={`rounded border p-4 ${toneClass}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs opacity-70">{detail}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-300">{value}</dd>
    </div>
  )
}

function LogTabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className={`rounded border px-3 py-1.5 text-xs transition ${active ? 'border-cyan-400 bg-cyan-400/10 text-cyan-100' : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600'}`}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function toneForPercent(percent: number): 'default' | 'warning' | 'danger' {
  if (percent >= 90) return 'danger'
  if (percent >= 75) return 'warning'
  return 'default'
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes.toFixed(0)} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}min`
  return `${minutes}min`
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'agora' : date.toLocaleString('pt-BR')
}
