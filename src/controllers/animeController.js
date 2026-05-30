// src/controllers/animeController.js

const Anime   = require('../models/AnimeV2');
const anilistProvider  = require('../providers/anilistProvider');
const tvdbProvider = require('../providers/tvdbProvider');
const { buildResponse } = require('../utils/responseBuilder');
const { getSkips } = require('../utils/aniSkip');
const { encode, encodeImage } = require('../utils/cipher');
const serversProvider = require('../providers/servers/index');

const ffmpeg = require('fluent-ffmpeg');

const cache = require('../utils/cache');

// --- NEW HELPER: Probes the video stream for exact codecs ---
function probeStreamAutomatically(streamUrl) {
  return new Promise((resolve) => {
    // If probing takes longer than 3 seconds, fail safely to default codecs
    const timeout = setTimeout(() => {
      resolve({ videoCodec: 'avc1.42E01E', audioCodec: 'mp4a.40.2' });
    }, 3000);

    ffmpeg.ffprobe(streamUrl, (err, metadata) => {
      clearTimeout(timeout);
      if (err) return resolve({ videoCodec: 'avc1.42E01E', audioCodec: 'mp4a.40.2' });

      let videoCodec = 'avc1.42E01E'; // Default H.264
      let audioCodec = 'mp4a.40.2';   // Default AAC

      metadata.streams.forEach(stream => {
        if (stream.codec_type === 'video') {
          if (stream.codec_name === 'hevc') videoCodec = 'hev1.1.6.L93.B0'; 
        } else if (stream.codec_type === 'audio') {
          if (stream.codec_name === 'ac3') audioCodec = 'ac-3';
          else if (stream.codec_name === 'eac3') audioCodec = 'ec-3';
        }
      });
      resolve({ videoCodec, audioCodec });
    });
  });
}

// ─────────────────────────────────────────────────────────────
// GET /v2/api/anime/home
// Returns seasonal, trending, popular, top, and upcoming anime.
// AniList is the source; DB is used to enrich with internal _id.
// Results are enriched with the local DB _id so clients can call
// /info/:id directly. Anime not yet in DB are included without _id.
// ─────────────────────────────────────────────────────────────

