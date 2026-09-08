import si from 'systeminformation'
import path from 'path'
import { fileURLToPath } from 'url'
import { getCurrentMonthUsage, recordNetworkSample } from '../data/networkUsageRepository'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '../../..')

const DISK_WARNING_FREE_PERCENT = 10
const CPU_WARNING_LOAD_PERCENT = 90
const MEM_WARNING_FREE_PERCENT = 10

interface InstantNetworkSample {
  rxBytesPerSec: number
  txBytesPerSec: number
  sampledAt: string
}

// Atualizado a cada amostragem periódica (ver startNetworkSampler). Guardar
// em memória evita que cada request na aba de Monitoramento dispare uma
// nova coleta (a taxa instantânea da systeminformation só fica precisa
// comparando duas leituras seguidas).
let latestInstantSample: InstantNetworkSample | null = null
let samplerTimer: NodeJS.Timeout | null = null

export function startNetworkSampler(intervalMs = 15_000): void {
  if (samplerTimer) return

  void sampleNetworkOnce().catch((error: unknown) => console.error('[monitoramento] Falha na primeira amostra de rede', error))
  samplerTimer = setInterval(() => {
    void sampleNetworkOnce().catch((error: unknown) => console.error('[monitoramento] Falha ao amostrar rede', error))
  }, intervalMs)
}

async function sampleNetworkOnce(): Promise<void> {
  const stats = await si.networkStats()
  const active = stats.filter((iface) => iface.operstate === 'up' && iface.iface !== 'lo')

  const totalRx = active.reduce((sum, iface) => sum + (iface.rx_bytes ?? 0), 0)
  const totalTx = active.reduce((sum, iface) => sum + (iface.tx_bytes ?? 0), 0)
  const rxPerSec = active.reduce((sum, iface) => sum + (iface.rx_sec ?? 0), 0)
  const txPerSec = active.reduce((sum, iface) => sum + (iface.tx_sec ?? 0), 0)

  latestInstantSample = {
    rxBytesPerSec: Math.round(rxPerSec),
    txBytesPerSec: Math.round(txPerSec),
    sampledAt: new Date().toISOString(),
  }

  await recordNetworkSample(totalRx, totalTx)
}

export interface ServerStatusSnapshot {
  ok: boolean
  warnings: string[]
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

export async function getServerStatus(): Promise<ServerStatusSnapshot> {
  const [load, mem, osInfo, disks, processes] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.osInfo(),
    si.fsSize(),
    si.processes(),
  ])

  const appDisk = pickDiskForPath(disks, APP_ROOT)
  const memUsedPercent = mem.total > 0 ? (mem.active / mem.total) * 100 : 0

  const warnings: string[] = []
  if (appDisk && appDisk.use >= 100 - DISK_WARNING_FREE_PERCENT) {
    warnings.push(`Disco com pouco espaço livre (${(100 - appDisk.use).toFixed(1)}% livre).`)
  }
  if (load.currentLoad >= CPU_WARNING_LOAD_PERCENT) {
    warnings.push(`Uso de CPU muito alto (${load.currentLoad.toFixed(0)}%).`)
  }
  if (memUsedPercent >= 100 - MEM_WARNING_FREE_PERCENT) {
    warnings.push(`Memória quase esgotada (${(100 - memUsedPercent).toFixed(1)}% livre).`)
  }

  return {
    ok: warnings.length === 0,
    warnings,
    server: {
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV ?? 'development',
      port: String(process.env.PORT ?? '3001'),
      cloudflareTunnelRunning: processes.list.some((item) => /cloudflared/i.test(item.name) || /cloudflared/i.test(item.command)),
    },
    machine: {
      hostname: osInfo.hostname,
      platform: osInfo.platform,
      distro: osInfo.distro,
      release: osInfo.release,
      arch: osInfo.arch,
      uptimeSeconds: Math.round(si.time().uptime),
    },
    cpu: {
      loadPercent: Math.round(load.currentLoad * 10) / 10,
      cores: load.cpus?.length ?? 0,
    },
    memory: {
      totalBytes: mem.total,
      usedBytes: mem.active,
      freeBytes: mem.available,
      usedPercent: Math.round(memUsedPercent * 10) / 10,
    },
    disk: appDisk
      ? {
          mount: appDisk.mount,
          totalBytes: appDisk.size,
          usedBytes: appDisk.used,
          freeBytes: appDisk.size - appDisk.used,
          usedPercent: Math.round(appDisk.use * 10) / 10,
        }
      : null,
  }
}

export interface NetworkUsageSnapshot {
  instant: InstantNetworkSample | null
  currentMonth: {
    label: string
    rxBytes: number
    txBytes: number
    totalBytes: number
  }
}

export async function getNetworkUsageSnapshot(): Promise<NetworkUsageSnapshot> {
  const usage = await getCurrentMonthUsage()
  const now = new Date()

  return {
    instant: latestInstantSample,
    currentMonth: {
      label: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
      rxBytes: usage.rxBytes,
      txBytes: usage.txBytes,
      totalBytes: usage.rxBytes + usage.txBytes,
    },
  }
}

function pickDiskForPath(disks: si.Systeminformation.FsSizeData[], targetPath: string) {
  const normalizedTarget = targetPath.replace(/\\/g, '/')

  const candidates = disks
    .filter((disk) => disk.mount && normalizedTarget.startsWith(disk.mount.replace(/\\/g, '/')))
    .sort((a, b) => b.mount.length - a.mount.length)

  return candidates[0] ?? disks[0] ?? null
}
