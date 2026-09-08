import { Router } from 'express'
import {
  createNewsFeedHandler,
  deleteNewsFeedHandler,
  getNewsSettingsHandler,
  refreshAllNewsFeedsHandler,
  testNewsFeedHandler,
  updateNewsFeedHandler,
} from '../controllers/newsController'
import { asyncHandler } from '../middleware/errorHandler'

const router = Router()

router.get('/', asyncHandler(getNewsSettingsHandler))
router.post('/', asyncHandler(createNewsFeedHandler))
router.post('/refresh', asyncHandler(refreshAllNewsFeedsHandler))
router.post('/test', asyncHandler(refreshAllNewsFeedsHandler))
router.put('/:id', asyncHandler(updateNewsFeedHandler))
router.delete('/:id', asyncHandler(deleteNewsFeedHandler))
router.post('/:id/test', asyncHandler(testNewsFeedHandler))

export default router
