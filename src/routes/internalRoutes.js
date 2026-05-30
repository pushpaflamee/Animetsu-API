// src/routes/internalRoutes.js
const express    = require('express');
const router     = express.Router();

const internalController = require('../controllers/internalController');
const apiKeyAuth         = require('../middleware/apiKeyAuth');

// All internal routes require a valid x-api-key header.
// Apply the middleware at router level so every route below is protected.
router.use(apiKeyAuth);

/**
 * POST /v2/internal/anime/anilist/:anilist_id
 * Ingests an anime from AniList into the local database.
 *
 * Headers:
 *   x-api-key: <INTERNAL_API_KEY from .env>
 *
 * Response 201: { message, id, anilist_id }
 * Response 200: { message: 'Already exists', id, anilist_id }
 * Response 400: { error: 'Invalid anilist_id' }
 */
router.post('/anime/anilist/:anilist_id', internalController.ingest);

/**
 * DELETE /v2/internal/anime/:id
 * Removes an anime from the local database by internal ID.
 * Does NOT delete from AniList — only removes local record.
 *
 * Response 200: { message: 'Deleted', id }
 * Response 404: { error: 'Not found' }
 */
router.delete('/anime/:id', internalController.remove);

/**
 * PUT /v2/internal/anime/refresh/:id
 * Forces a cache bust and re-fetches metadata from AniList
 * for an already-ingested anime.
 *
 * Response 200: { message: 'Refreshed', id, anilist_id }
 * Response 404: { error: 'Not found' }
 */
router.put('/anime/refresh/:id', internalController.refresh);

module.exports = router;