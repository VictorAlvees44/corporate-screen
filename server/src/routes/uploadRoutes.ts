import { Router } from 'express'
import {
  deleteUploadedMedia,
  listUploadedMedia,
  uploadMedia,
  uploadMediaBatch,
  uploadMediaBatchMiddleware,
  uploadMediaMiddleware,
} from '../controllers/uploadController'
import { asyncHandler } from '../middleware/errorHandler'

const router = Router()

router.get('/media', asyncHandler(listUploadedMedia))
router.post('/media', uploadMediaMiddleware, asyncHandler(uploadMedia))
router.post('/media/batch', uploadMediaBatchMiddleware, asyncHandler(uploadMediaBatch))
router.delete('/media', asyncHandler(deleteUploadedMedia))

export default router
