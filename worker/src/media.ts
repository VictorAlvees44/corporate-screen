import { findAuthenticatedAdmin } from '../../server/src/utils/adminAccess'
import { mutateJSON, readJSON } from '../../server/src/data/jsonStore'
import type { AuthorizedUser, Layout, Playlist, UploadedMediaFile } from '../../server/src/types'
import type { Env } from './env'
import { isAllowedMediaFile, hasMediaSignature, mediaContentType } from '../../server/src/utils/mediaValidation'

const AUTH_COOKIE_NAME = 'corporate-screen.session'
const MAX_MEDIA_BYTES = 95 * 1024 * 1024
const MAX_BATCH_FILES = 10
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.apng', '.gif', '.webp', '.bmp',
  '.avif', '.heic', '.heif', '.ico', '.tif', '.tiff', '.jxl',
])
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.m4v', '.ogv', '.avi', '.mkv', '.mpeg', '.mpg', '.3gp',
])

export async function handleMediaApi(request: Request, env: Env): Promise<Response> {
  const user = await getAuthenticatedUser(request)
  if (!user) return json({ message: 'Não autenticado' }, 401)

  const url = new URL(request.url)

  if (request.method === 'GET') return listMedia(env)
  if (request.method === 'DELETE') return deleteMedia(url.searchParams.get('url') ?? '', env)
  if (request.method === 'POST') {
    return uploadMedia(request, env, url.pathname.endsWith('/batch'))
  }

  return json({ message: 'Método não permitido' }, 405)
}

