import { mutateJSON, readJSON } from './jsonStore'
import type { Playlist } from '../types'

const FILE_NAME = 'playlists.json'

export async function listPlaylists(): Promise<Playlist[]> {
  return readJSON<Playlist[]>(FILE_NAME, [])
}

export async function findPlaylistById(id: string): Promise<Playlist | undefined> {
  const playlists = await listPlaylists()
  return playlists.find((playlist) => playlist.id === id)
}

export async function upsertPlaylist(playlist: Playlist): Promise<Playlist> {
  await mutateJSON<Playlist[]>(FILE_NAME, [], (current) => {
    const index = current.findIndex((item) => item.id === playlist.id)

    if (index >= 0) {
      const next = [...current]
      next[index] = playlist
      return next
    }

    return [...current, playlist]
  })

  return playlist
}

export async function deletePlaylist(id: string): Promise<boolean> {
  let removed = false

  await mutateJSON<Playlist[]>(FILE_NAME, [], (current) => {
    const next = current.filter((playlist) => playlist.id !== id)
    removed = next.length !== current.length
    return next
  })

  return removed
}

export async function generateNextPlaylistId(): Promise<string> {
  const playlists = await listPlaylists()

  const maxNumber = playlists.reduce((max, playlist) => {
    const match = playlist.id.match(/^playlist-(\d+)$/)
    if (!match) return max
    return Math.max(max, Number(match[1]))
  }, 0)

  return `playlist-${String(maxNumber + 1).padStart(3, '0')}`
}