exports.getHome = async (req, res, next) => {
  try {
    console.log('[Home API] 1. Starting getHome request...');

    const cacheKey = 'home:full';
    const cached   = cache.get(cacheKey);
    if (cached) {
      console.log('[Home API] Serving from cache.');
      return res.json({ ...cached, from: 'cache' });
    }

    console.log('[Home API] 2. Cache miss. Fetching from AniList...');
    const raw = await anilistProvider.fetchHome();
    
    if (!raw) {
       console.error('[Home API] CRITICAL ERROR: AniList returned undefined or null.');
       return res.status(500).json({ error: "AniList returned empty data" });
    }
    console.log('[Home API] 3. AniList fetch successful. Categories found:', Object.keys(raw));

    const allAnilistIds = [
      ...new Set(
        ['seasonal', 'trending', 'popular', 'top', 'upcoming']
          .flatMap(key => raw[key] ? raw[key].map(m => m.id) : [])
          .filter(Boolean)
      )
    ];
    console.log(`[Home API] 4. Collected ${allAnilistIds.length} unique AniList IDs.`);

    console.log('[Home API] 5. Querying MongoDB for anime documents...');
    const animeDocs = await Anime.find(
      { anilist_id: { $in: allAnilistIds } },
      { _id: 1, anilist_id: 1, title: 1, year: 1, clear_logo: 1, color: 1, updated_at: 1 } 
    ).lean();
    console.log(`[Home API] 6. MongoDB returned ${animeDocs.length} documents.`);

    const idMap = {};
    const missingLogos = [];

    for (const doc of animeDocs) {
      idMap[doc.anilist_id] = { 
        id: String(doc._id), 
        clear_logo: doc.clear_logo || null,
        color: doc.color || null,
        updated_at: doc.updated_at ? new Date(doc.updated_at).toISOString() : null
      };

      if (!doc.clear_logo && doc.title) {
        missingLogos.push(doc);
      }
    }

    console.log(`[Home API] 7. Mapped DB docs. ${missingLogos.length} items missing TVDb logos.`);

    const batchToFetch = missingLogos.slice(0, 5);
    if (batchToFetch.length > 0) {
        console.log(`[Home API] 8. Firing TVDb background fetches for 5 items...`);
    }

    const logoFetchOps = batchToFetch.map(async (doc) => {
      try {
        const logo = await tvdbProvider.getClearLogo(doc.title, doc.year);
        if (logo) {
          await Anime.findByIdAndUpdate(doc._id, { $set: { clear_logo: logo } });
          idMap[doc.anilist_id].clear_logo = logo; 
          console.log(`[Home API] -> TVDb success for: ${doc.title?.romaji}`);
        }
      } catch (err) {
        console.error(`[Home API] -> TVDb error for ${doc.title?.romaji}:`, err.message);
      }
    });

    await Promise.race([
      Promise.allSettled(logoFetchOps),
      new Promise(resolve => setTimeout(() => {
          if (batchToFetch.length > 0) console.log('[Home API] -> TVDb fetch timeout (2s). Moving on...');
          resolve();
      }, 2000)) 
    ]);

    console.log('[Home API] 9. TVDb fetch phase complete. Formatting response...');

    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const formatDate = (d) => {
      if (!d?.year) return null;
      if (d.month && d.day) return `${MONTHS[d.month - 1]} ${d.day}, ${d.year}`;
      if (d.month && !d.day) return `${MONTHS[d.month - 1]} ${d.year}`;
      return String(d.year);
    };

    const formatItem = (media) => {
      try {
          let parsedStudios = [];
          if (media.studios?.edges?.length) {
            parsedStudios = media.studios.edges.map(e => ({
              name:       e.node?.name || '',
              anilist_id: e.node?.id || null,
              is_main:    e.isMain || false, 
            }));
          } else if (media.studios?.nodes?.length) {
            parsedStudios = media.studios.nodes.map(s => ({
              name:       s.name,
              anilist_id: s.id,
              is_main:    false,
            }));
          }

          let desc = media.description 
            ? media.description.replace(/\\u003C/g, '<').replace(/\\u003E/g, '>') 
            : null;

          return {
            id:          idMap[media.id]?.id || null,
            anilist_id:  media.id,
            type:        'anime',
            title: {
              romaji:  media.title?.romaji  || null,
              english: media.title?.english || null,
              native:  media.title?.native  || null,
            },
            status:        media.status       || null,
            is_adult:      media.isAdult      ?? false,
            color:         media.coverImage?.color || idMap[media.id]?.color || null,
            clear_logo:    idMap[media.id]?.clear_logo || null,
            cover_image: {
              large:  media.coverImage?.extraLarge || media.coverImage?.large || null,
              medium: media.coverImage?.large || media.coverImage?.medium || null,
              small:  media.coverImage?.medium || null,
            },
            banner:        media.bannerImage  || null,
            description:   desc,
            source:        media.source       || null,
            total_eps:     media.episodes     || null,
            start_date:    formatDate(media.startDate),
            end_date:      formatDate(media.endDate),
            year:          media.seasonYear   || media.startDate?.year || null,
            format:        media.format       || null,
            next_airing_ep: media.nextAiringEpisode
              ? {
                  airing_at: media.nextAiringEpisode.airingAt,
                  ep_num:    media.nextAiringEpisode.episode,
                  time_left: media.nextAiringEpisode.airingAt - Math.floor(Date.now() / 1000),
                }
              : null,
            duration:      media.duration     || null,
            genres:        media.genres       || [],
            average_score: media.averageScore || null,
            updated_at:    idMap[media.id]?.updated_at || new Date().toISOString(),
            trailer:       media.trailer?.id  || null,
            season:        media.season       || null,
            studios:       parsedStudios,
          };
      } catch (formatErr) {
          console.error(`[Home API] Format Item Error on AniList ID ${media?.id}:`, formatErr);
          return null; // Prevents the whole API from crashing if one anime is broken
      }
    };

    console.log('[Home API] 10. Mapping final arrays...');
    const response = {
      seasonal: raw.seasonal ? raw.seasonal.map(formatItem).filter(Boolean) : [],
      trending: raw.trending ? raw.trending.map(formatItem).filter(Boolean) : [],
      popular:  raw.popular  ? raw.popular.map(formatItem).filter(Boolean)  : [],
      top:      raw.top      ? raw.top.map(formatItem).filter(Boolean)      : [],
      upcoming: raw.upcoming ? raw.upcoming.map(formatItem).filter(Boolean) : [],
    };

console.log('[Home API] 11. Caching and sending response.');
    cache.set(cacheKey, response, 600);
    
    // Force standard JSON formatting to prevent \u003Cbr\u003E outputs
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const rawJsonString = JSON.stringify({ ...response, from: 'api' })
      .replace(/\\u003C/g, '<')
      .replace(/\\u003E/g, '>');
      
    return res.send(rawJsonString);

  } catch (err) {
    console.error('\n==================== [HOME API CRASH] ====================');
    console.error('Message:', err.message);
    console.error('Stack Trace:', err.stack);
    console.error('==========================================================\n');
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /v2/api/anime/info/:id
// Returns full Animetsu-style response for one anime by internal ID.
// ─────────────────────────────────────────────────────────────
exports.getInfo = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // 1. Check if we already have the fully built data blob in the DB
    const doc = await Anime.findById(id).lean();
    if (!doc) return res.status(404).json({ error: 'Anime not found' });
    if (doc.data) return res.json(doc.data);
    
    // 2. If no data blob, fetch fresh from AniList
    const raw = await anilistProvider.fetchAnime(doc.anilist_id);
    
    // 3. Build the massive response payload
    const response = await buildResponse(raw, doc._id);
    
    // 4. Save the built payload to DB so we don't have to build it next time
    await Anime.findByIdAndUpdate(id, { 
      $set: { 
        data: response, 
        updated_at: new Date() 
      } 
    });
    
    return res.json(response);res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const rawJsonString = JSON.stringify(response)
      .replace(/\\u003C/g, '<')
      .replace(/\\u003E/g, '>');
      
    return res.send(rawJsonString);
    
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────
// GET /v2/api/anime/search?q=&page=&per_page=
// Full-text search against MongoDB. No AniList calls.
// ─────────────────────────────────────────────────────────────
exports.search = async (req, res, next) => {
  try {
    const { q, page = 1, per_page = 20 } = req.query;
    if (!q || !q.trim()) return res.status(400).json({ error: 'Query param q is required' });

    const safePage    = Math.max(Number(page), 1);
    const safePerPage = Math.min(Math.max(Number(per_page), 1), 50);
    const skip        = (safePage - 1) * safePerPage;
    const query       = q.trim().toLowerCase();
    const escaped     = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex       = new RegExp(escaped, 'i');

    const [textResults, regexResults] = await Promise.all([
      Anime.find({ $text: { $search: q } }, { score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' } }).limit(500).lean(),
      Anime.find({ $or: [{ 'title.romaji': regex }, { 'title.english': regex }, { 'title.native': regex }, { synonyms: regex }] }).limit(500).lean(),
    ]);

    const seen     = new Set();
    const combined = [];
    for (const doc of [...textResults, ...regexResults]) {
      const key = String(doc._id);
      if (!seen.has(key)) { seen.add(key); combined.push(doc); }
    }

    const scored = combined.map(doc => {
      const romaji  = (doc.title?.romaji  || '').toLowerCase();
      const english = (doc.title?.english || '').toLowerCase();
      const native  = (doc.title?.native  || '').toLowerCase();
      const syns    = (doc.synonyms || []).map(s => s.toLowerCase());
      const titles  = [romaji, english, native, ...syns].filter(Boolean);
      let score = 0;
      for (const t of titles) {
        if (t === query)              score = Math.max(score, 1000);
        else if (t.startsWith(query)) score = Math.max(score, 800);
        else if (t.includes(query))   score = Math.max(score, 600);
        else {
          const queryWords = query.split(/\s+/);
          const titleWords = t.split(/\s+/);
          const matches    = queryWords.filter(w => titleWords.some(tw => tw.includes(w)));
          score = Math.max(score, (matches.length / queryWords.length) * 400);
        }
      }
      return { doc, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const total = scored.length;
    
    // 1. Get the current page core documents
    const pagedCore = scored.slice(skip, skip + safePerPage).map(s => s.doc);

    // 2. Fetch the full DB document to ensure description, duration, etc., exist
    const pagedFull = await Promise.all(pagedCore.map(c => Anime.findById(c._id).lean()));

    // 3. Build payload (Intentionally KEEPING original pagination metadata)
    const payload = { 
      results: pagedFull.map(formatSearchResult), 
      page: safePage, 
      per_page: safePerPage, 
      total 
    };

    // 4. Send response and prevent Express from breaking the HTML <br> tags
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const rawJsonString = JSON.stringify(payload).replace(/\\u003C/g, '<').replace(/\\u003E/g, '>');
    return res.send(rawJsonString);

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────
// GET /v2/api/anime/filter
// Filter from MongoDB only. No AniList calls.
// ─────────────────────────────────────────────────────────────
exports.filter = async (req, res, next) => {
  try {
    const { genre, year, format, status, sort = 'year', page = 1, per_page = 20 } = req.query;
    const safePage    = Math.max(Number(page), 1);
    const safePerPage = Math.min(Math.max(Number(per_page), 1), 50);
    const skip        = (safePage - 1) * safePerPage;
    
    const query = {};
    if (genre)  query['genres'] = genre;
    if (year)   query['year']   = Number(year);
    if (format) query['format'] = format.toUpperCase();
    if (status) query['status'] = status.toUpperCase();
    
    const sortOptions = { year: { year: -1 }, popularity: { popularity: -1 }, score: { average_score: -1 } };
    const sortStage = sortOptions[sort] || { 'basic_meta.year': -1 };
    
    const [coreDocs, total] = await Promise.all([
      Anime.find(query).sort(sortStage).skip(skip).limit(safePerPage).lean(),
      Anime.countDocuments(query)
    ]);

    // Fetch the full DB document to ensure description, duration, etc., exist
    const pagedFull = await Promise.all(coreDocs.map(c => Anime.findById(c._id).lean()));

    // Build payload (Intentionally KEEPING original pagination metadata)
    const payload = { 
      results: pagedFull.map(formatSearchResult), 
      page: safePage, 
      per_page: safePerPage, 
      total 
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const rawJsonString = JSON.stringify(payload).replace(/\\u003C/g, '<').replace(/\\u003E/g, '>');
    return res.send(rawJsonString);

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────
// Shared formatter — shapes a Mongoose doc into the search/filter
// response format.
// ─────────────────────────────────────────────────────────────
function formatSearchResult(doc) {
  // If your DB caches the deep fetch in 'data', pull from there. Otherwise use root.
  const source = doc.data || doc; 

  // Format description: remove newlines, preserve standard spaces and <br>
  let desc = source.description 
    ? source.description.replace(/\\u003Cbr\\u003E/g, "<br>").replace(/\r?\n|\r/g, "").replace(/\s+/g, " ").trim() 
    : null;

  return {
    id:            doc._id,
    type:          'anime',
    title:         source.title        || {},
    status:        source.status       || null,
    is_adult:      source.is_adult     ?? false,
    cover_image:   source.cover_image  || {},
    banner:        source.banner       || null,
    description:   desc,
    total_eps:     source.total_eps    || null,
    start_date:    source.start_date   || null,
    end_date:      source.end_date     || null,
    year:          source.year         || null,
    format:        source.format       || null,
    duration:      source.duration     || null,
    genres:        source.genres       || [],
    average_score: source.average_score || null,
    trailer:       source.trailer      || null,
    season:        source.season       || null
  };
}

// ─────────────────────────────────────────────────────────────
// GET /v2/api/anime/eps/:id
// Returns episode list for an anime by internal anime _id.
// ─────────────────────────────────────────────────────────────
const Episode = require('../models/EpisodeV2');

exports.getEpisodes = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify anime exists
    const anime = await Anime.findById(id, { _id: 1 }).lean();
    if (!anime) return res.status(404).json({ error: 'Anime not found' });

    // Fetch episodes, explicitly excluding unnecessary internal fields
    const episodes = await Episode.find(
      { anime_id: id },
      { anime_id: 0, anilist_id: 0, __v: 0, hot: 0, updated_at: 0 } 
    )
      .sort({ ep_num: 1 })
      .lean();

    // Map to exactly match Animetsu's keys, ordering, and image proxying
    const result = episodes.map(ep => {
      // Encrypt the image URL and format it as a proxy path
      const proxyImg = ep.img ? `/img/ep/${encodeImage(ep.img)}` : null;

      return {
        ep_num:    ep.ep_num,
        aired_at:  ep.aired_at,
        desc:      ep.desc,
        dislikes:  ep.dislikes || 0,
        img:       proxyImg,
        is_filler: ep.is_filler || false,
        likes:     ep.likes || 0,
        name:      ep.name,
        views:     ep.views || 0,
        id:        String(ep._id)
      };
    });

    return res.json(result);
  } catch (err) { next(err); }
};


// ─────────────────────────────────────────────────────────────
// GET /v2/api/anime/schedule
// Returns airing episodes for the next 7 days from episodes
// collection, joined with anime meta. No external API calls.
// ─────────────────────────────────────────────────────────────
exports.getSchedule = async (req, res, next) => {
  try {
    const now  = new Date();
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const to   = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const episodes = await Episode.find(
      { aired_at: { $gte: from, $lte: to } },
      { anime_id: 1, ep_num: 1, aired_at: 1 }
    ).sort({ aired_at: 1 }).lean();

    if (!episodes.length) return res.json([]);

    const animeIds = [...new Set(episodes.map(e => e.anime_id))];

    // Query anime_core directly — color and is_adult are flat fields in v2
    const animes = await Anime.find(
      { _id: { $in: animeIds } },
      { _id: 1, title: 1, cover_image: 1, is_adult: 1, color: 1 }
    ).lean();

    const animeMap = {};
    for (const a of animes) animeMap[String(a._id)] = a;

    const result = episodes.map(ep => {
      const anime = animeMap[String(ep.anime_id)];
      if (!anime) return null;
      return {
        id:          anime._id,
        is_adult:    anime.is_adult  ?? false,   // flat field in anime_core
        title:       anime.title,
        cover_image: anime.cover_image,
        color:       anime.color     || null,     // flat field in anime_core
        airing_at:   ep.aired_at ? new Date(ep.aired_at).getTime() : null,
        airing_ep:   ep.ep_num
      };
    }).filter(Boolean);

    return res.json(result);
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────
// GET /v2/api/anime/recent?page=1&per_page=12
// AniList is the source of truth for what aired recently.
// DB is used to enrich each result with views, ep_name, etc.
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// GET /v2/api/anime/recent
// ─────────────────────────────────────────────────────────────
exports.getRecent = async (req, res, next) => {
  try {
    const page    = Math.max(Number(req.query.page)     || 1, 1);
    const perPage = Math.min(Number(req.query.per_page) || 12, 50);

    const [anilistData, jikanData] = await Promise.all([
      anilistProvider.fetchRecentlyAired({ page, perPage }),
      fetchJikanRecent(page, perPage).catch(() => []), 
    ]);

    const { pageInfo, schedules } = anilistData;
    if (!schedules.length && !jikanData.length) {
      return res.json({ current_page: page, last_page: 1, results: [] });
    }

    const anilistIds = new Set(schedules.map(s => s.media?.id).filter(Boolean));
    const jikanExtras = jikanData.filter(j => !anilistIds.has(j.anilist_id));
    const allAnilistIds = [...schedules.map(s => s.media?.id).filter(Boolean), ...jikanExtras.map(j => j.anilist_id)];

    const animeDocs = await Anime.find(
      { anilist_id: { $in: allAnilistIds } }, 
      { _id: 1, anilist_id: 1, title: 1, cover_image: 1, is_adult: 1, status: 1, year: 1 }
    ).lean();

    const animeByAnilist = {};
    for (const doc of animeDocs) animeByAnilist[doc.anilist_id] = doc;

    const matched = [
      ...schedules.map(s => ({ schedule: s, anime: animeByAnilist[s.media?.id] })).filter(p => p.anime),
      ...jikanExtras.map(j => ({ schedule: { episode: j.episode, airingAt: j.airingAt, media: j.media }, anime: animeByAnilist[j.anilist_id] })).filter(p => p.anime),
    ];

    const episodeKeys = matched.map(p => ({ anime_id: String(p.anime._id), ep_num: p.schedule.episode }));
    const episodeDocs = await Episode.find(
      { $or: episodeKeys.map(k => ({ anime_id: k.anime_id, ep_num: k.ep_num })) }, 
      { anime_id: 1, ep_num: 1, name: 1, img: 1, aired_at: 1, views: 1 }
    ).lean();

    const epMap = {};
    for (const ep of episodeDocs) epMap[`${ep.anime_id}:${ep.ep_num}`] = ep;

    const results = matched.map(({ schedule, anime }) => {
      const media      = schedule.media;
      const ep         = epMap[`${String(anime._id)}:${schedule.episode}`];
      
      const characters = (media?.characters?.edges || []).map(edge => ({
        anilist_id:  edge.node.id,
        name:        edge.node.name.full,
        image:       edge.node.image.large,
        role:        edge.role,
        // FIX: Match Animetsu's empty object format for missing voice actors
        voice_actor: edge.voiceActors?.[0] 
          ? { 
              anilist_id: edge.voiceActors[0].id, 
              name: edge.voiceActors[0].name.full, 
              image: edge.voiceActors[0].image.large, 
              language: edge.voiceActors[0].languageV2 
            } 
          : {
              anilist_id: null,
              name: null,
              image: null,
              language: null
            },
      }));

      // FIX: Encrypt the episode image and map it to the banner field
      const encryptedBanner = ep?.img ? `/img/ep/${encodeImage(ep.img)}` : null;

      return {
        id:          anime._id,
        type:        'anime',
        aired_at:    schedule.airingAt ? schedule.airingAt * 1000 : null,
        ep_num:      schedule.episode,
        anilist_id:  media?.id || anime.anilist_id,
        title:       anime.title,
        status:      media?.status || anime.status || null,
        is_adult:    media?.isAdult ?? anime.is_adult ?? false,
        cover_image: anime.cover_image,
        banner:      encryptedBanner, // <-- Replaces ep_img
        year:        anime.year || media?.seasonYear || null,
        characters,
        views:       ep?.views    || 0,
        ep_name:     ep?.name     || `Episode ${schedule.episode}`
      };
    });

    const lastPage = pageInfo.lastPage || Math.ceil((pageInfo.total || results.length) / perPage);
    return res.json({ current_page: page, last_page: lastPage, results });
  } catch (err) { next(err); }
};

// ── Jikan recently aired helper ───────────────────────────────
// Fetches recently aired episodes from MAL via Jikan as a supplement
async function fetchJikanRecent(page, perPage) {
  const https = require('https');
  return new Promise((resolve) => {
    const req = https.get(
      `https://api.jikan.moe/v4/watch/episodes?page=${page}`,
      { headers: { 'Accept': 'application/json' }, timeout: 8000 },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const items  = parsed.data || [];
            const result = items.flatMap(item =>
              (item.episodes || []).map(ep => ({
                anilist_id: null, // Jikan has mal_id only — matched below
                mal_id:     item.entry?.mal_id,
                episode:    ep.episode_number || ep.mal_id,
                airingAt:   item.entry?.aired
                  ? Math.floor(new Date(item.entry.aired).getTime() / 1000)
                  : null,
                media: {
                  id:          null,
                  title:       { romaji: item.entry?.title, english: item.entry?.title },
                  status:      null,
                  isAdult:     false,
                  coverImage:  { large: item.entry?.images?.jpg?.large_image_url },
                  characters:  { edges: [] },
                },
              }))
            );
            resolve(result);
          } catch { resolve([]); }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}


// ─────────────────────────────────────────────────────────────
// GET /v2/api/anime/servers/:anime_id/:ep_num
// Returns available streaming servers for a given episode.
// ─────────────────────────────────────────────────────────────
const { getAvailableServers } = require('../providers/servers/index');

exports.getServers = async (req, res, next) => {
  try {
    const { anime_id, ep_num } = req.params;
    const epNum = Number(ep_num);
    
    if (!anime_id || isNaN(epNum) || epNum < 1) {
      return res.status(400).json({ error: 'Invalid anime_id or ep_num' });
    }
    
    const anime = await Anime.findById(anime_id, {
      _id: 1, mal_id: 1, anilist_id: 1, title: 1
    }).lean();
    
    if (!anime) return res.status(404).json({ error: 'Anime not found' });
    if (!anime.mal_id) return res.status(422).json({ error: 'Anime has no MAL ID - cannot query servers' });

    // Grab the new object returning both available servers and debug data
    const serverData = await getAvailableServers(anime, epNum);
    const servers = serverData.available || [];
    const debug = serverData.debugInfo || {};

    if (!servers.length) {
      return res.status(404).json({ 
        error: 'No servers available for this episode',
        debug // <--- Debug info is now attached to the response
      });
    }
    
    return res.json(servers);
  } catch (err) { next(err); }
};

// GET /v2/api/anime/oppai/:anime_id/:ep_num?server=gojo&source_type=sub
exports.getOppaiSources = async (req, res, next) => {
  try {
    const { anime_id, ep_num } = req.params;
    let { server = 'gojo', source_type = 'sub' } = req.query;
    const epNumInt = Number(ep_num);

    // --- NEW: Map 'default' to 'gojo' ---
    if (server === 'default') {
      server = 'gojo';
    }

    if (!anime_id || isNaN(epNumInt) || epNumInt < 1) {
      return res.status(400).json({ error: 'Invalid anime_id or ep_num' });
    }

    // 1. Fetch Anime from DB
    const anime = await Anime.findById(anime_id, {
      _id: 1, mal_id: 1, anilist_id: 1, title: 1
    }).lean();

    if (!anime) return res.status(404).json({ error: 'Anime not found' });
    if (!anime.mal_id) return res.status(422).json({ error: 'Anime has no MAL ID' });


// 2. Fetch Sources from Provider using the resolved server name
    let sourcesRaw;
    try {
      sourcesRaw = await serversProvider.getSources(server, anime, epNumInt, source_type);
    } catch (err) {
      return res.status(404).json({ error: err.message});
    }

    if (!sourcesRaw || !sourcesRaw.length) {
      return res.status(404).json({ error: `No ${source_type} sources found for server ${server}` });
    }

    // 3. Probe the highest quality stream dynamically
    let detectedCodecs = { videoCodec: 'avc1.42E01E', audioCodec: 'mp4a.40.2' };
    if (sourcesRaw[0]?.raw_url) {
      // NOTE: Ensure probeStreamAutomatically is defined at the top of this file!
      detectedCodecs = await probeStreamAutomatically(sourcesRaw[0].raw_url); 
    }

        // ── 4A. Build the Auto (Master Playlist) Source ──
    let sources;

    if (server === 'hindi1') {
      sources = sourcesRaw.map(src => ({
        quality : src.quality,
        url     : `/proxy/oppai/${server}/${encode(src.raw_url)}`,
        old_hls : src.old_hls,
        type    : src.type,
      }));
    } else {
      const isAlreadyMaster = sourcesRaw.length === 1 && 
        (sourcesRaw[0].raw_url.includes('master.m3u8') || sourcesRaw[0].quality === 'default' || sourcesRaw[0].quality === 'auto');

      const individualSources = sourcesRaw.map(src => {
        const payload = { u: src.raw_url };
        if (src.embed_url) payload.r = src.embed_url;

        return {
          quality : src.quality === 'default' ? 'Auto' : src.quality,
          url     : `/proxy/oppai/${server}/${encode(JSON.stringify(payload))}`,
          old_hls : src.old_hls,
          type    : src.type,
        };
      });

      if (isAlreadyMaster) {
        sources = individualSources;
      } else {
        const masterPayload = {
          m: true,
          s: sourcesRaw.map(src => ({ q: src.quality, u: src.raw_url })),
          c: detectedCodecs
        };
        const autoSource = {
          quality: 'Auto',
          url: `/proxy/oppai/${server}/${encode(JSON.stringify(masterPayload))}`,
          type: 'application/vnd.apple.mpegurl'
        };
        sources = [autoSource, ...individualSources];
      }
    }

    // 5. Fetch AniSkip Timestamps
    const skips = await getSkips(anime.mal_id, epNumInt);

    // 6. Return response
    return res.json({
      sources,
      skips,
      server
    });

  } catch (err) { next(err); }
};