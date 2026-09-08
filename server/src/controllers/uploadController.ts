import type { Request, Response } from 'express'
import multer from 'multer'
import { randomUUID } from 'crypto'
import path from 'path'
import { promises as fs } from 'fs'
import { fileURLToPath } from 'url'
import { mutateJSON, readJSON } from '../data/jsonStore'
import type { Layout, Playlist, UploadedMediaFile } from '../types'
import { isAllowedMediaFile, hasMediaSignature } from '../utils/mediaValidation'
export { isAllowedMediaFile } from '../utils/mediaValidation'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads')
const MAX_FILES_PER_BATCH = 10
const DEFAULT_MAX_UPLOAD_SIZE_MB = 95
const configuredMaxUploadSizeMb = Number(process.env.MAX_UPLOAD_SIZE_MB ?? DEFAULT_MAX_UPLOAD_SIZE_MB)
export const MAX_UPLOAD_SIZE_BYTES = (
  Number.isFinite(configuredMaxUploadSizeMb) && configuredMaxUploadSizeMb > 0
    ? configuredMaxUploadSizeMb
    : DEFAULT_MAX_UPLOAD_SIZE_MB
) * 1024 * 1024
// Formatos usuais de comunicação visual. Para os vídeos, MP4 (H.264) e
// WebM são os mais compatíveis com navegadores de TVs.
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.jfif', '.png', '.apng', '.gif', '.webp', '.bmp',
  '.avif', '.heic', '.heif', '.ico', '.tif', '.tiff', '.jxl',
])
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.m4v', '.ogv', '.avi', '.mkv', '.mpeg', '.mpg', '.3gp',
])

function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  callback: multer.FileFilterCallback,
) {
  callback(null, isAllowedMediaFile(file.originalname, file.mimetype))
}

const storage = multer.diskStorage({
  destination: async (_req, file, callback) => {
    const folder = getUploadFolder(file)
    const destination = path.join(UPLOADS_DIR, folder)

    try { await fs.mkdir(destination, { recursive: true }); callback(null, destination) }
    catch (error) { callback(error instanceof Error ? error : new Error('Não foi possível preparar o upload'), destination) }
  },
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname)
    const safeName = path
      .basename(file.originalname, extension)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase().slice(0, 100)
    callback(null, `${Date.now()}-${randomUUID()}-${safeName || 'media'}${extension.toLowerCase()}`)
  },
})

export const uploadMediaMiddleware = multer({
  storage,
  fileFilter,
  limits: { files: 1, fileSize: MAX_UPLOAD_SIZE_BYTES },
}).single('file')

// Upload em lote: aceita vários arquivos de uma vez (campo "files"), usado
// pela nova tela de itens de playlist do admin. Arquivos em formato não
// suportado são simplesmente ignorados no fileFilter (multer não aborta o
// lote inteiro por causa de um arquivo inválido), e o handler abaixo avisa
// quantos de fato foram aceitos.
export const uploadMediaBatchMiddleware = multer({
  storage,
  fileFilter,
  limits: { files: MAX_FILES_PER_BATCH, fileSize: MAX_UPLOAD_SIZE_BYTES },
}).array('files', MAX_FILES_PER_BATCH)

export async function uploadMedia(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ message: 'Arquivo não enviado' })
  }

  if (!(await validateUploadedFile(req.file))) return res.status(400).json({ message: 'Conteúdo do arquivo não corresponde ao formato informado.' })
  res.status(201).json(toUploadResult(req.file))
}

export async function uploadMediaBatch(req: Request, res: Response) {
  const uploaded = (req.files as Express.Multer.File[] | undefined) ?? []
  const files: Express.Multer.File[] = []
  for (const file of uploaded) if (await validateUploadedFile(file)) files.push(file)

  if (files.length === 0) {
    return res.status(400).json({ message: 'Nenhum arquivo enviado' })
  }

  res.status(201).json(files.map(toUploadResult))
}

async function validateUploadedFile(file: Express.Multer.File): Promise<boolean> {
  const handle = await fs.open(file.path, 'r')
  const buffer = Buffer.alloc(512)
  let read = 0
  try { read = (await handle.read(buffer, 0, 512, 0)).bytesRead } finally { await handle.close() }
  if (hasMediaSignature(file.originalname, buffer.subarray(0, read))) return true
  await fs.unlink(file.path)
  return false
}

