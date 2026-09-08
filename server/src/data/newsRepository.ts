import { readJSON, writeJSON } from './jsonStore'
import type { NewsFeed, NewsSettings } from '../types'

const FILE_NAME = 'news.json'
const DEFAULT_SETTINGS: NewsSettings = { feeds: [] }

export async function getNewsSettings(): Promise<NewsSettings> {
  const raw = await readJSON<unknown>(FILE_NAME, DEFAULT_SETTINGS)
  return normalizeNewsSettings(raw)
}

export async function saveNewsSettings(settings: NewsSettings): Promise<NewsSettings> {
  const normalized = normalizeNewsSettings(settings)
  await writeJSON(FILE_NAME, normalized)
  return normalized
}

// Migra automaticamente a configuração antiga (feedUrl/feedUrls) para o
// gerenciador completo. Assim nenhuma fonte existente é perdida na atualização.
function normalizeNewsSettings(raw: unknown): NewsSettings {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const legacyUrls = Array.isArray(value.feedUrls)
    ? value.feedUrls.filter((item): item is string => typeof item === 'string')
    : typeof value.feedUrl === 'string'
      ? [value.feedUrl]
      : []

  const feeds = Array.isArray(value.feeds)
    ? value.feeds.map((feed, index) => normalizeFeed(feed, index)).filter((feed): feed is NewsFeed => feed !== null)
    : legacyUrls.map((url, index) => legacyFeed(url, index, Boolean(value.ativo)))

  return { feeds: feeds.sort((first, second) => first.prioridade - second.prioridade || first.nome.localeCompare(second.nome)) }
}

function legacyFeed(url: string, index: number, ativo: boolean): NewsFeed {
  return {
    id: `feed-legado-${index + 1}`,
    nome: sourceName(url),
    categoria: 'Notícias',
    url: url.trim(),
    ativo,
    prioridade: index + 1,
    atualizarMinutos: 5,
    limiteNoticias: 15,
    ultimoStatus: 'pending',
  }
}

function normalizeFeed(value: unknown, index: number): NewsFeed | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const url = typeof item.url === 'string' ? item.url.trim() : ''
  if (!url) return null

  return {
    id: typeof item.id === 'string' && item.id ? item.id : `feed-${index + 1}`,
    nome: text(item.nome) || sourceName(url),
    categoria: text(item.categoria) || 'Notícias',
    url,
    logoUrl: text(item.logoUrl) || undefined,
    // Fontes cadastradas são sempre incluídas na programação. Essa migração
    // também reativa automaticamente fontes que estavam inativas em versões
    // anteriores do gerenciador.
    ativo: true,
    prioridade: positiveInteger(item.prioridade, index + 1),
    atualizarMinutos: positiveInteger(item.atualizarMinutos, 5),
    limiteNoticias: positiveInteger(item.limiteNoticias, 15),
    ultimaAtualizacaoEm: text(item.ultimaAtualizacaoEm) || undefined,
    ultimaVerificacaoEm: text(item.ultimaVerificacaoEm) || undefined,
    ultimoStatus: item.ultimoStatus === 'success' || item.ultimoStatus === 'error' ? item.ultimoStatus : 'pending',
    ultimoErro: text(item.ultimoErro) || undefined,
    ultimaQuantidade: typeof item.ultimaQuantidade === 'number' ? item.ultimaQuantidade : undefined,
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback
}

function sourceName(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'g1.globo.com' || host.endsWith('.g1.globo.com')) return 'G1'
    if (host === 'ge.globo.com' || host.endsWith('.ge.globo.com') || host.startsWith('globoesporte.')) return 'GE'
    return host.split('.')[0] || 'Notícias'
  } catch {
    return 'Notícias'
  }
}
