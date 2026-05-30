// src/models/StreamCache.js
const mongoose = require('mongoose');

const streamCacheSchema = new mongoose.Schema(
  {
    server:     { type: String, required: true },
    mal_id:     { type: Number, default: null },      // used by gojo, pahe, kite
    anilist_id: { type: Number, default: null },      // used by hindi1, hindi2
    ep_num:     { type: Number, required: true },
    streams:    { type: mongoose.Schema.Types.Mixed, default: [] },
    expires_at: { type: Date, required: true }
  },
  {
    _id:        true,
    versionKey: false,
    timestamps: false
  }
);

// Separate unique indexes for each ID type
streamCacheSchema.index(
  { server: 1, mal_id: 1, ep_num: 1 },
  { unique: true, partialFilterExpression: { mal_id: { $ne: null } } }
);
streamCacheSchema.index(
  { server: 1, anilist_id: 1, ep_num: 1 },
  { unique: true, partialFilterExpression: { anilist_id: { $ne: null } } }
);

// TTL — auto-delete 1 hour after expiry
streamCacheSchema.index(
  { expires_at: 1 },
  { expireAfterSeconds: 3600 }
);

module.exports = mongoose.model('StreamCache', streamCacheSchema, 'stream_cache');