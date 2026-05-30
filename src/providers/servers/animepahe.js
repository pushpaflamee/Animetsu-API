// src/providers/servers/animepahe.js
const cheerio = require('cheerio');
const StreamCache = require('../../models/StreamCache');
const localCache = require('../../utils/cache');

const SERVER_ID = 'pahe';
const BASE_URL = 'https://animepahe.pw';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DDOS_GUARD_HEADERS = {
  Cookie: "__ddg1_=;__ddg2_=;",
  "Connection": "keep-alive",
  "User-Agent": USER_AGENT
};

// ─── Scraper Utilities ──────────────────────────────────────────────────
function substringBefore(str, pattern) {
  const idx = str.indexOf(pattern);
  return idx === -1 ? str : str.substring(0, idx);
}

function substringAfter(str, pattern) {
  const idx = str.indexOf(pattern);
  return idx === -1 ? str : str.substring(idx + pattern.length);
}

function substringAfterLast(str, pattern) {
  return str.split(pattern).pop() || "";
}

function getMapValue(mapString, key) {
  try {
    const map = JSON.parse(mapString);
    return map[key] != null ? String(map[key]) : "";
  } catch { return ""; }
}

// ─── Decryptor & Unpacker ───────────────────────────────────────────────
function decrypt(packedStr, key, offsetStr, delimiterIndex) {
  const offset = parseInt(offsetStr, 10);
  const delimiter = key[delimiterIndex];
  const radix = delimiterIndex;
  let html = "";
  let i = 0;

  while (i < packedStr.length) {
    let chunk = "";
    while (i < packedStr.length && packedStr[i] !== delimiter) {
      chunk += packedStr[i];
      i++;
    }
    let chunkWithDigits = chunk;
    for (let j = 0; j < key.length; j++) {
      chunkWithDigits = chunkWithDigits.replaceAll(key[j], j.toString());
    }
    const numericValue = parseInt(chunkWithDigits, radix);
    html += String.fromCharCode(numericValue - offset);
    i++;
  }
  return html;
}

class UnBase {
  constructor(radix) {
    this.radix = radix;
    this.dictionary = {};
    const alpha62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const alpha95 = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    
    if (radix > 36) {
      if (radix < 62) this.alphabet = alpha62.substring(0, radix);
      else if (radix === 62) this.alphabet = alpha62;
      else if (radix < 95) this.alphabet = alpha95.substring(0, radix);
      else if (radix === 95) this.alphabet = alpha95;

      for (let i = 0; i < this.alphabet.length; i++) {
        this.dictionary[this.alphabet.charAt(i)] = i;
      }
    } else {
      this.alphabet = "";
    }
  }

  unBase(str) {
    if (this.alphabet === "") return parseInt(str, this.radix);
    let ret = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charAt(str.length - 1 - i);
      const value = this.dictionary[char];
      if (value !== undefined) ret += Math.pow(this.radix, i) * value;
    }
    return ret;
  }
}

