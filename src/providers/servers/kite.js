// src/providers/servers/kite.js
const axios = require('axios');
const cheerio = require('cheerio');
const StreamCache = require('../../models/StreamCache');

const SERVER_ID = 'kite';
const MEGAPLAY_BASE = 'https://megaplay.buzz';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

async function fetchSourceType(malId, anilistId, epNum, type) {
  let pageUrl;
  if (anilistId) pageUrl = `${MEGAPLAY_BASE}/stream/ani/${anilistId}/${epNum}/${type}`;
  else if (malId) pageUrl = `${MEGAPLAY_BASE}/stream/mal/${malId}/${epNum}/${type}`;
  else return null;

  try {
    const { data: html } = await axios.get(pageUrl, {
      timeout: 10000,
      validateStatus: () => true,
      headers: { 
        'User-Agent': USER_AGENT,
        'Referer': 'https://animetsu.live/',
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site'
      }
    });

    const $ = cheerio.load(html);
    const dataId = $('#megaplay-player').attr('data-id');
    if (!dataId) return null;

    const sourceUrl = `${MEGAPLAY_BASE}/stream/getSources?id=${dataId}&id=${dataId}`;
    const { data: sourceData } = await axios.get(sourceUrl, {
      timeout: 10000,
      validateStatus: () => true,
      headers: {
        'User-Agent': USER_AGENT,
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': MEGAPLAY_BASE,
        'Referer': pageUrl,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
      }
    });

    if (!sourceData?.sources?.file) return null;

    return {
      label: 'auto',
      type: type,
      quality: 'auto',
      url: sourceData.sources.file,
      tracks: sourceData.tracks || [],
      intro: sourceData.intro || null,
      outro: sourceData.outro || null
    };
  } catch (err) {
    return null;
  }
}

async function getStreams(animeDoc, epNum) {
  const malId = animeDoc.mal_id;
  const anilistId = animeDoc.anilist_id;
  
  if (!malId && !anilistId) return { streams: [], fromCache: false };

  const now = new Date();
  if (malId) {
    const cached = await StreamCache.findOne({ server: SERVER_ID, mal_id: malId, ep_num: epNum }).lean();
    if (cached && cached.expires_at > now && cached.streams?.length > 0) {
      return { streams: cached.streams, fromCache: true };
    }
  }

  const [subStream, dubStream] = await Promise.all([
    fetchSourceType(malId, anilistId, epNum, 'sub'),
    fetchSourceType(malId, anilistId, epNum, 'dub')
  ]);

  const streams = [subStream, dubStream].filter(Boolean);

  if (streams.length > 0 && malId) {
    await StreamCache.findOneAndUpdate(
      { server: SERVER_ID, mal_id: malId, ep_num: epNum },
      { $set: { streams, expires_at: new Date(Date.now() + 7200000) } }, // 2h cache
      { upsert: true }
    );
  }

  return { streams, fromCache: false };
}

async function checkAvailability(animeDoc, epNum) {
  try {
    const result = await getStreams(animeDoc, epNum);
    return { available: (result.streams?.length > 0) };
  } catch {
    return { available: false };
  }
}

async function getSources(animeDoc, epNum, sourceType) {
  const result = await getStreams(animeDoc, epNum);
  const filtered = (result.streams || []).filter(s => s.type === sourceType);

  if (filtered.length === 0) {
    throw new Error(`No ${sourceType} sources found for server ${SERVER_ID}`);
  }

  return filtered.map(s => ({
    quality: s.quality,
    raw_url: s.url,
    old_hls: true,
    type: 'video/mpegurl',
  }));
}

module.exports = { checkAvailability, getSources, SERVER_ID };