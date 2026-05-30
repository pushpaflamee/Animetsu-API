// src/routes/publicRoutes.js
const express = require('express');
const router  = express.Router();

const animeController = require('../controllers/animeController');

// ── Core endpoints ───────────────────────────────────────────────────────────

/**
 * GET /v2/api/anime/home
 * Returns home page data: seasonal, trending, popular, top, upcoming.
 * Sourced from AniList (single batched query). Enriched with internal DB _id.
 * Cached for 10 minutes.
 */
router.get('/anime/home', animeController.getHome);

/**
 * GET /v2/api/anime/info/:id
 * Returns full Animetsu-style response for one anime by internal ID.
 */
router.get('/anime/info/:id', animeController.getInfo);

/**
 * GET /v2/api/anime/search?q=&page=&per_page=
 * Searches AniList, auto-inserts new results, returns enriched list.
 */
router.get('/anime/search', animeController.search);

/**
 * GET /v2/api/anime/filter?genre=&year=&format=&status=&sort=&page=&per_page=
 * Filters from local DB (fast, no AniList call).
 */
router.get('/anime/filter', animeController.filter);

// ── Future-ready stubs (won't break existing routes) ─────────────────────────

/**
 * GET /v2/api/anime/eps/:id
 * Returns episode list for an anime. (Not yet implemented)
 */
router.get('/anime/eps/:id', animeController.getEpisodes);

/**
 * GET /v2/api/anime/schedule
 * Returns airing episodes for the next 7 days, sorted by air time.
 */
router.get('/anime/schedule', animeController.getSchedule);

/**
 * GET /v2/api/anime/recent?page=1&per_page=12
 * Returns recently aired episodes with full anime meta, newest first.
 */
router.get('/anime/recent', animeController.getRecent);

/**
 * GET /v2/api/anime/servers/:anime_id/:ep_num
 * Returns available streaming servers for an episode.
 */
router.get('/anime/servers/:anime_id/:ep_num', animeController.getServers);

/* GET /v2/api/anime/oppai/:anime_id/:ep_num
 * Returns encoded streaming sources, skip times, and server details.
 */
router.get('/anime/oppai/:anime_id/:ep_num', animeController.getOppaiSources);


module.exports = router;