import { Router } from 'express'
import {
  createBirthday,
  getBirthdayById,
  getBirthdays,
  removeBirthday,
  updateBirthday,
} from '../controllers/birthdayController'
import { asyncHandler } from '../middleware/errorHandler'

const router = Router()

router.get('/', asyncHandler(getBirthdays))
router.get('/:id', asyncHandler(getBirthdayById))
router.post('/', asyncHandler(createBirthday))
router.put('/:id', asyncHandler(updateBirthday))
router.delete('/:id', asyncHandler(removeBirthday))

export default router