function unpackJsAndCombine(packedJS) {
  try {
    const exp = /\}\s*\('(.*)',\s*(.*?),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/s;
    const matches = exp.exec(packedJS);
    if (!matches || matches.length !== 5) return null;

    let payload = matches[1].replace(/\\'/g, "'");
    const radix = parseInt(matches[2], 10) || 36;
    const count = parseInt(matches[3], 10) || 0;
    const symArray = matches[4].split("|");

    const unBase = new UnBase(radix);
    payload = payload.replace(/\b\w+\b/g, (word) => {
      const index = unBase.unBase(word);
      return (index < symArray.length && symArray[index]) ? symArray[index] : word;
    });

    return payload;
  } catch { return null; }
}

// ─── Extraction Logic ───────────────────────────────────────────────────
// Add a variable at the top of your file to hold the session
let kwikCookie = "";

async function extractDirect(kwikLink) {
  // 1. Initial Handshake to acquire session cookies
  const initialRes = await fetch(kwikLink, {
    headers: {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL,
    }
  });
  
  // Save the cookies sent by Kwik (e.g., _ddg2_, etc.)
  const setCookie = initialRes.headers.get("set-cookie");
  if (setCookie) kwikCookie = setCookie;

  // 2. Main Request with Handshake Cookies and proper Browser Headers
  const res = await fetch(kwikLink, {
    headers: {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL,
      "Cookie": kwikCookie, // Essential for bypassing the block
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site",
      "Upgrade-Insecure-Requests": "1"
    }
  });

  const body = await res.text();
  
  // 3. Debugging: If the page structure changes, this helps you see why
  if (!body.includes("eval(function")) {
    console.error("[AnimePahe] Failed to find packed script. Page content might be a challenge/403.");
    throw new Error("No packed script found. Page might be blocked or structure changed.");
  }

  const $ = cheerio.load(body);
  let packedScript = "";
  $("script").each((_, el) => {
    const content = $(el).html() || "";
    if (content.includes("eval(function")) packedScript = content;
  });

  // 4. Extraction
  const scriptPart = substringAfterLast(packedScript, "eval(function(");
  const unpacked = unpackJsAndCombine("eval(function(" + scriptPart);
  
  // Improved extraction regex to be more flexible with single/double quotes
  const videoUrl = unpacked.match(/const\s+source\s*=\s*['"]([^'"]+)['"]/)?.[1];

  if (!videoUrl || !videoUrl.startsWith("http")) {
    throw new Error("Failed to extract video URL from unpacked script");
  }

  return videoUrl;
}

// ─── Provider Methods ───────────────────────────────────────────────────

async function searchPahe(query) {
  const res = await fetch(`${BASE_URL}/api?m=search&l=8&q=${encodeURIComponent(query)}`, { headers: DDOS_GUARD_HEADERS });
  const json = await res.json().catch(() => null);
  return json?.data || [];
}

async function mapAnilistId(animeDoc) {
  const cacheKey = `pahe:map:${animeDoc.anilist_id}`;
  let mappedId = localCache.get(cacheKey);
  if (mappedId) return mappedId;

  const titleEng = animeDoc.title?.english;
  const titleRom = animeDoc.title?.romaji;
  const year = animeDoc.basic_meta?.year;

  let results = [];
  if (titleEng) results = await searchPahe(titleEng);
  if (!results.length && titleRom) results = await searchPahe(titleRom);
  if (!results.length) return null;

  const exactMatch = results.find(r => r.year === year) || results[0];
  if (exactMatch?.session) {
    localCache.set(cacheKey, exactMatch.session, 86400 * 7); // Cache for 7 days
    return exactMatch.session;
  }
  return null;
}

async function fetchAllEpisodes(paheId) {
  const cacheKey = `pahe:eps:${paheId}`;
  let eps = localCache.get(cacheKey);
  if (eps) return eps;

  eps = [];
  try {
    const res = await fetch(`${BASE_URL}/api?m=release&id=${paheId}&sort=episode_asc&page=1`, { headers: DDOS_GUARD_HEADERS });
    const firstPage = await res.json();
    if (!firstPage?.data) return [];
    
    eps.push(...firstPage.data);
    
    if (firstPage.last_page > 1) {
      const pageNumbers = Array.from({ length: firstPage.last_page - 1 }, (_, i) => i + 2);
      const remaining = await Promise.all(pageNumbers.map(async page => {
        const r = await fetch(`${BASE_URL}/api?m=release&id=${paheId}&sort=episode_asc&page=${page}`, { headers: DDOS_GUARD_HEADERS });
        return r.json().catch(() => null);
      }));
      for (const p of remaining) {
        if (p?.data) eps.push(...p.data);
      }
    }

    localCache.set(cacheKey, eps, 3600); // Cache episode list for 1 hour
    return eps;
  } catch { return []; }
}

async function fetchAndDecodeStreams(paheId, epSession) {
  const res = await fetch(`${BASE_URL}/play/${paheId}/${epSession}`, { headers: DDOS_GUARD_HEADERS });
  const html = await res.text();
  const $ = cheerio.load(html);

  const buttons = $("div#resolutionMenu > button").toArray();
  const streams = [];

  const decodeJobs = buttons.map(async (btn) => {
    const el = $(btn);
    const audio = el.attr("data-audio") || "jpn"; // jpn = sub, eng = dub
    const kwikLink = el.attr("data-src");
    const quality = el.attr("data-resolution") || "unknown";

    if (!kwikLink) return null;

    try {
      const directUrl = await extractDirect(kwikLink);
      if (directUrl) {
        return {
          label: `${audio === "eng" ? "dub" : "sub"}-${quality}p`,
          type: audio === "eng" ? "dub" : "sub",
          quality: `${quality}p`,
          url: directUrl
        };
      }
    } catch (e) {
      console.error(`[AnimePahe] Extraction failed for ${quality}p ${audio}`);
    }
    return null;
  });

  const results = await Promise.all(decodeJobs);
  return results.filter(Boolean);
}

// ─── Required API Interfaces ────────────────────────────────────────────

async function checkAvailability(animeDoc, epNum) {
  if (!animeDoc.anilist_id) return { available: false, error: 'No Anilist ID' };

  try {
    const paheId = await mapAnilistId(animeDoc);
    if (!paheId) return { available: false, error: 'Not found on Animepahe' };

    const episodes = await fetchAllEpisodes(paheId);
    const targetEp = episodes.find(e => e.episode === epNum);

    return { 
      available: !!targetEp, 
      error: targetEp ? null : `Episode ${epNum} not found in Animepahe list` 
    };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

async function getSources(animeDoc, epNum, sourceType) {
  if (!animeDoc.mal_id) throw new Error('No MAL ID available');

  // Check DB Cache first
  const now = new Date();
  const cached = await StreamCache.findOne({
    server: SERVER_ID,
    mal_id: animeDoc.mal_id,
    ep_num: epNum
  }).lean();

  let streams = [];
  if (cached && cached.expires_at > now && cached.streams && cached.streams.length > 0) {
    streams = cached.streams;
  } else {
    // Re-fetch
    const paheId = await mapAnilistId(animeDoc);
    if (!paheId) throw new Error('Could not map Anilist ID to AnimePahe');

    const episodes = await fetchAllEpisodes(paheId);
    const targetEp = episodes.find(e => e.episode === epNum);
    if (!targetEp) throw new Error('Episode not found on AnimePahe');

    streams = await fetchAndDecodeStreams(paheId, targetEp.session);

    if (streams.length > 0) {
      await StreamCache.findOneAndUpdate(
        { server: SERVER_ID, mal_id: animeDoc.mal_id, ep_num: epNum },
        { 
          $set: { 
            streams, 
            expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000) // Cache Kwik .m3u8 for 2 hours
          } 
        },
        { upsert: true, new: true }
      );
    }
  }

  // Filter for 'sub' or 'dub'
  const filtered = streams.filter(s => s.type === sourceType);

  return filtered.map(s => ({
    quality: s.quality,
    raw_url: s.url,
    old_hls: true,
    type: 'video/mpegurl',
  }));
}

module.exports = { checkAvailability, getSources, SERVER_ID, mapAnilistId, fetchAllEpisodes, fetchAndDecodeStreams };