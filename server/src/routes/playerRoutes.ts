import { Router } from 'express'
import { getPlayerContent, registerPlayer, reportPlayerCompatibility } from '../controllers/playerController'
import { asyncHandler } from '../middleware/errorHandler'
import { playerRegistrationLimiter } from '../middleware/playerRegistrationLimiter'

const router = Router()

router.post('/register', asyncHandler(playerRegistrationLimiter), asyncHandler(registerPlayer))
router.get('/:tvId/content', asyncHandler(getPlayerContent))
router.post('/:tvId/content', asyncHandler(getPlayerContent))
router.post('/:tvId/compatibility', asyncHandler(reportPlayerCompatibility))

export default router
