import { Router } from 'express'
import { createAuthorizedUser, deleteAuthorizedUser, getAuthorizedUsers } from '../controllers/userController'
import { asyncHandler } from '../middleware/errorHandler'

const router = Router()

router.get('/', asyncHandler(getAuthorizedUsers))
router.post('/', asyncHandler(createAuthorizedUser))
router.delete('/:email', asyncHandler(deleteAuthorizedUser))

export default router
