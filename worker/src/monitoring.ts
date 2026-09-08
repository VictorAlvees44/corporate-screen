import { listLayouts } from '../../server/src/data/layoutRepository'
import { getNewsSettings } from '../../server/src/data/newsRepository'
import { listPlaylists } from '../../server/src/data/playlistRepository'
import { listRankings } from '../../server/src/data/rankingRepository'
import { listSchedules } from '../../server/src/data/scheduleRepository'
import { listTVs } from '../../server/src/data/tvRepository'
import { getAuthenticatedUser } from './media'
import type { Env } from './env'
import { secureJson } from './security'

const R2_FREE_TIER_BYTES = 10_000_000_000
const CACHE_MS = 15_000

interface CachedSnapshot {
  expiresAt: number
  value: Record<string, unknown>
}

let cachedSnapshot: CachedSnapshot | null = null

export async function handleMonitoring(request: Request, env: Env, pathName: string): Promise<Response> {
  const user = await getAuthenticatedUser(request)
  if (!user) return secureJson({ message: 'Não autenticado' }, 401)
  if (user.role !== 'admin') return secureJson({ message: 'Esta ação exige perfil de administrador' }, 403)

  if (pathName.endsWith('/logs')) {
    return secureJson({
      audit: [
        'Resumo das proteções configuradas; não representa histórico de acessos nem uma auditoria independente.',
        'Login exclusivo pelo Google Workspace, restrito a e-mails explicitamente cadastrados como Administrador. Login por senha removido.',
        'Cookie HttpOnly, sessão com hash e prazo de 8 horas, autorização revalidada por requisição e limite de tentativas no D1.',
        'Requisições administrativas de outras origens são bloqueadas no Worker.',
      ],
      startup: [
        'Worker global ativo; o domínio não depende do Cloudflare Tunnel nem de computador local.',
        'Persistência D1 e biblioteca R2 são verificadas na aba de Monitoramento.',
      ],
    })
  }

  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) return secureJson(cachedSnapshot.value)

  const checkedAt = new Date().toISOString()
  const warnings: string[] = []
  let d1Status: 'operational' | 'error' = 'operational'
  let r2Status: 'operational' | 'error' = 'operational'

  try {
    await env.DB.prepare('SELECT 1 AS ok').first()
  } catch {
    d1Status = 'error'
    warnings.push('Banco D1 não respondeu ao diagnóstico.')
  }

  let content = {
    tvsTotal: 0,
    tvsOnline: 0,
    tvsOffline: 0,
    tvsPending: 0,
    tvsIncompatible: 0,
    playlists: 0,
    layouts: 0,
    schedules: 0,
    rankings: 0,
    rssFeeds: 0,
  }

  if (d1Status === 'operational') {
    try {
      const [tvs, playlists, layouts, schedules, rankings, news] = await Promise.all([
        listTVs(),
        listPlaylists(),
        listLayouts(),
        listSchedules(),
        listRankings(),
        getNewsSettings(),
      ])
      content = {
        tvsTotal: tvs.length,
        tvsOnline: tvs.filter((tv) => tv.status === 'online').length,
        tvsOffline: tvs.filter((tv) => tv.status === 'offline').length,
        tvsPending: tvs.filter((tv) => tv.approvalStatus === 'pendente').length,
        tvsIncompatible: tvs.filter((tv) => tv.compatibilidade === 'incompativel').length,
        playlists: playlists.length,
        layouts: layouts.length,
        schedules: schedules.length,
        rankings: rankings.length,
        rssFeeds: news.feeds.length,
      }
    } catch {
      d1Status = 'error'
      warnings.push('Não foi possível ler o conteúdo operacional do D1.')
    }
  }

  let r2 = { objectCount: 0, totalBytes: 0, freeTierBytes: R2_FREE_TIER_BYTES, usedPercent: 0 }
  try {
    r2 = await collectR2Stats(env.MEDIA)
  } catch {
    r2Status = 'error'
    warnings.push('Bucket R2 não respondeu ao diagnóstico.')
  }

  if (content.tvsPending > 0) warnings.push(`${content.tvsPending} TV(s) aguardando aprovação.`)
  if (content.tvsOffline > 0) warnings.push(`${content.tvsOffline} TV(s) offline.`)
  if (content.tvsIncompatible > 0) warnings.push(`${content.tvsIncompatible} TV(s) reportaram incompatibilidade.`)
  if (r2.usedPercent >= 75) warnings.push(`R2 já utiliza ${r2.usedPercent.toFixed(1)}% da franquia de referência de 10 GB.`)
  const googleOAuthConfigured = Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_WORKSPACE_DOMAIN)
  if (!googleOAuthConfigured) warnings.push('Login Google Workspace não está configurado; o painel fica bloqueado até corrigir a configuração.')

  const operational = d1Status === 'operational' && r2Status === 'operational'
  const uptimeSeconds = Math.max(0, Math.round(performance.now() / 1000))
  const value = {
    status: {
      ok: operational,
      warnings,
      hosting: 'cloudflare',
      server: {
        uptimeSeconds,
        nodeVersion: 'Cloudflare Workers Runtime',
        environment: 'production',
        port: 'HTTPS/443',
        cloudflareTunnelRunning: false,
      },
      machine: {
        hostname: 'Cloudflare Global Network',
        platform: 'cloudflare',
        distro: 'Workers',
        release: 'edge',
        arch: 'serverless',
        uptimeSeconds,
      },
      cpu: { loadPercent: 0, cores: 0 },
      memory: { totalBytes: 0, usedBytes: 0, freeBytes: 0, usedPercent: 0 },
      disk: null,
    },
    network: {
      instant: null,
      currentMonth: {
        label: new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
        rxBytes: 0,
        txBytes: 0,
        totalBytes: 0,
      },
    },
    cloud: {
      checkedAt,
      worker: {
        status: 'operational',
        name: 'corporate-screen',
        route: 'configured-by-deployer',
      },
      d1: { status: d1Status, databaseName: 'corporate-screen' },
      r2: { status: r2Status, bucketName: 'corporate-screen-media', ...r2 },
      content,
      security: {
        googleOAuthConfigured,
        workspaceOnly: true,
        adminOnly: true,
        passwordLoginDisabled: true,
        hashedSessions: true,
        persistentRateLimiting: true,
        crossSiteProtection: true,
      },
      compatibility: {
        modernPlayer: true,
        legacyPlayer: true,
        baseline: 'Fallback ES5/XHR; requer HTTPS/TLS e suporte básico a HTML5 para vídeo.',
      },
    },
  }

  cachedSnapshot = { value, expiresAt: Date.now() + CACHE_MS }
  return secureJson(value)
}

async function collectR2Stats(bucket: R2Bucket) {
  let cursor: string | undefined
  let objectCount = 0
  let totalBytes = 0

  do {
    const page = await bucket.list({ prefix: 'uploads/', cursor })
    objectCount += page.objects.length
    totalBytes += page.objects.reduce((sum, object) => sum + object.size, 0)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  return {
    objectCount,
    totalBytes,
    freeTierBytes: R2_FREE_TIER_BYTES,
    usedPercent: Math.round((totalBytes / R2_FREE_TIER_BYTES) * 10_000) / 100,
  }
}
