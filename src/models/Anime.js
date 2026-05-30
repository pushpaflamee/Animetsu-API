// src/models/Anime.js
// COMPLETE FILE — paste this entirely, replacing your current file

const mongoose = require('mongoose');

const coverImageSchema = new mongoose.Schema({
  large:  { type: String, default: null },
  medium: { type: String, default: null },
  small:  { type: String, default: null }
}, { _id: false });

const titleSchema = new mongoose.Schema({
  romaji:  { type: String, default: null },
  english: { type: String, default: null },
  native:  { type: String, default: null }
}, { _id: false });

const basicMetaSchema = new mongoose.Schema({
  status: { type: String, default: null },
  format: { type: String, default: null },
  year:   { type: Number, default: null },
  genres: { type: [String], default: [] }
}, { _id: false });

const animeSchema = new mongoose.Schema(
  {
    _id: { type: String },

    // ✅ unique: true here already creates an index automatically.
    // Do NOT also call animeSchema.index({ anilist_id: 1 }) below.
    anilist_id: { type: Number, required: true, unique: true },

    mal_id:      { type: Number, default: null },
    title:       { type: titleSchema,     default: () => ({}) },
    synonyms:    { type: [String],        default: [] },
    slug:        { type: String,          default: null },
    cover_image: { type: coverImageSchema, default: () => ({}) },
    banner:      { type: String,          default: null },
    basic_meta:  { type: basicMetaSchema, default: () => ({}) },
    data:        { type: mongoose.Schema.Types.Mixed, default: null },
    created_at:  { type: Date,            default: Date.now },
    updated_at:  { type: Date,            default: Date.now }
  },
  {
    _id:        false,
    versionKey: false,
    timestamps: false
  }
);

// ── Indexes ──────────────────────────────────────────────────────────────────
// anilist_id is intentionally NOT listed here — unique:true above handles it.
// ll other indexes are safe to define here.

animeSchema.index({ slug: 1 });
animeSchema.index({ 'basic_meta.genres': 1 });
animeSchema.index({ 'basic_meta.year':   1 });
animeSchema.index({ 'basic_meta.format': 1 });
animeSchema.index({ 'basic_meta.status': 1 });
animeSchema.index(
  { 'title.romaji': 'text', 'title.english': 'text', synonyms: 'text' },
  { name: 'title_text_search' }
);

// ── Hooks ────────────────────────────────────────────────────────────────────
animeSchema.pre('save', function (next) {
  this.updated_at = new Date();
  next();
});

animeSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updated_at: new Date() });
  next();
});

module.exports = mongoose.model('Anime', animeSchema);