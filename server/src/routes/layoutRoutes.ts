import { Router } from 'express'
import {
  createLayout,
  getLayoutById,
  getLayouts,
  removeLayout,
  updateLayout,
} from '../controllers/layoutController'
import { asyncHandler } from '../middleware/errorHandler'

const router = Router()

router.get('/', asyncHandler(getLayouts))
router.get('/:id', asyncHandler(getLayoutById))
router.post('/', asyncHandler(createLayout))
router.put('/:id', asyncHandler(updateLayout))
router.delete('/:id', asyncHandler(removeLayout))

export default router
