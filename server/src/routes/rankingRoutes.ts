import { Router } from 'express'
import {
  createRanking,
  getRankingById,
  getRankings,
  importRanking,
  importRankingMiddleware,
  removeRanking,
  updateRanking,
} from '../controllers/rankingController'
import { asyncHandler } from '../middleware/errorHandler'

const router = Router()

router.get('/', asyncHandler(getRankings))
router.get('/:id', asyncHandler(getRankingById))
router.post('/', asyncHandler(createRanking))
router.put('/:id', asyncHandler(updateRanking))
router.delete('/:id', asyncHandler(removeRanking))
router.post('/:id/import', importRankingMiddleware, asyncHandler(importRanking))

export default router
