import { Router } from 'express'
import { getMonitoringLogs, getMonitoringStatus } from '../controllers/monitoringController'

const router = Router()

router.get('/status', getMonitoringStatus)
router.get('/logs', getMonitoringLogs)

export default router
