import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { OPERATIONAL_TIMEZONE } from '../utils/operationalSchedule'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = path.resolve(__dirname, '../..')
const BACKUP_SCRIPT = path.join(SERVER_DIR, 'scripts', 'backup.mjs')
const CHECK_INTERVAL_MS = 60_000

let lastBackupDay = ''
let backupRunning = false

export function startDailyBackupScheduler(): void {
  if (process.env.INTERNAL_BACKUP_ENABLED !== 'true') return

  const backupTime = parseBackupTime(process.env.BACKUP_TIME ?? '20:00')
  if (!backupTime) {
    console.error('[backup] BACKUP_TIME inválido; use HH:mm. Backup interno desativado.')
    return
  }

  const check = () => {
    const moment = getZonedMoment(new Date())
    const scheduledMinutes = backupTime.hours * 60 + backupTime.minutes
    if (moment.minutesOfDay < scheduledMinutes || lastBackupDay === moment.dayKey) return

    lastBackupDay = moment.dayKey
    void runBackup()
  }

  check()
  setInterval(check, CHECK_INTERVAL_MS)
  console.log(`[backup] Backup interno diário ativo às ${formatTime(backupTime)} (${OPERATIONAL_TIMEZONE}).`)
}

export function parseBackupTime(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return { hours, minutes }
}

async function runBackup(): Promise<void> {
  if (backupRunning) return
  backupRunning = true

  await new Promise<void>((resolve) => {
    const child = spawn(process.execPath, [BACKUP_SCRIPT], {
      cwd: SERVER_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    child.stdout.on('data', (chunk: Buffer) => console.log(`[backup] ${chunk.toString().trim()}`))
    child.stderr.on('data', (chunk: Buffer) => console.error(`[backup] ${chunk.toString().trim()}`))
    child.on('error', (error) => {
      console.error('[backup] Não foi possível iniciar o backup:', error)
      backupRunning = false
      resolve()
    })
    child.on('exit', (code) => {
      if (code !== 0) console.error(`[backup] Processo terminou com código ${code ?? 'desconhecido'}.`)
      backupRunning = false
      resolve()
    })
  })
}

function getZonedMoment(date: Date): { dayKey: string; minutesOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: OPERATIONAL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '00'
  const hours = Number(get('hour'))
  const minutes = Number(get('minute'))
  return {
    dayKey: `${get('year')}-${get('month')}-${get('day')}`,
    minutesOfDay: hours * 60 + minutes,
  }
}

function formatTime(value: { hours: number; minutes: number }): string {
  return `${String(value.hours).padStart(2, '0')}:${String(value.minutes).padStart(2, '0')}`
}
