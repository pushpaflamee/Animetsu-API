// src/models/Episode.js

const mongoose = require('mongoose');

const episodeSchema = new mongoose.Schema(
  {
    _id:        { type: String },
    anime_id:   { type: String, required: true },
    anilist_id: { type: Number, required: true },
    ep_num:     { type: Number, required: true },
    name:       { type: String, default: null },
    desc:       { type: String, default: null },
    img:        { type: String, default: null },
    aired_at:   { type: Date,   default: null },
    is_filler:  { type: Boolean, default: false },
    likes:      { type: Number, default: 0 },
    dislikes:   { type: Number, default: 0 },
    hot:        { type: Number, default: 0 },
    views:      { type: Number, default: 0 },
    updated_at: { type: Date,   default: Date.now }
  },
  { _id: false, versionKey: false }
);

episodeSchema.index({ anime_id: 1, ep_num: 1 }, { unique: true });
episodeSchema.index({ anilist_id: 1 });

module.exports = mongoose.model('Episode', episodeSchema, 'episodes');