export async function serveMedia(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const key = url.pathname.replace(/^\//, '')
  if (!/^uploads\/(images|videos|documents|logos)\/[a-zA-Z0-9._-]+$/.test(key)) {
    return new Response('Arquivo não encontrado', { status: 404 })
  }

  const rangeHeader = request.headers.get('range')
  const object = await env.MEDIA.get(key, rangeHeader ? { range: request.headers } : undefined)
  if (!object) return new Response('Arquivo não encontrado', { status: 404 })

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('content-type', mediaContentType(key))
  headers.set('content-security-policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'")
  headers.set('etag', object.httpEtag)
  headers.set('accept-ranges', 'bytes')
  headers.set('cache-control', 'public, max-age=86400, stale-while-revalidate=604800')
  headers.set('x-content-type-options', 'nosniff')

  let status = 200
  const servedRange = object.range
  if (rangeHeader && servedRange && 'offset' in servedRange && 'length' in servedRange && typeof servedRange.offset === 'number' && typeof servedRange.length === 'number') {
    const start = servedRange.offset
    const end = start + servedRange.length - 1
    headers.set('content-range', `bytes ${start}-${end}/${object.size}`)
    headers.set('content-length', String(servedRange.length))
    status = 206
  } else {
    headers.set('content-length', String(object.size))
  }

  return new Response(object.body, { status, headers })
}

export async function getAuthenticatedUser(request: Request): Promise<AuthorizedUser | null> {
  const token = readCookie(request.headers.get('cookie'), AUTH_COOKIE_NAME)
  if (!token) return null
  return findAuthenticatedAdmin(token)
}

async function uploadMedia(request: Request, env: Env, batch: boolean): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ message: 'Upload inválido' }, 400)
  }

  const fieldName = batch ? 'files' : 'file'
  const entries = form.getAll(fieldName).filter(isUploadedFile)
  const files = batch ? entries.slice(0, MAX_BATCH_FILES) : entries.slice(0, 1)
  if (files.length === 0) return json({ message: batch ? 'Nenhum arquivo enviado' : 'Arquivo não enviado' }, 400)

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (files.some((file) => file.size > MAX_MEDIA_BYTES) || totalBytes > MAX_MEDIA_BYTES) {
    return json({ message: 'O envio deve ter no máximo 95 MB por requisição' }, 413)
  }

  const results: Array<{ tipo: string; url: string; originalName: string }> = []
  for (const file of files) {
    if (!isAllowedMediaFile(file.name, file.type) || !hasMediaSignature(file.name, new Uint8Array(await file.slice(0, 512).arrayBuffer()))) {
      continue
    }

    const extension = getExtension(file.name)
    const folder = mediaFolder(extension, file.type)
    const safeBase = file.name
      .slice(0, Math.max(0, file.name.length - extension.length))
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase().slice(0, 100) || 'media'
    const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeBase}${extension}`
    const key = `uploads/${folder}/${fileName}`

    await env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: mediaContentType(file.name) },
      customMetadata: {
        originalName: file.name.slice(0, 240),
        uploadedAt: new Date().toISOString(),
      },
    })

    results.push({
      tipo: folder === 'videos' ? 'video' : folder === 'images' ? 'imagem' : 'link',
      url: `/${key}`,
      originalName: file.name,
    })
  }

  if (results.length === 0) return json({ message: 'Nenhum arquivo compatível foi enviado' }, 400)
  return json(batch ? results : results[0], 201)
}

async function listMedia(env: Env): Promise<Response> {
  const [images, videos, documents, playlists, layouts] = await Promise.all([
    listFolder(env.MEDIA, 'images', 'imagem'),
    listFolder(env.MEDIA, 'videos', 'video'),
    listFolder(env.MEDIA, 'documents', 'link'),
    readJSON<Playlist[]>('playlists.json', []),
    readJSON<Layout[]>('layouts.json', []),
  ])
  const references = referenceCounts(playlists, layouts)
  const files = [...images, ...videos, ...documents]
    .map((file) => ({ ...file, referencias: references.get(file.url) ?? 0 }))
    .sort((first, second) => second.atualizadoEm.localeCompare(first.atualizadoEm))
  return json(files)
}

async function listFolder(
  bucket: R2Bucket,
  folder: 'images' | 'videos' | 'documents',
  tipo: UploadedMediaFile['tipo'],
): Promise<UploadedMediaFile[]> {
  const prefix = `uploads/${folder}/`
  const files: UploadedMediaFile[] = []
  let cursor: string | undefined

  do {
    const page = await bucket.list({ prefix, cursor })
    for (const object of page.objects) {
      if (object.key.endsWith('/.gitkeep')) continue
      files.push({
        url: `/${object.key}`,
        nome: object.key.slice(prefix.length),
        tipo,
        tamanhoBytes: object.size,
        atualizadoEm: object.uploaded.toISOString(),
      })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  return files
}

async function deleteMedia(mediaUrl: string, env: Env): Promise<Response> {
  const match = mediaUrl.match(/^\/uploads\/(images|videos|documents)\/([a-zA-Z0-9._-]+)$/)
  if (!match) return json({ message: 'URL de mídia inválida' }, 400)

  await env.MEDIA.delete(`uploads/${match[1]}/${match[2]}`)
  const removedReferences = await removeMediaReferences(mediaUrl)
  return json({ url: mediaUrl, removedReferences })
}

async function removeMediaReferences(mediaUrl: string): Promise<number> {
  let removed = 0
  await mutateJSON<Playlist[]>('playlists.json', [], (playlists) =>
    playlists.map((playlist) => {
      const nextItems = playlist.itens.filter((item) => item.arquivo !== mediaUrl)
      removed += playlist.itens.length - nextItems.length
      return { ...playlist, itens: nextItems.map((item, index) => ({ ...item, ordem: index + 1 })) }
    }),
  )
  await mutateJSON<Layout[]>('layouts.json', [], (layouts) =>
    layouts.map((layout) => ({
      ...layout,
      componentes: layout.componentes.map((component) => {
        if (component.conteudo !== mediaUrl) return component
        removed += 1
        return { ...component, conteudo: '' }
      }),
    })),
  )
  return removed
}

function referenceCounts(playlists: Playlist[], layouts: Layout[]): Map<string, number> {
  const counts = new Map<string, number>()
  const add = (url: string) => counts.set(url, (counts.get(url) ?? 0) + 1)
  playlists.forEach((playlist) => playlist.itens.forEach((item) => add(item.arquivo)))
  layouts.forEach((layout) => layout.componentes.forEach((component) => {
    if (component.conteudo.startsWith('/uploads/')) add(component.conteudo)
  }))
  return counts
}

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof value !== 'string' && typeof value.arrayBuffer === 'function'
}

function mediaFolder(extension: string, mimeType: string): 'images' | 'videos' | 'documents' {
  if (mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'images'
  if (mimeType.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) return 'videos'
  return 'documents'
}

function getExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.')
  return index >= 0 ? fileName.slice(index).toLowerCase() : ''
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim()) || null
    } catch {
      return null
    }
  }
  return null
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
