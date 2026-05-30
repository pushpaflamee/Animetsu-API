// src/models/EpisodeV2.js
//
// Drop-in replacement for the old Episode model.
// Points to anime_v2.episodes instead of animedb.episodes.
//
// Usage — in any controller, replace:
//   const Episode = require('../models/Episode');
// with:
//   const Episode = require('../models/EpisodeV2');

'use strict';

const v2conn = require('../db/v2');
const { Schema } = require('mongoose');

const episodeSchema = new Schema(
  {
    _id:        { type: Schema.Types.Mixed },
    anime_id:   { type: String,  required: true },
    anilist_id: { type: Number,  required: true },
    ep_num:     { type: Number,  required: true },
    name:       { type: String,  default: null },
    desc:       { type: String,  default: null },
    img:        { type: String,  default: null },
    aired_at:   { type: Date,    default: null },
    is_filler:  { type: Boolean, default: false },
    likes:      { type: Number,  default: 0 },
    dislikes:   { type: Number,  default: 0 },
    hot:        { type: Number,  default: 0 },
    views:      { type: Number,  default: 0 },
    updated_at: { type: Date,    default: Date.now },
  },
  { _id: false, versionKey: false }
);

episodeSchema.index({ anime_id: 1, ep_num: 1 }, { unique: true });
episodeSchema.index({ anilist_id: 1 });
episodeSchema.index({ aired_at: 1 });

module.exports = v2conn.model('EpisodeV2', episodeSchema, 'episodes');