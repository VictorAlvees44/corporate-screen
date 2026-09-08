import { Router } from 'express'
import { completeGoogleLogin, getAuthProviders, getCurrentSession, rejectLegacyLogin, logout, startGoogleLogin } from '../controllers/authController'
import { asyncHandler } from '../middleware/errorHandler'
import { googleLoginLimiter } from '../middleware/requestSecurity'

const router = Router()

router.get('/me', asyncHandler(getCurrentSession))
router.get('/providers', asyncHandler(getAuthProviders))
router.get('/google', googleLoginLimiter, asyncHandler(startGoogleLogin))
router.get('/google/callback', asyncHandler(completeGoogleLogin))
router.post('/login', asyncHandler(rejectLegacyLogin))
router.post('/logout', asyncHandler(logout))

export default router
