// src/controllers/internalController.js
// COMPLETE FILE — paste this entirely, replacing your current file

const Anime           = require('../models/Anime');
const anilistProvider = require('../providers/anilistProvider');
const animeService    = require('../services/animeService');
const idGenerator     = require('../utils/idGenerator');
const cache           = require('../utils/cache');

// ─────────────────────────────────────────────────────────────
// POST /v2/internal/anime/anilist/:anilist_id
// Ingest a new anime from AniList into the local database
// ─────────────────────────────────────────────────────────────
exports.ingest = async (req, res, next) => {
  try {
    const anilist_id = Number(req.params.anilist_id);
    if (!anilist_id || isNaN(anilist_id))
      return res.status(400).json({ error: 'Invalid anilist_id' });

    const existing = await Anime.findOne({ anilist_id });
    if (existing)
      return res.json({ message: 'Already exists', id: existing._id, anilist_id });

    const raw = await anilistProvider.fetchAnime(anilist_id);

    const doc = await Anime.create({
      _id:        idGenerator.generate(),
      anilist_id: raw.id,
      mal_id:     raw.idMal || null,
      title:      raw.title || {},
      synonyms:   raw.synonyms || [],
      slug:       animeService.buildSlug(raw.title?.romaji || raw.title?.english),
      cover_image: {
        large:  raw.coverImage?.large  || null,
        medium: raw.coverImage?.medium || null,
        small:  raw.coverImage?.small  || null
      },
      banner:     raw.bannerImage || null,
      basic_meta: {
        status: raw.status     || null,
        format: raw.format     || null,
        year:   raw.seasonYear || null,
        genres: raw.genres     || []
      }
    });

    res.status(201).json({
      message:    'Ingested',
      id:         doc._id,
      anilist_id: doc.anilist_id
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────
// DELETE /v2/internal/anime/:id
// Remove an anime from the local database by internal ID
// ─────────────────────────────────────────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await Anime.findByIdAndDelete(id);
    if (!doc)
      return res.status(404).json({ error: 'Anime not found' });

    // Also bust the AniList cache for this entry
    cache.del(`anilist:full:${doc.anilist_id}`);

    res.json({ message: 'Deleted', id });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────
// PUT /v2/internal/anime/refresh/:id
// Force re-fetch from AniList and update local metadata
// ─────────────────────────────────────────────────────────────
exports.refresh = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await Anime.findById(id);
    if (!doc)
      return res.status(404).json({ error: 'Anime not found' });

    // Bust cache so fetchAnime goes to AniList fresh
    cache.del(`anilist:full:${doc.anilist_id}`);

    const raw    = await anilistProvider.fetchAnime(doc.anilist_id);
    const updated = await animeService.updateMeta(id, raw);

    res.json({
      message:    'Refreshed',
      id:         updated._id,
      anilist_id: updated.anilist_id
    });
  } catch (err) { next(err); }
};