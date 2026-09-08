import type { Request, Response } from 'express'
import { InputValidationError } from '../utils/publicError'
import {
  deletePlaylist,
  findPlaylistById,
  generateNextPlaylistId,
  listPlaylists,
  upsertPlaylist,
} from '../data/playlistRepository'
import type { Playlist, PlaylistItem, PlaylistItemType } from '../types'
import { safeContentUrl } from '../utils/contentSecurity'

interface PlaylistBody {
  nome?: string
  itens?: Partial<PlaylistItem>[]
}

export async function getPlaylists(_req: Request, res: Response) {
  res.json(await listPlaylists())
}

export async function getPlaylistById(req: Request, res: Response) {
  const playlist = await findPlaylistById(req.params.id)

  if (!playlist) {
    return res.status(404).json({ message: 'Playlist não encontrada' })
  }

  res.json(playlist)
}

export async function createPlaylist(req: Request, res: Response) {
  const body = req.body as PlaylistBody
  const id = await generateNextPlaylistId()
  const playlist = normalizePlaylist(id, body)

  await upsertPlaylist(playlist)
  res.status(201).json(playlist)
}

export async function updatePlaylist(req: Request, res: Response) {
  const existing = await findPlaylistById(req.params.id)

  if (!existing) {
    return res.status(404).json({ message: 'Playlist não encontrada' })
  }

  const playlist = normalizePlaylist(existing.id, req.body as PlaylistBody)
  await upsertPlaylist(playlist)
  res.json(playlist)
}

export async function removePlaylist(req: Request, res: Response) {
  const removed = await deletePlaylist(req.params.id)

  if (!removed) {
    return res.status(404).json({ message: 'Playlist não encontrada' })
  }

  res.status(204).send()
}

function normalizePlaylist(id: string, body: PlaylistBody): Playlist {
  const nome = body.nome?.trim()

  if (!nome) {
    throw new InputValidationError('Informe o nome da playlist')
  }

  const itens = (body.itens ?? [])
    .map((item, index) => normalizePlaylistItem(item, index))
    .filter((item): item is PlaylistItem => item !== null)

  return { id, nome, itens }
}

function normalizePlaylistItem(item: Partial<PlaylistItem>, index: number): PlaylistItem | null {
  const arquivo = item.arquivo?.trim()

  if (!arquivo) {
    return null
  }

  return {
    id: item.id?.trim() || `item-${index + 1}`,
    tipo: normalizeItemType(item.tipo),
    arquivo: safeContentUrl(arquivo),
    tempoExibicao: normalizeDuration(item.tempoExibicao),
    ordem: Number.isFinite(item.ordem) ? Number(item.ordem) : index + 1,
  }
}

function normalizeItemType(tipo: PlaylistItemType | undefined): PlaylistItemType {
  if (tipo === 'video' || tipo === 'link') {
    return tipo
  }

  return 'imagem'
}

function normalizeDuration(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 10
  }

  return Math.max(3, Number(value))
}
