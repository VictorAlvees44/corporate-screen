import { Router } from 'express'
import {
  createPlaylist,
  getPlaylistById,
  getPlaylists,
  removePlaylist,
  updatePlaylist,
} from '../controllers/playlistController'
import { asyncHandler } from '../middleware/errorHandler'

const router = Router()

router.get('/', asyncHandler(getPlaylists))
router.get('/:id', asyncHandler(getPlaylistById))
router.post('/', asyncHandler(createPlaylist))
router.put('/:id', asyncHandler(updatePlaylist))
router.delete('/:id', asyncHandler(removePlaylist))

export default router
