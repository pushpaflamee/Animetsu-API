// src/services/animeService.js

const Anime       = require('../models/Anime');
const idGenerator = require('../utils/idGenerator');

/**
 * buildSlug — converts a title string into a URL-safe slug.
 * e.g. "Blue Lock VS. U-20 JAPAN" → "blue-lock-vs-u-20-japan"
 */
function buildSlug(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * upsert — inserts the anime if it doesn't exist yet,
 * or returns the existing record. Used only by internal ingest flow.
 */
async function upsert(raw) {
  if (!raw || !raw.id) return null;

  let doc = await Anime.findOne({ anilist_id: raw.id });

  if (!doc) {
    const newId = idGenerator.generate();
    const slug  = buildSlug(raw.title?.romaji || raw.title?.english);

    try {
      doc = await Anime.create({
        _id:        newId,
        anilist_id: raw.id,
        mal_id:     raw.idMal || null,
        title:      raw.title || {},
        synonyms:   raw.synonyms || [],
        slug,
        cover_image: {
          large:  raw.coverImage?.extraLarge || null,
          medium: raw.coverImage?.large      || null,
          small:  raw.coverImage?.medium     || null
        },
        banner:     raw.bannerImage || null,
        basic_meta: {
          status: raw.status     || null,
          format: raw.format     || null,
          year:   raw.seasonYear || null,
          genres: raw.genres     || []
        }
      });
    } catch (err) {
      if (err.code === 11000) {
        doc = await Anime.findOne({ anilist_id: raw.id });
      } else {
        throw err;
      }
    }
  }

  return doc;
}

/**
 * findById — fetch a single anime document by internal ID.
 */
async function findById(id) {
  return Anime.findById(id).lean();
}

/**
 * updateMeta — refreshes metadata stored in MongoDB after a forced
 * AniList re-fetch (used by the /refresh internal endpoint).
 */
async function updateMeta(id, raw) {
  const slug = buildSlug(raw.title?.romaji || raw.title?.english);

  return Anime.findByIdAndUpdate(
    id,
    {
      $set: {
        mal_id:   raw.idMal || null,
        title:    raw.title || {},
        synonyms: raw.synonyms || [],
        slug,
        cover_image: {
          large:  raw.coverImage?.extraLarge || null,
          medium: raw.coverImage?.large      || null,
          small:  raw.coverImage?.medium     || null
        },
        banner:     raw.bannerImage || null,
        basic_meta: {
          status: raw.status     || null,
          format: raw.format     || null,
          year:   raw.seasonYear || null,
          genres: raw.genres     || []
        },
        data:       null,   // clear so next /info re-builds from AniList
        updated_at: new Date()
      }
    },
    { new: true }
  ).lean();
}

module.exports = { upsert, findById, updateMeta, buildSlug };
