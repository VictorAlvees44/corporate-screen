import type { Request, Response } from 'express'
import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { getNetworkUsageSnapshot, getServerStatus } from '../services/systemMonitor'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGS_DIR = path.resolve(__dirname, '../../logs')
const AUDIT_LOG_PATH = path.join(LOGS_DIR, 'audit.jsonl')
const STARTUP_LOG_PATH = path.join(LOGS_DIR, 'startup.log')
const MAX_LOG_LINES = 200

export async function getMonitoringStatus(_req: Request, res: Response) {
  const [status, network] = await Promise.all([getServerStatus(), getNetworkUsageSnapshot()])
  res.json({ status, network })
}

export async function getMonitoringLogs(_req: Request, res: Response) {
  const [audit, startup] = await Promise.all([
    readLastLines(AUDIT_LOG_PATH, MAX_LOG_LINES),
    readLastLines(STARTUP_LOG_PATH, MAX_LOG_LINES),
  ])

  const auditEntries = audit
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as { at: string; user: string; method: string; path: string; status: number }
        return `[${parsed.at}] ${parsed.user} — ${parsed.method} ${parsed.path} (${parsed.status})`
      } catch {
        return line
      }
    })

  res.json({
    audit: auditEntries,
    startup,
  })
}

async function readLastLines(filePath: string, maxLines: number): Promise<string[]> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const lines = content.split('\n').filter((line) => line.trim().length > 0)
    return lines.slice(-maxLines)
  } catch {
    return []
  }
}
