// src/providers/tvdbProvider.js
const axios = require('axios');

const TVDB_BASE    = 'https://api4.thetvdb.com/v4';
const TVDB_API_KEY = process.env.TVDB_API_KEY;

let cachedToken     = null;
let tokenExpiresAt  = 0;
let authPromise     = null; 

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;
  if (authPromise) return authPromise;

  authPromise = axios.post(`${TVDB_BASE}/login`, {
    apikey: TVDB_API_KEY
  }, {
    headers: { 'Content-Type': 'application/json' }
  }).then(res => {
    cachedToken    = res.data.data.token;
    tokenExpiresAt = now + 23 * 60 * 60 * 1000; 
    authPromise    = null; 
    return cachedToken;
  }).catch(err => {
    authPromise = null;
    throw err;
  });

  return authPromise;
}

async function searchSeries(title) {
  const token = await getToken();
  const res   = await axios.get(`${TVDB_BASE}/search`, {
    params: { query: title, type: 'series', limit: 5 },
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data.data || [];
}

async function getSeriesArtwork(tvdbId) {
  const token = await getToken();
  const res   = await axios.get(`${TVDB_BASE}/series/${tvdbId}/artworks`, {
    params: { type: 23 }, 
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data.data?.artworks || [];
}

// --- ANIMETSU MATCH FIX: Strip out "Season 2", "Part 3", "Cour 2", "III", etc. ---
function cleanTitleForTVDb(title) {
  if (!title) return '';
  return title
    .replace(/\s\d+(st|nd|rd|th)\sSeason/gi, '')
    .replace(/\sSeason\s\d+/gi, '')
    .replace(/\sPart\s\d+/gi, '')
    .replace(/\sCour\s\d+/gi, '')
    .replace(/\s(II|III|IV|V|VI)$/i, '')
    .replace(/\s\d+$/i, '')
    .trim();
}

async function getClearLogo(title, year) {
  try {
    if (!TVDB_API_KEY) return null;
    
    // Search the cleaned base titles first, then fallback to original titles
    const searchTitles = [
      title.english ? cleanTitleForTVDb(title.english) : null,
      title.romaji ? cleanTitleForTVDb(title.romaji) : null,
      title.english,
      title.romaji
    ].filter(Boolean);
    
    const uniqueTitles = [...new Set(searchTitles)];
    
    for (const searchTitle of uniqueTitles) {
      const results = await searchSeries(searchTitle);
      if (!results.length) continue;
      
      const match = results.find(r => r.year && Number(r.year) === Number(year)) || results[0];
      if (!match?.tvdb_id) continue;
      
      const artworks = await getSeriesArtwork(match.tvdb_id);
      if (!artworks.length) continue;
      
      const logo = artworks[0];
      return logo.image || logo.thumbnail || null;
    }
    return null;
  } catch (err) {
    console.warn('[TVDb] Failed to fetch clear logo:', err.message);
    return null;
  }
}

module.exports = { getClearLogo };