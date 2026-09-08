import { Router } from 'express'
import {
  createSchedule,
  getScheduleById,
  getSchedules,
  removeSchedule,
  updateSchedule,
} from '../controllers/scheduleController'
import { asyncHandler } from '../middleware/errorHandler'

const router = Router()

router.get('/', asyncHandler(getSchedules))
router.get('/:id', asyncHandler(getScheduleById))
router.post('/', asyncHandler(createSchedule))
router.put('/:id', asyncHandler(updateSchedule))
router.delete('/:id', asyncHandler(removeSchedule))

export default router
