import type { NextFunction, Request, Response } from 'express'
import { getSettings } from '../data/settingsRepository'

interface Entry {
  startedAt: number
  count: number
}

const WINDOW_MS = 15 * 60_000
const MAX_REGISTRATIONS = 3
const MAX_TRACKED_ADDRESSES = 10_000
const entries = new Map<string, Entry>()

export async function playerRegistrationLimiter(req: Request, res: Response, next: NextFunction) {
  const settings = await getSettings()
  if (!settings.limiteCadastroAtivo) {
    return next()
  }

  const key = req.ip || req.socket.remoteAddress || 'unknown'
  const now = Date.now()
  pruneExpiredEntries(now)
  const current = entries.get(key)
  const entry = !current || now - current.startedAt >= WINDOW_MS ? { startedAt: now, count: 0 } : current

  if (entry.count >= MAX_REGISTRATIONS) {
    return res.status(429).json({ message: 'Limite de novos players atingido. Aguarde 15 minutos ou revise o dispositivo.' })
  }

  entry.count += 1
  entries.set(key, entry)
  next()
}

function pruneExpiredEntries(now: number): void {
  for (const [key, entry] of entries) {
    if (now - entry.startedAt >= WINDOW_MS) entries.delete(key)
  }

  while (entries.size > MAX_TRACKED_ADDRESSES) {
    const oldestKey = entries.keys().next().value as string | undefined
    if (!oldestKey) break
    entries.delete(oldestKey)
  }
}
