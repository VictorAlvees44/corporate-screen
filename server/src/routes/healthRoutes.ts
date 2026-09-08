import { Router } from 'express'
import { statfs } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { listTVs } from '../data/tvRepository'

const router = Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads')
const MIN_FREE_SPACE_BYTES = 2 * 1024 * 1024 * 1024

router.get('/', async (_req, res) => {
  const tvs = await listTVs()
  const incompatibleTVs = tvs.filter((tv) => tv.compatibilidade === 'incompativel').length
  const pendingTVs = tvs.filter((tv) => tv.approvalStatus === 'pendente').length
  const offlineTVs = tvs.filter((tv) => tv.status === 'offline').length
  const alerts: { code: string; count?: number; message: string }[] = []

  if (incompatibleTVs > 0) alerts.push({ code: 'INCOMPATIBLE_TVS', count: incompatibleTVs, message: `${incompatibleTVs} TV(s) com navegador incompatível` })
  if (pendingTVs > 0) alerts.push({ code: 'PENDING_TVS', count: pendingTVs, message: `${pendingTVs} TV(s) aguardando aprovação` })
  if (offlineTVs > 0) alerts.push({ code: 'OFFLINE_TVS', count: offlineTVs, message: `${offlineTVs} TV(s) offline` })

  try {
    const disk = await statfs(UPLOADS_DIR)
    const freeSpace = Number(disk.bavail) * Number(disk.bsize)
    if (freeSpace < MIN_FREE_SPACE_BYTES) alerts.push({ code: 'LOW_DISK_SPACE', message: 'Menos de 2 GB livres para mídias e backups' })
  } catch {
    alerts.push({ code: 'DISK_CHECK_UNAVAILABLE', message: 'Não foi possível verificar o espaço em disco' })
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    alerts,
  })
})

export default router
