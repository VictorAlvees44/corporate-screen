import { Router } from 'express'
import { getTVs, getTVById, createTV, updateTV, removeTV, approveTV, requestTVDiagnostic, refreshTVHandler } from '../controllers/tvController'
import { asyncHandler } from '../middleware/errorHandler'

const router = Router()

router.get('/', asyncHandler(getTVs))
router.get('/:id', asyncHandler(getTVById))
router.post('/', asyncHandler(createTV))
router.post('/:id/diagnose', asyncHandler(requestTVDiagnostic))
router.post('/:id/refresh', asyncHandler(refreshTVHandler))
router.put('/:id/approve', asyncHandler(approveTV))
router.put('/:id', asyncHandler(updateTV))
router.delete('/:id', asyncHandler(removeTV))

export default router
