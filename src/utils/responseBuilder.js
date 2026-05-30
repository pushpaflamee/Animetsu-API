// src/utils/responseBuilder.js

const Anime = require('../models/AnimeV2');
const idGenerator = require('./idGenerator');
const { getClearLogo } = require('../providers/tvdbProvider');

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function formatDate(dateObj) {
  if (!dateObj || !dateObj.year) return null;
  const d = new Date(dateObj.year, (dateObj.month || 1) - 1, dateObj.day || 1);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function cleanHTML(text) {
  if (!text) return null;
  return text
    .replace(/\\u003Cbr\\u003E/g, "<br>")
    .replace(/\r?\n|\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveInternalId(anilist_id) {
  if (!anilist_id) return null;

  const doc = await Anime.findOne({ anilist_id }, { _id: 1 });
  if (doc) return doc._id;

  // Don't create stubs here — just return a generated ID for embedding in relations.
  // The actual document will be created when that anime is fully ingested.
  return idGenerator.generate();
}

function mapCoverImage(img) {
  if (!img) return null;

  return {
    large: img.extraLarge || null,
    medium: img.large || null,
    small: img.medium || null
  };
}

// ─────────────────────────────────────────────
// 🔥 FINAL SEASONS BUILDER
// ─────────────────────────────────────────────

function buildSeasons(relations, currentAnime) {
  const all = [
    ...relations,
    {
      ...currentAnime,
      relation_type: "CURRENT"
    }
  ];

  // Step 1: Ensure ONLY anime goes into the seasons array (leaves manga alone)
  const animeOnly = all.filter(r =>
    (r.type === "anime" || !r.type) && 
    ["TV", "MOVIE", "ONA", "OVA"].includes(r.format)
  );

  // Step 2: Remove unreleased
  const released = animeOnly.filter(r => r.status !== "NOT_YET_RELEASED");

  // Step 3: Split by format
  const tv = released.filter(r => ["TV", "ONA", "OVA"].includes(r.format));
  const movies = released.filter(r => r.format === "MOVIE");

  // Step 4: Sort TV chronologically
  tv.sort((a, b) => {
      const yearA = a.year || 9999;
      const yearB = b.year || 9999;
      return yearA - yearB;
  });

  // Step 5: Build TV seasons with sequential naming
  const seasons = tv.map((r, i) => ({
    id: r.id,
    anilist_id: r.anilist_id,
    title: r.title,
    format: r.format,
    season: r.season,
    year: r.year,
    type: r.type,
    total_eps: r.total_eps,
    status: r.status,
    genres: r.genres,
    start_date: r.start_date,
    duration: r.duration,
    average_score: r.average_score,
    description: cleanHTML(r.description),
    cover_image: r.cover_image,
    banner: r.banner,
    trailer: r.trailer || null,
    relation: `Season ${i + 1}` // <--- FIX: Sequential TV naming
  }));

  // Step 6: Append movies with strict "Movie" naming
  const movieEntries = movies.map(r => ({
    id: r.id,
    anilist_id: r.anilist_id,
    title: r.title,
    format: r.format,
    season: r.season,
    year: r.year,
    type: r.type,
    total_eps: r.total_eps,
    status: r.status,
    genres: r.genres,
    start_date: r.start_date,
    duration: r.duration,
    average_score: r.average_score,
    description: cleanHTML(r.description),
    cover_image: r.cover_image,
    banner: r.banner,
    trailer: r.trailer || null,
    relation: "Movie" // <--- FIX: Strict Movie naming
  }));

  return [...seasons, ...movieEntries];
}

// ─────────────────────────────────────────────
// MAIN BUILDER
// ─────────────────────────────────────────────

async function buildResponse(raw, internalId) {
  const startDate = formatDate(raw.startDate);
  const endDate = formatDate(raw.endDate);

  const clearLogoPromise = getClearLogo(raw.title, raw.seasonYear);

// ── Relations ─────────────────────────────

  const relations = await Promise.all(
    (raw.relations?.edges || []).map(async (edge) => {
      const n = edge.node;
      const rid = await resolveInternalId(n.id);

      return {
        id: rid,
        anilist_id: n.id,
        title: n.title,
        format: n.format,
        season: n.season,
        year: n.seasonYear,
        type: n.type?.toLowerCase(),
        total_eps: n.episodes,
        status: n.status,
        genres: n.genres,
        start_date: formatDate(n.startDate),
        duration: n.duration,
        average_score: n.averageScore,
        description: cleanHTML(n.description),
        cover_image: mapCoverImage(n.coverImage),
        banner: n.bannerImage,
        trailer: n.trailer?.id || null, 
        relation_type: edge.relationType
      };
    })
  );

  // 🔥 Build Seasons
  const seasons = buildSeasons(relations, {
    id: internalId,
    anilist_id: raw.id,
    title: raw.title,
    format: raw.format,
    season: raw.season,
    year: raw.seasonYear,
    type: raw.type?.toLowerCase(),
    total_eps: raw.episodes,
    status: raw.status,
    genres: raw.genres,
    start_date: startDate,
    duration: raw.duration,
    average_score: raw.averageScore,
    description: raw.description,
    cover_image: mapCoverImage(raw.coverImage),
    banner: raw.bannerImage,
    trailer: raw.trailer?.id || null
  });

  // ── Recommendations ───────────────────────
  const recommendations = await Promise.all(
    (raw.recommendations?.nodes || []).map(async (node) => {
      const n = node.mediaRecommendation;
      if (!n) return null;

      const rid = await resolveInternalId(n.id);

      return {
        id: rid,
        anilist_id: n.id,
        title: n.title,
        format: n.format,
        season: n.season,
        year: n.seasonYear,
        type: n.type?.toLowerCase(),
        total_eps: n.episodes,
        status: n.status,
        genres: n.genres,
        start_date: formatDate(n.startDate),
        duration: n.duration,
        average_score: n.averageScore,
        description: cleanHTML(n.description),
        cover_image: mapCoverImage(n.coverImage),
        banner: n.bannerImage,
        trailer: n.trailer?.id || null // FIX: Properly map trailer IDs
      };
    })
  ).then(r => r.filter(Boolean));

  // ── Characters ────────────────────────────
  const characters = (raw.characters?.edges || []).map(edge => ({
    anilist_id: edge.node.id,
    name: edge.node.name.full,
    image: edge.node.image.large,
    role: edge.role,
    voice_actor: edge.voiceActors?.[0]
      ? {
          anilist_id: edge.voiceActors[0].id,
          name: edge.voiceActors[0].name.full,
          image: edge.voiceActors[0].image.large,
          language: edge.voiceActors[0].languageV2
        }
      : null
  }));

  // ── Staff ────────────────────────────────
  const staff = (raw.staff?.edges || []).map(edge => ({
    anilist_id: edge.node.id,
    name: edge.node.name.full,
    image: edge.node.image.large,
    language: edge.node.languageV2,
    role: edge.role
  }));

  // ── Studios ──────────────────────────────
  const studios = (raw.studios?.edges || []).map(edge => ({
    name: edge.node.name,
    anilist_id: edge.node.id,
    is_main: edge.isMain
  }));

  const clearLogo = await clearLogoPromise;
  
  // Extract primary ranking metrics
  const topRank = (raw.rankings || []).find(r => r.allTime && r.context === 'highest rated all time')?.rank || null;
  const userCount = raw.favourites; // AniList doesn't expose raw "users", favourites is the closest standard metric used.

  // ── FINAL RESPONSE ───────────────────────
  return {
    id: internalId,
    anilist_id: raw.id,
    mal_id: raw.idMal,
    type: raw.type?.toLowerCase(),
    title: raw.title,
    status: raw.status,
    is_adult: raw.isAdult,
    color: raw.coverImage?.color || null,

    clear_logo: clearLogo,

    cover_image: mapCoverImage(raw.coverImage),
    banner: raw.bannerImage,
    description: cleanHTML(raw.description),

    country: raw.countryOfOrigin || "JP",
    source: raw.source,
    hashtag: raw.hashtag,
    total_eps: raw.episodes,
    start_date: startDate,
    end_date: endDate,
    year: raw.seasonYear,
    format: raw.format,

    next_airing_ep: raw.nextAiringEpisode
      ? {
          airing_at: raw.nextAiringEpisode.airingAt,
          ep_num: raw.nextAiringEpisode.episode,
          time_left:
            raw.nextAiringEpisode.airingAt -
            Math.floor(Date.now() / 1000)
        }
      : null,

    duration: raw.duration,
    genres: raw.genres,
    synonyms: raw.synonyms,
    tags: (raw.tags || []).map(t => t.name),

    average_score: raw.averageScore,
    mean_score: raw.meanScore,
    popularity: raw.popularity,
    favourites: raw.favourites,
    trending: raw.trending,

    updated_at: new Date().toISOString(),
    trailer: raw.trailer?.id || null,
    season: raw.season,

    seasons,
    relations,
    recommendations,
    characters,
    staff,
    studios,
    
    // FIX: Append users and rank
    users: userCount,
    rank: topRank
  };
}

module.exports = { buildResponse };