import { Router } from 'express'
import { getSettingsHandler, refreshPlayersHandler, updateSettingsHandler } from '../controllers/settingsController'
import { asyncHandler } from '../middleware/errorHandler'

const router = Router()

router.get('/', asyncHandler(getSettingsHandler))
router.put('/', asyncHandler(updateSettingsHandler))
router.post('/refresh-players', asyncHandler(refreshPlayersHandler))

export default router
