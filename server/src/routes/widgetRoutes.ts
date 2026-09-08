import { Router } from 'express'
import { getTodayBirthdays } from '../controllers/birthdayController'
import { getNewsFeed } from '../controllers/newsController'
import { getRankingById } from '../controllers/rankingController'
import { getWeather } from '../controllers/weatherController'
import { asyncHandler } from '../middleware/errorHandler'

// Rotas públicas (sem autenticação) consumidas pelos widgets do /player.
// O player não tem sessão administrativa, então esses dados precisam ficar
// fora do grupo protegido por requireAuth, assim como /api/player/*.
const router = Router()

router.get('/weather', asyncHandler(getWeather))
router.get('/news', asyncHandler(getNewsFeed))
router.get('/birthdays/today', asyncHandler(getTodayBirthdays))
router.get('/ranking/:id', asyncHandler(getRankingById))

export default router
