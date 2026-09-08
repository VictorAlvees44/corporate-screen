import type { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { lookup } from 'dns/promises'
import { isPrivateAddress, readLimitedBody } from '../utils/contentSecurity'
import { getNewsSettings, saveNewsSettings } from '../data/newsRepository'
import type { NewsFeed, NewsItem } from '../types'

const BACKGROUND_CHECK_INTERVAL_MS = 30_000
const DEFAULT_UPDATE_MINUTES = 5
const DEFAULT_ITEM_LIMIT = 15
let schedulerStarted = false
const feedCache = new Map<string, { items: NewsItem[]; fetchedAt: number }>()
// A semente é renovada a cada inicialização do servidor. Ela deixa a ordem
// imprevisível, mas estável durante o ciclo: o player percorre toda a lista
// antes de voltar ao primeiro item.
let playlistSeed: string | null = null

interface NewsFeedBody {
  nome?: unknown
  categoria?: unknown
  url?: unknown
  logoUrl?: unknown
  ativo?: unknown
  prioridade?: unknown
  atualizarMinutos?: unknown
  limiteNoticias?: unknown
}

export async function getNewsSettingsHandler(_req: Request, res: Response) {
  res.json(await getNewsSettings())
}

export async function createNewsFeedHandler(req: Request, res: Response) {
  const settings = await getNewsSettings()
  let feed: Omit<NewsFeed, 'id' | 'ultimoStatus' | 'ultimoErro' | 'ultimaQuantidade' | 'ultimaAtualizacaoEm' | 'ultimaVerificacaoEm'>
  try {
    feed = await normalizeFeedBody(req.body as NewsFeedBody, settings.feeds.length + 1)
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Dados do feed inválidos' })
  }

  if (settings.feeds.some((item) => item.url === feed.url)) {
    return res.status(409).json({ message: 'Esse endereço já está cadastrado como fonte.' })
  }

  const created: NewsFeed = { ...feed, id: randomUUID(), ultimoStatus: 'pending' }
  const saved = await saveNewsSettings({ feeds: [...settings.feeds, created] })
  res.status(201).json(saved.feeds.find((item) => item.id === created.id))
}

export async function updateNewsFeedHandler(req: Request, res: Response) {
  const settings = await getNewsSettings()
  const existing = settings.feeds.find((item) => item.id === req.params.id)
  if (!existing) return res.status(404).json({ message: 'Feed não encontrado' })

  let update: Omit<NewsFeed, 'id' | 'ultimoStatus' | 'ultimoErro' | 'ultimaQuantidade' | 'ultimaAtualizacaoEm' | 'ultimaVerificacaoEm'>
  try {
    update = await normalizeFeedBody(req.body as NewsFeedBody, existing.prioridade, existing)
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Dados do feed inválidos' })
  }
  if (settings.feeds.some((item) => item.id !== existing.id && item.url === update.url)) {
    return res.status(409).json({ message: 'Esse endereço já está cadastrado como fonte.' })
  }

  const changedUrl = update.url !== existing.url
  const next: NewsFeed = {
    ...existing,
    ...update,
    ultimoStatus: changedUrl ? 'pending' : existing.ultimoStatus,
    ultimoErro: changedUrl ? undefined : existing.ultimoErro,
    ultimaQuantidade: changedUrl ? undefined : existing.ultimaQuantidade,
    ultimaAtualizacaoEm: changedUrl ? undefined : existing.ultimaAtualizacaoEm,
  }
  if (changedUrl) feedCache.delete(existing.id)

  const saved = await saveNewsSettings({ feeds: settings.feeds.map((item) => item.id === existing.id ? next : item) })
  res.json(saved.feeds.find((item) => item.id === existing.id))
}

export async function deleteNewsFeedHandler(req: Request, res: Response) {
  const settings = await getNewsSettings()
  if (!settings.feeds.some((item) => item.id === req.params.id)) {
    return res.status(404).json({ message: 'Feed não encontrado' })
  }
  feedCache.delete(req.params.id)
  await saveNewsSettings({ feeds: settings.feeds.filter((item) => item.id !== req.params.id) })
  res.status(204).send()
}

export async function testNewsFeedHandler(req: Request, res: Response) {
  const result = await refreshFeeds({ force: true, feedIds: [req.params.id], includeInactive: true })
  const feed = result.feeds.find((item) => item.id === req.params.id)
  if (!feed) return res.status(404).json({ message: 'Feed não encontrado' })
  res.json({ feed, quantidade: feedCache.get(feed.id)?.items.length ?? 0 })
}

export async function refreshAllNewsFeedsHandler(_req: Request, res: Response) {
  const result = await refreshFeeds({ force: true })
  res.json(result)
}

// Rota pública do player. A resposta é sempre construída a partir dos últimos
// dados válidos: a indisponibilidade de um portal nunca interrompe os demais.
export async function getNewsFeed(_req: Request, res: Response) {
  const result = await refreshFeeds({ force: false })
  res.json(buildPlaylist(result.feeds))
}

export function startNewsFeedScheduler() {
  if (schedulerStarted) return
  schedulerStarted = true
  void refreshFeeds({ force: true }).catch((error) => console.error('[noticias] Falha na atualização inicial', error))
  setInterval(() => {
    void refreshFeeds({ force: false }).catch((error) => console.error('[noticias] Falha na atualização em segundo plano', error))
  }, BACKGROUND_CHECK_INTERVAL_MS).unref()
}

async function normalizeFeedBody(body: NewsFeedBody, fallbackPriority: number, existing?: NewsFeed): Promise<Omit<NewsFeed, 'id' | 'ultimoStatus' | 'ultimoErro' | 'ultimaQuantidade' | 'ultimaAtualizacaoEm' | 'ultimaVerificacaoEm'>> {
  const url = text(body.url ?? existing?.url)
  const nome = text(body.nome ?? existing?.nome)
  if (!url || !(await isSafeFeedUrl(url))) throw new Error('Informe uma URL RSS pública usando HTTP ou HTTPS')
  if (!nome) throw new Error('Informe o nome da fonte')

  return {
    nome,
    categoria: text(body.categoria ?? existing?.categoria) || 'Notícias',
    url,
    logoUrl: text(body.logoUrl ?? existing?.logoUrl) || undefined,
    // Toda fonte cadastrada participa da programação. Para interromper uma
    // fonte, ela deve ser removida do gerenciador, não apenas ocultada.
    ativo: true,
    prioridade: positiveInteger(body.prioridade ?? existing?.prioridade, fallbackPriority),
    atualizarMinutos: positiveInteger(body.atualizarMinutos ?? existing?.atualizarMinutos, DEFAULT_UPDATE_MINUTES),
    limiteNoticias: positiveInteger(body.limiteNoticias ?? existing?.limiteNoticias, DEFAULT_ITEM_LIMIT),
  }
}

async function refreshFeeds(options: { force: boolean; feedIds?: string[]; includeInactive?: boolean }): Promise<{ feeds: NewsFeed[] }> {
  const settings = await getNewsSettings()
  const ids = options.feedIds ? new Set(options.feedIds) : null
  const selected = settings.feeds.filter((feed) => !ids || ids.has(feed.id))
  const now = Date.now()
  let changed = false

  const refreshed = await Promise.all(selected.map(async (feed) => {
    const cached = feedCache.get(feed.id)
    const due = !cached || now - cached.fetchedAt >= feed.atualizarMinutos * 60_000
    if (!options.force && !due) return feed

    try {
      const items = await fetchNewsItems(feed.url, feed.limiteNoticias)
      feedCache.set(feed.id, { items, fetchedAt: now })
      changed = true
      return {
        ...feed,
        ultimoStatus: 'success' as const,
        ultimoErro: undefined,
        ultimaQuantidade: items.length,
        ultimaAtualizacaoEm: new Date(now).toISOString(),
        ultimaVerificacaoEm: new Date(now).toISOString(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível ler o feed'
      console.error(`[noticias] Feed "${feed.nome}" indisponível: ${message}`)
      changed = true
      return {
        ...feed,
        ultimoStatus: 'error' as const,
        ultimoErro: message.slice(0, 240),
        ultimaVerificacaoEm: new Date(now).toISOString(),
      }
    }
  }))

  const updatedById = new Map(refreshed.map((feed) => [feed.id, feed]))
  const feeds = settings.feeds.map((feed) => updatedById.get(feed.id) ?? feed)
  if (changed) await saveNewsSettings({ feeds })
  return { feeds }
}

function buildPlaylist(feeds: NewsFeed[]): NewsItem[] {
  const seen = new Set<string>()
  const sources = feeds
    .map((feed) => {
      const items = (feedCache.get(feed.id)?.items ?? [])
        .map((item) => ({
          ...item,
          fonte: feed.nome,
          fonteLogoUrl: feed.logoUrl,
          fonteCategoria: feed.categoria,
          _prioridade: feed.prioridade,
        }))
        .filter((item) => {
      const key = normalizeDuplicateKey(item.link || item.titulo)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
        .sort((first, second) => {
          const order = playlistRank(`item:${normalizeDuplicateKey(first.link || first.titulo)}`) - playlistRank(`item:${normalizeDuplicateKey(second.link || second.titulo)}`)
          if (order !== 0) return order
          return normalizeDuplicateKey(first.link || first.titulo).localeCompare(normalizeDuplicateKey(second.link || second.titulo))
        })

      return { id: feed.id, items }
    })
    .filter((source) => source.items.length > 0)
    .sort((first, second) => {
      const order = playlistRank(`source:${first.id}`) - playlistRank(`source:${second.id}`)
      return order !== 0 ? order : first.id.localeCompare(second.id)
    })

  // Uma rodada entrega uma notícia de cada fonte disponível. A fonte inicial
  // muda a cada rodada, deixando a sequência variada sem deixar uma mesma
  // fonte dominar o rodapé. Nenhuma notícia volta a aparecer antes do fim do
  // ciclo completo, mesmo quando as fontes têm quantidades diferentes.
  const playlist: Array<NewsItem & { _prioridade?: number }> = []
  for (let round = 0; ; round += 1) {
    let added = false
    for (let offset = 0; offset < sources.length; offset += 1) {
      const source = sources[(round + offset) % sources.length]
      const item = source.items[round]
      if (!item) continue
      playlist.push(item)
      added = true
    }
    if (!added) break
  }

  return playlist.map(({ _prioridade: _ignored, ...item }) => item)
}

function playlistRank(value: string): number {
  // Workers não permitem aleatoriedade no escopo global. A semente é criada
  // na primeira requisição, dentro do ciclo permitido pelo runtime.
  playlistSeed ??= randomUUID()
  const seededValue = `${playlistSeed}:${value}`
  let hash = 2166136261
  for (let index = 0; index < seededValue.length; index += 1) {
    hash ^= seededValue.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function normalizeDuplicateKey(value: string): string {
  return value.toLocaleLowerCase('pt-BR').replace(/https?:\/\/|www\.|[^a-z0-9à-ÿ]+/gi, '')
}

// Aceita tanto o RSS/Atom como a página normal de um portal e encontra o feed
// anunciado pela própria página quando necessário.
async function fetchNewsItems(feedUrl: string, limit: number): Promise<NewsItem[]> {
  const firstAttempt = await fetchFeedCandidate(feedUrl)
  const directItems = parseFeedItems(firstAttempt)
  if (directItems.length > 0) return directItems.slice(0, limit)

  const discoveredUrl = discoverFeedUrl(firstAttempt, feedUrl)
  if (!discoveredUrl || !(await isSafeFeedUrl(discoveredUrl))) return []
  return parseFeedItems(await fetchFeedCandidate(discoveredUrl)).slice(0, limit)
}

async function fetchFeedCandidate(url: string, redirects = 0): Promise<string> {
  if (!(await isSafeFeedUrl(url))) throw new Error('Endereço do feed não permitido')
  // Workers usa redirect manual. Cada destino é revalidado antes de seguir,
  // mantendo a proteção contra SSRF e limitando cadeias maliciosas.
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location || redirects >= 3) throw new Error('Redirecionamento inválido no feed')
    const nextUrl = new URL(location, url).toString()
    if (!(await isSafeFeedUrl(nextUrl))) throw new Error('O feed redirecionou para um endereço não permitido')
    return fetchFeedCandidate(nextUrl, redirects + 1)
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Feed retornou status ${response.status}`) }
  const bytes = await readLimitedBody(response, 2_000_000)
  return decodeFeedBytes(bytes, response.headers.get('content-type'))
}

// Nem todo RSS usa UTF-8. Alguns feeds brasileiros, como os da UOL, ainda
// enviam ISO-8859-1. response.text() sempre tratava os bytes como UTF-8 e
// convertia acentos em "�" antes de a notícia chegar ao player.
function decodeFeedBytes(bytes: Uint8Array, contentType: string | null): string {
  const latinPreview = new TextDecoder('windows-1252').decode(bytes.slice(0, 1_024))
  const charsetFromHeader = contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]
  const charsetFromXml = latinPreview.match(/<\?xml[^>]+encoding\s*=\s*["']([^"']+)/i)?.[1]
  const charsetFromHtml = latinPreview.match(/<meta[^>]+charset\s*=\s*["']?([^\s"'>/]+)/i)?.[1]
  const declared = (charsetFromHeader ?? charsetFromXml ?? charsetFromHtml ?? 'utf-8').trim().toLowerCase()
  const aliases: Record<string, string> = {
    'iso-8859-1': 'windows-1252',
    'iso8859-1': 'windows-1252',
    latin1: 'windows-1252',
    'us-ascii': 'windows-1252',
  }

  try {
    return new TextDecoder(aliases[declared] ?? declared).decode(bytes)
  } catch {
    // Um cabeçalho incorreto não deve derrubar todas as notícias. UTF-8 é a
    // alternativa segura para os feeds modernos que não declaram charset.
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function parseFeedItems(raw: string): NewsItem[] {
  return [...parseRSSItems(raw), ...parseAtomItems(raw)]
}

async function isSafeFeedUrl(value: string): Promise<boolean> {
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
  if (url.port && !['80', '443'].includes(url.port)) return false
  try {
    const addresses = await lookup(url.hostname, { all: true })
    return addresses.length > 0 && addresses.every((address) => !isPrivateAddress(address.address))
  } catch { return false }
}

function discoverFeedUrl(html: string, pageUrl: string): string | null {
  const linkTags = html.match(/<link[^>]+rel=["']alternate["'][^>]*>/gi) ?? []
  for (const tag of linkTags) {
    const type = tag.match(/type=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? ''
    if (!type.includes('rss') && !type.includes('atom') && !type.includes('xml')) continue
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1]
    if (!href) continue
    try { return new URL(href, pageUrl).toString() } catch { continue }
  }
  return null
}

function parseAtomItems(xml: string): NewsItem[] {
  return (xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? []).flatMap((block) => {
    const titulo = extractTag(block, 'title')
    if (!titulo) return []
    return [{ titulo, link: block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i)?.[1] ?? '', resumo: extractTag(block, 'summary') ?? extractTag(block, 'content') ?? undefined, imagem: extractImageUrl(block), publicadoEm: extractTag(block, 'updated') ?? extractTag(block, 'published') ?? undefined }]
  })
}

function parseRSSItems(xml: string): NewsItem[] {
  return (xml.match(/<item[\s\S]*?<\/item>/gi) ?? []).flatMap((block) => {
    const titulo = extractTag(block, 'title')
    if (!titulo) return []
    return [{ titulo, link: extractTag(block, 'link') ?? '', resumo: extractTag(block, 'description') ?? extractTag(block, 'content:encoded') ?? undefined, imagem: extractImageUrl(block), publicadoEm: extractTag(block, 'pubDate') ?? undefined }]
  })
}

function extractTag(block: string, tagName: string): string | null {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\/${tagName}>`, 'i'))
  if (!match) return null
  return decodeXMLEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim())
}

function decodeXMLEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', eacute: 'é', ecirc: 'ê',
    iacute: 'í', oacute: 'ó', ocirc: 'ô', otilde: 'õ', uacute: 'ú', ccedil: 'ç',
    Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã', Eacute: 'É', Ecirc: 'Ê',
    Iacute: 'Í', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Uacute: 'Ú', Ccedil: 'Ç',
  }
  let decoded = value
  // Alguns feeds codificam entidades duas vezes (por exemplo, &amp;eacute;).
  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decoded.replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z]+);/g, (whole, entity: string) => {
      if (entity.charAt(0) !== '#') return entities[entity] ?? whole
      const code = entity.charAt(1).toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    })
  }
  return decoded
}

function extractImageUrl(block: string): string | undefined {
  for (const expression of [/<(?:media:content|media:thumbnail|thumbnail|enclosure)[^>]+url=["']([^"']+)["']/i, /<(?:media:content|media:thumbnail|thumbnail|enclosure)[^>]+href=["']([^"']+)["']/i, /<img[^>]+src=["']([^"']+)["']/i]) {
    const match = block.match(expression)
    if (match?.[1] && /^https?:\/\//i.test(match[1])) return match[1]
  }
  return undefined
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function positiveInteger(value: unknown, fallback: number): number { const number = Number(value); return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback }
