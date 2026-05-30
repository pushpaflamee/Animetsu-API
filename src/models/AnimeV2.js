// src/models/AnimeV2.js
//
// Drop-in replacement for the old Anime model.
// Reads from anime_v2.anime_core  (lightweight fields)
// and  anime_v2.anime_details     (heavy page-only fields)
// and merges them into the same shape the controllers expect.
//
// Usage — in any controller, replace:
//   const Anime = require('../models/Anime');
// with:
//   const Anime = require('../models/AnimeV2');
//
// Every method (findById, find, findOne, findByIdAndUpdate,
// countDocuments, aggregate) works identically to before.

'use strict';

const v2conn = require('../db/v2');

// ── Raw Mongoose models (internal use only) ───────────────────

const { Schema } = require('mongoose');

const coreSchema = new Schema({
  _id:            { type: String },
  anilist_id:     { type: Number },
  mal_id:         { type: Number,  default: null },
  title:          { type: Schema.Types.Mixed, default: {} },
  synonyms:       { type: [String], default: [] },
  slug:           { type: String,  default: null },
  cover_image:    { type: Schema.Types.Mixed, default: {} },
  banner:         { type: String,  default: null },
  clear_logo:     { type: String,  default: null },
  color:          { type: String,  default: null },
  status:         { type: String,  default: null },
  format:         { type: String,  default: null },
  year:           { type: Number,  default: null },
  season:         { type: String,  default: null },
  genres:         { type: [String], default: [] },
  total_eps:      { type: Number,  default: null },
  duration:       { type: Number,  default: null },
  average_score:  { type: Number,  default: null },
  popularity:     { type: Number,  default: null },
  is_adult:       { type: Boolean, default: false },
  source:         { type: String,  default: null },
  type:           { type: String,  default: null },
  start_date:     { type: String,  default: null },
  end_date:       { type: String,  default: null },
  next_airing_ep: { type: Schema.Types.Mixed, default: null },
  trailer:        { type: String,  default: null },
  created_at:     { type: Date },
  updated_at:     { type: Date },
}, { _id: false, versionKey: false });

const detailsSchema = new Schema({
  _id:             { type: String },
  anilist_id:      { type: Number },
  description:     { type: String,  default: null },
  characters:      { type: [Schema.Types.Mixed], default: [] },
  staff:           { type: [Schema.Types.Mixed], default: [] },
  studios:         { type: [Schema.Types.Mixed], default: [] },
  relations:       { type: [Schema.Types.Mixed], default: [] },
  recommendations: { type: [Schema.Types.Mixed], default: [] },
  seasons:         { type: [Schema.Types.Mixed], default: [] },
  tags:            { type: [Schema.Types.Mixed], default: [] },
  data:            { type: Schema.Types.Mixed, default: null },
}, { _id: false, versionKey: false });

const CoreModel    = v2conn.model('AnimeCore',    coreSchema,    'anime_core');
const DetailsModel = v2conn.model('AnimeDetails', detailsSchema, 'anime_details');

// ── Merge helper ──────────────────────────────────────────────
// Combines a core doc + details doc into the shape the old
// Anime model produced. details is optional (some queries skip it).

function merge(core, details) {
  if (!core) return null;
  const c = core.toObject ? core.toObject() : core;
  const d = details
    ? (details.toObject ? details.toObject() : details)
    : {};

  // Reconstruct basic_meta so controllers that read
  // doc.basic_meta.status / doc.basic_meta.genres still work
  const basic_meta = {
    status: c.status || null,
    format: c.format || null,
    year:   c.year   || null,
    genres: c.genres || [],
  };

  // Reconstruct data field — controllers check doc.data to
  // decide whether to call AniList. In v2, details has a
  // pre-built `data` blob stored during migration; if present
  // use it, otherwise signal a rebuild is needed (return null).
  const data = d.data || null;

  return {
    ...c,
    basic_meta,
    // heavy fields from details
    description:     d.description     || null,
    characters:      d.characters      || [],
    staff:           d.staff           || [],
    studios:         d.studios         || [],
    relations:       d.relations       || [],
    recommendations: d.recommendations || [],
    seasons:         d.seasons         || [],
    tags:            d.tags            || [],
    data,
  };
}

// ── Public API ────────────────────────────────────────────────
// Mirrors the Mongoose Model static API used by the controllers.

const AnimeV2 = {

  // findById — used by getInfo, getEpisodes, getServers, getOppaiSources
  // Returns a thenable with .lean() for Mongoose compatibility
  findById(id, projection) {
    const promise = Promise.all([
      CoreModel.findById(id, projection).lean(),
      DetailsModel.findById(id).lean(),
    ]).then(([core, details]) => merge(core, details));

    // Add .lean() as a no-op so controllers can call .findById(id).lean()
    promise.lean = () => promise;
    // Add .select() as a no-op too
    promise.select = () => promise;
    return promise;
  },

  // findOne — used by animeService, responseBuilder
  async findOne(query, projection) {
    const core = await CoreModel.findOne(query, projection).lean();
    if (!core) return null;
    const details = await DetailsModel.findById(core._id).lean();
    return merge(core, details);
  },

  // find — used by getHome, getRecent, getSchedule (lightweight lookups)
  // Returns a thenable with .lean() for compatibility
  find(query, projection) {
    // Returns a Mongoose Query-like object with lean() and sort/skip/limit
    return CoreModel.find(query, projection);
  },

  // countDocuments — used by search, filter
  async countDocuments(query) {
    return CoreModel.countDocuments(query);
  },

  // findByIdAndUpdate — used by getInfo (persisting data blob), updateMeta
  async findByIdAndUpdate(id, update, options) {
    // Split $set fields between core and details
    const setFields = update.$set || {};

    const coreFields   = {};
    const detailFields = {};

    const detailKeys = new Set([
      'description', 'characters', 'staff', 'studios',
      'relations', 'recommendations', 'seasons', 'tags', 'data',
    ]);

    for (const [key, val] of Object.entries(setFields)) {
      if (detailKeys.has(key)) detailFields[key] = val;
      else                     coreFields[key]   = val;
    }

    const ops = [];

    if (Object.keys(coreFields).length) {
      ops.push(
        CoreModel.findByIdAndUpdate(id, { $set: coreFields }, { new: true }).lean()
      );
    }

    if (Object.keys(detailFields).length) {
      ops.push(
        DetailsModel.findByIdAndUpdate(
          id,
          { $set: detailFields },
          { new: true, upsert: true }
        ).lean()
      );
    }

    await Promise.all(ops);

    if (options?.new) return AnimeV2.findById(id);
    return null;
  },

  // aggregate — pass through to CoreModel (used rarely)
  aggregate(pipeline) {
    return CoreModel.aggregate(pipeline);
  },

  // createIndex — no-op (indexes managed by migration scripts)
  createIndex() { return Promise.resolve(); },
};

module.exports = AnimeV2;