export async function listUploadedMedia(_req: Request, res: Response) {
  const [images, videos, documents, playlists, layouts] = await Promise.all([
    listMediaFolder('images', 'imagem'),
    listMediaFolder('videos', 'video'),
    listMediaFolder('documents', 'link'),
    readJSON<Playlist[]>('playlists.json', []),
    readJSON<Layout[]>('layouts.json', []),
  ])

  const referenceCounts = getMediaReferenceCounts(playlists, layouts)

  res.json(
    [...images, ...videos, ...documents].map((file) => ({
      ...file,
      referencias: referenceCounts.get(file.url) ?? 0,
    })).sort((first, second) =>
      second.atualizadoEm.localeCompare(first.atualizadoEm),
    ),
  )
}

export async function deleteUploadedMedia(req: Request, res: Response) {
  const mediaUrl = String(req.query.url ?? '').trim()

  if (!mediaUrl) {
    return res.status(400).json({ message: 'Informe a URL do arquivo para remover' })
  }

  const filePath = resolveMediaUrl(mediaUrl)

  if (!filePath) {
    return res.status(400).json({ message: 'URL de mídia inválida' })
  }

  try {
    await fs.unlink(filePath)
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error
    }
  }

  const removedReferences = await removeMediaReferences(mediaUrl)

  res.json({ url: mediaUrl, removedReferences })
}

function toUploadResult(file: Express.Multer.File) {
  const mediaKind = getMediaKind(file)
  const folder = getUploadFolder(file)
  const tipo = mediaKind === 'video' ? 'video' : mediaKind === 'image' ? 'imagem' : 'link'

  return {
    tipo,
    url: `/uploads/${folder}/${file.filename}`,
    originalName: file.originalname,
  }
}

async function listMediaFolder(
  folder: 'images' | 'videos' | 'documents',
  tipo: UploadedMediaFile['tipo'],
): Promise<UploadedMediaFile[]> {
  const folderPath = path.join(UPLOADS_DIR, folder)

  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
        .map(async (entry) => {
          const stats = await fs.stat(path.join(folderPath, entry.name))
          return {
            url: `/uploads/${folder}/${entry.name}`,
            nome: entry.name,
            tipo,
            tamanhoBytes: stats.size,
            atualizadoEm: stats.mtime.toISOString(),
          }
        }),
    )

    return files
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return []
    }

    throw error
  }
}

function resolveMediaUrl(mediaUrl: string): string | null {
  const match = mediaUrl.match(/^\/uploads\/(images|videos|documents)\/([^/\\]+)$/)

  if (!match) {
    return null
  }

  const filePath = path.resolve(UPLOADS_DIR, match[1], match[2])
  const uploadsRoot = path.resolve(UPLOADS_DIR)

  return filePath.startsWith(uploadsRoot + path.sep) ? filePath : null
}

function getMediaReferenceCounts(playlists: Playlist[], layouts: Layout[]): Map<string, number> {
  const counts = new Map<string, number>()
  const add = (url: string) => counts.set(url, (counts.get(url) ?? 0) + 1)

  playlists.forEach((playlist) => playlist.itens.forEach((item) => add(item.arquivo)))
  layouts.forEach((layout) => layout.componentes.forEach((component) => {
    if (component.conteudo.startsWith('/uploads/')) add(component.conteudo)
  }))

  return counts
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
        if (component.conteudo !== mediaUrl) {
          return component
        }

        removed += 1
        return { ...component, conteudo: '' }
      }),
    })),
  )

  return removed
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function getUploadFolder(file: Express.Multer.File): 'images' | 'videos' | 'documents' {
  const mediaKind = getMediaKind(file)

  if (mediaKind === 'image') return 'images'
  if (mediaKind === 'video') return 'videos'
  return 'documents'
}

function getMediaKind(file: Express.Multer.File): 'image' | 'video' | 'document' {
  if (file.mimetype.startsWith('image/')) {
    return 'image'
  }

  if (file.mimetype.startsWith('video/')) {
    return 'video'
  }

  const extension = path.extname(file.originalname).toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return 'video'
  }

  return 'document'
}
